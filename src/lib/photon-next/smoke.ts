// Self-contained behavioral test for photon-next (ARCHITECTURE.md §Verification).
// No network: FakePhotonServer scripts fake WebSocket instances injected via `webSocketImpl`.
// Run standalone after `npm run build`:  node dist/lib/photon-next/smoke.js

import assert from 'node:assert/strict'
import type { EventEmitter } from 'node:events'
import {
  Logger,
  LogLevel,
  PhotonAbortError,
  PhotonClient,
  PhotonConnectionError,
  PhotonOperationError,
  PhotonTimeoutError,
} from './index'
import type {
  Actor,
  AppStats,
  ClientState,
  DisconnectReason,
  PhotonClientEvents,
  PhotonClientOptions,
  RoomInfo,
  RoomListUpdate,
  WebSocketConstructor,
  WebSocketLike,
} from './index'

// ---------------------------------------------------------------------------
// FakePhotonServer — scripted WebSocket endpoints
// ---------------------------------------------------------------------------

type OpHandler = (socket: FakeSocket, vals: unknown[]) => void

interface SocketScript {
  /** Bare (non-`~j~`) session-id payload delivered right after the socket opens — the "connected" signal. */
  sessionId: string
  /** Reply handlers per operation code; a missing entry leaves that request unanswered. */
  ops: Record<number, OpHandler>
}

interface SentOperation {
  req: number
  vals: unknown[]
}

interface ClientEnvelope {
  req?: number
  irq?: number
  vals?: unknown[]
}

/** Wraps a payload in one `~m~<length>~m~<payload>` frame (independent re-implementation on purpose). */
const frame = (payload: string): string => `~m~${payload.length}~m~${payload}`
const jsonFrame = (envelope: object): string => frame(`~j~${JSON.stringify(envelope)}`)

function unframe(raw: string): string {
  const header = /^~m~(\d+)~m~/.exec(raw)
  if (!header) throw new Error(`malformed client frame: ${raw}`)
  const start = header[0].length
  return raw.slice(start, start + Number(header[1]))
}

const CONNECTING = 0
const OPEN = 1
const CLOSED = 3

class FakeSocket implements WebSocketLike {
  readyState = CONNECTING
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null

  readonly url: string
  readonly protocols: string | string[] | undefined
  /** Raw outbound frames in send order, pings included. */
  readonly sentFrames: string[] = []
  /** Decoded non-ping operations `{ req, vals }` in send order — `vals` is the raw flat pair array. */
  readonly operations: SentOperation[] = []
  pingCount = 0
  closedByClient = false

  readonly #script: SocketScript

  constructor(server: FakePhotonServer, url: string, protocols?: string | string[]) {
    this.url = url
    this.protocols = protocols
    this.#script = server.scriptFor(url)
    server.sockets.push(this)
    // a real socket opens asynchronously; the peer attaches its handlers right after construction
    queueMicrotask(() => {
      if (this.readyState !== CONNECTING) return
      this.readyState = OPEN
      this.onopen?.({})
      this.deliver(frame(this.#script.sessionId))
    })
  }

  send(data: string): void {
    if (this.readyState !== OPEN) throw new Error('send() on a fake socket that is not open')
    this.sentFrames.push(data)
    const payload = unframe(data)
    if (!payload.startsWith('~j~')) return
    const envelope = JSON.parse(payload.slice(3)) as ClientEnvelope
    const vals = envelope.vals ?? []
    if (typeof envelope.irq === 'number') {
      // ping { irq: 1, vals: [1, elapsed] } → { irs: 1, vals: [1, echoedElapsed, 2, serverTime] }
      this.pingCount++
      this.reply({ irs: envelope.irq, vals: [1, vals[1], 2, 424242] })
      return
    }
    if (typeof envelope.req !== 'number') return
    this.operations.push({ req: envelope.req, vals })
    this.#script.ops[envelope.req]?.(this, vals)
  }

  close(): void {
    if (this.readyState === CLOSED) return
    this.readyState = CLOSED
    this.closedByClient = true
    queueMicrotask(() => this.onclose?.({ code: 1000, reason: '', wasClean: true }))
  }

  /** Server→client `~j~` JSON frame on a microtask — op handlers run inside the peer's send(), before the request slot exists. */
  reply(envelope: object): void {
    queueMicrotask(() => {
      if (this.readyState === OPEN) this.deliver(jsonFrame(envelope))
    })
  }

  /** Server-pushed event `{ evt, vals }`, delivered synchronously (test-driven). */
  pushEvent(code: number, valsPairs: unknown[]): void {
    this.deliver(jsonFrame({ evt: code, vals: valsPairs }))
  }

  /** Operation response `{ res, err?, msg?, vals }`, delivered synchronously (test-driven). */
  pushResponse(code: number, valsPairs: unknown[], errCode?: number, errMsg?: string): void {
    const envelope: Record<string, unknown> = { res: code, vals: valsPairs }
    if (errCode !== undefined) {
      envelope.err = errCode
      envelope.msg = errMsg
    }
    this.deliver(jsonFrame(envelope))
  }

  /** Server-initiated close (unclean), delivered synchronously. */
  serverClose(code: number, reason = ''): void {
    if (this.readyState === CLOSED) return
    this.readyState = CLOSED
    this.onclose?.({ code, reason, wasClean: false })
  }

  private deliver(raw: string): void {
    this.onmessage?.({ data: raw })
  }
}

class FakePhotonServer {
  /** Every socket ever constructed, in connection order (nameserver → master → game). */
  readonly sockets: FakeSocket[] = []
  /** Inject as PhotonClientOptions.webSocketImpl. */
  readonly wsImpl: WebSocketConstructor
  readonly #scripts: Array<{ match: string; script: SocketScript }> = []

  constructor() {
    const server = this
    this.wsImpl = class extends FakeSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(server, url, protocols)
      }
    }
  }

  /** Scripts every socket whose URL contains `match`. */
  script(match: string, script: SocketScript): void {
    this.#scripts.push({ match, script })
  }

  /** Replaces one op handler of an already-registered script. */
  onOp(match: string, code: number, handler: OpHandler): void {
    const entry = this.#scripts.find(candidate => candidate.match === match)
    if (!entry) throw new Error(`no script registered for ${match}`)
    entry.script.ops[code] = handler
  }

  scriptFor(url: string): SocketScript {
    const entry = this.#scripts.find(candidate => url.includes(candidate.match))
    if (!entry) throw new Error(`unexpected connection to ${url}`)
    return entry.script
  }

  /** The most recent socket whose URL contains `match`. */
  socket(match: string): FakeSocket {
    const matching = this.socketsFor(match)
    const last = matching[matching.length - 1]
    if (!last) throw new Error(`no socket connected to ${match}`)
    return last
  }

  socketsFor(match: string): FakeSocket[] {
    return this.sockets.filter(socket => socket.url.includes(match))
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const APP_ID = 'fake-app-id'
const APP_VERSION = '9.9'
const REGION = 'US'
const USER_ID = 'user-42'
const NS_HOST = 'ns.fake:9093'
const MASTER_HOST = 'master.fake:5055'
const GAME_HOST = 'game.fake:5056'
const NS_SECRET = 'secret-from-ns'
const GAME_SECRET = 'secret-from-master'
const BOT_NAME = '<b>SmokeBot</b>'
const ROOM_NAME = 'QUEUE-abc'

interface RosterOptions {
  selfActorNr?: number
  actorList?: number[]
  actorProps?: Record<string, Record<string, unknown>>
  gameProps?: Record<string, unknown>
}

/** Scripts the standard nameserver → master → game happy path; scenarios override single ops via onOp(). */
function standardServer(roster: RosterOptions = {}): FakePhotonServer {
  const selfActorNr = roster.selfActorNr ?? 1
  const actorList = roster.actorList ?? [selfActorNr]
  const actorProps = roster.actorProps ?? {}
  const gameProps = roster.gameProps ?? {}
  const server = new FakePhotonServer()
  server.script(NS_HOST, {
    sessionId: '10001',
    ops: {
      // NS Authenticate → Secret (221) + master Address (230); the live NS returns a full
      // scheme-prefixed URL with a path (the game address stays bare host:port to cover both forms)
      230: socket => socket.reply({ res: 230, vals: [221, NS_SECRET, 230, `ws://${MASTER_HOST}/Master`] }),
    },
  })
  server.script(MASTER_HOST, {
    sessionId: '10002',
    ops: {
      230: socket => socket.reply({ res: 230, vals: [] }),
      // JoinLobby
      229: socket => socket.reply({ res: 229, vals: [] }),
      // JoinGame → fresh Secret (221) + game Address (230)
      226: socket => socket.reply({ res: 226, vals: [221, GAME_SECRET, 230, GAME_HOST] }),
    },
  })
  server.script(GAME_HOST, {
    sessionId: '10003',
    ops: {
      230: socket => socket.reply({ res: 230, vals: [] }),
      // JoinGame → GameProperties (248), per-actor properties (249), ActorList (252), own ActorNr (254)
      226: socket =>
        socket.reply({ res: 226, vals: [248, gameProps, 249, actorProps, 252, actorList, 254, selfActorNr] }),
      // SetProperties
      252: socket => socket.reply({ res: 252, vals: [] }),
      // Leave
      254: socket => socket.reply({ res: 254, vals: [] }),
    },
  })
  return server
}

function makeClient(server: FakePhotonServer, extra: Partial<PhotonClientOptions> = {}): PhotonClient {
  return new PhotonClient({
    appId: APP_ID,
    appVersion: APP_VERSION,
    region: REGION,
    nameServerAddress: NS_HOST,
    userId: USER_ID,
    keepAliveMs: 0, // disables idle pings — scenarios control every frame (session-open ping still fires)
    logger: new Logger('[smoke]', LogLevel.OFF),
    webSocketImpl: server.wsImpl,
    ...extra,
  })
}

interface RecordedEvent {
  name: string
  args: unknown[]
}

function record(client: PhotonClient, names: ReadonlyArray<keyof PhotonClientEvents>): RecordedEvent[] {
  const recorded: RecordedEvent[] = []
  const emitter = client as unknown as EventEmitter
  for (const name of names) {
    emitter.on(name, (...args: unknown[]) => recorded.push({ name, args }))
  }
  return recorded
}

const named = (events: RecordedEvent[], name: keyof PhotonClientEvents): RecordedEvent[] =>
  events.filter(event => event.name === name)

// ---------------------------------------------------------------------------
// Scenarios (ARCHITECTURE.md §Verification 1-10) — fresh client + fresh fake server each
// ---------------------------------------------------------------------------

async function scenarioConnect(): Promise<void> {
  const server = standardServer()
  const client = makeClient(server)
  try {
    const states: ClientState[] = []
    client.on('stateChange', state => states.push(state))
    const outOfBand = record(client, ['error', 'disconnect'])

    await client.connect()

    assert.equal(client.state, 'joinedLobby')
    assert.deepEqual(states, ['connectingToNameServer', 'connectingToMaster', 'connectedToMaster', 'joinedLobby'])

    const ns = server.socket(NS_HOST)
    assert.equal(ns.url, `ws://${NS_HOST}/${APP_ID}?libversion=4.3.2.0`)
    assert.equal(ns.protocols, 'Json')
    // exact NS Authenticate wire shape: { req, vals } with the flat pair array in ascending-code order
    const nsAuth = { req: 230, vals: [210, REGION, 220, APP_VERSION, 224, APP_ID, 225, USER_ID] }
    assert.deepEqual(ns.operations, [nsAuth])
    assert.equal(ns.sentFrames[1], jsonFrame(nsAuth))
    // the peer pings exactly once, as soon as the session opens
    assert.equal(ns.pingCount, 1)
    assert.match(ns.sentFrames[0]!, /^~m~\d+~m~~j~\{"irq":1,"vals":\[1,\d+\]\}$/)
    assert.equal(ns.closedByClient, true)

    const master = server.socket(MASTER_HOST)
    // scheme-prefixed address: no double `ws://`, appId still appended after the /Master path
    assert.equal(master.url, `ws://${MASTER_HOST}/Master/${APP_ID}?libversion=4.3.2.0`)
    // master Authenticate carries ONLY the nameserver secret (legacy parity); JoinLobby has no params
    assert.deepEqual(master.operations, [
      { req: 230, vals: [221, NS_SECRET] },
      { req: 229, vals: [] },
    ])
    assert.equal(master.sentFrames[1], jsonFrame({ req: 230, vals: [221, NS_SECRET] }))
    assert.equal(master.closedByClient, false)
    assert.equal(outOfBand.length, 0)
  } finally {
    client.disconnect()
  }
}

async function scenarioRoomList(): Promise<void> {
  const server = standardServer()
  const client = makeClient(server)
  try {
    await client.connect()
    const snapshots: RoomInfo[][] = []
    const updates: RoomListUpdate[] = []
    client.on('roomList', rooms => snapshots.push(rooms))
    client.on('roomListUpdate', update => updates.push(update))
    const master = server.socket(MASTER_HOST)

    // GameList (230): full snapshot in param 222, keyed by room name
    master.pushEvent(230, [222, { 'ROOM-a': { '252': 3, '255': 20 }, 'ROOM-b': { '252': 1, '253': false } }])
    assert.equal(snapshots.length, 1)
    assert.deepEqual(
      snapshots[0]!.map(room => room.name),
      ['ROOM-a', 'ROOM-b']
    )
    assert.equal(client.rooms, snapshots[0])
    const roomA = snapshots[0]![0]!
    assert.equal(roomA.playerCount, 3)
    assert.equal(roomA.maxPlayers, 20)
    assert.equal(roomA.isOpen, true)
    assert.equal(snapshots[0]![1]!.isOpen, false)

    // GameListUpdate (229): ROOM-a updated, ROOM-b removed (Removed 251), ROOM-c added
    master.pushEvent(229, [222, { 'ROOM-a': { '252': 5 }, 'ROOM-b': { '251': true }, 'ROOM-c': { '252': 2 } }])
    assert.equal(updates.length, 1)
    const update = updates[0]!
    assert.deepEqual(
      update.updated.map(room => room.name),
      ['ROOM-a']
    )
    assert.deepEqual(
      update.added.map(room => room.name),
      ['ROOM-c']
    )
    assert.deepEqual(
      update.removed.map(room => room.name),
      ['ROOM-b']
    )
    assert.deepEqual(
      update.rooms.map(room => room.name),
      ['ROOM-a', 'ROOM-c']
    )
    assert.equal(update.updated[0], roomA) // same RoomInfo identity, updated in place
    assert.equal(roomA.playerCount, 5)
    assert.equal(client.rooms, update.rooms)
  } finally {
    client.disconnect()
  }
}

async function scenarioAppStats(): Promise<void> {
  const server = standardServer()
  const client = makeClient(server)
  try {
    await client.connect()
    const stats: AppStats[] = []
    client.on('appStats', payload => stats.push(payload))
    // AppStats (226): 229 peerCount, 227 masterPeerCount, 228 gameCount — already numbers on the JSON wire
    server.socket(MASTER_HOST).pushEvent(226, [229, 128, 227, 5, 228, 3])
    assert.deepEqual(stats, [{ peerCount: 128, masterPeerCount: 5, gameCount: 3 }])
  } finally {
    client.disconnect()
  }
}

async function scenarioJoinRoom(): Promise<void> {
  const server = standardServer({
    selfActorNr: 1,
    actorList: [1, 2],
    actorProps: { '1': { '255': BOT_NAME, UUID: 'knightbot' }, '2': { '255': 'OtherGuy', '253': 'user-other' } },
    gameProps: { '252': 2, '253': true, '255': 20, mode: 'ranked' },
  })
  const client = makeClient(server, { name: BOT_NAME, customProperties: { UUID: 'knightbot' } })
  try {
    await client.connect()
    const events = record(client, ['actorJoin', 'error', 'disconnect'])

    const room = await client.joinRoom(ROOM_NAME)

    const master = server.socket(MASTER_HOST)
    assert.deepEqual(master.operations[2], { req: 226, vals: [255, ROOM_NAME] })
    // handoff: master socket dropped (expected close — must NOT emit disconnect), game socket dialed
    assert.equal(master.closedByClient, true)
    assert.equal(named(events, 'disconnect').length, 0)

    const game = server.socket(GAME_HOST)
    assert.equal(game.url, `ws://${GAME_HOST}/${APP_ID}?libversion=4.3.2.0`)
    assert.equal(game.protocols, 'Json')
    // game Authenticate replays the identity plus the secret minted by the master JoinGame response
    assert.deepEqual(game.operations[0], {
      req: 230,
      vals: [220, APP_VERSION, 221, GAME_SECRET, 224, APP_ID, 225, USER_ID],
    })
    // exact game JoinGame shape: PlayerProperties (249) carries the buffered name + custom properties
    assert.deepEqual(game.operations[1], {
      req: 226,
      vals: [249, { '255': BOT_NAME, UUID: 'knightbot' }, 250, true, 255, ROOM_NAME],
    })

    assert.equal(client.state, 'joined')
    assert.equal(client.room, room)
    assert.equal(room.name, ROOM_NAME)
    assert.equal(room.playerCount, 2)
    assert.equal(room.maxPlayers, 20)
    assert.equal(room.getCustomProperty('mode'), 'ranked')
    assert.equal(client.myActor.actorNr, 1)
    assert.deepEqual([...client.actors.keys()], [1, 2])
    const other = client.actors.get(2)!
    assert.equal(other.name, 'OtherGuy')
    assert.equal(other.userId, 'user-other')
    assert.equal(other.isLocal, false)
    assert.equal(client.masterClientId, 1)
    // roster built from the join response emits NO actorJoin (legacy parity)
    assert.equal(named(events, 'actorJoin').length, 0)

    // the self Join event (255) arrives after the response → actorJoin fires for the local actor
    game.pushEvent(255, [254, 1, 249, { '255': BOT_NAME, UUID: 'knightbot' }])
    const joins = named(events, 'actorJoin')
    assert.equal(joins.length, 1)
    assert.equal(joins[0]!.args[0], client.myActor)
    assert.equal(named(events, 'error').length, 0)
  } finally {
    client.disconnect()
  }
}

async function scenarioActorLifecycle(): Promise<void> {
  const server = standardServer({
    selfActorNr: 2,
    actorList: [1, 2],
    actorProps: { '1': { '255': 'Chief', '253': 'user-chief' } },
  })
  const client = makeClient(server, { name: BOT_NAME })
  try {
    await client.connect()
    const events = record(client, ['actorJoin', 'actorLeave', 'actorSuspend', 'masterClientChange'])
    await client.joinRoom(ROOM_NAME)
    assert.equal(client.masterClientId, 1) // no raw masterClientId → lowest actorNr
    assert.equal(named(events, 'masterClientChange').length, 0) // initial computation is silent
    assert.equal(named(events, 'actorJoin').length, 0)
    const game = server.socket(GAME_HOST)

    // Join (255) of a remote actor
    game.pushEvent(255, [254, 3, 249, { '255': 'Third' }])
    const joins = named(events, 'actorJoin')
    assert.equal(joins.length, 1)
    const third = joins[0]!.args[0] as Actor
    assert.equal(third.actorNr, 3)
    assert.equal(third.name, 'Third')
    assert.equal(client.actors.size, 3)
    assert.equal(named(events, 'masterClientChange').length, 0) // actor 1 is still the master

    // Leave (254) of the master, carrying the reassigned MasterClientId in param 203
    game.pushEvent(254, [254, 1, 203, 2])
    const leaves = named(events, 'actorLeave')
    assert.equal(leaves.length, 1)
    assert.equal((leaves[0]!.args[0] as Actor).actorNr, 1)
    assert.equal(leaves[0]!.args[1], false)
    assert.equal(client.actors.has(1), false)
    const changes = named(events, 'masterClientChange')
    assert.equal(changes.length, 1)
    assert.equal(changes[0]!.args[0], client.myActor) // actor 2 = the local actor
    assert.equal(changes[0]!.args[1], 1)
    assert.equal(client.masterClientId, 2)
    assert.equal(named(events, 'actorSuspend').length, 0)
  } finally {
    client.disconnect()
  }
}

async function scenarioCustomEvent(): Promise<void> {
  const server = standardServer()
  const client = makeClient(server)
  try {
    await client.connect()
    await client.joinRoom(ROOM_NAME)
    const received: Array<{ code: number; data: unknown; actorNr: number }> = []
    client.on('photonEvent', event => received.push(event))
    // PUN RPC event 200: payload in Data (245) keyed by stringified numbers, sender in ActorNr (254)
    const payload = { '0': 1001, '1': 'serialization error', '2': 42, '4': [], '5': 29 }
    server.socket(GAME_HOST).pushEvent(200, [245, payload, 254, 2])
    assert.equal(received.length, 1)
    assert.equal(received[0]!.code, 200)
    assert.equal(received[0]!.actorNr, 2)
    assert.deepEqual(received[0]!.data, payload)
    assert.equal((received[0]!.data as Record<string, unknown>)['5'], 29)
  } finally {
    client.disconnect()
  }
}

async function scenarioJoinError(): Promise<void> {
  const server = standardServer()
  server.onOp(MASTER_HOST, 226, socket => socket.reply({ res: 226, err: 32758, msg: 'Game does not exist', vals: [] }))
  const client = makeClient(server)
  try {
    await client.connect()
    const outOfBand = record(client, ['error', 'disconnect'])
    const error = await client.joinRoom('GONE').then(
      () => undefined,
      (thrown: unknown) => thrown
    )
    assert.ok(error instanceof PhotonOperationError, `expected PhotonOperationError, got ${String(error)}`)
    assert.equal(error.operation, 226)
    assert.equal(error.errorCode, 32758)
    assert.match(error.message, /GameDoesNotExist/)
    assert.equal(error.serverMessage, 'Game does not exist')
    // the client stays in the lobby: master untouched, game server never dialed, no out-of-band events
    assert.equal(client.state, 'joinedLobby')
    assert.equal(server.socket(MASTER_HOST).closedByClient, false)
    assert.equal(server.socketsFor(GAME_HOST).length, 0)
    assert.equal(outOfBand.length, 0)
  } finally {
    client.disconnect()
  }
}

async function scenarioLeaveRoom(): Promise<void> {
  // master connection kept → back to the lobby
  {
    const server = standardServer({ selfActorNr: 1, actorList: [1, 2], actorProps: { '2': { '255': 'OtherGuy' } } })
    const client = makeClient(server, { keepMasterConnection: true })
    try {
      await client.connect()
      await client.joinRoom(ROOM_NAME)
      const events = record(client, ['actorLeave', 'disconnect'])
      await client.leaveRoom()
      const game = server.socket(GAME_HOST)
      assert.deepEqual(game.operations[2], { req: 254, vals: [] }) // Leave op, no params
      assert.equal(game.closedByClient, true)
      // roster cleanup: actorLeave(actor, cleanup=true) for every actor, local one included
      const leaves = named(events, 'actorLeave')
      assert.deepEqual(
        leaves.map(event => [(event.args[0] as Actor).actorNr, event.args[1]]),
        [
          [1, true],
          [2, true],
        ]
      )
      assert.equal(leaves[0]!.args[0], client.myActor)
      assert.equal(client.actors.size, 0)
      assert.equal(client.room, undefined)
      assert.equal(client.state, 'joinedLobby')
      assert.equal(named(events, 'disconnect').length, 0)
    } finally {
      client.disconnect()
    }
  }
  // master dropped at join (default) → leaving disconnects entirely
  {
    const server = standardServer()
    const client = makeClient(server)
    try {
      await client.connect()
      await client.joinRoom(ROOM_NAME)
      const events = record(client, ['disconnect'])
      await client.leaveRoom()
      assert.equal(client.state, 'disconnected')
      const disconnects = named(events, 'disconnect')
      assert.equal(disconnects.length, 1)
      const reason = disconnects[0]!.args[0] as DisconnectReason
      assert.equal(reason.kind, 'local')
      assert.equal(reason.server, 'game')
    } finally {
      client.disconnect()
    }
  }
}

async function scenarioUnexpectedClose(): Promise<void> {
  const server = standardServer()
  server.onOp(MASTER_HOST, 226, () => {
    // never answered — the unexpected close below must reject it
  })
  const client = makeClient(server)
  try {
    await client.connect()
    const events = record(client, ['error', 'disconnect'])
    const pending = client.joinRoom(ROOM_NAME).then(
      () => undefined,
      (thrown: unknown) => thrown
    )
    const master = server.socket(MASTER_HOST)
    assert.equal(master.operations.length, 3) // auth + JoinLobby + the still-pending JoinGame

    master.serverClose(1002, 'protocol error')

    const error = await pending
    assert.ok(error instanceof PhotonAbortError, `expected PhotonAbortError, got ${String(error)}`)
    assert.equal(client.state, 'error')
    const errors = named(events, 'error')
    assert.equal(errors.length, 1)
    const connectionError = errors[0]!.args[0]
    assert.ok(connectionError instanceof PhotonConnectionError)
    assert.equal(connectionError.server, 'master')
    const disconnects = named(events, 'disconnect')
    assert.equal(disconnects.length, 1)
    const reason = disconnects[0]!.args[0] as DisconnectReason
    assert.equal(reason.server, 'master')
    assert.equal(reason.kind, 'remote') // 1006 would be 'timeout'
    assert.equal(reason.code, 1002)
  } finally {
    client.disconnect()
  }
}

async function scenarioRequestTimeout(): Promise<void> {
  const server = standardServer()
  server.onOp(GAME_HOST, 252, () => {
    // SetProperties intentionally unanswered → per-request timeout
  })
  const client = makeClient(server, { operationTimeoutMs: 150 })
  try {
    await client.connect()
    const room = await client.joinRoom(ROOM_NAME)
    const error = await room.setCustomProperties({ speed: 1 }).then(
      () => undefined,
      (thrown: unknown) => thrown
    )
    assert.ok(error instanceof PhotonTimeoutError, `expected PhotonTimeoutError, got ${String(error)}`)
    assert.equal(error.operation, 252)
    assert.equal(client.state, 'joined') // an op timeout rejects the caller, it tears nothing down

    // FIFO correlation: a second 252 request queues behind the timed-out slot's tombstone; the late
    // (error) response for the first request must be discarded, not settle the second request
    const second = room.setCustomProperties({ speed: 2 })
    const game = server.socket(GAME_HOST)
    game.pushResponse(252, [], -1, 'late response to the timed-out request')
    game.pushResponse(252, [])
    await second
    assert.equal(client.state, 'joined')
  } finally {
    client.disconnect()
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const scenarios: ReadonlyArray<readonly [string, () => Promise<void>]> = [
  ['connect: nameserver auth, master auth with secret only, JoinLobby', scenarioConnect],
  ['lobby: GameList snapshot and GameListUpdate diff semantics', scenarioRoomList],
  ['lobby: AppStats event payload', scenarioAppStats],
  ['joinRoom: game handoff, PlayerProperties, roster, self Join event', scenarioJoinRoom],
  ['room: remote actor join, master handoff on leave', scenarioActorLifecycle],
  ['room: custom event 200 passes through with string-number keys', scenarioCustomEvent],
  ['joinRoom: server error rejects and leaves the client in the lobby', scenarioJoinError],
  ['leaveRoom: Leave op, roster cleanup, state per master-connection rule', scenarioLeaveRoom],
  ['unexpected close mid-lobby: error + disconnect, pending request rejected', scenarioUnexpectedClose],
  ['request timeout: PhotonTimeoutError, late response discarded', scenarioRequestTimeout],
]

async function main(): Promise<void> {
  let failed = 0
  for (const [name, run] of scenarios) {
    try {
      await run()
      console.log(`PASS ${name}`)
    } catch (error) {
      failed++
      console.log(`FAIL ${name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    }
  }
  console.log(
    failed === 0
      ? `smoke: all ${scenarios.length} scenarios passed`
      : `smoke: ${failed} of ${scenarios.length} scenarios FAILED`
  )
  if (failed > 0) process.exitCode = 1
}

void main()
