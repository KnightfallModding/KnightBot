import { GameProperty } from './constants'
import type { RoomOps, Vals } from './types'

/**
 * Room data as listed in the lobby (GameList 230 / GameListUpdate 229) and mirrored while joined.
 * Plain data holder — no client back-reference.
 */
export class RoomInfo {
  /** Room name — the unique gameId (ParameterCode.RoomName 255). */
  name: string
  /** (GameProperty.PlayerCount 252) Current player count. Only pushed to the lobby room list. */
  playerCount = 0
  /** (GameProperty.MaxPlayers 255) Max players that fit into the room; 0 = unlimited. */
  maxPlayers = 0
  /** (GameProperty.IsVisible 254) Whether the room is listed in the lobby. */
  isVisible = true
  /** (GameProperty.IsOpen 253) Whether more players may join. */
  isOpen = true
  /** (GameProperty.Removed 251) True when a GameListUpdate marks this room for removal from the lobby list. */
  removed = false
  /** (GameProperty.CleanupCacheOnLeave 249) Server cleans up the event cache of leaving players. */
  cleanupCacheOnLeave = false
  /** (GameProperty.MasterClientId 248) Synced by the server; 0 when unsupported — fall back to the lowest actorNr. */
  masterClientId = 0
  /** (GameProperty.ExpectedUsers 247) UserIds matchmaking keeps slots open for; undefined until the server sends them. */
  expectedUsers?: string[]
  /** (GameProperty.PlayerTTL 246) How long an inactive player keeps their slot, in ms. */
  playerTTL = 0
  /** (GameProperty.RoomTTL 245) How long the room stays alive after the last player becomes inactive, in ms. */
  roomTTL = 0
  /** (GameProperty.PropsListedInLobby 250) Custom property keys exposed in the lobby room list. */
  propsListedInLobby: string[] = []
  protected _customProperties: Record<string, unknown> = {}

  constructor(name = '') {
    this.name = name
  }

  /** Readonly live view of the custom (string-keyed) room properties. */
  get customProperties(): Readonly<Record<string, unknown>> {
    return this._customProperties
  }

  getCustomProperty(key: string): unknown {
    return this._customProperties[key]
  }

  /**
   * Internal: applies a GameProperties (248) hashtable — well-known byte keys map to the fields above,
   * non-numeric keys → custom properties (strict-diffed; unknown numeric keys are ignored).
   * Well-known keys use `hasOwnProperty` semantics (legacy parity): explicitly sent null/false/0 DO overwrite.
   * @returns the custom properties that actually changed, for the client's `roomPropertiesChange` event.
   */
  _updateFromProps(props: Vals): Record<string, unknown> {
    const get = <T>(code: number, current: T): T =>
      Object.hasOwn(props, String(code)) ? (props[String(code)] as T) : current
    this.maxPlayers = get(GameProperty.MaxPlayers, this.maxPlayers)
    this.isVisible = get(GameProperty.IsVisible, this.isVisible)
    this.isOpen = get(GameProperty.IsOpen, this.isOpen)
    this.playerCount = get(GameProperty.PlayerCount, this.playerCount)
    this.removed = get(GameProperty.Removed, this.removed)
    this.propsListedInLobby = get(GameProperty.PropsListedInLobby, this.propsListedInLobby)
    this.cleanupCacheOnLeave = get(GameProperty.CleanupCacheOnLeave, this.cleanupCacheOnLeave)
    this.masterClientId = get(GameProperty.MasterClientId, this.masterClientId)
    this.expectedUsers = get(GameProperty.ExpectedUsers, this.expectedUsers)
    this.playerTTL = get(GameProperty.PlayerTTL, this.playerTTL)
    this.roomTTL = get(GameProperty.RoomTTL, this.roomTTL)
    const changed: Record<string, unknown> = {}
    for (const key of Object.keys(props)) {
      // canonical-numeric keys are well-known byte codes, never custom properties (legacy key filter)
      if (String(parseInt(key, 10)) === key) continue
      if (this._customProperties[key] !== props[key]) {
        this._customProperties[key] = props[key]
        changed[key] = props[key]
      }
    }
    return changed
  }
}

/**
 * The currently joined room. Setters send SetProperties (252) through the owning client (RoomOps).
 *
 * CAS rule (legacy parity): setters that send ExpectedValues (231) — all well-known setters below,
 * plus custom setters given `expected` — do NOT apply the new value locally; the field updates only
 * when the server echoes the change back via the PropertiesChanged (253) event. A CAS failure surfaces
 * as the returned promise rejecting with the server's error. Non-CAS custom setters apply locally
 * immediately (optimistic).
 */
export class Room extends RoomInfo {
  readonly #ops: RoomOps

  constructor(name: string, ops: RoomOps) {
    super(name)
    this.#ops = ops
  }

  /**
   * Sets one custom room property (string key). Without `expected` it applies locally immediately;
   * with `expected` it is a CAS write (use null to expect the property to not exist) — see the class doc.
   */
  setCustomProperty(key: string, value: unknown, options?: { expected?: unknown }): Promise<void> {
    const expected = options?.expected
    return this.setCustomProperties(
      { [key]: value },
      expected === undefined ? undefined : { expected: { [key]: expected } }
    )
  }

  /**
   * Sets custom room properties (string keys). Without `expected` they apply locally immediately;
   * with `expected` it is a CAS write covering the given expected table — see the class doc.
   */
  setCustomProperties(
    properties: Record<string, unknown>,
    options?: { expected?: Record<string, unknown> }
  ): Promise<void> {
    const expected = options?.expected
    if (expected === undefined) {
      for (const key of Object.keys(properties)) this._customProperties[key] = properties[key]
    }
    return this.#ops.sendSetProperties(properties, expected)
  }

  /**
   * Opens/closes the room via GameProperty.IsOpen (253), CAS'd against the current value.
   * Local apply deferred to the echoed PropertiesChanged event; no-op when the value already matches.
   */
  setIsOpen(isOpen: boolean): Promise<void> {
    if (this.isOpen === isOpen) return Promise.resolve()
    return this.#ops.sendSetProperties({ [GameProperty.IsOpen]: isOpen }, { [GameProperty.IsOpen]: this.isOpen })
  }

  /**
   * Shows/hides the room in the lobby via GameProperty.IsVisible (254), CAS'd against the current value.
   * Local apply deferred to the echoed PropertiesChanged event; no-op when the value already matches.
   */
  setIsVisible(isVisible: boolean): Promise<void> {
    if (this.isVisible === isVisible) return Promise.resolve()
    return this.#ops.sendSetProperties(
      { [GameProperty.IsVisible]: isVisible },
      { [GameProperty.IsVisible]: this.isVisible }
    )
  }

  /**
   * Changes the player limit via GameProperty.MaxPlayers (255), CAS'd against the current value.
   * Local apply deferred to the echoed PropertiesChanged event; no-op when the value already matches.
   */
  setMaxPlayers(maxPlayers: number): Promise<void> {
    if (this.maxPlayers === maxPlayers) return Promise.resolve()
    return this.#ops.sendSetProperties(
      { [GameProperty.MaxPlayers]: maxPlayers },
      { [GameProperty.MaxPlayers]: this.maxPlayers }
    )
  }

  /**
   * Transfers the master client role via GameProperty.MasterClientId (248), CAS'd against the current value.
   * Always sends (no equality guard — legacy parity); local apply deferred to the echoed PropertiesChanged event.
   */
  setMasterClient(actorNr: number): Promise<void> {
    return this.#ops.sendSetProperties(
      { [GameProperty.MasterClientId]: actorNr },
      { [GameProperty.MasterClientId]: this.masterClientId }
    )
  }

  /** Leaves the room — delegates to the owning client's leaveRoom(). */
  leave(): Promise<void> {
    return this.#ops.leaveRoom()
  }
}
