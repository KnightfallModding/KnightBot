import { EventEmitter } from 'node:events'

import { Actor } from './actor'
import {
  ActorProperty,
  DefaultNameServerAddress,
  EventCaching,
  EventCode,
  GameProperty,
  JoinMode,
  MatchmakingMode,
  OperationCode,
  ParameterCode,
  PHOTON_LIB_VERSION,
  ReceiverGroup,
  WebFlag,
} from './constants'
import { PhotonAbortError, PhotonConnectionError, PhotonError, PhotonStateError } from './errors'
import { Logger } from './logger'
import { PhotonPeer } from './peer'
import { getParam } from './protocol'
import { Room, RoomInfo } from './room'
import type {
  AppStats,
  ClientState,
  CreateRoomOptions,
  DisconnectReason,
  JoinRandomRoomOptions,
  JoinRoomOptions,
  LobbyStatsEntry,
  PhotonClientEvents,
  PhotonClientOptions,
  RaiseEventOptions,
  RoomOps,
  ServerName,
  Vals,
  WebSocketConstructor,
  WireParams,
} from './types'

const peerLogSuffix: Record<ServerName, string> = { nameServer: 'NameServer', master: 'Master', game: 'Game' }

/** Everything a join/create/join-random dance needs beyond the shared choreography. */
interface JoinDanceConfig {
  masterOpCode: number
  masterParams: WireParams
  gameOpCode: number
  /** Name the caller asked for; the master response's RoomName (255) wins when present. */
  requestedName: string
  buildGameParams: (roomName: string) => WireParams
}

/**
 * Promise-first Photon LoadBalancing client: nameserver → master → game server orchestration,
 * lobby room list, join/create/join-random dances, actors, properties and custom events.
 *
 * Cancellation model: the client keeps a monotonically increasing epoch. `disconnect()` and fatal
 * socket failures bump it; every multi-step dance re-checks its captured epoch after each await and
 * rejects with PhotonAbortError on mismatch. There is NO automatic reconnect — consumers own that policy.
 */
export class PhotonClient extends EventEmitter<PhotonClientEvents> {
  readonly #appId: string
  readonly #appVersion: string
  readonly #region: string
  readonly #protocol: 'ws' | 'wss'
  readonly #nameServerAddress: string
  readonly #joinLobby: boolean
  readonly #keepMasterConnection: boolean
  readonly #logger: Logger
  readonly #operationTimeoutMs: number
  readonly #connectTimeoutMs: number
  readonly #keepAliveMs: number
  readonly #webSocketImpl: WebSocketConstructor | undefined
  readonly #myActor: Actor
  /** Joined-room roster incl. the local actor; empty while not joined. */
  readonly #actors = new Map<number, Actor>()
  readonly #roomOps: RoomOps

  #state: ClientState = 'uninitialized'
  /** Bumped by disconnect()/fatal failures; dances captured on an older epoch abort at their next check. */
  #epoch = 0
  /** Serializes connect/join dances — a second dance while one is in flight is a PhotonStateError. */
  #danceActive = false
  #leavePromise: Promise<void> | undefined
  #userId: string | undefined
  /** Auth token (parameter 221) minted by the nameserver, replayed to master/game, refreshed opportunistically. */
  #secret: string | undefined
  #rooms: RoomInfo[] = []
  #room: Room | undefined
  /** Last effective master-client id, for masterClientChange emission. 0 while unknown/not joined. */
  #lastMasterClientId = 0
  /**
   * While the join dance is between game-peer creation and roster build, game events are queued here
   * and drained afterwards: the JoinGame response settles a promise (async continuation) but events
   * dispatch synchronously, so a self Join event bundled into the same socket message would otherwise
   * be processed before the roster exists.
   */
  #pendingGameEvents: Array<{ code: number; vals: Vals }> | undefined
  #nameServerPeer: PhotonPeer | undefined
  #masterPeer: PhotonPeer | undefined
  #gamePeer: PhotonPeer | undefined

  constructor(options: PhotonClientOptions) {
    super()
    this.#appId = options.appId
    this.#appVersion = options.appVersion
    this.#region = options.region
    this.#protocol = options.protocol ?? 'ws'
    this.#nameServerAddress = options.nameServerAddress ?? DefaultNameServerAddress[this.#protocol]
    this.#joinLobby = options.joinLobby ?? true
    this.#keepMasterConnection = options.keepMasterConnection ?? false
    this.#logger = options.logger ?? new Logger()
    this.#operationTimeoutMs = options.operationTimeoutMs ?? 15_000
    this.#connectTimeoutMs = options.connectTimeoutMs ?? 15_000
    this.#keepAliveMs = options.keepAliveMs ?? 3_000
    this.#webSocketImpl = options.webSocketImpl
    this.#userId = options.userId || undefined
    this.#myActor = new Actor(options.name ?? '', -1, true)
    if (this.#userId) this.#myActor.userId = this.#userId
    if (options.customProperties) this.#myActor._updateFromProps(options.customProperties)
    this.#roomOps = {
      sendSetProperties: (properties, expectedProperties) => this.#sendRoomProperties(properties, expectedProperties),
      leaveRoom: () => this.leaveRoom(),
    }
  }

  get state(): ClientState {
    return this.#state
  }

  /** The local actor. Exists from construction; its actorNr is -1 until a room join assigns one. */
  get myActor(): Actor {
    return this.#myActor
  }

  /** The joined room; undefined while not joined. */
  get room(): Room | undefined {
    return this.#room
  }

  /** Lobby room list, kept in sync from GameList (230) / GameListUpdate (229) events. */
  get rooms(): RoomInfo[] {
    return this.#rooms
  }

  /** Joined-room roster incl. the local actor, keyed by actorNr. Empty while not joined. */
  get actors(): ReadonlyMap<number, Actor> {
    return this.#actors
  }

  /** Effective master client: the room's raw masterClientId (GameProperty 248) or the lowest actorNr; 0 if unknown. */
  get masterClientId(): number {
    return this.#computeMasterClientId()
  }

  get masterClient(): Actor | undefined {
    return this.#actors.get(this.#computeMasterClientId())
  }

  /**
   * Connects: nameserver Authenticate (230) with `{ 224: appId, 220: appVersion, 225: userId?, 210: region }`,
   * then master Authenticate with only the returned secret `{ 221 }`, then JoinLobby (229) unless disabled.
   * Resolves at `joinedLobby` (or `connectedToMaster` when `joinLobby: false`).
   *
   * A failed connect tears the peers down quietly and leaves the client in state `error` — the rejection
   * is the report; the `error`/`disconnect` events are reserved for out-of-band failures.
   */
  async connect(): Promise<void> {
    if (this.#state !== 'uninitialized' && this.#state !== 'disconnected' && this.#state !== 'error') {
      throw new PhotonStateError(`connect() is not allowed in state '${this.#state}'`)
    }
    if (this.#danceActive) throw new PhotonStateError('Another connect/join dance is already in flight')
    this.#danceActive = true
    const epoch = this.#epoch
    try {
      await this.#connectDance(epoch)
    } catch (error) {
      if (this.#epoch !== epoch) {
        throw error instanceof PhotonAbortError
          ? error
          : new PhotonAbortError('connect() aborted: client was torn down mid-dance')
      }
      this.#epoch++
      this.#teardownPeers(false)
      this.#setState('error')
      throw error
    } finally {
      this.#danceActive = false
    }
  }

  /**
   * Joins a room by name: master JoinGame (226) → game-server handoff → game Authenticate →
   * replayed JoinGame carrying PlayerProperties (249) — the buffered name/custom properties.
   * A master-side rejection (e.g. GameDoesNotExist 32758) leaves the client in the lobby untouched.
   */
  joinRoom(name: string, options: JoinRoomOptions = {}): Promise<Room> {
    const masterParams: WireParams = {
      [ParameterCode.RoomName]: name,
      [ParameterCode.Add]: options.expectedUsers,
    }
    if (options.createIfNotExists) {
      Object.assign(masterParams, this.#createRoomPayload(), {
        [ParameterCode.JoinMode]: JoinMode.CreateIfNotExists,
      })
    }
    return this.#joinDance({
      masterOpCode: OperationCode.JoinGame,
      masterParams,
      gameOpCode: OperationCode.JoinGame,
      requestedName: name,
      buildGameParams: roomName => {
        const params: WireParams = {
          [ParameterCode.RoomName]: roomName,
          [ParameterCode.Broadcast]: true,
          [ParameterCode.PlayerProperties]: this.#playerProperties(),
          [ParameterCode.Add]: options.expectedUsers,
        }
        if (options.createIfNotExists) {
          Object.assign(params, this.#createRoomPayload(), {
            [ParameterCode.JoinMode]: JoinMode.CreateIfNotExists,
          })
        }
        return params
      },
    })
  }

  /**
   * Creates a room: master CreateGame (227) with the full create payload, then the same payload replayed
   * on the game server plus PlayerProperties (249). An empty/omitted name lets the server assign one
   * (returned via RoomName 255 in the master response).
   */
  createRoom(name?: string, options?: CreateRoomOptions): Promise<Room> {
    const requestedName = name ?? ''
    return this.#joinDance({
      masterOpCode: OperationCode.CreateGame,
      masterParams: {
        ...(requestedName ? { [ParameterCode.RoomName]: requestedName } : {}),
        ...this.#createRoomPayload(options),
      },
      gameOpCode: OperationCode.CreateGame,
      requestedName,
      buildGameParams: roomName => ({
        ...(roomName ? { [ParameterCode.RoomName]: roomName } : {}),
        ...this.#createRoomPayload(options),
        [ParameterCode.PlayerProperties]: this.#playerProperties(),
      }),
    })
  }

  /**
   * Joins a random room: master JoinRandomGame (225) with the matchmaking filters; the matched room's
   * name arrives in the response (255) and the game-server op is a regular JoinGame (226) — legacy parity.
   * NoRandomMatchFound (32760) is the normal "no room" rejection.
   */
  joinRandomRoom(options?: JoinRandomRoomOptions): Promise<Room> {
    return this.#joinDance({
      masterOpCode: OperationCode.JoinRandomGame,
      masterParams: this.#joinRandomPayload(options),
      gameOpCode: OperationCode.JoinGame,
      requestedName: '',
      buildGameParams: roomName => ({
        [ParameterCode.RoomName]: roomName,
        [ParameterCode.Broadcast]: true,
        [ParameterCode.PlayerProperties]: this.#playerProperties(),
      }),
    })
  }

  /**
   * Leaves the joined room: Leave (254) on the game peer (timeout/abort tolerated — teardown proceeds
   * either way), close the game peer, clear the roster with `actorLeave(actor, true)` for every actor
   * incl. the local one. Ends in `joinedLobby` when the master connection was kept, else `disconnected`
   * + a `disconnect` event (kind 'local'). Resolves immediately when not joined (legacy was a silent no-op).
   */
  leaveRoom(): Promise<void> {
    if (this.#state !== 'joined') return Promise.resolve()
    this.#leavePromise ??= this.#leaveDance().finally(() => {
      this.#leavePromise = undefined
    })
    return this.#leavePromise
  }

  /**
   * Raises a custom event, fire-and-forget: RaiseEvent (253) with `{ 244: code, 245: data }` plus the
   * options (246 receivers, 247 cache, 240 interestGroup, 252 targetActors, 234 web flags).
   * @throws {PhotonStateError} when not joined to a room.
   */
  raiseEvent(code: number, data?: unknown, options: RaiseEventOptions = {}): void {
    const game = this.#gamePeer
    if (this.#state !== 'joined' || !game?.isOpen) {
      throw new PhotonStateError('raiseEvent requires a joined room')
    }
    const webFlags =
      (options.webForward ? WebFlag.HttpForward : 0) | (options.sendAuthCookie ? WebFlag.SendAuthCookie : 0)
    game.send(OperationCode.RaiseEvent, {
      [ParameterCode.Code]: code,
      // legacy always sends Data — an omitted payload goes out as null on the JSON wire
      [ParameterCode.Data]: data === undefined ? null : data,
      [ParameterCode.ReceiverGroup]:
        options.receivers !== undefined && options.receivers !== ReceiverGroup.Others ? options.receivers : undefined,
      [ParameterCode.Cache]:
        options.cache !== undefined && options.cache !== EventCaching.DoNotCache ? options.cache : undefined,
      [ParameterCode.Group]: options.interestGroup,
      [ParameterCode.ActorList]: options.targetActors,
      [ParameterCode.WebFlags]: webFlags === 0 ? undefined : webFlags,
    })
  }

  /**
   * Changes interest groups: ChangeGroups (248) with `{ 239: remove?, 238: add? }`.
   * `null`/`undefined` = don't touch; `[]` = remove/add ALL. Removal is processed before addition.
   * Not joined → no-op (legacy parity), logged as a warning.
   */
  changeGroups(remove?: number[] | null, add?: number[] | null): void {
    const game = this.#gamePeer
    if (this.#state !== 'joined' || !game?.isOpen) {
      this.#logger.warn('changeGroups ignored: no joined room')
      return
    }
    game.send(OperationCode.ChangeGroups, {
      [ParameterCode.Remove]: remove ?? undefined,
      [ParameterCode.Add]: add ?? undefined,
    })
  }

  /**
   * Sets the local actor's display name (ActorProperty.PlayerName 255). Pre-join it is buffered on
   * myActor and sent with the join op's PlayerProperties; while joined it is also pushed via
   * SetProperties (252) with `{ 254: actorNr, 251: { 255: name }, 250: true }`.
   */
  setName(name: string): void {
    this.#myActor.name = name
    this.#sendActorProperties({ [ActorProperty.PlayerName]: name })
  }

  /** Sets a custom property of the local actor — same pre-join buffering / post-join SetProperties rule as setName. */
  setCustomProperty(key: string, value: unknown): void {
    this.#myActor._updateFromProps({ [key]: value })
    this.#sendActorProperties({ [key]: value })
  }

  /**
   * Idempotent teardown: bumps the epoch (rejecting in-flight dances with PhotonAbortError via their
   * peers), closes all peers, clears the roster with `actorLeave(actor, true)`, ends in `disconnected`
   * and emits `disconnect` (kind 'local') when the client was on the wire.
   */
  disconnect(): void {
    const wasOnWire = this.#state !== 'uninitialized' && this.#state !== 'disconnected' && this.#state !== 'error'
    const server: ServerName = this.#gamePeer ? 'game' : this.#masterPeer ? 'master' : 'nameServer'
    this.#epoch++
    this.#teardownPeers(true)
    this.#clearRoster()
    this.#room = undefined
    this.#lastMasterClientId = 0
    this.#setState('disconnected')
    if (wasOnWire) this.emit('disconnect', { server, kind: 'local', message: 'disconnect() was called' })
  }

  async #connectDance(epoch: number): Promise<void> {
    this.#setState('connectingToNameServer')
    const nameServer = this.#createPeer('nameServer', this.#nameServerAddress)
    this.#nameServerPeer = nameServer
    nameServer.onEvent = (code, vals) => this.#emitPhotonEvent(code, vals)
    await nameServer.connect()
    this.#checkEpoch(epoch)
    const nsVals = await nameServer.request(OperationCode.Authenticate, {
      [ParameterCode.ApplicationId]: this.#appId,
      [ParameterCode.AppVersion]: this.#appVersion,
      [ParameterCode.UserId]: this.#userId,
      [ParameterCode.Region]: this.#region,
    })
    this.#checkEpoch(epoch)
    this.#adoptIdentity(nsVals)
    this.#secret = getParam<string>(nsVals, ParameterCode.Secret)
    const masterAddress = getParam<string>(nsVals, ParameterCode.Address)
    if (!masterAddress) throw new PhotonError('NameServer Authenticate response carried no master address (230)')
    nameServer.close()
    this.#nameServerPeer = undefined

    this.#setState('connectingToMaster')
    const master = this.#createPeer('master', masterAddress)
    this.#masterPeer = master
    master.onEvent = (code, vals) => this.#handleMasterEvent(code, vals)
    await master.connect()
    this.#checkEpoch(epoch)
    // secret path: ONLY the token, no appId/appVersion/userId (legacy parity)
    const authVals = await master.request(OperationCode.Authenticate, { [ParameterCode.Secret]: this.#secret })
    this.#checkEpoch(epoch)
    this.#adoptIdentity(authVals)
    this.#refreshSecret(authVals)
    this.#setState('connectedToMaster')
    if (this.#joinLobby) {
      const lobbyVals = await master.request(OperationCode.JoinLobby)
      this.#checkEpoch(epoch)
      this.#refreshSecret(lobbyVals)
      this.#setState('joinedLobby')
    }
    // installed only now: mid-dance failures reject connect() instead of firing error/disconnect events
    master.onClose = reason => this.#handleUnexpectedClose(master, reason)
  }

  async #joinDance(config: JoinDanceConfig): Promise<Room> {
    if (this.#state !== 'joinedLobby' && this.#state !== 'connectedToMaster') {
      throw new PhotonStateError(`Cannot join or create a room in state '${this.#state}'`)
    }
    if (this.#danceActive) throw new PhotonStateError('Another connect/join dance is already in flight')
    const master = this.#masterPeer
    if (!master?.isOpen) throw new PhotonStateError('Master connection is not open')
    this.#danceActive = true
    const epoch = this.#epoch
    try {
      let masterVals: Vals
      try {
        masterVals = await master.request(config.masterOpCode, config.masterParams)
      } catch (error) {
        // master-op rejection (e.g. GameDoesNotExist/GameFull): client stays in the lobby, nothing torn down
        if (this.#epoch !== epoch && !(error instanceof PhotonAbortError)) {
          throw new PhotonAbortError('join aborted: client was torn down mid-dance')
        }
        throw error
      }
      this.#checkEpoch(epoch)
      this.#refreshSecret(masterVals)
      const gameAddress = getParam<string>(masterVals, ParameterCode.Address)
      const roomName = getParam<string>(masterVals, ParameterCode.RoomName) || config.requestedName
      if (!gameAddress) {
        throw new PhotonError(`Operation ${config.masterOpCode} response carried no game server address (230)`)
      }
      if (!roomName && config.gameOpCode === OperationCode.JoinGame) {
        throw new PhotonError('Master response carried no room name (255) to join on the game server')
      }

      const previousState = this.#state
      if (!this.#keepMasterConnection) {
        // expected close — must NOT emit disconnect
        master.onClose = undefined
        master.close()
        this.#masterPeer = undefined
      }
      this.#setState('connectingToGameServer')
      const game = this.#createPeer('game', gameAddress)
      this.#gamePeer = game
      this.#pendingGameEvents = []
      game.onEvent = (code, vals) => this.#handleGameEvent(code, vals)
      try {
        await game.connect()
        this.#checkEpoch(epoch)
        await game.request(OperationCode.Authenticate, {
          [ParameterCode.ApplicationId]: this.#appId,
          [ParameterCode.AppVersion]: this.#appVersion,
          [ParameterCode.Secret]: this.#secret,
          [ParameterCode.UserId]: this.#userId,
        })
        this.#checkEpoch(epoch)
        const joinVals = await game.request(config.gameOpCode, config.buildGameParams(roomName))
        this.#checkEpoch(epoch)
        const room = this.#applyJoinResponse(roomName, joinVals)
        this.#setState('joined')
        // initial post-join computation is silent — consumers read client.masterClientId
        this.#lastMasterClientId = this.#computeMasterClientId()
        game.onClose = reason => this.#handleUnexpectedClose(game, reason)
        const queued = this.#pendingGameEvents ?? []
        this.#pendingGameEvents = undefined
        for (const event of queued) this.#handleGameEvent(event.code, event.vals)
        return room
      } catch (error) {
        // no silent stranding: tear the game peer down and land somewhere well-defined
        this.#pendingGameEvents = undefined
        game.close(false)
        if (this.#gamePeer === game) this.#gamePeer = undefined
        if (this.#epoch !== epoch) {
          throw error instanceof PhotonAbortError
            ? error
            : new PhotonAbortError('join aborted: client was torn down mid-dance')
        }
        if (this.#masterPeer?.isOpen) {
          this.#setState(previousState)
        } else {
          this.#setState('disconnected')
          this.emit('disconnect', {
            server: 'game',
            kind: 'local',
            message: `room join failed with no master connection to fall back to: ${
              error instanceof Error ? error.message : String(error)
            }`,
          })
        }
        throw error
      }
    } finally {
      this.#danceActive = false
    }
  }

  /** Builds roster and room from a game-server JoinGame/CreateGame response. Emits no actorJoin (legacy parity). */
  #applyJoinResponse(roomName: string, joinVals: Vals): Room {
    const actorNr = getParam<number>(joinVals, ParameterCode.ActorNr)
    if (typeof actorNr === 'number') this.#myActor.actorNr = actorNr
    this.#actors.clear()
    this.#actors.set(this.#myActor.actorNr, this.#myActor)
    const actorList = getParam<number[]>(joinVals, ParameterCode.ActorList)
    const actorProps = getParam<Record<string, Vals>>(joinVals, ParameterCode.PlayerProperties)
    if (actorList) {
      for (const nr of actorList) {
        const props = actorProps?.[nr]
        if (nr === this.#myActor.actorNr) {
          if (props) this.#myActor._updateFromProps(props)
          continue
        }
        const actor = new Actor('', nr, false)
        if (props) actor._updateFromProps(props)
        this.#actors.set(nr, actor)
      }
    }
    const room = new Room(roomName, this.#roomOps)
    const gameProps = getParam<Vals>(joinVals, ParameterCode.GameProperties)
    if (gameProps) room._updateFromProps(gameProps)
    this.#room = room
    return room
  }

  async #leaveDance(): Promise<void> {
    const epoch = this.#epoch
    const game = this.#gamePeer
    if (game) {
      // we own this teardown: a server-side close of the game socket during leave must not report
      game.onClose = undefined
      try {
        await game.request(OperationCode.Leave)
      } catch (error) {
        this.#logger.warn('Leave operation did not complete cleanly, tearing down anyway', error)
      }
    }
    if (this.#epoch !== epoch) return // disconnect()/failure teardown already ran while we waited
    if (game) {
      game.close()
      if (this.#gamePeer === game) this.#gamePeer = undefined
    }
    this.#clearRoster()
    this.#room = undefined
    this.#lastMasterClientId = 0
    if (this.#masterPeer?.isOpen) {
      this.#setState('joinedLobby')
    } else {
      this.#setState('disconnected')
      this.emit('disconnect', {
        server: 'game',
        kind: 'local',
        message: 'left the room with no master connection to fall back to',
      })
    }
  }

  /** Room SetProperties (252): `{ 251: properties, 250: true, (231: expected CAS table) }` on the game peer. */
  async #sendRoomProperties(
    properties: Record<string, unknown>,
    expectedProperties?: Record<string, unknown>
  ): Promise<void> {
    const game = this.#gamePeer
    if (this.#state !== 'joined' || !game?.isOpen) {
      throw new PhotonStateError('Cannot set room properties: no joined room')
    }
    await game.request(OperationCode.SetProperties, {
      [ParameterCode.Properties]: properties,
      [ParameterCode.Broadcast]: true,
      [ParameterCode.ExpectedValues]: expectedProperties,
    })
  }

  /** Actor SetProperties (252): `{ 254: actorNr, 251: properties, 250: true }`. Pre-join it is a no-op (buffered). */
  #sendActorProperties(properties: Record<string, unknown>): void {
    const game = this.#gamePeer
    if (this.#state !== 'joined' || !game?.isOpen) return
    game
      .request(OperationCode.SetProperties, {
        [ParameterCode.ActorNr]: this.#myActor.actorNr,
        [ParameterCode.Properties]: properties,
        [ParameterCode.Broadcast]: true,
      })
      .catch(error => this.#logger.warn('SetProperties for the local actor failed', error))
  }

  /**
   * CreateGame payload (also replayed for createIfNotExists joins): GameProperties table (248, always
   * sent even when empty), CleanupCacheOnLeave 241=true and Broadcast 250=true (legacy hardcodes),
   * RoomTTL 236 / PlayerTTL 235, CheckUserOnJoin 232 (default true) and PublishUserId 239=true,
   * LobbyName 213 (+LobbyType 212 only alongside it), expectedUsers via Add 238.
   */
  #createRoomPayload(options: CreateRoomOptions = {}): WireParams {
    const gameProperties: Record<string, unknown> = {}
    if (options.isVisible !== undefined) gameProperties[GameProperty.IsVisible] = options.isVisible
    if (options.isOpen !== undefined) gameProperties[GameProperty.IsOpen] = options.isOpen
    if (options.maxPlayers !== undefined) gameProperties[GameProperty.MaxPlayers] = options.maxPlayers
    if (options.propsListedInLobby !== undefined) {
      gameProperties[GameProperty.PropsListedInLobby] = options.propsListedInLobby
    }
    if (options.customGameProperties) Object.assign(gameProperties, options.customGameProperties)
    const params: WireParams = {
      [ParameterCode.GameProperties]: gameProperties,
      [ParameterCode.CleanupCacheOnLeave]: true,
      [ParameterCode.Broadcast]: true,
      [ParameterCode.RoomTTL]: options.roomTTL,
      [ParameterCode.PlayerTTL]: options.playerTTL,
      [ParameterCode.CheckUserOnJoin]: options.uniqueUserId ?? true,
      [ParameterCode.PublishUserId]: true,
    }
    if (options.lobbyName) {
      params[ParameterCode.LobbyName] = options.lobbyName
      if (options.lobbyType !== undefined) params[ParameterCode.LobbyType] = options.lobbyType
    }
    if (options.expectedUsers) params[ParameterCode.Add] = options.expectedUsers
    return params
  }

  /**
   * JoinRandomGame payload: MatchMakingType 223 (omitted when FillRoom), expected properties table
   * under GameProperties 248 (custom props + MaxPlayers 255, omitted when empty), LobbyName 213
   * (+LobbyType 212 only alongside it), sqlLobbyFilter via Data 245.
   */
  #joinRandomPayload(options: JoinRandomRoomOptions = {}): WireParams {
    const params: WireParams = {}
    if (options.matchmakingMode !== undefined && options.matchmakingMode !== MatchmakingMode.FillRoom) {
      params[ParameterCode.MatchMakingType] = options.matchmakingMode
    }
    const expected: Record<string, unknown> = { ...options.expectedCustomRoomProperties }
    if (options.expectedMaxPlayers !== undefined && options.expectedMaxPlayers > 0) {
      expected[GameProperty.MaxPlayers] = options.expectedMaxPlayers
    }
    if (Object.keys(expected).length > 0) params[ParameterCode.GameProperties] = expected
    if (options.lobbyName) {
      params[ParameterCode.LobbyName] = options.lobbyName
      if (options.lobbyType !== undefined) params[ParameterCode.LobbyType] = options.lobbyType
    }
    if (options.sqlLobbyFilter) params[ParameterCode.Data] = options.sqlLobbyFilter
    return params
  }

  /** PlayerProperties (249) table for join/create ops: `{ 255: name, ...customProperties }`. */
  #playerProperties(): Record<string, unknown> {
    return { [ActorProperty.PlayerName]: this.#myActor.name, ...this.#myActor.customProperties }
  }

  #handleMasterEvent(code: number, vals: Vals): void {
    switch (code) {
      case EventCode.GameList:
        this.#handleGameList(vals)
        break
      case EventCode.GameListUpdate:
        this.#handleGameListUpdate(vals)
        break
      case EventCode.AppStats: {
        const stats: AppStats = {
          peerCount: getParam<number>(vals, ParameterCode.PeerCount) ?? 0,
          masterPeerCount: getParam<number>(vals, ParameterCode.MasterPeerCount) ?? 0,
          gameCount: getParam<number>(vals, ParameterCode.GameCount) ?? 0,
        }
        this.emit('appStats', stats)
        break
      }
      case EventCode.LobbyStats:
        this.emit('lobbyStats', this.#parseLobbyStats(vals))
        break
      default:
        this.#emitPhotonEvent(code, vals)
    }
  }

  /** GameList (230): full snapshot in vals[222] (roomName → GameProperties table) replaces the lobby list. */
  #handleGameList(vals: Vals): void {
    const gameList = getParam<Record<string, Vals>>(vals, ParameterCode.GameList) ?? {}
    const rooms: RoomInfo[] = []
    for (const [name, props] of Object.entries(gameList)) {
      const room = new RoomInfo(name)
      room._updateFromProps(props)
      rooms.push(room)
    }
    this.#rooms = rooms
    this.emit('roomList', rooms)
  }

  /**
   * GameListUpdate (229): merge vals[222] into the list. Known rooms are updated and reported as
   * updated/removed by their Removed flag (GameProperty 251); unknown rooms are added — reported as
   * added even when their props already flag them removed (legacy parity) — then removed rooms are purged.
   */
  #handleGameListUpdate(vals: Vals): void {
    const gameList = getParam<Record<string, Vals>>(vals, ParameterCode.GameList) ?? {}
    const updated: RoomInfo[] = []
    const added: RoomInfo[] = []
    const removed: RoomInfo[] = []
    for (const [name, props] of Object.entries(gameList)) {
      const existing = this.#rooms.find(room => room.name === name)
      if (existing) {
        existing._updateFromProps(props)
        if (existing.removed) removed.push(existing)
        else updated.push(existing)
      } else {
        const room = new RoomInfo(name)
        room._updateFromProps(props)
        this.#rooms.push(room)
        added.push(room)
      }
    }
    this.#rooms = this.#rooms.filter(room => !room.removed)
    this.emit('roomListUpdate', { rooms: this.#rooms, updated, added, removed })
  }

  /** LobbyStats (224): parallel arrays LobbyName 213 / LobbyType 212 / PeerCount 229 / GameCount 228. */
  #parseLobbyStats(vals: Vals): LobbyStatsEntry[] {
    const names = getParam<string[]>(vals, ParameterCode.LobbyName)
    if (!names) return []
    const types = getParam<number[]>(vals, ParameterCode.LobbyType) ?? []
    const peers = getParam<number[]>(vals, ParameterCode.PeerCount) ?? []
    const games = getParam<number[]>(vals, ParameterCode.GameCount) ?? []
    return names.map((lobbyName, i) => ({
      lobbyName,
      lobbyType: types[i] ?? 0,
      peerCount: peers[i] ?? 0,
      gameCount: games[i] ?? 0,
    }))
  }

  #handleGameEvent(code: number, vals: Vals): void {
    if (this.#pendingGameEvents) {
      this.#pendingGameEvents.push({ code, vals })
      return
    }
    switch (code) {
      case EventCode.Join:
        this.#handleJoinEvent(vals)
        break
      case EventCode.Leave:
        this.#handleLeaveEvent(vals)
        break
      case EventCode.PropertiesChanged:
        this.#handlePropertiesChanged(vals)
        break
      case EventCode.Disconnect: {
        // abnormal drop with playerTTL > 0: the actor goes inactive, never removed here
        const actorNr = getParam<number>(vals, ParameterCode.ActorNr)
        const actor = actorNr === undefined ? undefined : this.#actors.get(actorNr)
        if (actor) {
          actor._setSuspended(true)
          this.emit('actorSuspend', actor)
        }
        break
      }
      case EventCode.ErrorInfo:
        this.emit('serverError', getParam(vals, ParameterCode.Info))
        break
      case EventCode.AuthEvent: {
        // token refresh push — Secret (221)
        const secret = getParam<string>(vals, ParameterCode.Secret)
        if (secret !== undefined) this.#secret = secret
        break
      }
      default:
        this.#emitPhotonEvent(code, vals)
    }
  }

  /**
   * Join (255): for the local actor (arrives AFTER the JoinGame response) refresh properties and emit
   * `actorJoin(myActor)` without re-adding — legacy parity, consumers rely on the self event. Others
   * always arrive as brand-new Actors (a rejoiner replaces its suspended predecessor).
   */
  #handleJoinEvent(vals: Vals): void {
    const actorNr = getParam<number>(vals, ParameterCode.ActorNr)
    if (actorNr === undefined) return
    const props = getParam<Vals>(vals, ParameterCode.PlayerProperties)
    if (actorNr === this.#myActor.actorNr) {
      if (props) this.#myActor._updateFromProps(props)
      this.emit('actorJoin', this.#myActor)
    } else {
      const actor = new Actor('', actorNr, false)
      if (props) actor._updateFromProps(props)
      this.#actors.set(actorNr, actor)
      this.emit('actorJoin', actor)
    }
    this.#recomputeMasterClient()
  }

  /**
   * Leave (254): first adopt the reassigned raw masterClientId from param 203 when present; then
   * IsInactive (233) → suspend + `actorSuspend`, else remove + `actorLeave(actor, false)`.
   */
  #handleLeaveEvent(vals: Vals): void {
    const masterClientId = getParam<number>(vals, ParameterCode.MasterClientId)
    if (masterClientId !== undefined && this.#room) this.#room.masterClientId = masterClientId
    const actorNr = getParam<number>(vals, ParameterCode.ActorNr)
    const actor = actorNr === undefined ? undefined : this.#actors.get(actorNr)
    if (actor && actorNr !== undefined) {
      if (getParam(vals, ParameterCode.IsInactive)) {
        actor._setSuspended(true)
        this.emit('actorSuspend', actor)
      } else {
        this.#actors.delete(actorNr)
        this.emit('actorLeave', actor, false)
      }
    }
    this.#recomputeMasterClient()
  }

  /**
   * PropertiesChanged (253): TargetActorNr (253) > 0 routes vals[251] to that actor (unknown actors
   * dropped silently — legacy parity), else to the room. CAS setters rely on this echo for local apply.
   */
  #handlePropertiesChanged(vals: Vals): void {
    const targetActorNr = getParam<number>(vals, ParameterCode.TargetActorNr)
    const properties = getParam<Vals>(vals, ParameterCode.Properties) ?? {}
    if (targetActorNr !== undefined && targetActorNr > 0) {
      const actor = this.#actors.get(targetActorNr)
      if (!actor) return
      const changed = actor._updateFromProps(properties)
      this.emit('actorPropertiesChange', actor, changed)
      return
    }
    const room = this.#room
    if (!room) return
    const changed = room._updateFromProps(properties)
    this.emit('roomPropertiesChange', changed)
    this.#recomputeMasterClient() // GameProperty.MasterClientId (248) may have been part of the change
  }

  /** Custom/unhandled events pass through as `photonEvent`: data = vals[245], actorNr = vals[254]. */
  #emitPhotonEvent(code: number, vals: Vals): void {
    this.emit('photonEvent', {
      code,
      data: getParam(vals, ParameterCode.Data),
      actorNr: getParam<number>(vals, ParameterCode.ActorNr) ?? 0,
    })
  }

  /** Effective master client: raw room masterClientId, else the lowest actorNr in the roster; 0 if unknown. */
  #computeMasterClientId(): number {
    if (!this.#room) return 0
    if (this.#room.masterClientId) return this.#room.masterClientId
    let lowest = 0
    for (const actorNr of this.#actors.keys()) {
      if (lowest === 0 || actorNr < lowest) lowest = actorNr
    }
    return lowest
  }

  /** Centralized master-client tracking: run after every roster or relevant property mutation. */
  #recomputeMasterClient(): void {
    const effective = this.#computeMasterClientId()
    if (effective === this.#lastMasterClientId) return
    const previous = this.#lastMasterClientId
    this.#lastMasterClientId = effective
    this.emit('masterClientChange', this.#actors.get(effective), previous)
  }

  /** Adopts server-pushed identity from an Authenticate response: UserId (225) and Nickname (202). */
  #adoptIdentity(vals: Vals): void {
    const userId = getParam<string>(vals, ParameterCode.UserId)
    if (userId !== undefined) {
      this.#userId = userId
      this.#myActor.userId = userId
    }
    const nickname = getParam<string>(vals, ParameterCode.Nickname)
    if (nickname !== undefined) this.#myActor.name = nickname
  }

  /** Opportunistic auth-token refresh from any master response carrying Secret (221). */
  #refreshSecret(vals: Vals): void {
    const secret = getParam<string>(vals, ParameterCode.Secret)
    if (secret !== undefined) this.#secret = secret
  }

  /**
   * Fatal out-of-band failure (unexpected close of a live peer): full teardown, state `error`,
   * `error(PhotonConnectionError)` + `disconnect(reason)` events, epoch bump.
   */
  #handleUnexpectedClose(peer: PhotonPeer, reason: DisconnectReason): void {
    // stale-peer guard: a replaced peer must not tear down its successor
    if (peer !== this.#nameServerPeer && peer !== this.#masterPeer && peer !== this.#gamePeer) return
    this.#epoch++
    this.#teardownPeers(false)
    this.#clearRoster()
    this.#room = undefined
    this.#lastMasterClientId = 0
    this.#setState('error')
    this.emit('error', new PhotonConnectionError(reason.message, { server: reason.server, address: peer.url }))
    this.emit('disconnect', reason)
  }

  #teardownPeers(expected: boolean): void {
    const peers = [this.#nameServerPeer, this.#masterPeer, this.#gamePeer]
    this.#nameServerPeer = undefined
    this.#masterPeer = undefined
    this.#gamePeer = undefined
    this.#pendingGameEvents = undefined
    for (const peer of peers) {
      if (!peer) continue
      peer.onClose = undefined
      peer.close(expected)
    }
  }

  /** Empties the roster, emitting `actorLeave(actor, true)` for every actor incl. the local one. */
  #clearRoster(): void {
    if (this.#actors.size === 0) return
    const actors = [...this.#actors.values()]
    this.#actors.clear()
    for (const actor of actors) this.emit('actorLeave', actor, true)
  }

  #createPeer(name: ServerName, address: string): PhotonPeer {
    // The live nameserver/master may return a full URL (e.g. `ws://host:80/Master`) instead of
    // `host:port` — legacy parity: skip the scheme prefix then, but always append `/appId?libversion`
    const base = /^wss?:\/\//.test(address) ? address : `${this.#protocol}://${address}`
    return new PhotonPeer({
      name,
      url: `${base}/${this.#appId}?libversion=${PHOTON_LIB_VERSION}`,
      subprotocol: 'Json',
      logger: this.#logger.child(peerLogSuffix[name]),
      keepAliveMs: this.#keepAliveMs,
      operationTimeoutMs: this.#operationTimeoutMs,
      connectTimeoutMs: this.#connectTimeoutMs,
      webSocketImpl: this.#webSocketImpl,
    })
  }

  #setState(state: ClientState): void {
    if (state === this.#state) return
    const previous = this.#state
    this.#state = state
    this.#logger.debug(`state: ${previous} -> ${state}`)
    this.emit('stateChange', state, previous)
  }

  #checkEpoch(epoch: number): void {
    if (this.#epoch !== epoch) {
      throw new PhotonAbortError('client was torn down while the operation was in flight')
    }
  }
}
