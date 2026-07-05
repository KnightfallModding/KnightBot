import type { Actor } from './actor'
import type { EventCaching, LobbyType, MatchmakingMode, ReceiverGroup } from './constants'
import type { PhotonError } from './errors'
import type { Logger } from './logger'
import type { RoomInfo } from './room'

/** Received wire `vals`: the flat pair array converted to an object keyed by STRINGIFIED parameter codes. */
export type Vals = Record<string, unknown>

/** Outgoing operation parameters keyed by numeric parameter code, flattened to a `[k1, v1, k2, v2, ...]` pair array on send. */
export type WireParams = Record<number, unknown>

// Method-shorthand type extraction makes the parameter bivariant, so undici's DOM-style handler types
// (e.g. `onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null`) remain assignable to
// WebSocketLike while fakes can still invoke the handlers with plain minimal objects.
type BivariantHandler<E> = { handler(event: E): void }['handler']

/** Minimal WebSocket surface used by PhotonPeer — shape-compatible with Node's global WebSocket and easy to fake. */
export interface WebSocketLike {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: BivariantHandler<unknown> | null
  onmessage: BivariantHandler<{ data: unknown }> | null
  onclose: BivariantHandler<{ code: number; reason: string; wasClean: boolean }> | null
  onerror: BivariantHandler<unknown> | null
}

/** WebSocket constructor shape: `new (url, subprotocol)`. `globalThis.WebSocket` satisfies this. */
export type WebSocketConstructor = new (url: string, protocols?: string | string[]) => WebSocketLike

export interface PhotonClientOptions {
  /** Photon application id — the path segment of the connection URL. */
  appId: string
  /** Application version, sent with Authenticate (parameter 220). */
  appVersion: string
  /** The wire region value sent to the nameserver (parameter 210), e.g. 'US' or 'EU'. */
  region: string
  /** Connection protocol. Default 'ws' (bot parity). */
  protocol?: 'ws' | 'wss'
  /** Nameserver `host:port`. Defaults per protocol (DefaultNameServerAddress). */
  nameServerAddress?: string
  /** UserId sent with Authenticate (parameter 225). */
  userId?: string
  /** Local actor display name (ActorProperty.PlayerName 255), sent with join/create. */
  name?: string
  /** Local actor custom properties, sent with join/create. */
  customProperties?: Record<string, unknown>
  /** Auto JoinLobby (229) after master auth. Default true. */
  joinLobby?: boolean
  /** Keep the master connection while joined to a room. Default false (parity: master socket dropped on room join). */
  keepMasterConnection?: boolean
  /** Logger for the client; peers get child loggers with suffixed prefixes. Default: `new Logger()`. */
  logger?: Logger
  /** Per-operation response timeout in milliseconds. Default 15_000. */
  operationTimeoutMs?: number
  /** Socket connect (session handshake) timeout in milliseconds. Default 15_000. */
  connectTimeoutMs?: number
  /** Keepalive idle-ping interval in milliseconds; values below 1000 disable it. Default 3_000. */
  keepAliveMs?: number
  /** Test injection: WebSocket constructor used instead of `globalThis.WebSocket`. */
  webSocketImpl?: WebSocketConstructor
}

export type ClientState =
  | 'uninitialized'
  | 'connectingToNameServer'
  | 'connectingToMaster'
  | 'connectedToMaster'
  | 'joinedLobby'
  | 'connectingToGameServer'
  | 'joined'
  | 'disconnected'
  | 'error'

/** Which server a peer connection belongs to. */
export type ServerName = 'nameServer' | 'master' | 'game'

/** Why a peer left the wire. */
export interface DisconnectReason {
  server: ServerName
  /** 'local' = we closed it, 'timeout' = WS close code 1006 (abnormal closure), 'remote' = server/network closed it. */
  kind: 'local' | 'remote' | 'timeout'
  /** WebSocket close code, when the close came from the socket. */
  code?: number
  message: string
}

/** AppStats event (226) payload — parameters 229/227/228, already numbers on the JSON wire. */
export interface AppStats {
  /** (229) Count of players in this application, in rooms. */
  peerCount: number
  /** (227) Count of players on the master server, looking for rooms. */
  masterPeerCount: number
  /** (228) Count of games in this application. */
  gameCount: number
}

/** One entry of the LobbyStats event (224) / response — parameters 213/212/229/228. */
export interface LobbyStatsEntry {
  /** (213) Lobby name. */
  lobbyName: string
  /** (212) Lobby type — see LobbyType. */
  lobbyType: number
  /** (229) Count of players in this lobby's rooms. */
  peerCount: number
  /** (228) Count of games in this lobby. */
  gameCount: number
}

/** GameListUpdate (229) diff — same semantics as the legacy handling. `rooms` is the full merged list. */
export interface RoomListUpdate {
  rooms: RoomInfo[]
  updated: RoomInfo[]
  added: RoomInfo[]
  removed: RoomInfo[]
}

export interface JoinRoomOptions {
  /** Send JoinMode.CreateIfNotExists (215: 1) so the room is created when missing. */
  createIfNotExists?: boolean
  /** UserIds to keep slots open for (parameter 238). */
  expectedUsers?: string[]
}

export interface CreateRoomOptions {
  /** List the room in the lobby (GameProperty.IsVisible 254). Default true. */
  isVisible?: boolean
  /** Allow more players to join (GameProperty.IsOpen 253). Default true. */
  isOpen?: boolean
  /** Max players that fit into the room; 0 = unlimited (GameProperty.MaxPlayers 255). */
  maxPlayers?: number
  /** Custom room properties (string keys, merged into the GameProperties hashtable 248). */
  customGameProperties?: Record<string, unknown>
  /** Custom property keys to expose in the lobby room list (GameProperty.PropsListedInLobby 250). */
  propsListedInLobby?: string[]
  /** How long the room stays alive after the last player becomes inactive, in ms (parameter 236). */
  roomTTL?: number
  /** How long an inactive player keeps their slot, in ms (parameter 235). */
  playerTTL?: number
  /** Reject joins by users already active in the room (parameter 232). */
  uniqueUserId?: boolean
  /** Lobby to attach the room to (parameter 213). */
  lobbyName?: string
  /** Type of that lobby (parameter 212). */
  lobbyType?: (typeof LobbyType)[keyof typeof LobbyType]
  /** UserIds to keep slots open for (parameter 238). */
  expectedUsers?: string[]
}

export interface JoinRandomRoomOptions {
  /** Room custom properties the random room must match (GameProperties hashtable 248). */
  expectedCustomRoomProperties?: Record<string, unknown>
  /** MaxPlayers the random room must have (GameProperty.MaxPlayers 255). */
  expectedMaxPlayers?: number
  /** Matchmaking algorithm (parameter 223); omitted on the wire when FillRoom (default). */
  matchmakingMode?: (typeof MatchmakingMode)[keyof typeof MatchmakingMode]
  /** Lobby to match in (parameter 213). */
  lobbyName?: string
  /** Type of that lobby (parameter 212). */
  lobbyType?: (typeof LobbyType)[keyof typeof LobbyType]
  /** SQL-like filter clause for SqlLobby lobbies (parameter 245). */
  sqlLobbyFilter?: string
}

export interface RaiseEventOptions {
  /** Interest group to send the event to (parameter 240). */
  interestGroup?: number
  /** Event caching mode (parameter 247); omitted on the wire when DoNotCache (default). */
  cache?: (typeof EventCaching)[keyof typeof EventCaching]
  /** Receiver selection (parameter 246); omitted on the wire when Others (default). */
  receivers?: (typeof ReceiverGroup)[keyof typeof ReceiverGroup]
  /** Explicit target actor numbers (parameter 252). */
  targetActors?: number[]
  /** Forward the event to the configured webhook (WebFlag.HttpForward in parameter 234). */
  webForward?: boolean
  /** Send the auth cookie along with the webhook call (WebFlag.SendAuthCookie in parameter 234). */
  sendAuthCookie?: boolean
}

/** Event map of PhotonClient (tuple-args form for `EventEmitter<PhotonClientEvents>`). */
export interface PhotonClientEvents {
  stateChange: [state: ClientState, previous: ClientState]
  /** Socket-level/unexpected failures — NOT rejected operations (those reject their promise). */
  error: [error: PhotonError]
  /** Fired once when the client leaves the wire entirely. */
  disconnect: [reason: DisconnectReason]
  appStats: [stats: AppStats]
  lobbyStats: [stats: LobbyStatsEntry[]]
  /** Full GameList (230) snapshot. */
  roomList: [rooms: RoomInfo[]]
  /** GameListUpdate (229) diff. */
  roomListUpdate: [update: RoomListUpdate]
  /** ALSO fires for the local actor's own Join event (legacy parity — consumers rely on it). */
  actorJoin: [actor: Actor]
  /** cleanup=true when leaving/teardown clears the roster. */
  actorLeave: [actor: Actor, cleanup: boolean]
  actorSuspend: [actor: Actor]
  actorPropertiesChange: [actor: Actor, changed: Record<string, unknown>]
  roomPropertiesChange: [changed: Record<string, unknown>]
  masterClientChange: [current: Actor | undefined, previousActorNr: number]
  /** Custom/unhandled events: data = vals[245], actorNr = vals[254]. */
  photonEvent: [event: { code: number; data: unknown; actorNr: number }]
  /** ErrorInfo event (251) — payload is vals[218]. */
  serverError: [info: unknown]
}

/** The slice of PhotonClient that Room needs, so room.ts never imports client.ts. */
export interface RoomOps {
  /** SetProperties (252) for the room: `{ 251: properties, 250: true, (231: expectedProperties CAS) }`. */
  sendSetProperties(properties: Record<string, unknown>, expectedProperties?: Record<string, unknown>): Promise<void>
  leaveRoom(): Promise<void>
}
