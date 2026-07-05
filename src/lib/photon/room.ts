import type { PhotonClient } from './client'
import { GameProperty, ParameterCode } from './constants'

/**
  Read only information about a room, as listed in the lobby.
*/
export class RoomInfo {
  /** Room name. */
  name: string
  /** Joined room Game server address. */
  address = ''
  /** Max players before the room is considered full. 0 means "unlimited". */
  maxPlayers = 0
  /** Shows the room in the lobby's room list. */
  isVisible = true
  /** Defines if this room can be joined. */
  isOpen = true
  /** Count of players currently in the room. */
  playerCount = 0
  /** Time in ms the room is kept alive on the server after all clients left. */
  roomTTL = 0
  /** Time in ms a suspended player is kept in the room. */
  playerTTL = 0
  /** Room removed flag (used in room list updates). */
  removed = false
  cleanupCacheOnLeave = false
  /** Master client set by the game server. If 0, use the lowest actorNr instead. */
  masterClientId = 0
  /** Users the matchmaking keeps slots open for. */
  expectedUsers?: string[]

  protected customProperties: Record<string, any> = {}
  protected propsListedInLobby: string[] = []

  constructor(name: string) {
    this.name = name
  }

  /** Returns a copy of the room's custom properties. */
  getCustomProperties(): Record<string, any> {
    return { ...this.customProperties }
  }

  /** Returns the names of the properties listed in the lobby. */
  getPropsListedInLobby(): string[] {
    return [...this.propsListedInLobby]
  }

  getCustomProperty(name: string): any {
    return this.customProperties[name]
  }

  getCustomPropertyOrElse(name: string, defaultValue: any): any {
    return Object.hasOwn(this.customProperties, name) ? this.customProperties[name] : defaultValue
  }

  /**
    Called on every room properties update: room creation, properties set by client,
    properties update from server. Override to update custom room state.
  */
  onPropertiesChange(_changedCustomProps: Record<string, any>, _byClient?: boolean): void {}

  /** @internal */
  updateFromMasterResponse(vals: Record<number, any>): void {
    this.address = vals[ParameterCode.Address]

    const name = vals[ParameterCode.RoomName]
    if (name) this.name = name
  }

  /** @internal */
  updateFromProps(props?: Record<string | number, any>): void {
    if (!props) return

    this.maxPlayers = this.#valueOrPrevious(props, GameProperty.MaxPlayers, this.maxPlayers)
    this.isVisible = this.#valueOrPrevious(props, GameProperty.IsVisible, this.isVisible)
    this.isOpen = this.#valueOrPrevious(props, GameProperty.IsOpen, this.isOpen)
    this.playerCount = this.#valueOrPrevious(props, GameProperty.PlayerCount, this.playerCount)
    this.removed = this.#valueOrPrevious(props, GameProperty.Removed, this.removed)
    this.propsListedInLobby = this.#valueOrPrevious(props, GameProperty.PropsListedInLobby, this.propsListedInLobby)
    this.cleanupCacheOnLeave = this.#valueOrPrevious(props, GameProperty.CleanupCacheOnLeave, this.cleanupCacheOnLeave)
    this.masterClientId = this.#valueOrPrevious(props, GameProperty.MasterClientId, this.masterClientId)
    this.roomTTL = this.#valueOrPrevious(props, GameProperty.RoomTTL, this.roomTTL)
    this.playerTTL = this.#valueOrPrevious(props, GameProperty.PlayerTTL, this.playerTTL)
    this.expectedUsers = this.#valueOrPrevious(props, GameProperty.ExpectedUsers, this.expectedUsers)

    const changedProps: Record<string, any> = {}
    for (const key in props) {
      // Numeric keys are well known properties, string keys are custom properties.
      if (String(parseInt(key, 10)) === key) continue

      if (this.customProperties[key] !== props[key]) {
        this.customProperties[key] = props[key]
        changedProps[key] = props[key]
      }
    }

    this.onPropertiesChange(changedProps, false)
  }

  /** @internal */
  updateFromEvent(vals?: Record<number, any>): void {
    if (vals) this.masterClientId = this.#valueOrPrevious(vals, ParameterCode.MasterClientId, this.masterClientId)
  }

  #valueOrPrevious<Value>(props: Record<string | number, any>, code: number, previous: Value): Value {
    return Object.hasOwn(props, code) ? props[code] : previous
  }
}

/**
  A room the client joins or is joined to, with writable properties.
  Extend to implement custom logic.
*/
export class Room extends RoomInfo {
  /** Expected server plugins. */
  plugins?: string[]

  /** @internal */
  client?: PhotonClient

  /**
    Sets a custom property. When joined to the room, the change is synced with the server.
    @param expectedValue Property value expected when the update occurs ("Check And Swap").
  */
  setCustomProperty(name: string, value: any, webForward = false, expectedValue?: any): void {
    this.setCustomProperties(
      { [name]: value },
      webForward,
      expectedValue === undefined ? undefined : { [name]: expectedValue }
    )
  }

  /**
    Sets multiple custom properties. When joined to the room, changes are synced with the server.
    @param expectedProperties Properties expected when the update occurs ("Check And Swap").
  */
  setCustomProperties(
    properties: Record<string, any>,
    webForward = false,
    expectedProperties?: Record<string, any>
  ): void {
    const joined = this.client?.isJoinedToRoom() ?? false
    if (joined) this.client?.setPropertiesOfRoom(properties, webForward, expectedProperties)

    if (!joined || expectedProperties === undefined) {
      Object.assign(this.customProperties, properties)
      this.onPropertiesChange(properties, true)
    }
  }

  /** Sets the room's visibility in the lobby's room list. */
  setIsVisible(isVisible: boolean): void {
    if (this.isVisible === isVisible) return

    if (this.#setWellKnownProperty(GameProperty.IsVisible, isVisible, this.isVisible)) this.isVisible = isVisible
  }

  /** Sets if this room can be joined. */
  setIsOpen(isOpen: boolean): void {
    if (this.isOpen === isOpen) return

    if (this.#setWellKnownProperty(GameProperty.IsOpen, isOpen, this.isOpen)) this.isOpen = isOpen
  }

  /** Sets max players before the room is considered full. */
  setMaxPlayers(maxPlayers: number): void {
    if (this.maxPlayers === maxPlayers) return

    if (this.#setWellKnownProperty(GameProperty.MaxPlayers, maxPlayers, this.maxPlayers)) this.maxPlayers = maxPlayers
  }

  /** Sets the room's Time To Live on the server after all clients left, in milliseconds. */
  setRoomTTL(ttl: number): void {
    if (this.roomTTL === ttl) return

    if (this.#setWellKnownProperty(GameProperty.RoomTTL, ttl)) this.roomTTL = ttl
  }

  /** Sets how long a suspended player is kept in the room, in milliseconds. */
  setPlayerTTL(ttl: number): void {
    if (this.playerTTL === ttl) return

    if (this.#setWellKnownProperty(GameProperty.PlayerTTL, ttl)) this.playerTTL = ttl
  }

  /** Sets expected server plugins. */
  setPlugins(plugins?: string[]): void {
    this.plugins = plugins
  }

  /** Sets the room properties to pass to the RoomInfo list in a lobby. */
  setPropsListedInLobby(props: string[]): void {
    this.propsListedInLobby = props
  }

  /** Reserves slots for the given users. */
  setExpectedUsers(users?: string[]): void {
    const update = users?.length ? users : null
    const expected = this.expectedUsers?.length ? this.expectedUsers : null

    if (this.#setWellKnownProperty(GameProperty.ExpectedUsers, update, expected)) {
      this.expectedUsers = users
    }
  }

  /** Attempts to remove all current expected users from the server's slot reservation list. */
  clearExpectedUsers(): void {
    this.setExpectedUsers(undefined)
  }

  /** Asks the server to assign another player as Master Client of the room. */
  setMasterClient(actorNr: number): void {
    if (this.#setWellKnownProperty(GameProperty.MasterClientId, actorNr, this.masterClientId)) {
      this.masterClientId = actorNr
    }
  }

  #setWellKnownProperty(code: number, value: any, expected?: any): boolean {
    if (!this.client?.isJoinedToRoom()) return true

    const expectedProps = expected === undefined || expected === null ? undefined : { [code]: expected }
    this.client.setPropertiesOfRoom({ [code]: value }, false, expectedProps)
    return expected === undefined || expected === null // non-CAS updates apply immediately
  }
}
