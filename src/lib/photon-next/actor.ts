import { ActorProperty } from './constants'
import type { Vals } from './types'

/**
 * A player in a room. Plain data holder — all mutations flow through the client
 * (no client back-reference; the legacy send methods live on PhotonClient/Room instead).
 */
export class Actor {
  /** Actor number, unique within the room. The local actor starts at -1 until the server assigns one on join. */
  actorNr: number
  /** Display name (ActorProperty.PlayerName 255). */
  name: string
  /** UserId (ActorProperty.UserId 253); empty string until known. */
  userId = ''
  /** True for the client's own actor. */
  readonly isLocal: boolean
  #suspended = false
  #customProperties: Record<string, unknown> = {}

  constructor(name = '', actorNr = -1, isLocal = false) {
    this.name = name
    this.actorNr = actorNr
    this.isLocal = isLocal
  }

  /**
   * True once the actor went inactive (Leave event with IsInactive 233, or Disconnect event 252).
   * Never reset to false — a rejoining remote actor arrives as a brand-new Actor (legacy parity).
   */
  get suspended(): boolean {
    return this.#suspended
  }

  /** Readonly live view of the custom (string-keyed) properties. */
  get customProperties(): Readonly<Record<string, unknown>> {
    return this.#customProperties
  }

  getCustomProperty(key: string): unknown {
    return this.#customProperties[key]
  }

  /**
   * Internal: applies a PlayerProperties (249) hashtable — PlayerName (255) → name, UserId (253) → userId,
   * non-numeric keys → custom properties (strict-diffed; other numeric keys are ignored).
   * Well-known keys use `hasOwnProperty` semantics (legacy parity): explicitly sent null/''/0 DO overwrite.
   * @returns the custom properties that actually changed, for the client's `actorPropertiesChange` event.
   */
  _updateFromProps(props: Vals): Record<string, unknown> {
    if (Object.hasOwn(props, String(ActorProperty.PlayerName))) {
      this.name = props[String(ActorProperty.PlayerName)] as string
    }
    if (Object.hasOwn(props, String(ActorProperty.UserId))) {
      this.userId = props[String(ActorProperty.UserId)] as string
    }
    const changed: Record<string, unknown> = {}
    for (const key of Object.keys(props)) {
      // canonical-numeric keys are well-known byte codes, never custom properties (legacy key filter)
      if (String(parseInt(key, 10)) === key) continue
      if (this.#customProperties[key] !== props[key]) {
        this.#customProperties[key] = props[key]
        changed[key] = props[key]
      }
    }
    return changed
  }

  /** Internal: marks the actor inactive (only ever called with true — see `suspended`). */
  _setSuspended(suspended: boolean): void {
    this.#suspended = suspended
  }
}
