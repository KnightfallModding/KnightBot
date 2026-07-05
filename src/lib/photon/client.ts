import { Actor } from './actor'
import {
  ActorProperty,
  ClientState,
  ConnectionProtocol,
  CustomAuthenticationType,
  EventCaching,
  EventCode,
  GameProperty,
  JoinMode,
  LobbyType,
  MatchmakingMode,
  OperationCode,
  ParameterCode,
  PeerErrorCode,
  ReceiverGroup,
  WebFlag,
} from './constants'
import { TypedEventEmitter } from './emitter'
import { PhotonError, PhotonOperationError } from './errors'
import { Logger } from './logger'
import type { OperationResponse, WebSocketConstructor } from './peer'
import { PhotonPeer } from './peer'
import { Room, RoomInfo } from './room'

export interface PhotonClientOptions {
  /** Cloud application ID. */
  appId: string
  /** Cloud application version. */
  appVersion: string
  /** Transport protocol. Defaults to {@link ConnectionProtocol.Wss}. */
  protocol?: ConnectionProtocol
  /** Overrides the default NameServer address. */
  nameServerAddress?: string
  /** Master server address, when connecting directly without a NameServer. */
  masterServerAddress?: string
  /** User ID used for authentication and FindFriends. */
  userId?: string
  /** Automatically join the default lobby after connecting to the Master server. Defaults to true. */
  autoJoinLobby?: boolean
  /** Logger used by the client. Peers derive prefixed child loggers from it. */
  logger?: Logger
  /** WebSocket implementation. Defaults to the global WebSocket. */
  webSocketImpl?: WebSocketConstructor
  /** Creates custom rooms (extended from Room). */
  roomFactory?: (name: string) => Room
  /** Creates custom actors (extended from Actor). */
  actorFactory?: (name: string, actorNr: number, isLocal: boolean) => Actor
}

export interface ConnectOptions {
  /** Don't disconnect from the Master server after joining a room. */
  keepMasterConnection?: boolean
  /** Name of the lobby to connect to. */
  lobbyName?: string
  /** Type of the lobby. */
  lobbyType?: LobbyType
  /** If true, the Master server periodically sends lobbies statistics through the `lobbyStats` event. */
  lobbyStats?: boolean
  /** If specified, connect to that region's Master server after connecting to the NameServer. */
  region?: string
}

export interface CreateRoomOptions {
  /** Shows the room in the lobby's room list. Defaults to true. */
  isVisible?: boolean
  /** Keeps players from joining the room (or opens it to everyone). Defaults to true. */
  isOpen?: boolean
  /** Max players before the room is considered full. Defaults to 0 ("unlimited"). */
  maxPlayers?: number
  /** Custom properties to apply to the room on creation (short string keys). */
  customGameProperties?: Record<string, any>
  /** Custom room properties that get listed in the lobby. */
  propsListedInLobby?: string[]
  /** Room Time To Live (ms) on the server after all clients left the room. */
  roomTTL?: number
  /** Player Time To Live (ms) in the room after a player suspended. */
  playerTTL?: number
  /** Expected server plugins. */
  plugins?: string[]
  /** Name of the lobby to create the room in. */
  lobbyName?: string
  /** Type of the lobby. */
  lobbyType?: LobbyType
  /** Users the matchmaking keeps slots open for. */
  expectedUsers?: string[]
}

export interface JoinRoomOptions {
  /** Rejoin the room using the current userId. */
  rejoin?: boolean
  /** Create the room if it does not exist. */
  createIfNotExists?: boolean
  /** Users the matchmaking keeps slots open for. */
  expectedUsers?: string[]
}

export interface JoinRandomRoomOptions {
  /** Only join a room matching these custom properties. */
  expectedCustomRoomProperties?: Record<string, any>
  /** Filters for a particular maxPlayer setting. 0 accepts any. */
  expectedMaxPlayers?: number
  /** Selects one of the available matchmaking algorithms. */
  matchingType?: MatchmakingMode
  /** Name of the lobby to search rooms in. */
  lobbyName?: string
  /** Type of the lobby. */
  lobbyType?: LobbyType
  /** SQL-like "where" clause filter, for lobbies of type {@link LobbyType.SqlLobby}. */
  sqlLobbyFilter?: string
  /** Users the matchmaking keeps slots open for. */
  expectedUsers?: string[]
}

export interface RaiseEventOptions {
  /** The ID of the interest group this event goes to (exclusively). */
  interestGroup?: number
  /** Events can be cached (merged and removed) for players joining later on. */
  cache?: EventCaching
  /** Defines to which group of players the event is passed on. */
  receivers?: ReceiverGroup
  /** The target players who should receive the event (only for small target groups). */
  targetActors?: number[]
  /** Forward to web hook. */
  webForward?: boolean
}

export interface LeaveRoomOptions {
  /** Transmit the encrypted AuthCookie to the web service in the PathLeave webhook, when available. */
  sendAuthCookie?: boolean
}

export interface WebRpcOptions {
  /** Defines if the authentication cookie gets sent to a WebHook (if setup). */
  sendAuthCookie?: boolean
}

export interface AppStats {
  /** Count of players currently online on Game servers. */
  peerCount: number
  /** Count of players on the Master server (looking for a game). */
  masterPeerCount: number
  /** Count of games currently in use, including invisible and full rooms. */
  gameCount: number
}

export interface LobbyStatsEntry {
  lobbyName: string
  lobbyType: LobbyType
  /** The number of players in the lobby (on Master, not playing). */
  peerCount: number
  /** The number of games in the lobby. */
  gameCount: number
}

export interface FriendStatus {
  online: boolean
  /** Joined room name, empty when not known or no room joined. */
  roomId: string
}

export interface WebRpcResult {
  uriPath: string
  /** Result code returned by the remote procedure. */
  resultCode: number
  /** Data returned by the remote procedure. */
  data: any
  /** Optional message returned by the remote procedure. */
  message: string
}

export type PhotonClientEvents = {
  /** Client connection state changed. */
  stateChange: [state: ClientState, previous: ClientState]
  /** A connection-level error occurred. Pending operations reject with the same error. */
  error: [error: PhotonError]
  /** Raw operation response, mostly useful for debugging or custom workflows. */
  operationResponse: [code: OperationCode, response: OperationResponse]
  /** Custom event raised by another actor. */
  event: [code: number, content: any, actorNr: number]
  /** Initial room list received from the Master server. */
  roomList: [rooms: RoomInfo[]]
  /** Rooms changed while in the lobby. */
  roomListUpdate: [rooms: RoomInfo[], updated: RoomInfo[], added: RoomInfo[], removed: RoomInfo[]]
  /** Application statistics update. */
  appStats: [stats: AppStats]
  /** Periodic lobbies statistics, enable with the `lobbyStats` connect option. */
  lobbyStats: [stats: LobbyStatsEntry[]]
  /** The client joined a room. */
  roomJoined: [room: Room, createdByMe: boolean]
  /** A new actor joined the room the client is in. */
  actorJoin: [actor: Actor]
  /** An actor left the room. `cleanup` is true when called during room cleanup. */
  actorLeave: [actor: Actor, cleanup: boolean]
  /** An actor got suspended in the room. */
  actorSuspend: [actor: Actor]
  /** Properties of an actor changed. */
  actorPropertiesChange: [actor: Actor]
  /** Properties of the joined room changed. */
  roomPropertiesChange: [room: Room]
  /** The server reported a non-critical error (webhooks, plugins, cached events limit). */
  serverErrorInfo: [info: string]
}

interface InternalConnectOptions extends ConnectOptions {
  userAuthSecret?: string
}

const defaultNameServer: Record<ConnectionProtocol, string> = {
  [ConnectionProtocol.Ws]: 'ws://ns.photonengine.io:9093',
  [ConnectionProtocol.Wss]: 'wss://ns.photonengine.io:19093',
}

const validNextStates: Partial<Record<ClientState, ClientState[]>> = {
  [ClientState.Error]: [ClientState.ConnectingToMasterServer, ClientState.ConnectingToNameServer],
  [ClientState.Uninitialized]: [ClientState.ConnectingToMasterServer, ClientState.ConnectingToNameServer],
  [ClientState.ConnectedToNameServer]: [ClientState.ConnectingToMasterServer],
  [ClientState.Disconnected]: [
    ClientState.ConnectingToGameServer,
    ClientState.ConnectingToMasterServer,
    ClientState.ConnectingToNameServer,
  ],
  [ClientState.ConnectedToMaster]: [ClientState.JoinedLobby, ClientState.ConnectingToGameServer],
  [ClientState.JoinedLobby]: [ClientState.ConnectingToGameServer],
  [ClientState.ConnectingToGameServer]: [ClientState.ConnectedToGameServer],
  [ClientState.ConnectedToGameServer]: [ClientState.Joined],
}

/**
  Implements the Photon LoadBalancing workflow with an async, event-driven API.

  Connection and room operations return promises resolving once the full server
  round trip completed (e.g. `await client.joinRoom(name)` resolves with the
  joined {@link Room}). Server pushed updates are exposed through typed events,
  see {@link PhotonClientEvents}.
*/
export class PhotonClient extends TypedEventEmitter<PhotonClientEvents> {
  appId: string
  appVersion: string
  userId: string
  nameServerAddress: string
  masterServerAddress: string

  readonly logger: Logger

  /** Don't treat disconnection by the game server as an error while leaving a room. */
  #gamePeerWaitingForDisconnect = false
  #autoJoinLobby: boolean
  #protocol: ConnectionProtocol
  #webSocketImpl: WebSocketConstructor | undefined
  #roomFactory: (name: string) => Room
  #actorFactory: (name: string, actorNr: number, isLocal: boolean) => Actor

  #state = ClientState.Uninitialized
  #nameServerPeer?: PhotonPeer
  #masterPeer?: PhotonPeer
  #gamePeer?: PhotonPeer

  #connectOptions: InternalConnectOptions = {}
  #createRoomOptions: CreateRoomOptions = {}
  #joinRoomOptions: JoinRoomOptions = {}

  #roomInfos: RoomInfo[] = []
  #roomInfosByName = new Map<string, RoomInfo>()
  #actors = new Map<number, Actor>()
  #lowestActorId = 0

  #currentRoom: Room
  #myActor: Actor

  #userAuthType = CustomAuthenticationType.None
  #userAuthParameters = ''
  #userAuthData: unknown = ''

  constructor(options: PhotonClientOptions) {
    super()

    this.appId = options.appId
    this.appVersion = options.appVersion
    this.userId = options.userId ?? ''
    this.logger = options.logger ?? new Logger('Client:')

    this.#protocol = options.protocol ?? ConnectionProtocol.Wss
    this.#autoJoinLobby = options.autoJoinLobby ?? true
    this.#webSocketImpl = options.webSocketImpl
    this.#roomFactory = options.roomFactory ?? (name => new Room(name))
    this.#actorFactory = options.actorFactory ?? ((name, actorNr, isLocal) => new Actor(name, actorNr, isLocal))

    this.nameServerAddress = options.nameServerAddress ?? defaultNameServer[this.#protocol]
    this.masterServerAddress = options.masterServerAddress ?? ''

    this.#currentRoom = this.#createRoom('')
    this.#myActor = this.#createActor('', -1, true)
    this.#addActor(this.#myActor)
  }

  //#region State

  /** Current client state. */
  get state(): ClientState {
    return this.#state
  }

  /** Name of the current client state, for logs and diagnostics. */
  get stateName(): string {
    return ClientState[this.#state] ?? String(this.#state)
  }

  isConnectedToNameServer(): boolean {
    return this.#nameServerPeer?.isConnected() ?? false
  }

  /** True when connected to the Master server (usually in lobby, receiving room list updates). */
  isConnectedToMaster(): boolean {
    return this.#masterPeer?.isConnected() ?? false
  }

  /** True when in a lobby, ready to join or create rooms. */
  isInLobby(): boolean {
    return this.#state === ClientState.JoinedLobby
  }

  /** True when joined to a room. */
  isJoinedToRoom(): boolean {
    return this.#state === ClientState.Joined
  }

  //#endregion

  //#region Accessors

  /** The local actor. Available even when not joined to a room. */
  get myActor(): Actor {
    return this.#myActor
  }

  /** The client's room. Available even when not joined, used for room creation. */
  get room(): Room {
    return this.#currentRoom
  }

  /** Actors in the currently joined room, keyed by actorNr, including the local actor. */
  get actors(): ReadonlyMap<number, Actor> {
    return this.#actors
  }

  /** Current room list from the Master server. */
  get rooms(): RoomInfo[] {
    return this.#roomInfos
  }

  /** ActorNr of the room's master client. */
  get masterClientActorNr(): number {
    return this.#currentRoom.masterClientId || this.#lowestActorId
  }

  /** Latest game server round trip time measurement in milliseconds. */
  get rtt(): number {
    return this.#gamePeer?.rtt ?? 0
  }

  /** Triggers a game server round trip time measurement. */
  updateRtt(): void {
    this.#gamePeer?.ping()
  }

  /** Fetches server time from the game server, updating the base used by {@link getServerTimeMs}. */
  syncServerTime(): void {
    this.#gamePeer?.ping(true)
  }

  /** Game server time extrapolation in milliseconds (signed 32 bit integer). */
  getServerTimeMs(): number {
    return this.#gamePeer?.getServerTimeMs() ?? 0
  }

  /** Enables custom authentication and sets its parameters. Call before connecting. */
  setCustomAuthentication(
    authParameters: string,
    authType: CustomAuthenticationType = CustomAuthenticationType.Custom,
    authData?: unknown
  ): void {
    this.#userAuthType = authType
    this.#userAuthParameters = authParameters
    this.#userAuthData = authData
  }

  /** Sets the log level of the client and all active peers. */
  setLogLevel(level: number): void {
    this.logger.level = level
    for (const peer of [this.#nameServerPeer, this.#masterPeer, this.#gamePeer]) {
      if (peer) peer.logger.level = level
    }
  }

  //#endregion

  //#region Connection

  /**
    Connects to the NameServer.
    Resolves once connected — or, when a `region` is given, once the full chain
    completed (NameServer → region Master server → lobby).
  */
  async connectToNameServer(options: ConnectOptions = {}): Promise<void> {
    if (!this.#checkNextState(ClientState.ConnectingToNameServer)) {
      throw new PhotonError(
        PeerErrorCode.NameServerError,
        `Cannot connect to NameServer while in state ${this.stateName}`
      )
    }

    const wait = this.#waitForStates(
      options.region === undefined ? [ClientState.ConnectedToNameServer] : this.#connectedStates()
    )

    this.#changeState(ClientState.ConnectingToNameServer)
    this.logger.info('Connecting to NameServer', this.nameServerAddress)
    this.#connectOptions = { ...options }

    this.#nameServerPeer?.destroy()
    this.#nameServerPeer = this.#createPeer(this.nameServerAddress, 'NameServer')
    this.#initNameServerPeer(this.#nameServerPeer)
    this.#nameServerPeer.connect(this.appId)

    await wait
  }

  /**
    Connects to a specific region's Master server, using the NameServer to find its address.
    Resolves once the lobby is joined (or the Master connection established when
    `autoJoinLobby` is disabled).
  */
  async connectToRegionMaster(region: string, options: Omit<ConnectOptions, 'region'> = {}): Promise<void> {
    if (this.#nameServerPeer?.isConnected()) {
      const wait = this.#waitForStates(this.#connectedStates())
      this.#connectOptions = { ...this.#connectOptions, ...options, region }
      this.logger.debug('Connecting to Region Master', region, '...')
      this.#nameServerOpAuth(this.#nameServerPeer, region)
      await wait
    } else {
      await this.connectToNameServer({ ...options, region })
    }
  }

  /**
    Connects directly to the Master server set through {@link masterServerAddress}.
    Resolves once the lobby is joined (or the Master connection established when
    `autoJoinLobby` is disabled).
  */
  async connectToMaster(options: ConnectOptions = {}): Promise<void> {
    const wait = this.#waitForStates(this.#connectedStates())

    if (!this.#connectToMasterInternal({ ...options })) {
      throw new PhotonError(PeerErrorCode.MasterError, `Cannot connect to Master while in state ${this.stateName}`)
    }

    await wait
  }

  /** Reconnects to the Master server after a disconnect, reusing the previous authentication token. */
  async reconnectToMaster(): Promise<void> {
    if (this.#state !== ClientState.Disconnected && this.#state !== ClientState.Error) {
      throw new PhotonError(
        PeerErrorCode.MasterError,
        `Can only reconnect while in state Disconnected or Error. Current state: ${this.stateName}`
      )
    }
    if (!this.masterServerAddress) {
      throw new PhotonError(PeerErrorCode.MasterError, 'Master server address is empty')
    }
    if (!this.#connectOptions.userAuthSecret) {
      throw new PhotonError(PeerErrorCode.MasterError, 'No previous authentication token available to reconnect')
    }

    this.#changeState(ClientState.Disconnected)
    await this.connectToMaster(this.#connectOptions)
  }

  /**
    Returns to a room quickly by directly reconnecting to the game server and rejoining.
    Player properties are not sent; up-to-date ones come from the server.
  */
  async reconnectAndRejoin(): Promise<Room> {
    if (this.#state !== ClientState.Disconnected && this.#state !== ClientState.Error) {
      throw new PhotonError(
        PeerErrorCode.GameError,
        `Can only reconnect while in state Disconnected or Error. Current state: ${this.stateName}`
      )
    }
    if (!this.#currentRoom.address) {
      throw new PhotonError(PeerErrorCode.GameError, 'No previous game server address available to rejoin')
    }
    if (!this.#connectOptions.userAuthSecret) {
      throw new PhotonError(PeerErrorCode.GameError, 'No previous authentication token available to reconnect')
    }

    return this.#roomOperation(() => {
      this.#joinRoomOptions = { rejoin: true }
      this.#changeState(ClientState.Disconnected)
      this.#connectToGameServer(OperationCode.JoinGame)
    })
  }

  /** Disconnects from all servers. */
  disconnect(): void {
    this.#nameServerPeer?.disconnect()
    this.#masterPeer?.disconnect()
    if (this.#gamePeer) {
      this.#gamePeer.disconnect()
      this.#cleanupGamePeerData()
    }

    this.#changeState(ClientState.Disconnected)
  }

  //#endregion

  //#region Rooms

  /**
    Joins a room by name.
    Resolves with the joined room once fully connected to it on the game server.
  */
  async joinRoom(roomName: string, options: JoinRoomOptions = {}, createOptions?: CreateRoomOptions): Promise<Room> {
    const masterPeer = this.#requireMasterPeer()

    return this.#roomOperation(() => {
      this.#joinRoomOptions = { ...options }
      this.#createRoomOptions = { ...createOptions }

      const params: unknown[] = []
      if (options.createIfNotExists) {
        params.push(ParameterCode.JoinMode, JoinMode.CreateIfNotExists)
        this.#fillCreateRoomParams(params, createOptions, ParameterCode.GameProperties)
      }
      if (options.rejoin) params.push(ParameterCode.JoinMode, JoinMode.RejoinOnly)
      if (options.expectedUsers) params.push(ParameterCode.Add, options.expectedUsers)

      this.#currentRoom = this.#createRoom(roomName)
      params.push(ParameterCode.RoomName, roomName)

      this.logger.info('Join Room', roomName, '...')
      masterPeer.sendOperation(OperationCode.JoinGame, params)
    })
  }

  /**
    Creates a room on the server (or fails when the name is already taken).
    Resolves with the created room once fully connected to it on the game server.
    @param roomName Room name, assigned by the server when omitted.
  */
  async createRoom(roomName?: string, options?: CreateRoomOptions): Promise<Room> {
    this.#requireMasterPeer()

    return this.#roomOperation(() => {
      this.#joinRoomOptions = {}
      this.#createRoomOptions = { ...options }
      this.#currentRoom = this.#createRoom(roomName ?? '')
      this.#createRoomInternal(this.#requireMasterPeer(), this.#createRoomOptions)
    })
  }

  /**
    Joins a random room matching the given filters.
    Resolves with the joined room, or rejects with {@link PhotonOperationError}
    ({@link ErrorCode.NoRandomMatchFound}) when all rooms are closed or full.
  */
  async joinRandomRoom(options: JoinRandomRoomOptions = {}): Promise<Room> {
    const masterPeer = this.#requireMasterPeer()

    return this.#roomOperation(() => {
      this.#joinRoomOptions = {}
      this.#createRoomOptions = {}

      const params: unknown[] = []
      this.#fillJoinRandomRoomParams(params, options)

      this.logger.info('Join Random Room', options.lobbyName, options.lobbyType, '...')
      masterPeer.sendOperation(OperationCode.JoinRandomGame, params)
    })
  }

  /**
    Joins a room matching the given filters, creating one when none is found.
    Resolves with the joined or created room.
  */
  async joinRandomOrCreateRoom(
    options: JoinRandomRoomOptions = {},
    createRoomName?: string,
    createOptions?: CreateRoomOptions
  ): Promise<Room> {
    const masterPeer = this.#requireMasterPeer()

    return this.#roomOperation(() => {
      this.#joinRoomOptions = { createIfNotExists: true }
      this.#createRoomOptions = { ...createOptions }

      const params: unknown[] = []
      this.#fillJoinRandomRoomParams(params, options)
      params.push(ParameterCode.JoinMode, JoinMode.CreateIfNotExists)
      if (createRoomName) params.push(ParameterCode.RoomName, createRoomName)
      this.#fillCreateRoomParams(params, createOptions, ParameterCode.Properties)

      this.logger.info('Join Random or Create Room', options.lobbyName, options.lobbyType, createRoomName, '...')
      masterPeer.sendOperation(OperationCode.JoinRandomGame, params)
    })
  }

  /**
    Leaves the room and reconnects to the Master server when needed.
    Resolves once the server acknowledged the leave.
  */
  async leaveRoom(options: LeaveRoomOptions = {}): Promise<void> {
    await this.#leaveRoomInternal(options, false)
  }

  /**
    Disconnects from the game server keeping the player in the room (to rejoin later)
    and reconnects to the Master server when needed.
  */
  async suspendRoom(options: LeaveRoomOptions = {}): Promise<void> {
    await this.#leaveRoomInternal(options, true)
  }

  //#endregion

  //#region In-room operations

  /**
    Raises a game custom event.
    @param eventCode Identifies this type of event (and its content). Game event codes can start at 0.
  */
  raiseEvent(eventCode: number, data?: unknown, options?: RaiseEventOptions): void {
    if (!this.#gamePeer || !this.isJoinedToRoom()) throw new Error('raiseEvent - not joined to a room')

    const params: unknown[] = [ParameterCode.Code, eventCode, ParameterCode.Data, data]

    if (options) {
      if (options.receivers !== undefined && options.receivers !== ReceiverGroup.Others) {
        params.push(ParameterCode.ReceiverGroup, options.receivers)
      }
      if (options.cache !== undefined && options.cache !== EventCaching.DoNotCache) {
        params.push(ParameterCode.Cache, options.cache)
      }
      if (options.interestGroup !== undefined) params.push(ParameterCode.Group, options.interestGroup)
      if (options.targetActors !== undefined) params.push(ParameterCode.ActorList, options.targetActors)
      if (options.webForward) params.push(ParameterCode.WebFlags, WebFlag.HttpForward)
    }

    this.#gamePeer.sendOperation(OperationCode.RaiseEvent, params)
  }

  /**
    Changes the client's interest groups (for events in the room).
    Note the difference between passing undefined and []: undefined won't add/remove
    any groups, [] will add/remove all (existing) groups. Removal executes first.
  */
  changeGroups(groupsToRemove?: number[], groupsToAdd?: number[]): void {
    if (!this.#gamePeer || !this.isJoinedToRoom()) return

    const params: unknown[] = []
    if (groupsToRemove !== undefined) params.push(ParameterCode.Remove, groupsToRemove)
    if (groupsToAdd !== undefined) params.push(ParameterCode.Add, groupsToAdd)

    this.logger.debug('Group change:', groupsToRemove, groupsToAdd)
    this.#gamePeer.sendOperation(OperationCode.ChangeGroups, params)
  }

  /** @internal Used by {@link Room} property setters. */
  setPropertiesOfRoom(
    properties: Record<string | number, any>,
    webForward = false,
    expectedProperties?: Record<string | number, any>
  ): void {
    if (!this.#gamePeer) return

    const params: unknown[] = [ParameterCode.Properties, properties, ParameterCode.Broadcast, true]
    if (webForward) params.push(ParameterCode.WebFlags, WebFlag.HttpForward)
    if (expectedProperties) params.push(ParameterCode.ExpectedValues, expectedProperties)

    this.#gamePeer.sendOperation(OperationCode.SetProperties, params)
  }

  /** @internal Used by {@link Actor} property setters. */
  setPropertiesOfActor(
    actorNr: number,
    properties: Record<string | number, any>,
    webForward = false,
    expectedProperties?: Record<string | number, any>
  ): void {
    if (!this.#gamePeer) return

    const params: unknown[] = [
      ParameterCode.ActorNr,
      actorNr,
      ParameterCode.Properties,
      properties,
      ParameterCode.Broadcast,
      true,
    ]
    if (webForward) params.push(ParameterCode.WebFlags, WebFlag.HttpForward)
    if (expectedProperties) params.push(ParameterCode.ExpectedValues, expectedProperties)

    this.#gamePeer.sendOperation(OperationCode.SetProperties, params)
  }

  //#endregion

  //#region Requests

  /** Requests the online status and joined rooms of the given users from the Master server. */
  async findFriends(friendsToFind: string[]): Promise<Record<string, FriendStatus>> {
    const masterPeer = this.#requireMasterPeer()

    const wait = masterPeer.waitForResponse(OperationCode.FindFriends)
    masterPeer.sendOperation(OperationCode.FindFriends, [ParameterCode.FindFriendsRequestList, friendsToFind])

    const response = await wait
    if (response.errCode) {
      throw new PhotonOperationError(OperationCode.FindFriends, response.errCode, response.errMsg)
    }

    const onlineList = response.vals[ParameterCode.FindFriendsResponseOnlineList] ?? []
    const roomIdList = response.vals[ParameterCode.FindFriendsResponseRoomIdList] ?? []

    const friends: Record<string, FriendStatus> = {}
    for (const [index, name] of friendsToFind.entries()) {
      if (name) friends[name] = { online: Boolean(onlineList[index]), roomId: roomIdList[index] ?? '' }
    }

    return friends
  }

  /**
    Requests lobbies statistics from the Master server.
    Periodic automated updates can be enabled with the `lobbyStats` connect option
    instead, and arrive through the `lobbyStats` event.
    @param lobbiesToRequest Array of lobby id pairs: [[name1, type1], [name2, type2], ...].
    Statistics for all lobbies are returned when omitted.
  */
  async requestLobbyStats(lobbiesToRequest?: [string, LobbyType?][]): Promise<LobbyStatsEntry[]> {
    const masterPeer = this.#requireMasterPeer()

    const requested: [string, LobbyType][] = (lobbiesToRequest ?? []).map(([name, type]) => [
      name,
      type ?? LobbyType.Default,
    ])

    const params: unknown[] = []
    if (requested.length > 0) {
      params.push(
        ParameterCode.LobbyName,
        requested.map(([name]) => name)
      )
      params.push(
        ParameterCode.LobbyType,
        requested.map(([, type]) => type)
      )
    }

    const wait = masterPeer.waitForResponse(OperationCode.LobbyStats)
    masterPeer.sendOperation(OperationCode.LobbyStats, params)

    const response = await wait
    if (response.errCode) {
      throw new PhotonOperationError(OperationCode.LobbyStats, response.errCode, response.errMsg)
    }

    return this.#parseLobbyStats(response.vals, requested)
  }

  /** Requests the region list with Master server addresses from the NameServer. */
  async getRegions(): Promise<Record<string, string>> {
    const nameServerPeer = this.#nameServerPeer
    if (!nameServerPeer?.isConnected()) {
      throw new PhotonError(PeerErrorCode.NameServerError, 'Not connected to NameServer')
    }

    const wait = nameServerPeer.waitForResponse(OperationCode.GetRegions)
    nameServerPeer.sendOperation(OperationCode.GetRegions, [ParameterCode.ApplicationId, this.appId])

    const response = await wait
    if (response.errCode) {
      throw new PhotonOperationError(OperationCode.GetRegions, response.errCode, response.errMsg)
    }

    const codes: string[] = response.vals[ParameterCode.Region] ?? []
    const addresses: string[] = response.vals[ParameterCode.Address] ?? []

    const regions: Record<string, string> = {}
    for (const [index, code] of codes.entries()) regions[code] = addresses[index] ?? ''

    return regions
  }

  /** Sends a web RPC request through the Master (or Game) server. */
  async webRpc(uriPath: string, parameters?: Record<string, any>, options?: WebRpcOptions): Promise<WebRpcResult> {
    const peer = this.#masterPeer?.isConnected() ? this.#masterPeer : this.isJoinedToRoom() ? this.#gamePeer : undefined

    if (!peer) throw new PhotonError(PeerErrorCode.MasterError, 'Connected to neither Master nor Game server')

    const params: unknown[] = [ParameterCode.UriPath, uriPath, ParameterCode.RpcCallParams, parameters]
    if (options?.sendAuthCookie) params.push(ParameterCode.WebFlags, WebFlag.SendAuthCookie)

    const wait = peer.waitForResponse(OperationCode.Rpc)
    peer.sendOperation(OperationCode.Rpc, params)

    const response = await wait
    if (response.errCode) throw new PhotonOperationError(OperationCode.Rpc, response.errCode, response.errMsg)

    return {
      uriPath: response.vals[ParameterCode.UriPath],
      resultCode: response.vals[ParameterCode.RpcCallRetCode],
      data: response.vals[ParameterCode.RpcCallRetData],
      message: response.vals[ParameterCode.RpcCallRetMessage] ?? '',
    }
  }

  //#endregion

  //#region Internals

  #createPeer(address: string, name: string): PhotonPeer {
    return new PhotonPeer(this.#protocol, address, this.logger.child(name), this.#webSocketImpl)
  }

  #createRoom(name: string): Room {
    const room = this.#roomFactory(name)
    room.client = this
    return room
  }

  #createActor(name: string, actorNr: number, isLocal: boolean): Actor {
    const actor = this.#actorFactory(name, actorNr, isLocal)
    actor.client = this
    return actor
  }

  #connectedStates(): ClientState[] {
    return this.#autoJoinLobby ? [ClientState.JoinedLobby] : [ClientState.ConnectedToMaster]
  }

  #requireMasterPeer(): PhotonPeer {
    if (!this.#masterPeer?.isConnected()) {
      throw new PhotonError(PeerErrorCode.MasterError, 'Not connected to Master server')
    }

    return this.#masterPeer
  }

  #changeState(state: ClientState): void {
    const previous = this.#state
    this.logger.info('State:', ClientState[previous], '->', ClientState[state])
    this.#state = state
    this.emit('stateChange', state, previous)
  }

  #checkNextState(nextState: ClientState): boolean {
    const valid = validNextStates[this.#state]?.includes(nextState) ?? false
    if (!valid) {
      this.logger.error(`Invalid state transition: ${this.stateName} -> ${ClientState[nextState]}`)
    }

    return valid
  }

  #onError(code: PeerErrorCode, message: string): void {
    this.logger.error('Error:', code, message)
    this.emit('error', new PhotonError(code, message))
  }

  /** Resolves when one of the given states is reached, rejects on client error. */
  #waitForStates(states: ClientState[]): Promise<void> {
    if (states.includes(this.#state)) return Promise.resolve()

    return new Promise((resolve, reject) => {
      const offState = this.on('stateChange', state => {
        if (!states.includes(state)) return

        offState()
        offError()
        resolve()
      })
      const offError = this.on('error', error => {
        offState()
        offError()
        reject(error)
      })
    })
  }

  /**
    Runs a join/create room operation. Resolves with the room once fully joined,
    rejects on client errors and on server errors answering the involved operations.
  */
  #roomOperation(send: () => void): Promise<Room> {
    const watchedOperations = [OperationCode.JoinGame, OperationCode.CreateGame, OperationCode.JoinRandomGame]

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        offState()
        offError()
        offResponse()
      }

      const offState = this.on('stateChange', state => {
        if (state !== ClientState.Joined) return

        cleanup()
        resolve(this.#currentRoom)
      })
      const offError = this.on('error', error => {
        cleanup()
        reject(error)
      })
      const offResponse = this.on('operationResponse', (code, response) => {
        if (!response.errCode || !watchedOperations.includes(code)) return

        cleanup()
        reject(new PhotonOperationError(code, response.errCode, response.errMsg))
      })

      try {
        send()
      } catch (error) {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async #leaveRoomInternal(options: LeaveRoomOptions, suspend: boolean): Promise<void> {
    if (!this.isJoinedToRoom()) return

    const gamePeer = this.#gamePeer
    let wait: Promise<OperationResponse> | undefined

    if (gamePeer) {
      const params: unknown[] = []
      if (options.sendAuthCookie) params.push(ParameterCode.WebFlags, WebFlag.SendAuthCookie)
      if (suspend) params.push(ParameterCode.IsInactive, true)

      wait = gamePeer.waitForResponse(OperationCode.Leave)
      gamePeer.sendOperation(OperationCode.Leave, params)
      this.#gamePeerWaitingForDisconnect = true
    }

    this.#cleanupGamePeerData()

    if (this.isConnectedToMaster()) {
      this.#changeState(ClientState.JoinedLobby)
    } else {
      this.#changeState(ClientState.Disconnected)
      this.#connectToMasterInternal(this.#connectOptions)
    }

    await wait
  }

  #connectToMasterInternal(options: InternalConnectOptions): boolean {
    if (!this.#checkNextState(ClientState.ConnectingToMasterServer)) return false

    this.#changeState(ClientState.ConnectingToMasterServer)
    this.logger.info('Connecting to Master', this.masterServerAddress)
    this.#connectOptions = { ...options }

    this.#masterPeer?.destroy()
    this.#masterPeer = this.#createPeer(this.masterServerAddress, 'Master')
    this.#initMasterPeer(this.#masterPeer)
    this.#masterPeer.connect(this.appId)

    return true
  }

  #connectToGameServer(masterOpCode: OperationCode): boolean {
    if (!this.#connectOptions.keepMasterConnection) this.#masterPeer?.disconnect()

    if (!this.#checkNextState(ClientState.ConnectingToGameServer)) return false

    this.logger.info('Connecting to Game', this.#currentRoom.address)

    this.#gamePeer?.destroy()
    this.#gamePeer = this.#createPeer(this.#currentRoom.address, 'Game')
    this.#gamePeerWaitingForDisconnect = false
    this.#initGamePeer(this.#gamePeer, masterOpCode)
    this.#gamePeer.connect(this.appId)
    this.#changeState(ClientState.ConnectingToGameServer)

    return true
  }

  #nameServerOpAuth(peer: PhotonPeer, region: string): void {
    const params: unknown[] = [ParameterCode.ApplicationId, this.appId, ParameterCode.AppVersion, this.appVersion]

    if (this.#userAuthType !== CustomAuthenticationType.None) {
      params.push(ParameterCode.ClientAuthenticationType, this.#userAuthType)
      params.push(ParameterCode.ClientAuthenticationParams, this.#userAuthParameters)
      if (this.#userAuthData) params.push(ParameterCode.ClientAuthenticationData, this.#userAuthData)
    }
    if (this.userId) params.push(ParameterCode.UserId, this.userId)
    params.push(ParameterCode.Region, region)

    peer.sendOperation(OperationCode.Authenticate, params)
    peer.logger.info('Authenticate...')
  }

  #updateUserIdAndNickname(vals: Record<number, any>, logger: Logger): void {
    const userId = vals[ParameterCode.UserId]
    if (userId !== undefined) {
      this.userId = userId
      logger.info('Setting userId sent by server:', userId)
    }

    const nickname = vals[ParameterCode.Nickname]
    if (nickname !== undefined) {
      this.#myActor.setName(nickname)
      logger.info('Setting nickname sent by server:', nickname)
    }
  }

  #onOperationResponse(code: OperationCode, response: OperationResponse): void {
    if (response.errCode) {
      this.logger.warn('Operation', code, 'error:', response.errMsg, `(${response.errCode})`)
    }

    this.emit('operationResponse', code, response)
  }

  //#endregion

  //#region NameServer peer

  #initNameServerPeer(peer: PhotonPeer): void {
    peer.on('error', () => {
      this.#changeState(ClientState.Error)
      this.#onError(PeerErrorCode.NameServerError, 'NameServer peer error')
    })
    peer.on('connectFailed', () => {
      this.#changeState(ClientState.Error)
      this.#onError(PeerErrorCode.NameServerConnectFailed, `NameServer connect failed: ${this.nameServerAddress}`)
    })
    peer.on('timeout', () => {
      this.#changeState(ClientState.Error)
      this.#onError(PeerErrorCode.NameServerTimeout, 'NameServer peer timeout')
    })
    peer.on('connectClosed', () => {
      peer.logger.info('Server closed connection')
      this.#changeState(ClientState.Error)
      this.#onError(PeerErrorCode.NameServerConnectClosed, 'NameServer closed connection')
    })
    peer.on('disconnect', () => {
      if (peer === this.#nameServerPeer) peer.logger.info('Disconnected')
    })

    peer.on('connect', () => {
      peer.logger.info('Connected')
      this.#changeState(ClientState.ConnectedToNameServer)

      // connectToRegionMaster initiated this connection
      if (this.#connectOptions.region !== undefined) {
        this.#nameServerOpAuth(peer, this.#connectOptions.region)
      }
    })

    peer.onResponse(OperationCode.Authenticate, response => {
      peer.logger.debug('resp Authenticate', response)

      if (response.errCode) {
        this.#changeState(ClientState.Error)
        this.#onError(
          PeerErrorCode.NameServerAuthenticationFailed,
          `NameServer authentication failed: ${response.errCode} ${response.errMsg}`
        )
        return
      }

      peer.logger.info('Authenticated')
      peer.disconnect()
      this.#updateUserIdAndNickname(response.vals, peer.logger)

      this.masterServerAddress = response.vals[ParameterCode.Address]
      peer.logger.info('Connecting to Master server', this.masterServerAddress, '...')

      this.#connectOptions.userAuthSecret = response.vals[ParameterCode.Secret]
      if (!this.#connectToMasterInternal(this.#connectOptions)) {
        this.#onError(PeerErrorCode.MasterError, `Cannot connect to Master while in state ${this.stateName}`)
      }
    })

    peer.on('unhandledEvent', (code, data) => {
      this.emit('event', code, data.vals[ParameterCode.CustomEventContent], data.vals[ParameterCode.ActorNr])
    })
    peer.on('unhandledResponse', (code, response) => this.#onOperationResponse(code, response))
  }

  //#endregion

  //#region Master peer

  #initMasterPeer(peer: PhotonPeer): void {
    peer.on('error', () => {
      this.#changeState(ClientState.Error)
      this.#onError(PeerErrorCode.MasterError, 'Master peer error')
    })
    peer.on('connectFailed', () => {
      this.#changeState(ClientState.Error)
      this.#onError(PeerErrorCode.MasterConnectFailed, `Master connect failed: ${this.masterServerAddress}`)
    })
    peer.on('timeout', () => {
      this.#changeState(ClientState.Error)
      this.#onError(PeerErrorCode.MasterTimeout, 'Master peer timeout')
    })
    peer.on('connectClosed', () => {
      peer.logger.info('Server closed connection')
      this.#changeState(ClientState.Error)
      this.#onError(PeerErrorCode.MasterConnectClosed, 'Master server closed connection')
    })
    peer.on('disconnect', () => {
      if (peer === this.#masterPeer) peer.logger.info('Disconnected')
    })

    peer.on('connect', () => {
      peer.logger.info('Connected')
      const params: unknown[] = []

      if (this.#connectOptions.userAuthSecret) {
        // The NameServer gave us a secret to authenticate with.
        params.push(ParameterCode.Secret, this.#connectOptions.userAuthSecret)
      } else {
        params.push(ParameterCode.ApplicationId, this.appId, ParameterCode.AppVersion, this.appVersion)

        if (this.#userAuthType !== CustomAuthenticationType.None) {
          params.push(ParameterCode.ClientAuthenticationType, this.#userAuthType)
          params.push(ParameterCode.ClientAuthenticationParams, this.#userAuthParameters)
          if (this.#userAuthData) params.push(ParameterCode.ClientAuthenticationData, this.#userAuthData)
        }
        if (this.userId) params.push(ParameterCode.UserId, this.userId)
        if (this.#connectOptions.lobbyStats) params.push(ParameterCode.LobbyStats, true)
      }

      peer.sendOperation(OperationCode.Authenticate, params)
      peer.logger.info('Authenticate...')
    })

    peer.onResponse(OperationCode.Authenticate, response => {
      peer.logger.debug('resp Authenticate', response)

      if (response.errCode) {
        this.#changeState(ClientState.Error)
        this.#onError(
          PeerErrorCode.MasterAuthenticationFailed,
          `Master authentication failed: ${response.errCode} ${response.errMsg}`
        )
        return
      }

      peer.logger.info('Authenticated')
      this.#updateUserIdAndNickname(response.vals, peer.logger)
      if (response.vals[ParameterCode.Secret] !== undefined) {
        this.#connectOptions.userAuthSecret = response.vals[ParameterCode.Secret]
      }

      this.#changeState(ClientState.ConnectedToMaster)

      if (this.#autoJoinLobby) {
        const params: unknown[] = []
        if (this.#connectOptions.lobbyName) {
          params.push(ParameterCode.LobbyName, this.#connectOptions.lobbyName)
          if (this.#connectOptions.lobbyType !== undefined) {
            params.push(ParameterCode.LobbyType, this.#connectOptions.lobbyType)
          }
        }

        peer.sendOperation(OperationCode.JoinLobby, params)
        peer.logger.info('Join Lobby', this.#connectOptions.lobbyName, '...')
      }
    })

    peer.onResponse(OperationCode.JoinLobby, response => {
      peer.logger.debug('resp JoinLobby', response)

      if (!response.errCode) {
        peer.logger.info('Joined to Lobby')
        if (response.vals[ParameterCode.Secret] !== undefined) {
          this.#connectOptions.userAuthSecret = response.vals[ParameterCode.Secret]
        }
        this.#changeState(ClientState.JoinedLobby)
      }

      this.#onOperationResponse(OperationCode.JoinLobby, response)
    })

    const onMasterJoinResponse = (code: OperationCode) => (response: OperationResponse) => {
      peer.logger.debug(`resp ${OperationCode[code]}`, response)

      if (!response.errCode) {
        if (response.vals[ParameterCode.Secret] !== undefined) {
          this.#connectOptions.userAuthSecret = response.vals[ParameterCode.Secret]
        }
        this.#currentRoom.updateFromMasterResponse(response.vals)
        peer.logger.debug(`Joined ${this.#currentRoom.name}`)
        this.#connectToGameServer(code)
      }

      this.#onOperationResponse(code, response)
    }

    peer.onResponse(OperationCode.CreateGame, onMasterJoinResponse(OperationCode.CreateGame))
    peer.onResponse(OperationCode.JoinGame, onMasterJoinResponse(OperationCode.JoinGame))
    peer.onResponse(OperationCode.JoinRandomGame, onMasterJoinResponse(OperationCode.JoinRandomGame))

    peer.onEvent(EventCode.GameList, data => {
      const gameList: Record<string, any> = data.vals[ParameterCode.GameList] ?? {}

      this.#clearRooms()
      for (const name in gameList) {
        const room = new RoomInfo(name)
        room.updateFromProps(gameList[name])
        this.#addRoom(room)
      }

      this.emit('roomList', this.#roomInfos)
      peer.logger.debug('ev GameList', this.#roomInfos)
    })

    peer.onEvent(EventCode.GameListUpdate, data => {
      const gameList: Record<string, any> = data.vals[ParameterCode.GameList] ?? {}

      const updated: RoomInfo[] = []
      const added: RoomInfo[] = []
      const removed: RoomInfo[] = []

      for (const name in gameList) {
        const existing = this.#roomInfosByName.get(name)
        if (existing) {
          existing.updateFromProps(gameList[name])
          if (existing.removed) removed.push(existing)
          else updated.push(existing)
        } else {
          const room = new RoomInfo(name)
          room.updateFromProps(gameList[name])
          this.#addRoom(room)
          added.push(room)
        }
      }

      this.#purgeRemovedRooms()
      this.emit('roomListUpdate', this.#roomInfos, updated, added, removed)
      peer.logger.debug('ev GameListUpdate:', this.#roomInfos, 'u:', updated, 'a:', added, 'r:', removed)
    })

    peer.onEvent(EventCode.AppStats, data => {
      peer.logger.debug('ev AppStats', data)
      this.emit('appStats', {
        peerCount: data.vals[ParameterCode.PeerCount],
        masterPeerCount: data.vals[ParameterCode.MasterPeerCount],
        gameCount: data.vals[ParameterCode.GameCount],
      })
    })

    peer.onEvent(EventCode.LobbyStats, data => {
      peer.logger.debug('ev LobbyStats', data)
      this.emit('lobbyStats', this.#parseLobbyStats(data.vals, []))
    })

    peer.on('unhandledEvent', (code, data) => {
      this.emit('event', code, data.vals[ParameterCode.CustomEventContent], data.vals[ParameterCode.ActorNr])
    })
    peer.on('unhandledResponse', (code, response) => this.#onOperationResponse(code, response))
  }

  #parseLobbyStats(vals: Record<number, any>, requested: [string, LobbyType][]): LobbyStatsEntry[] {
    const names: string[] | undefined = vals[ParameterCode.LobbyName]
    const types: LobbyType[] = vals[ParameterCode.LobbyType] ?? []
    const peers: number[] = vals[ParameterCode.PeerCount] ?? []
    const games: number[] = vals[ParameterCode.GameCount] ?? []

    if (names) {
      return names.map((lobbyName, index) => ({
        lobbyName,
        lobbyType: types[index] ?? LobbyType.Default,
        peerCount: peers[index] ?? 0,
        gameCount: games[index] ?? 0,
      }))
    }

    return requested.map(([lobbyName, lobbyType], index) => ({
      lobbyName,
      lobbyType,
      peerCount: peers[index] ?? 0,
      gameCount: games[index] ?? 0,
    }))
  }

  //#endregion

  //#region Game peer

  #initGamePeer(peer: PhotonPeer, masterOpCode: OperationCode): void {
    peer.on('error', () => {
      this.#changeState(ClientState.Error)
      this.#onError(PeerErrorCode.GameError, 'Game peer error')
    })
    peer.on('connectFailed', () => {
      this.#changeState(ClientState.Error)
      this.#onError(PeerErrorCode.GameConnectFailed, `Game connect failed: ${this.#currentRoom.address}`)
    })
    peer.on('timeout', () => {
      this.#changeState(ClientState.Error)
      this.#onError(PeerErrorCode.GameTimeout, 'Game peer timeout')
    })
    peer.on('connectClosed', () => {
      peer.logger.info('Server closed connection')
      if (!this.#gamePeerWaitingForDisconnect) {
        this.#changeState(ClientState.Error)
        this.#onError(PeerErrorCode.GameConnectClosed, 'Game server closed connection')
      }
    })
    peer.on('disconnect', () => {
      if (peer === this.#gamePeer) {
        this.#cleanupGamePeerData()
        peer.logger.info('Disconnected')
      }
    })

    peer.on('connect', () => {
      peer.logger.info('Connected')
      const params: unknown[] = [ParameterCode.ApplicationId, this.appId, ParameterCode.AppVersion, this.appVersion]

      if (this.#connectOptions.userAuthSecret !== undefined) {
        params.push(ParameterCode.Secret, this.#connectOptions.userAuthSecret)
      }
      if (this.#userAuthType !== CustomAuthenticationType.None) {
        params.push(ParameterCode.ClientAuthenticationType, this.#userAuthType)
      }
      if (this.userId) params.push(ParameterCode.UserId, this.userId)

      peer.sendOperation(OperationCode.Authenticate, params)
      peer.logger.info('Authenticate...')
    })

    peer.onResponse(OperationCode.Authenticate, response => {
      peer.logger.debug('resp Authenticate', response)

      if (response.errCode) {
        this.#changeState(ClientState.Error)
        this.#onError(
          PeerErrorCode.GameAuthenticationFailed,
          `Game authentication failed: ${response.errCode} ${response.errMsg}`
        )
        return
      }

      peer.logger.info('Authenticated')

      if (masterOpCode === OperationCode.CreateGame) {
        this.#createRoomInternal(peer, this.#createRoomOptions)
      } else {
        const params: unknown[] = [
          ParameterCode.RoomName,
          this.#currentRoom.name,
          ParameterCode.Broadcast,
          true,
          ParameterCode.PlayerProperties,
          this.#myActor.getAllProperties(),
        ]

        if (this.#joinRoomOptions.createIfNotExists) {
          params.push(ParameterCode.JoinMode, JoinMode.CreateIfNotExists)
          this.#fillCreateRoomParams(params, this.#createRoomOptions, ParameterCode.GameProperties)
        }
        if (this.#joinRoomOptions.rejoin) params.push(ParameterCode.JoinMode, JoinMode.RejoinOnly)
        if (this.#joinRoomOptions.expectedUsers) params.push(ParameterCode.Add, this.#joinRoomOptions.expectedUsers)

        peer.sendOperation(OperationCode.JoinGame, params)
      }

      this.#changeState(ClientState.ConnectedToGameServer)
    })

    peer.onResponse(OperationCode.CreateGame, response => {
      peer.logger.debug('resp CreateGame', response)

      if (!response.errCode) {
        this.#myActor.actorNr = response.vals[ParameterCode.ActorNr]
        this.#currentRoom.updateFromProps(response.vals[ParameterCode.GameProperties])
        this.#clearActors()
        this.#addActor(this.#myActor)
        this.#changeState(ClientState.Joined)
        this.emit('roomJoined', this.#currentRoom, true)
      }

      this.#onOperationResponse(OperationCode.CreateGame, response)
    })

    peer.onResponse(OperationCode.JoinGame, response => {
      peer.logger.debug('resp JoinGame', response)

      if (!response.errCode) {
        this.#myActor.actorNr = response.vals[ParameterCode.ActorNr]
        this.#clearActors()
        this.#addActor(this.#myActor)

        const actorList: number[] | undefined = response.vals[ParameterCode.ActorList]
        const actorProps: Record<number, any> | undefined = response.vals[ParameterCode.PlayerProperties]

        if (actorList) {
          for (const actorNr of actorList) {
            const props = actorProps?.[actorNr]

            let actor: Actor
            if (actorNr === this.#myActor.actorNr) {
              actor = this.#myActor
            } else {
              actor = this.#createActor(props?.[ActorProperty.PlayerName] ?? '', actorNr, false)
              this.#addActor(actor)
            }

            if (props !== undefined) {
              const userId = props[ActorProperty.UserId]
              if (userId !== undefined) actor.userId = userId

              actor.updateFromProps(props)
            }
          }
        }

        this.#currentRoom.updateFromProps(response.vals[ParameterCode.GameProperties])
        this.#changeState(ClientState.Joined)
        this.emit('roomJoined', this.#currentRoom, false)
      }

      this.#onOperationResponse(OperationCode.JoinGame, response)
    })

    peer.onResponse(OperationCode.SetProperties, response => {
      peer.logger.debug('resp SetProperties', response)
      this.#onOperationResponse(OperationCode.SetProperties, response)
    })

    peer.onResponse(OperationCode.Leave, response => {
      peer.logger.debug('resp Leave', response)
      peer.disconnect()
      this.#onOperationResponse(OperationCode.Leave, response)
    })

    peer.onEvent(EventCode.Join, data => {
      peer.logger.debug('ev Join', data)

      if (Actor.getActorNrFromResponse(data.vals) === this.#myActor.actorNr) {
        this.#myActor.updateFromResponse(data.vals)
        this.emit('actorJoin', this.#myActor) // lets listeners read updated properties
      } else {
        const actor = this.#createActor('', -1, false)
        actor.updateFromResponse(data.vals)
        this.#addActor(actor)
        this.emit('actorJoin', actor)
      }
    })

    peer.onEvent(EventCode.Leave, data => {
      peer.logger.debug('ev Leave', data)
      this.#currentRoom.updateFromEvent(data.vals) // updates masterClientId

      const actorNr = Actor.getActorNrFromResponse(data.vals)
      const actor = actorNr === undefined ? undefined : this.#actors.get(actorNr)
      if (actorNr === undefined || !actor) return

      if (data.vals[ParameterCode.IsInactive]) {
        actor.setSuspended(true)
        this.emit('actorSuspend', actor)
      } else {
        this.#removeActor(actorNr)
        this.emit('actorLeave', actor, false)
      }
    })

    peer.onEvent(EventCode.Disconnect, data => {
      peer.logger.debug('ev Disconnect', data)

      const actorNr = Actor.getActorNrFromResponse(data.vals)
      const actor = actorNr === undefined ? undefined : this.#actors.get(actorNr)
      if (!actor) return

      actor.setSuspended(true)
      this.emit('actorSuspend', actor)
    })

    peer.onEvent(EventCode.PropertiesChanged, data => {
      peer.logger.debug('ev PropertiesChanged', data)
      const targetActorNr: number | undefined = data.vals[ParameterCode.TargetActorNr]

      if (targetActorNr !== undefined && targetActorNr > 0) {
        const actor = this.#actors.get(targetActorNr)
        if (actor) {
          actor.updateFromProps(data.vals[ParameterCode.Properties])
          this.emit('actorPropertiesChange', actor)
        }
      } else {
        this.#currentRoom.updateFromProps(data.vals[ParameterCode.Properties])
        this.emit('roomPropertiesChange', this.#currentRoom)
      }
    })

    peer.onEvent(EventCode.AuthEvent, data => {
      peer.logger.debug('ev AuthEvent', data)
      this.#connectOptions.userAuthSecret = data.vals[ParameterCode.Secret]
    })

    peer.onEvent(EventCode.ErrorInfo, data => {
      peer.logger.debug('ev ErrorInfo', data)
      this.emit('serverErrorInfo', data.vals[ParameterCode.Info])
    })

    peer.on('unhandledEvent', (code, data) => {
      this.emit('event', code, data.vals[ParameterCode.CustomEventContent], data.vals[ParameterCode.ActorNr])
    })
    peer.on('unhandledResponse', (code, response) => this.#onOperationResponse(code, response))
  }

  //#endregion

  //#region Room and actor bookkeeping

  #createRoomInternal(peer: PhotonPeer, options: CreateRoomOptions): void {
    const params: unknown[] = []
    if (this.#currentRoom.name) params.push(ParameterCode.RoomName, this.#currentRoom.name)
    this.#fillCreateRoomParams(params, options, ParameterCode.GameProperties)

    if (peer === this.#gamePeer) {
      params.push(ParameterCode.PlayerProperties, this.#myActor.getAllProperties())
    }

    peer.logger.info('Create Room', options.lobbyName, options.lobbyType, '...')
    peer.sendOperation(OperationCode.CreateGame, params)
  }

  #fillCreateRoomParams(params: unknown[], options: CreateRoomOptions = {}, gamePropertiesKey: number): void {
    // Well known properties use numeric keys, custom ones keep their string keys.
    const gameProperties: Record<string | number, any> = {}
    if (options.isVisible !== undefined) gameProperties[GameProperty.IsVisible] = options.isVisible
    if (options.isOpen !== undefined) gameProperties[GameProperty.IsOpen] = options.isOpen
    if (options.maxPlayers !== undefined) gameProperties[GameProperty.MaxPlayers] = options.maxPlayers
    if (options.propsListedInLobby !== undefined)
      gameProperties[GameProperty.PropsListedInLobby] = options.propsListedInLobby
    if (options.customGameProperties) Object.assign(gameProperties, options.customGameProperties)

    params.push(gamePropertiesKey, gameProperties)
    params.push(ParameterCode.CleanupCacheOnLeave, true)
    params.push(ParameterCode.Broadcast, true)

    if (options.roomTTL !== undefined) params.push(ParameterCode.RoomTTL, options.roomTTL)
    if (options.playerTTL !== undefined) params.push(ParameterCode.PlayerTTL, options.playerTTL)
    if (options.plugins !== undefined) params.push(ParameterCode.Plugins, options.plugins)

    params.push(ParameterCode.CheckUserOnJoin, true)
    params.push(ParameterCode.PublishUserId, true)

    if (options.lobbyName) {
      params.push(ParameterCode.LobbyName, options.lobbyName)
      if (options.lobbyType !== undefined) params.push(ParameterCode.LobbyType, options.lobbyType)
    }
    if (options.expectedUsers) params.push(ParameterCode.Add, options.expectedUsers)
  }

  #fillJoinRandomRoomParams(params: unknown[], options: JoinRandomRoomOptions): void {
    if (options.matchingType !== undefined && options.matchingType !== MatchmakingMode.FillRoom) {
      params.push(ParameterCode.MatchMakingType, options.matchingType)
    }

    const expectedRoomProperties: Record<string | number, any> = {}
    let hasProperties = false

    if (options.expectedCustomRoomProperties) {
      Object.assign(expectedRoomProperties, options.expectedCustomRoomProperties)
      hasProperties = Object.keys(options.expectedCustomRoomProperties).length > 0
    }
    if (options.expectedMaxPlayers !== undefined && options.expectedMaxPlayers > 0) {
      expectedRoomProperties[GameProperty.MaxPlayers] = options.expectedMaxPlayers
      hasProperties = true
    }

    if (hasProperties) params.push(ParameterCode.GameProperties, expectedRoomProperties)

    if (options.lobbyName) {
      params.push(ParameterCode.LobbyName, options.lobbyName)
      if (options.lobbyType !== undefined) params.push(ParameterCode.LobbyType, options.lobbyType)
    }
    if (options.sqlLobbyFilter) params.push(ParameterCode.Data, options.sqlLobbyFilter)
    if (options.expectedUsers) params.push(ParameterCode.Add, options.expectedUsers)
  }

  #addRoom(room: RoomInfo): void {
    this.#roomInfos.push(room)
    this.#roomInfosByName.set(room.name, room)
  }

  #clearRooms(): void {
    this.#roomInfos = []
    this.#roomInfosByName.clear()
  }

  #purgeRemovedRooms(): void {
    this.#roomInfos = this.#roomInfos.filter(room => !room.removed)
    for (const [name, room] of this.#roomInfosByName) {
      if (room.removed) this.#roomInfosByName.delete(name)
    }
  }

  #addActor(actor: Actor): void {
    this.#actors.set(actor.actorNr, actor)
    this.#currentRoom.playerCount = this.#actors.size
    if (this.#lowestActorId === 0 || this.#lowestActorId > actor.actorNr) this.#lowestActorId = actor.actorNr
  }

  #removeActor(actorNr: number): void {
    this.#actors.delete(actorNr)
    this.#currentRoom.playerCount = this.#actors.size

    if (this.#lowestActorId === actorNr) {
      this.#lowestActorId = this.#actors.size > 0 ? Math.min(...this.#actors.keys()) : 0
    }
  }

  #clearActors(): void {
    this.#actors.clear()
    this.#currentRoom.playerCount = 0
    this.#lowestActorId = 0
  }

  #cleanupGamePeerData(): void {
    for (const actor of this.#actors.values()) this.emit('actorLeave', actor, true)

    this.#clearActors()
    this.#addActor(this.#myActor)
  }

  //#endregion
}
