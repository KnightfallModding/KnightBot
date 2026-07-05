// Wire constants for the Photon LoadBalancing JSON protocol (SDK 4.3.2.0).
// Const objects `as const`, NOT TS enums: several tables carry duplicate numeric values
// (request vs response context), which would break an enum's reverse mapping.

/** Photon JS SDK version this client is wire-compatible with — sent as the `libversion` URL query parameter. */
export const PHOTON_LIB_VERSION = '4.3.2.0'

/** Default Photon cloud nameserver `host:port` per connection protocol. */
export const DefaultNameServerAddress = {
  /** Plain WebSocket endpoint. */
  ws: 'ns.photonengine.io:9093',
  /** TLS WebSocket endpoint. */
  wss: 'ns.photonengine.io:19093',
} as const

/** Operation codes — the wire `req` (request) / `res` (response) field. */
export const OperationCode = {
  /** (230) Authenticates this peer on the nameserver/master/game server. */
  Authenticate: 230,
  /** (229) Joins the lobby (on master). */
  JoinLobby: 229,
  /** (228) Leaves the lobby (on master). Vocabulary only — the legacy SDK never sends it. */
  LeaveLobby: 228,
  /** (227) Creates a game (or fails if the name exists). */
  CreateGame: 227,
  /** (226) Joins a room by name. */
  JoinGame: 226,
  /** (225) Joins a random room (on master). */
  JoinRandomGame: 225,
  /** (254) Leaves the room. */
  Leave: 254,
  /** (253) Raises an event in the room, for other actors. */
  RaiseEvent: 253,
  /** (252) Sets properties of the room or of an actor. */
  SetProperties: 252,
  /** (251) Gets properties. Vocabulary only — the legacy SDK never sends it. */
  GetProperties: 251,
  /** (248) Changes interest groups in the room. */
  ChangeGroups: 248,
  /** (222) Asks the master for friends' online status and joined rooms. */
  FindFriends: 222,
  /** (221) Asks the master for lobby statistics. */
  LobbyStats: 221,
  /** (220) Gets the list of regional servers from a nameserver. */
  GetRegions: 220,
  /** (219) WebRPC operation. */
  Rpc: 219,
} as const

/** Event codes — the wire `evt` field. Photon events count down from 255; codes 0+ are for in-game events. */
export const EventCode = {
  /** (230) Initial list of RoomInfos (in lobby on master). */
  GameList: 230,
  /** (229) Update of RoomInfos to be merged into the initial list (in lobby on master). */
  GameListUpdate: 229,
  /** (228) Not used. State of queueing in case of server-full. */
  QueueState: 228,
  /** (226) Stats about this application: players, rooms etc. Pushed periodically by the master. */
  AppStats: 226,
  /** (224) Statistics per lobby (pushed by the master when subscribed). */
  LobbyStats: 224,
  /** (223) Sent by Photon to refresh the auth token before it times out (game server only). */
  AuthEvent: 223,
  /** (210) Internally used in case of hosting by Azure. Never handled. */
  AzureNodeInfo: 210,
  /** (255) Someone joined the game: carries the new actorNr and that actor's properties. */
  Join: 255,
  /** (254) A player left the game, identified by actorNr. */
  Leave: 254,
  /** (253) Properties were set with broadcast on: carries the changed properties. */
  PropertiesChanged: 253,
  /** (252) A player disconnected unexpectedly while playerTTL > 0 (actor becomes inactive/suspended). */
  Disconnect: 252,
  /** (251) Sent by Photon Cloud when a plugin/webhook call failed or the events cache limit was exceeded. */
  ErrorInfo: 251,
} as const

/**
 * Parameter codes for operations and events — keys of the flat `vals` pair array.
 * Several byte values are intentionally reused and disambiguated by context (request vs response, op vs event):
 * 223, 245, 210, 209, 208, 239 and 1 each appear under more than one name.
 */
export const ParameterCode = {
  /** (230) Address of a (game) server to use. */
  Address: 230,
  /** (229) Count of players in this application, in rooms (AppStats/LobbyStats). */
  PeerCount: 229,
  /** (228) Count of games in this application (AppStats/LobbyStats). */
  GameCount: 228,
  /** (227) Count of players on the master server, looking for rooms (AppStats). */
  MasterPeerCount: 227,
  /** (225) User's ID. */
  UserId: 225,
  /** (224) Application ID: a name on a self-hosted Photon or a GUID on the Photon Cloud. */
  ApplicationId: 224,
  /** (223) Not used ("Position"): if you get queued before connect, this is your position. */
  Position: 223,
  /** (223) Matchmaking algorithm for JoinRandomGame — see MatchmakingMode. Same byte as Position. */
  MatchMakingType: 223,
  /** (222) List of RoomInfos of open/listed rooms (GameList/GameListUpdate events). */
  GameList: 222,
  /** (221) The auth token ("secret") — returned by Authenticate, replayed to master/game servers. */
  Secret: 221,
  /** (220) Version of your application. */
  AppVersion: 220,
  /** (210) Internally used in case of hosting by Azure. Same byte as Region. */
  AzureNodeInfo: 210,
  /** (209) Internally used in case of hosting by Azure. Same byte as UriPath. */
  AzureLocalNodeId: 209,
  /** (208) Internally used in case of hosting by Azure. Same byte as RpcCallParams/RpcCallRetData. */
  AzureMasterNodeId: 208,
  /** (255) The gameId/roomName (a unique name per room). Used in JoinGame and similar. */
  RoomName: 255,
  /** (250) Broadcast option of SetProperties. */
  Broadcast: 250,
  /** (252) List of players in a room (JoinGame response). */
  ActorList: 252,
  /** (254) Actor number of an operation or event. */
  ActorNr: 254,
  /** (249) Actor/player property set (hashtable). */
  PlayerProperties: 249,
  /** (245) Custom content of an event, as sent by RaiseEvent. Same byte as Data. */
  CustomEventContent: 245,
  /** (245) Data of an event (read side of CustomEventContent). */
  Data: 245,
  /** (244) Code-related parameter, e.g. RaiseEvent's event code. */
  Code: 244,
  /** (248) Room/game property set (hashtable). */
  GameProperties: 248,
  /** (251) Property set (hashtable) when sending only one set of properties. */
  Properties: 251,
  /** (253) Target actor of a property set operation; 0 targets the game/room. */
  TargetActorNr: 253,
  /** (246) Selects the receivers of an event (RaiseEvent) — see ReceiverGroup. */
  ReceiverGroup: 246,
  /** (247) Event caching mode while raising events — see EventCaching. */
  Cache: 247,
  /** (241) Boolean CreateGame parameter: server cleans up the room cache of leaving players. */
  CleanupCacheOnLeave: 241,
  /** (240) Interest group parameter of RaiseEvent. */
  Group: 240,
  /** (239) Removes something from a list, e.g. groups from the player's interest groups. Same byte as PublishUserId. */
  Remove: 239,
  /** (238) Adds something to a list/set, e.g. groups to the player's interest groups, or expected users. */
  Add: 238,
  /** (236) How long a room instance is kept alive in the room cache after all players left. */
  RoomTTL: 236,
  /** (235) How long a disconnected player stays "inactive" in the room before removal. */
  PlayerTTL: 235,
  /** (204) Informs the server of the plugins the room should use (CreateGame). */
  Plugins: 204,
  /** (217) Target custom authentication type/service (Authenticate). */
  ClientAuthenticationType: 217,
  /** (216) String parameters for the custom authentication service (Authenticate). */
  ClientAuthenticationParams: 216,
  /** (214) Binary/extra data for the custom authentication service (Authenticate). */
  ClientAuthenticationData: 214,
  /** (215) Join variant: join only, create-if-not-exists or rejoin — see JoinMode. */
  JoinMode: 215,
  /** (203) MasterClientId as op/event parameter. As a room property this is byte 248 (GameProperty.MasterClientId). */
  MasterClientId: 203,
  /** (1) FindFriends request: string[] of friends to look up. */
  FindFriendsRequestList: 1,
  /** (1) FindFriends response: boolean[] of online states. Same byte as the request list (request vs response). */
  FindFriendsResponseOnlineList: 1,
  /** (2) FindFriends response: string[] of room names ('' where not known or no room joined). */
  FindFriendsResponseRoomIdList: 2,
  /** (213) Lobby name, in matchmaking operations and room creation. */
  LobbyName: 213,
  /** (212) Lobby type, combined with the lobby name — see LobbyType. */
  LobbyType: 212,
  /** (211) Lobby statistics subscription/payload. */
  LobbyStats: 211,
  /** (210) Region value in Authenticate and GetRegions. Same byte as AzureNodeInfo. */
  Region: 210,
  /** (233) Marks an actor as inactive (Leave op with playerTTL, Join event of a rejoiner). */
  IsInactive: 233,
  /** (232) CreateGame option: reject joins by users already active in the room (unique userId). */
  CheckUserOnJoin: 232,
  /** (231) Expected values for Check-And-Swap (CAS) property changes. */
  ExpectedValues: 231,
  /** (209) WebRPC URI path. Same byte as AzureLocalNodeId. */
  UriPath: 209,
  /** (208) WebRPC call parameters (request side). */
  RpcCallParams: 208,
  /** (207) WebRPC return code (response side). */
  RpcCallRetCode: 207,
  /** (206) WebRPC return message. Never read — the legacy SDK takes the message from the response envelope. */
  RpcCallRetMessage: 206,
  /** (208) WebRPC return data (response side). Same byte as RpcCallParams (request vs response). */
  RpcCallRetData: 208,
  /** (234) Webhook behavior flags — see WebFlag. */
  WebFlags: 234,
  /** (202) Nickname of the client, pushed back by the server in operation responses. */
  Nickname: 202,
  /** (239) Join option: broadcast UserIds of players in the room (FindFriends/slot reservation). Same byte as Remove. */
  PublishUserId: 239,
  /** (218) Content of the ErrorInfo event and internal debug operations. */
  Info: 218,
} as const

/**
 * "Well known" room/game property byte keys, nested inside the GameProperties (248) hashtable.
 * Custom room properties use string keys in the same hashtable.
 */
export const GameProperty = {
  /** (255) Max number of players that fit into this room; 0 means unlimited. */
  MaxPlayers: 255,
  /** (254) Whether this room is listed in the lobby on the master. */
  IsVisible: 254,
  /** (253) Whether more players may join the room. */
  IsOpen: 253,
  /** (252) Current count of players in the room; only sent to the lobby on the master. */
  PlayerCount: 252,
  /** (251) True if the room is to be removed from the lobby's room listing (GameListUpdate). */
  Removed: 251,
  /** (250) List of room property keys to expose in the lobby's RoomInfo list; defined once at CreateGame. */
  PropsListedInLobby: 250,
  /** (249) Room-property equivalent of the CleanupCacheOnLeave join/create parameter. */
  CleanupCacheOnLeave: 249,
  /** (248) MasterClientId, synced by the server. As an op parameter this is byte 203 (ParameterCode.MasterClientId). */
  MasterClientId: 248,
  /** (247) ExpectedUsers of a room: matchmaking keeps slots open for these userIds. */
  ExpectedUsers: 247,
  /** (246) Player Time To Live: how long an inactive player keeps their slot. */
  PlayerTTL: 246,
  /** (245) Room Time To Live: how long a room stays available after the last player becomes inactive. */
  RoomTTL: 245,
} as const

/**
 * "Well known" actor/player property byte keys, nested inside the PlayerProperties (249) hashtable.
 * Custom actor properties use string keys in the same hashtable.
 */
export const ActorProperty = {
  /** (255) The player's display name. */
  PlayerName: 255,
  /** (253) The player's userId. */
  UserId: 253,
} as const

/**
 * Server error codes (the wire `err` field of operation responses).
 * Pure vocabulary: the legacy SDK never compares against these at runtime — kept for friendly error names.
 */
export const ErrorCode = {
  /** (0) No error. */
  Ok: 0,
  /** (-3) Operation can't be executed yet (e.g. not authenticated). */
  OperationNotAllowedInCurrentState: -3,
  /** (-2) The operation is not implemented on the server application you connect to. */
  InvalidOperationCode: -2,
  /** (-1) Something went wrong in the server. */
  InternalServerError: -1,
  /** (32767) Authentication failed. Possible cause: AppId is unknown to Photon (in cloud service). */
  InvalidAuthentication: 32767,
  /** (32766) GameId (name) already in use; can't create another. Change the name. */
  GameIdAlreadyExists: 32766,
  /** (32765) Game is full. Can happen when players took the last slots while you joined. */
  GameFull: 32765,
  /** (32764) Game is closed and can't be joined. Join another game. */
  GameClosed: 32764,
  /** (32762) All servers are busy; temporary — retry after a brief wait. (32763 is skipped upstream.) */
  ServerFull: 32762,
  /** (32761) Not in use currently. */
  UserBlocked: 32761,
  /** (32760) Random matchmaking found no open, non-full room. Retry or create a room. */
  NoRandomMatchFound: 32760,
  /** (32758) The room (name) does not exist (anymore). Can happen when players leave while you join. (32759 is skipped upstream.) */
  GameDoesNotExist: 32758,
  /** (32757) The concurrent-users (CCU) limit of the app's subscription is reached. */
  MaxCcuReached: 32757,
  /** (32756) The app's subscription does not allow using this region's server. */
  InvalidRegion: 32756,
  /** (32755) Custom authentication failed: setup issue or bad user data — check the error message. */
  CustomAuthenticationFailed: 32755,
  /** (32753) The authentication ticket expired. Connect (and authorize) again. */
  AuthenticationTicketExpired: 32753,
  /** (32752) A server-side plugin or webhook failed to execute and reported an error. */
  PluginReportedError: 32752,
  /** (32751) CreateGame/JoinGame failed because the expected plugin does not match the loaded one. */
  PluginMismatch: 32751,
  /** (32750) Join failed: this peer already called join and is joined to the room. */
  JoinFailedPeerAlreadyJoined: 32750,
  /** (32749) Join failed: the inactive-actor list already contains an actor with this ActorNr or UserId. */
  JoinFailedFoundInactiveJoiner: 32749,
  /** (32748) Rejoin failed: no actor (active or inactive) with the requested ActorNr or UserId. */
  JoinFailedWithRejoinerNotFound: 32748,
  /** (32747) Join failed: the requested UserId is in the exclusion list. */
  JoinFailedFoundExcludedUserId: 32747,
  /** (32746) Join failed: the active-actor list already contains an actor with this ActorNr or UserId. */
  JoinFailedFoundActiveJoiner: 32746,
  /** (32745) SetProperties/RaiseEvent with HttpForward: max allowed HTTP requests per minute reached. */
  HttpLimitReached: 32745,
  /** (32744) WebRPC: the call to the external service failed. */
  ExternalHttpCallFailed: 32744,
  /** (32743) An operation limit (calls per second, content count or size) was reached. */
  OperationLimitReached: 32743,
  /** (32742) Slot-reservation matchmaking error, e.g. reserved slots exceed MaxPlayers. */
  SlotError: 32742,
  /** (32741) Invalid encryption parameters provided by the token. */
  InvalidEncryptionParameters: 32741,
} as const

/** Join variant carried by ParameterCode.JoinMode (215). Default (0) is expressed by omitting the parameter. */
export const JoinMode = {
  /** (0) Regular join: the room must exist. */
  Default: 0,
  /** (1) Join the room, creating it when it does not exist. */
  CreateIfNotExists: 1,
  /** (3) Only rejoin an existing (inactive) actor slot. (2 is skipped upstream.) */
  RejoinOnly: 3,
} as const

/** Matchmaking algorithm for JoinRandomGame, carried by ParameterCode.MatchMakingType (223). */
export const MatchmakingMode = {
  /** (0) Default. Fills up rooms (oldest first) to get players together as fast as possible. Parameter omitted when default. */
  FillRoom: 0,
  /** (1) Distributes players across available rooms sequentially, taking filters into account. */
  SerialMatching: 1,
  /** (2) Joins a fully random room; expected properties must still match. */
  RandomMatching: 2,
} as const

/** Event caching option of RaiseEvent, carried by ParameterCode.Cache (247). Parameter omitted when default. */
export const EventCaching = {
  /** (0) Default. Do not cache. */
  DoNotCache: 0,
  /** (1) Merge this event's keys with those already cached. */
  MergeCache: 1,
  /** (2) Replace the event cache for this event code with this event's content. */
  ReplaceCache: 2,
  /** (3) Remove this event (by event code) from the cache. */
  RemoveCache: 3,
  /** (4) Add this event to the room's cache. */
  AddToRoomCache: 4,
  /** (5) Add this event to the cache for actor 0 (a "globally owned" cached event). */
  AddToRoomCacheGlobal: 5,
  /** (6) Remove the fitting event from the room's cache. */
  RemoveFromRoomCache: 6,
  /** (7) Remove cached events of players who already left the room. */
  RemoveFromRoomCacheForActorsLeft: 7,
} as const

/** Receiver selection of RaiseEvent, carried by ParameterCode.ReceiverGroup (246). Parameter omitted when default. */
export const ReceiverGroup = {
  /** (0) Default. Anyone else gets the event. */
  Others: 0,
  /** (1) Everyone in the current room, including the sender. */
  All: 1,
  /** (2) The "master client": the actor who has been in the room the longest. */
  MasterClient: 2,
} as const

/** Lobby type, carried by ParameterCode.LobbyType (212) next to the lobby name. */
export const LobbyType = {
  /** (0) Used unless another is defined. Sends room lists; JoinRandomGame filters by matching properties. */
  Default: 0,
  /** (2) Like Default, but JoinRandomGame accepts SQL-like "where" filter clauses. (1 is skipped upstream.) */
  SqlLobby: 2,
  /** (3) Sends no room lists; JoinRandomGame only. Keeps rooms available while only inactive users remain. */
  AsyncRandomLobby: 3,
} as const

/** Webhook behavior bit flags, OR-combined into ParameterCode.WebFlags (234). Module-private in the legacy SDK. */
export const WebFlag = {
  /** (0x01) Forward the event/properties to the configured webhook. */
  HttpForward: 0x01,
  /** (0x02) Send the auth cookie along with the webhook call. */
  SendAuthCookie: 0x02,
  /** (0x04) Unused by the legacy SDK. */
  SendSync: 0x04,
  /** (0x08) Unused by the legacy SDK. */
  SendState: 0x08,
} as const
