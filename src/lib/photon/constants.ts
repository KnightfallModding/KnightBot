/** Photon protocol version reported to the server. */
export const PHOTON_VERSION = '4.3.2.0'

/** Underlying transport protocols. */
export enum ConnectionProtocol {
  /** Plain WebSocket connection. */
  Ws,
  /** WebSocket Secure connection. */
  Wss,
}

/** Client connection lifecycle states. */
export enum ClientState {
  /** Critical error occurred. */
  Error = -1,
  /** Client is created but not used yet. */
  Uninitialized = 0,
  ConnectingToNameServer = 1,
  ConnectedToNameServer = 2,
  /** Connecting to Master (includes connect, authenticate and joining the lobby). */
  ConnectingToMasterServer = 3,
  ConnectedToMaster = 4,
  /** Connected to Master and joined lobby. Room list is available. */
  JoinedLobby = 5,
  /** Connecting to Game server (client will authenticate and join/create the room). */
  ConnectingToGameServer = 6,
  ConnectedToGameServer = 7,
  /** The client joined a room. */
  Joined = 8,
  /** The client is no longer connected to any server. */
  Disconnected = 10,
}

/** Client peer error codes, reported through the `error` event. */
export enum PeerErrorCode {
  Ok = 0,
  MasterError = 1001,
  MasterConnectFailed = 1002,
  MasterConnectClosed = 1003,
  MasterTimeout = 1004,
  MasterEncryptionEstablishError = 1005,
  MasterAuthenticationFailed = 1101,
  GameError = 2001,
  GameConnectFailed = 2002,
  GameConnectClosed = 2003,
  GameTimeout = 2004,
  GameEncryptionEstablishError = 2005,
  GameAuthenticationFailed = 2101,
  NameServerError = 3001,
  NameServerConnectFailed = 3002,
  NameServerConnectClosed = 3003,
  NameServerTimeout = 3004,
  NameServerEncryptionEstablishError = 3005,
  NameServerAuthenticationFailed = 3101,
}

/** Master and Game servers error codes. */
export enum ErrorCode {
  Ok = 0,
  /** Operation can't be executed yet. */
  OperationNotAllowedInCurrentState = -3,
  /** The operation is not implemented on the server application. */
  InvalidOperationCode = -2,
  InternalServerError = -1,
  /** Authentication failed. Possible cause: AppId is unknown to Photon. */
  InvalidAuthentication = 0x7fff,
  /** Room name already in use, can't create another. */
  GameIdAlreadyExists = 0x7fff - 1,
  GameFull = 0x7fff - 2,
  GameClosed = 0x7fff - 3,
  ServerFull = 0x7fff - 5,
  UserBlocked = 0x7fff - 6,
  NoRandomMatchFound = 0x7fff - 7,
  GameDoesNotExist = 0x7fff - 9,
  MaxCcuReached = 0x7fff - 10,
  InvalidRegion = 0x7fff - 11,
  CustomAuthenticationFailed = 0x7fff - 12,
  AuthenticationTicketExpired = 0x7ff1,
  PluginReportedError = 0x7fff - 15,
  PluginMismatch = 0x7fff - 16,
  JoinFailedPeerAlreadyJoined = 0x7fff - 17,
  JoinFailedFoundInactiveJoiner = 0x7fff - 18,
  JoinFailedWithRejoinerNotFound = 0x7fff - 19,
  JoinFailedFoundExcludedUserId = 0x7fff - 20,
  JoinFailedFoundActiveJoiner = 0x7fff - 21,
  HttpLimitReached = 0x7fff - 22,
  ExternalHttpCallFailed = 0x7fff - 23,
  OperationLimitReached = 0x7fff - 24,
  SlotError = 0x7fff - 25,
  InvalidEncryptionParameters = 0x7fff - 26,
}

/** Well known actor (player) property codes. */
export enum ActorProperty {
  PlayerName = 255,
  UserId = 253,
}

/** Well known room property codes. */
export enum GameProperty {
  /** Max number of players that "fit" into this room. 0 is for "unlimited". */
  MaxPlayers = 255,
  /** Makes this room listed or not in the lobby on Master. */
  IsVisible = 254,
  /** Allows more players to join a room (or not). */
  IsOpen = 253,
  /** Current count of players in the room. Used only in the lobby on Master. */
  PlayerCount = 252,
  /** True if the room is to be removed from room listing. */
  Removed = 251,
  /** A list of the room properties to pass to the RoomInfo list in a lobby. */
  PropsListedInLobby = 250,
  CleanupCacheOnLeave = 249,
  /** Code for MasterClientId, which is synced by server. */
  MasterClientId = 248,
  /** Matchmaking keeps a slot open for the players with these userIDs. */
  ExpectedUsers = 247,
  /** How long any player can be inactive before being removed from the player list. */
  PlayerTTL = 246,
  /** How long a room stays available after the last player became inactive. */
  RoomTTL = 245,
}

/** Server event codes. */
export enum EventCode {
  /** Initial list of rooms (sent while in lobby on Master). */
  GameList = 230,
  /** Update to be merged into the initial room list (sent while in lobby on Master). */
  GameListUpdate = 229,
  QueueState = 228,
  /** Statistics about this application (players, rooms, etc.). */
  AppStats = 226,
  LobbyStats = 224,
  AzureNodeInfo = 210,
  /** Someone joined the room. */
  Join = 255,
  /** Someone left the room. */
  Leave = 254,
  /** Properties of the room or a player changed. */
  PropertiesChanged = 253,
  /** A player left the room unexpectedly while playerTTL > 0. */
  Disconnect = 252,
  /** A plugin call or webhook call failed on the server. */
  ErrorInfo = 251,
  /** Token refresh sent by Photon before the current one times out. */
  AuthEvent = 223,
  /** RPC sent inside a room */
  RPC = 200,
}

/** Codes for parameters of operations and events. */
export enum ParameterCode {
  /** Address of a (Game) server to use. */
  Address = 230,
  /** Count of players in this application in rooms (used in stats event). */
  PeerCount = 229,
  /** Count of games in this application (used in stats event). */
  GameCount = 228,
  /** Count of players on the Master server (looking for rooms). */
  MasterPeerCount = 227,
  UserId = 225,
  ApplicationId = 224,
  Position = 223,
  /** Modifies the matchmaking algorithm used for JoinRandom. */
  MatchMakingType = 223,
  /** List of RoomInfos about open / listed rooms. */
  GameList = 222,
  /** Internally used to establish encryption. */
  Secret = 221,
  AppVersion = 220,
  AzureNodeInfo = 210,
  AzureLocalNodeId = 209,
  AzureMasterNodeId = 208,
  /** The unique room name, used in join and create operations. */
  RoomName = 255,
  /** Broadcast parameter of the SetProperties operation. */
  Broadcast = 250,
  /** List of players in a room. */
  ActorList = 252,
  /** The actor an operation applies to. */
  ActorNr = 254,
  /** Player property set (hashtable). */
  PlayerProperties = 249,
  /** Custom content of an event, used in RaiseEvent. */
  CustomEventContent = 245,
  /** Data of an event, used in RaiseEvent. */
  Data = 245,
  /** Code-related parameter, like RaiseEvent's event code. */
  Code = 244,
  /** Room property set (hashtable). */
  GameProperties = 248,
  /** Property set (hashtable) when sending only one set of properties. */
  Properties = 251,
  /** Target actor of a property set operation. Is 0 for the room. */
  TargetActorNr = 253,
  /** Selects the receivers of events (RaiseEvent). */
  ReceiverGroup = 246,
  /** Caching of events while raising them. */
  Cache = 247,
  /** If true, the server cleans up the room cache of leaving players. */
  CleanupCacheOnLeave = 241,
  /** Interest group parameter (RaiseEvent). */
  Group = 240,
  /** Removes something from a list, e.g. interest groups. */
  Remove = 239,
  /** Adds something to a list, e.g. interest groups or expected users. */
  Add = 238,
  /** How long a room instance is kept alive after all players left. */
  RoomTTL = 236,
  PlayerTTL = 235,
  Plugins = 204,
  /** Target custom authentication type/service, used in Authenticate. */
  ClientAuthenticationType = 217,
  /** Parameters sent to the custom authentication type/service. */
  ClientAuthenticationParams = 216,
  ClientAuthenticationData = 214,
  /** Which variant of joining a room to execute: join, create-if-missing or rejoin. */
  JoinMode = 215,
  /** MasterClientId, synced by the server, as operation parameter. */
  MasterClientId = 203,
  /** FindFriends request: string[] of friends to look up. */
  FindFriendsRequestList = 1,
  /** FindFriends response: boolean[] of online states. */
  FindFriendsResponseOnlineList = 1,
  /** FindFriends response: string[] of room names. */
  FindFriendsResponseRoomIdList = 2,
  /** Lobby name for matchmaking-related methods and room creation. */
  LobbyName = 213,
  /** Lobby type, combined with the lobby name this identifies the lobby. */
  LobbyType = 212,
  LobbyStats = 211,
  /** Region values in Authenticate and GetRegions. */
  Region = 210,
  IsInactive = 233,
  CheckUserOnJoin = 232,
  /** "Check And Swap" (CAS) values when changing properties. */
  ExpectedValues = 231,
  UriPath = 209,
  RpcCallParams = 208,
  RpcCallRetCode = 207,
  RpcCallRetMessage = 206,
  RpcCallRetData = 208,
  WebFlags = 234,
  /** Nickname of the user, sent by the server in operation responses. */
  Nickname = 202,
  /** Defines if UserIds of the players are broadcast in the room. */
  PublishUserId = 239,
  /** Content for EventCode.ErrorInfo and internal debug operations. */
  Info = 218,
}

/** Operation codes of the Photon Load Balancing API. */
export enum OperationCode {
  /** Authenticates this peer and connects to a virtual application. */
  Authenticate = 230,
  /** Joins lobby (on Master). */
  JoinLobby = 229,
  /** Leaves lobby (on Master). */
  LeaveLobby = 228,
  /** Creates a room (or fails if the name exists). */
  CreateGame = 227,
  /** Joins a room by name. */
  JoinGame = 226,
  /** Joins a random room (on Master). */
  JoinRandomGame = 225,
  /** Leaves the room. */
  Leave = 254,
  /** Raises an event in a room, for other actors. */
  RaiseEvent = 253,
  /** Sets properties of the room or an actor. */
  SetProperties = 252,
  GetProperties = 251,
  /** Changes interest groups in the room. */
  ChangeGroups = 248,
  /** Requests online status and joined rooms of given users. */
  FindFriends = 222,
  /** Requests lobbies statistics from the Master server. */
  LobbyStats = 221,
  /** Gets the list of regional servers from a NameServer. */
  GetRegions = 220,
  /** Web RPC operation. */
  Rpc = 219,
}

/** Matchmaking modes for {@link PhotonClient#joinRandomRoom}. */
export enum MatchmakingMode {
  /** Fills up rooms (oldest first) to get players together as fast as possible. */
  FillRoom = 0,
  /** Distributes players across available rooms sequentially. */
  SerialMatching = 1,
  /** Joins a fully random room matching the expected properties. */
  RandomMatching = 2,
}

/** Caching options for raised events. */
export enum EventCaching {
  DoNotCache = 0,
  MergeCache = 1,
  ReplaceCache = 2,
  RemoveCache = 3,
  AddToRoomCache = 4,
  AddToRoomCacheGlobal = 5,
  RemoveFromRoomCache = 6,
  RemoveFromRoomCacheForActorsLeft = 7,
}

/** Which actors in the room should receive a raised event. */
export enum ReceiverGroup {
  /** Anyone else gets the event. */
  Others = 0,
  /** Everyone in the current room gets the event, including the sender. */
  All = 1,
  /** The actor who has been in the room the longest gets the event. */
  MasterClient = 2,
}

/** Custom authentication services usable with Photon. */
export enum CustomAuthenticationType {
  Custom = 0,
  Steam = 1,
  Facebook = 2,
  Oculus = 3,
  PlayStation4 = 4,
  Xbox = 5,
  Viveport = 10,
  NintendoSwitch = 11,
  PlayStation5 = 12,
  Epic = 13,
  FacebookGaming = 15,
  None = 255,
}

/** Available lobby types. */
export enum LobbyType {
  /** Room lists are sent and JoinRandomRoom can filter by matching properties. */
  Default = 0,
  /** Room lists are sent and JoinRandom accepts SQL-like "where" filters. */
  SqlLobby = 2,
  /** No room lists. Keeps rooms available for a while when only inactive users are left. */
  AsyncRandomLobby = 3,
}

/** How a join operation should behave when the room is missing or was left. */
export enum JoinMode {
  Default = 0,
  CreateIfNotExists = 1,
  RejoinOnly = 3,
}

/** Flags controlling webhook forwarding behaviour. */
export enum WebFlag {
  HttpForward = 0x01,
  SendAuthCookie = 0x02,
  SendSync = 0x04,
  SendState = 0x08,
}
