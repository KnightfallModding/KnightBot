import type { PhotonClient, RaiseEventOptions } from './client'
import { ActorProperty, ParameterCode } from './constants'
import type { Room } from './room'

/**
  A "player" within a room, identified (in that room) by an ID called `actorNr`.
  Extend to implement custom logic.
*/
export class Actor {
  name: string
  actorNr: number
  readonly isLocal: boolean
  userId = ''

  /** @internal */
  client?: PhotonClient

  #customProperties: Record<string, any> = {}
  #suspended = false

  constructor(name: string, actorNr: number, isLocal: boolean) {
    this.name = name
    this.actorNr = actorNr
    this.isLocal = isLocal
  }

  /** The room this actor belongs to. */
  get room(): Room | undefined {
    return this.client?.room
  }

  /** True if the actor is in a suspended state. */
  get suspended(): boolean {
    return this.#suspended
  }

  /** Raises a game custom event on behalf of the client. */
  raiseEvent(eventCode: number, data?: unknown, options?: RaiseEventOptions): void {
    this.client?.raiseEvent(eventCode, data, options)
  }

  /** Sets the actor name and syncs it with the server when joined to a room. */
  setName(name: string): void {
    if (this.name === name) return

    if (this.#setWellKnownProperty(ActorProperty.PlayerName, name)) this.name = name
  }

  /**
    Called on every actor properties update: properties set by client, properties update from server.
    Override to update custom actor state.
  */
  onPropertiesChange(_changedCustomProps: Record<string, any>, _byClient?: boolean): void {}

  getCustomProperty(name: string): any {
    return this.#customProperties[name]
  }

  getCustomPropertyOrElse(name: string, defaultValue: any): any {
    return Object.hasOwn(this.#customProperties, name) ? this.#customProperties[name] : defaultValue
  }

  /** Returns a copy of the actor's custom properties. */
  getCustomProperties(): Record<string, any> {
    return { ...this.#customProperties }
  }

  /**
    Sets a custom property.
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
    Sets multiple custom properties.
    @param expectedProperties Properties expected when the update occurs ("Check And Swap").
  */
  setCustomProperties(
    properties: Record<string, any>,
    webForward = false,
    expectedProperties?: Record<string, any>
  ): void {
    const joined = this.client?.isJoinedToRoom() ?? false
    if (joined) this.client?.setPropertiesOfActor(this.actorNr, properties, webForward, expectedProperties)

    if (!joined || expectedProperties === undefined) {
      Object.assign(this.#customProperties, properties)
      this.onPropertiesChange(properties, true)
    }
  }

  /** @internal */
  getAllProperties(): Record<string | number, any> {
    return {
      [ActorProperty.PlayerName]: this.name,
      ...this.#customProperties,
    }
  }

  /** @internal */
  updateFromResponse(vals: Record<number, any>): void {
    this.actorNr = vals[ParameterCode.ActorNr]

    const props = vals[ParameterCode.PlayerProperties]
    if (props !== undefined) {
      const name = props[ActorProperty.PlayerName]
      if (name !== undefined) this.name = name

      const userId = props[ActorProperty.UserId]
      if (userId !== undefined) this.userId = userId

      this.updateFromProps(props)
    }
  }

  /** @internal */
  updateFromProps(props: Record<string | number, any>): void {
    if (Object.hasOwn(props, ActorProperty.PlayerName)) this.name = props[ActorProperty.PlayerName]

    const changedProps: Record<string, any> = {}
    for (const key in props) {
      // Numeric keys are well known properties, string keys are custom properties.
      if (String(parseInt(key, 10)) === key) continue

      if (this.#customProperties[key] !== props[key]) {
        this.#customProperties[key] = props[key]
        changedProps[key] = props[key]
      }
    }

    this.onPropertiesChange(changedProps, false)
  }

  /** @internal */
  setSuspended(suspended: boolean): void {
    this.#suspended = suspended
  }

  /** @internal */
  static getActorNrFromResponse(vals: Record<number, any>): number | undefined {
    return vals[ParameterCode.ActorNr]
  }

  #setWellKnownProperty(code: number, value: any, expected?: any): boolean {
    if (!this.client?.isJoinedToRoom()) return true

    const expectedProps = expected === undefined ? undefined : { [code]: expected }
    this.client.setPropertiesOfActor(this.actorNr, { [code]: value }, false, expectedProps)
    return expected === undefined // non-CAS updates apply immediately
  }
}
