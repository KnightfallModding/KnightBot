# photon-next — promise-first Photon LoadBalancing client

Ground-up TypeScript rewrite of the legacy Photon JS SDK (4.3.2.0, JSON-over-WebSocket).
Design goals, in order:

1. **Promise-based operations** — `await client.joinRoom(name)` resolves with the joined room or rejects
   with a typed error. No split "call method / override callback" pairs.
2. **Typed EventEmitter** for server-pushed events — `client.on('actorJoin', actor => ...)`. Consumers
   compose a client; they never subclass it.
3. **Wire-compatible** with the current Photon cloud endpoints this bot talks to (same URL shape,
   subprotocol `Json`, same frames, same op/event/parameter codes, `libversion=4.3.2.0`).
4. **Focused core**: nameserver→master→game flow, lobby room list, join/create/join-random, leave,
   actors, properties (+CAS), raiseEvent, changeGroups, custom events, app/lobby stats.
   Out of scope: rejoin/suspend, webRPC, FindFriends, GetRegions, encryption, Chat.

Reference material (read these; they document the legacy SDK's exact behavior):

- `/tmp/claude-1000/-home-aeryle-projects-bots-KnightBot/4cac35b6-e697-433f-9ef5-4de43398420c/scratchpad/map-peer.md` — transport & framing
- `.../map-client-flow.md` — state machine, auth chain
- `.../map-peers-setup.md` — per-server listener tables, handoff
- `.../map-room-ops.md` — join/create/leave dances, failure paths
- `.../map-models.md` — Actor/RoomInfo/Room, property semantics
- `.../map-constants.md` — every constant with exact values, [used]/[unused] tags
- `.../map-consumers.md` — the migration contract (QueueDetector, PlayerTracker, commands)

Legacy source (do not import from it, only consult): `src/lib/photon/index.js`.

## Module layout (`src/lib/photon-next/`)

```
constants.ts   — wire constants (const objects `as const`; NOT TS enums — several tables have
                 duplicate numeric values which break reverse mappings)
logger.ts      — Logger (port of src/lib/photon-reverse.wip/logger.ts minus the exception() method)
errors.ts      — typed error hierarchy
types.ts       — options interfaces, event map, wire type aliases, DisconnectReason, AppStats...
protocol.ts    — pure encode/decode functions for the ~m~ framing + message classification
peer.ts        — PhotonPeer: one WebSocket, promise-correlated operations, keepalive
actor.ts       — Actor model
room.ts        — RoomInfo (lobby data) + Room (joined; setters return promises)
client.ts      — PhotonClient: state machine, three-peer orchestration, public API
index.ts       — public re-exports
smoke.ts       — self-contained behavioral test against an in-process fake server (see §Verification)
```

Dependency direction: `constants ← protocol ← peer ← client → room/actor`, everything may use
`logger/errors/types`. No module imports `client.ts` except `index.ts`.

## Wire protocol (protocol.ts)

Text frames over WebSocket, subprotocol **`Json`** (pass explicitly; empty string is legacy's cue to
default to `Json`). URL: `ws://<address>/<appId>?libversion=4.3.2.0` (`wss` for secure). Server-returned
addresses may already be full URLs with a path (live NS returns `ws://<host>:80/Master`) — skip the
scheme prefix then, but always append `/<appId>?libversion` (legacy `addProtocolPrefix` parity).
Default nameserver: `ns.photonengine.io:9093` (ws) / `ns.photonengine.io:19093` (wss).

- Encode: payload string `p` → `~m~${p.length}~m~${p}`; objects are `~j~` + `JSON.stringify(obj)`.
- Decode: strip NUL chars; parse **all** frames in a message and return `string[]`
  (the legacy code joined multiple frames with commas — a latent corruption bug; fix it).
- Client→server operation: `{ req: <opCode>, vals: [k1, v1, k2, v2, ...] }` — vals is a FLAT array of
  parameter-code/value pairs.
- Ping request: `{ irq: 1, vals: [1, <ms since peer construction>] }`; response `{ irs: 1, vals: [1, echo, serverTime] }`.
- Server→client classification by field priority: `res` defined → operation response
  `{ res, err?, msg?, vals: [...] }`; else `evt` defined → event `{ evt, vals }`; else `irs` → ping reply;
  a non-`~j~` frame is the **session id** (first one = connected signal; later ones ignored).
- Received `vals` flat arrays must be converted to `Record<string, unknown>` keyed by STRINGIFIED
  parameter codes (odd-length array = protocol error). Export a helper
  `getParam<T>(vals, code: number): T | undefined` that indexes `vals[String(code)]`.

## peer.ts — PhotonPeer (internal class, not exported from index.ts)

One WebSocket connection to one server. Constructed with
`{ name: 'nameServer'|'master'|'game', url, subprotocol: 'Json', logger, keepAliveMs, operationTimeoutMs, webSocketImpl }`.
Uses `webSocketImpl ?? globalThis.WebSocket` (Node 24 has a spec-compliant global). Attach via the
`onopen/onmessage/onclose/onerror` properties (supported by undici and easy to fake).

API:

- `connect(): Promise<void>` — opens the socket; resolves when the **first session-id frame** arrives
  (NOT on `onopen` — parity with legacy). Rejects on close/error before that (`PhotonConnectionError`)
  or after `connectTimeoutMs` (`PhotonTimeoutError`).
- `request(code: number, params?: Record<number, unknown>): Promise<Vals>` — sends the op and returns
  a promise correlated **FIFO per op code** (the protocol carries no request id; the socket is ordered
  and the server answers each op code in order — the legacy single-listener model relied on the same
  invariant). Resolves with the response `vals` object when `err` is 0/undefined; rejects with
  `PhotonOperationError` (carrying op code, server errCode, server msg, vals) otherwise.
  Per-request timeout → reject `PhotonTimeoutError`, but keep the queue slot as a tombstone so a late
  response is discarded instead of settling the wrong request. All pending requests reject with
  `PhotonAbortError` when the peer closes.
- `send(code, params)` — fire-and-forget (used by RaiseEvent, ChangeGroups, keepalive-adjacent sends).
- `close(expected = true): void` — sets closing flag, closes socket, clears keepalive timer.
- Callbacks assigned by the client: `onEvent(code: number, vals: Vals)`,
  `onClose(reason: DisconnectReason)` (fires once, only for UNexpected closes — a close() we initiated
  never reports), `onSessionOpen()` optional.

Keepalive: after every successful send re-arm a timer (`keepAliveMs`, default 3000, <1000 disables);
on fire send the ping. Handle `irs` internally (track `rtt`; expose as getter; server-time sync is NOT
needed — drop it). Clear the timer on close (legacy leaked it).

WS close code 1006 → reason kind `'timeout'`; closing-flag set → `'local'`; else `'remote'`.

## errors.ts

```ts
class PhotonError extends Error                      // base
class PhotonStateError extends PhotonError           // operation not allowed in current client state
class PhotonConnectionError extends PhotonError      // { server, address, cause? } socket-level failure
class PhotonTimeoutError extends PhotonError         // { operation? } connect or op timed out
class PhotonAbortError extends PhotonError           // client disconnected/destroyed mid-flight
class PhotonOperationError extends PhotonError       // { operation, errorCode, serverMessage, vals }
```

`PhotonOperationError.message` should include the friendly name when `errorCode` matches a known
`ErrorCode` entry (e.g. 32765 → `GameFull`, 32758 → `GameDoesNotExist`, 32760 → `NoRandomMatchFound`).

## client.ts — PhotonClient

```ts
interface PhotonClientOptions {
  appId: string
  appVersion: string
  region: string // e.g. 'US' | 'EU' — the wire value sent to the nameserver
  protocol?: 'ws' | 'wss' // default 'ws' (bot parity)
  nameServerAddress?: string // default per protocol, see §Wire
  userId?: string
  name?: string // local actor display name (ActorProperties.PlayerName 255)
  customProperties?: Record<string, unknown> // local actor props, sent with join/create
  joinLobby?: boolean // default true — auto JoinLobby after master auth
  keepMasterConnection?: boolean // default false — parity: master socket dropped on room join
  logger?: Logger // default: new Logger(); child peers get suffixed prefixes
  operationTimeoutMs?: number // default 15_000
  connectTimeoutMs?: number // default 15_000
  keepAliveMs?: number // default 3_000
  webSocketImpl?: WebSocketLike // test injection
}

type ClientState =
  | 'uninitialized'
  | 'connectingToNameServer'
  | 'connectingToMaster'
  | 'connectedToMaster'
  | 'joinedLobby'
  | 'connectingToGameServer'
  | 'joined'
  | 'disconnected'
  | 'error'

interface PhotonClientEvents {
  stateChange: [state: ClientState, previous: ClientState]
  error: [error: PhotonError] // socket-level/unexpected failures (NOT rejected ops)
  disconnect: [reason: DisconnectReason] // fired once when the client leaves the wire entirely
  appStats: [stats: AppStats] // { peerCount, masterPeerCount, gameCount } as numbers
  lobbyStats: [stats: LobbyStatsEntry[]]
  roomList: [rooms: RoomInfo[]] // full GameList snapshot
  roomListUpdate: [update: RoomListUpdate] // { rooms, updated, added, removed } — same diff
  // semantics as legacy GameListUpdate handling
  actorJoin: [actor: Actor] // ALSO fires for the local actor's own Join event
  // (legacy parity — consumers rely on it)
  actorLeave: [actor: Actor, cleanup: boolean] // cleanup=true when leaving/teardown clears the roster
  actorSuspend: [actor: Actor]
  actorPropertiesChange: [actor: Actor, changed: Record<string, unknown>]
  roomPropertiesChange: [changed: Record<string, unknown>]
  masterClientChange: [current: Actor | undefined, previousActorNr: number]
  photonEvent: [event: { code: number; data: unknown; actorNr: number }] // custom/unhandled events
  // data = vals[245], actorNr = vals[254]
  serverError: [info: unknown] // ErrorInfo event (251), payload vals[218]
}

class PhotonClient extends EventEmitter<PhotonClientEvents> {
  readonly state: ClientState
  readonly myActor: Actor
  readonly room: Room | undefined // set while joined
  readonly rooms: RoomInfo[] // lobby room list (kept in sync)
  readonly masterClientId: number // effective: raw masterClientId || lowest actorNr; 0 if unknown
  readonly masterClient: Actor | undefined
  readonly actors: ReadonlyMap<number, Actor> // joined-room roster incl. local actor
  connect(): Promise<void> // resolves at joinedLobby (or connectedToMaster if !joinLobby)
  joinRoom(name: string, options?: { createIfNotExists?: boolean; expectedUsers?: string[] }): Promise<Room>
  createRoom(name?: string, options?: CreateRoomOptions): Promise<Room>
  joinRandomRoom(options?: JoinRandomRoomOptions): Promise<Room>
  leaveRoom(): Promise<void>
  raiseEvent(code: number, data?: unknown, options?: RaiseEventOptions): void // throws PhotonStateError if not joined
  changeGroups(remove?: number[] | null, add?: number[] | null): void
  setName(name: string): void // pre-join: buffered; post-join: SetProperties op
  setCustomProperty(key: string, value: unknown): void // same buffering rule
  disconnect(): void // tear down all peers; rejects in-flight lifecycle promises
}
```

### Connection flow (`connect()`)

1. Guard: state must be `uninitialized` / `disconnected` / `error`, else `PhotonStateError`.
2. Capture epoch (see §Cancellation). New nameserver peer → `await peer.connect()`.
3. `await request(Authenticate 230, { 224: appId, 220: appVersion, 225: userId?, 210: region })`.
   Response: `masterAddress = vals[230]`, `secret = vals[221]`; server may push back
   UserId (225) / Nickname (202) — adopt them. Close nameserver peer (expected).
4. New master peer → connect → `Authenticate` with **only** `{ 221: secret }` (plus nothing else —
   legacy parity). Refresh secret from response if present. State `connectedToMaster`.
5. If `joinLobby`: `await request(JoinLobby 229)` (no params for default lobby) → state `joinedLobby`.
6. Resolve. Master peer stays; its events flow: GameList 230 / GameListUpdate 229 / AppStats 226 /
   LobbyStats 224 → maintain `rooms` + emit. (AppStats params: 229=peerCount, 227=masterPeerCount,
   228=gameCount — already numbers on the JSON wire; no parseInt.)

### Join dance (`joinRoom` — createRoom/joinRandomRoom analogous)

1. Guard: `joinedLobby` or `connectedToMaster`.
2. `await master.request(JoinGame 226, { 255: name, ...(createIfNotExists: { 215: 1, ...create payload }), (238: expectedUsers) })`.
   Rejection (e.g. GameDoesNotExist) → rethrow; client stays in lobby, nothing torn down.
3. From response: `gameAddress = vals[230]`, refresh secret. Unless `keepMasterConnection`,
   close master peer (expected — must NOT emit `disconnect`).
4. New game peer → connect (state `connectingToGameServer`) →
   `Authenticate { 224: appId, 220: appVersion, 221: secret, 225: userId? }`.
5. `await game.request(JoinGame 226, { 255: name, 250: true /*Broadcast*/, 249: playerProperties, ...replayed join options })`
   where playerProperties = `{ 255: myActor.name, ...customProperties }` (the buffered pre-join identity).
6. Response: `myActor.actorNr = vals[254]`; roster from ActorList (252) + per-actor properties map
   (249): self reuses myActor, others become new Actors (name from prop 255, userId from 253);
   room properties from GameProperties (248). State `joined`. Compute masterClientId silently
   (no `masterClientChange` for the initial value — consumers read `client.masterClientId`).
   Resolve with the `Room`.
7. Failure handling: game-op rejection or socket death mid-dance → close game peer; if master was
   kept → state back to lobby; else state `disconnected` + emit `disconnect`; reject the join promise
   with the typed error. **No silent stranding** (legacy left the client dead in
   `connectedToGameServer` with the master already gone).

The Join event (255) for self arrives AFTER the JoinGame response: update myActor properties and emit
`actorJoin(myActor)` (do not re-add). Join for others: add + emit. Roster actors built in step 6 do
NOT emit `actorJoin` (legacy parity — consumers seed from the resolved room/`client.actors`).

### Game-server events

- Leave (254): first update raw masterClientId from param 203 if present; then param 233 IsInactive →
  mark suspended + `actorSuspend`; else remove from roster + `actorLeave(actor, false)`.
- Disconnect (252): mark suspended + `actorSuspend`.
- PropertiesChanged (253): param 254 TargetActorNr > 0 → update that actor's props (ignore unknown)
  - `actorPropertiesChange`; else room.\_updateFromProps(vals[251]) + `roomPropertiesChange`.
- ErrorInfo (251): emit `serverError` with vals[218].
- Anything else: emit `photonEvent { code, data: vals[245], actorNr: vals[254] }`.

**Master-client tracking is centralized**: after every roster or relevant property mutation, recompute
`effective = rawMasterClientId || lowestActorNr` and emit `masterClientChange(actor, previous)` when it
changed (except the initial post-join computation). This replaces consumer-side tracking.

### leaveRoom()

1. Guard `joined` (else resolve immediately — legacy was a silent no-op; we resolve, don't throw).
2. `await game.request(Leave 254)` (tolerate timeout/abort — proceed with teardown either way).
3. Close game peer (expected). Clear roster (emit `actorLeave(actor, true)` for every actor including
   local — legacy parity), clear room. myActor keeps its actorNr.
4. If master peer still connected → state `joinedLobby`; else state `disconnected` +
   emit `disconnect` (reason kind `'local'`). Resolve.

### Cancellation & failure model (§the epoch)

The client keeps a monotonically increasing `epoch`. `disconnect()`, `destroy`-like teardown, and
fatal socket errors bump it. Every multi-step dance re-checks the captured epoch after each `await`;
on mismatch it stops immediately and rejects with `PhotonAbortError`. Unexpected peer closes
(`onClose`) map to: state `error`, emit `error(PhotonConnectionError)` + `disconnect(reason)`, bump
epoch, reject all in-flight requests. `disconnect()` is idempotent.

There is NO automatic reconnect in the SDK — consumers own that policy (QueueDetector keeps its
backoff-recreate loop).

## Models

- **Actor**: `{ actorNr, name, userId, isLocal, suspended, customProperties (readonly view), getCustomProperty(key) }`.
  Plain data holder; mutations flow through the client.
- **RoomInfo** (lobby listing): `name, playerCount, maxPlayers, isOpen, isVisible, removed,
customProperties, propsListedInLobby`, updated from GameProperties byte keys
  (255 maxPlayers, 254 isVisible, 253 isOpen, 252 playerCount, 251 removed, 250 propsListedInLobby,
  249 cleanupCacheOnLeave, 248 masterClientId, 245 roomTTL, 246 playerTTL, 247 expectedUsers;
  non-numeric keys → custom properties, strict-diffed).
- **Room extends RoomInfo** (joined): `setCustomProperty/setCustomProperties(props, { expected? })`
  → `SetProperties 252` `{ 251: props, 250: true, (231: expectedProps CAS) }` returning a promise;
  `setIsOpen/setIsVisible/setMaxPlayers/setMasterClient(actorNr)` via well-known GameProperties keys
  with CAS like legacy; `leave()` delegates to the client. Holds a client reference injected at
  construction. CAS rule (legacy parity): non-CAS setters apply locally immediately; CAS setters
  defer local state to the echoed PropertiesChanged event.

## constants.ts

Const objects `as const` with exact values from `map-constants.md` (the [used] subset plus the full
ParameterCode/ErrorCode tables — they're small and aid debugging): `OperationCode`, `EventCode`,
`ParameterCode`, `GameProperty`, `ActorProperty`, `ErrorCode`, `JoinMode`, `MatchmakingMode`,
`EventCaching`, `ReceiverGroup`, `LobbyType`, `WebFlag`. Doc-comment each member.

## Verification (smoke.ts)

Self-contained behavioral test, run as `node dist/lib/photon-next/smoke.js` after `npm run build`.
No network: a `FakePhotonServer` implements the WebSocket interface (constructor + on\* properties +
send/close), scripted per the wire shapes above, injected via `webSocketImpl`. It must exercise:

1. connect(): session frame → NS auth (assert exact `{req, vals}` sent) → master auth with secret →
   JoinLobby → resolves; state `joinedLobby`.
2. GameList + GameListUpdate → `roomList`/`roomListUpdate` diff semantics (added/updated/removed).
3. AppStats event → `appStats` payload.
4. joinRoom(): master JoinGame → game peer handoff (new fake socket) → auth → second JoinGame with
   PlayerProperties containing the buffered name/custom props → roster + room props correct →
   promise resolves; self Join event → `actorJoin` fires for local actor.
5. Another actor joins (Join event) → `actorJoin`; leaves with masterClientId param →
   `actorLeave` + `masterClientChange`.
6. Custom event 200 → `photonEvent` with stringified-numeric-key data intact.
7. Op error (JoinGame errCode 32758) → `joinRoom` rejects `PhotonOperationError`, client stays in lobby.
8. leaveRoom() → Leave op → resolves; state per master-connection rule.
9. Unexpected socket close mid-lobby → `error` + `disconnect` events, pending request rejected.
10. Request timeout → `PhotonTimeoutError`, late response discarded (no mis-correlation).

Use `node:assert/strict`; print PASS/FAIL per scenario; `process.exitCode = 1` on any failure.

## Migration contracts (consumers)

Keep these exports/shapes so `queue.ts` needs zero changes:
`src/lib/queue-detector.ts` still exports `appId`, `appVersion`, `Regions` (NA='US', EU='EU'),
`queueDetectors` (NA/EU instances), and `QueueDetector` with `players.active` (−1 sentinel until first
AppStats), `currentQueue?: { name, players, timer } | null`, `playerTrackers: PlayerTracker[]`.
Internally: composition (`readonly client: PhotonClient`), constructor takes the region KEY
('NA'|'EU') — fixing the legacy key/value mixup — plus `lastDelay`. Reconnect policy preserved:
on client `error`/`disconnect` → destroy old client, `setTimeout` recreate `queueDetectors[key]` with
`lastDelay + 2000` (first delay 3000, guard against double-fire). Room-list handling keeps the exact
legacy algorithm for updates (single added → setCurrentQueue; >1 added → warn + most-filled +
potentiallyBuggedQueues; fallback scan adopting first open room / refreshing player count; removed →
null currentQueue + destroy & drop that room's tracker). NEW (deliberate fix): the initial `roomList`
snapshot also runs the adopt-first-open-room scan (legacy dropped the snapshot entirely) — but does
NOT create trackers or bugged-queue warnings.

`src/lib/player-tracker.ts`: `PlayerTracker` keeps `room: RoomInfo`, `players: Record<number, string>`,
`masterActorNr`, `masterName?`, `get errored()`. Composition: own PhotonClient
(`joinLobby: false`, name = the rich-text bot name, customProperties `{ UUID: 'knightbot' }`, logger
prefix `[<roomName>]`). Constructor kicks off an async `start()`: connect → joinRoom(room.name) →
seed `players` from roster EXCLUDING local (then the self Join event adds the local actor — legacy
parity: the bot IS in its own list) → set masterActorNr/masterName from `client.masterClientId` +
log `Master client: X`. Subscriptions: `actorJoin` add; `actorLeave` delete + leave-and-destroy when
alone (`length === 1`); `masterClientChange` update fields + log `Master client changed: X → Y`;
`photonEvent` code 200 with `data['5'] === 29` (RPC_WIN) → leave-and-destroy; client `error` →
`#errored = true` + destroy. Expose `destroy()` (idempotent: leave if joined, disconnect client).

`src/commands/Admin/playerlist.ts`: keep behavior; fix the region option bug — the select choices must
yield the Regions KEY ('NA'/'EU'), not the wire value ('US'), so `queueDetectors[region]` resolves.

`src/commands/General/queue.ts`: no changes needed.

Do NOT modify `src/lib/photon/` or `src/lib/photon-reverse.wip/` — they stay untouched until the user
deletes them.

## Style

Match the repo: Prettier via `npx prettier --write` (no semicolons, single quotes, 120-col),
`@sapphire/ts-config` extra-strict (no unused locals, exactOptionalPropertyTypes-level care),
ESM with `$lib/*` path alias available. Comments only where the wire protocol or a parity quirk
can't speak for itself.
