export type EventMap = Record<string, unknown[]>

export type Listener<Args extends unknown[]> = (...args: Args) => void

/**
  Minimal strongly-typed event emitter.
  Every subscription method returns an unsubscribe function for easy cleanup.
*/
export class TypedEventEmitter<Events extends EventMap> {
  #listeners = new Map<keyof Events, Set<Listener<never>>>()

  /**
    Subscribes to an event.
    @returns Function removing the listener when called.
  */
  on<Event extends keyof Events>(event: Event, listener: Listener<Events[Event]>): () => void {
    let set = this.#listeners.get(event)
    if (!set) {
      set = new Set()
      this.#listeners.set(event, set)
    }

    set.add(listener as Listener<never>)
    return () => this.off(event, listener)
  }

  /**
    Subscribes to an event for a single emission.
    @returns Function removing the listener when called.
  */
  once<Event extends keyof Events>(event: Event, listener: Listener<Events[Event]>): () => void {
    const off = this.on(event, ((...args: Events[Event]) => {
      off()
      listener(...args)
    }) as Listener<Events[Event]>)

    return off
  }

  /** Removes a previously registered listener. */
  off<Event extends keyof Events>(event: Event, listener: Listener<Events[Event]>): void {
    this.#listeners.get(event)?.delete(listener as Listener<never>)
  }

  /** Removes all listeners, optionally only for the given event. */
  removeAllListeners<Event extends keyof Events>(event?: Event): void {
    if (event === undefined) this.#listeners.clear()
    else this.#listeners.delete(event)
  }

  /** Returns the number of listeners registered for the given event. */
  listenerCount<Event extends keyof Events>(event: Event): number {
    return this.#listeners.get(event)?.size ?? 0
  }

  protected emit<Event extends keyof Events>(event: Event, ...args: Events[Event]): boolean {
    const set = this.#listeners.get(event)
    if (!set?.size) return false

    for (const listener of [...set]) (listener as Listener<Events[Event]>)(...args)
    return true
  }
}
