import { container } from '@sapphire/framework'
import { envParseString } from '@skyra/env-utilities'

import type { PhotonError, RoomInfo, RoomListUpdate } from '$lib/photon-next'
import { DefaultNameServerAddress, Logger, LogLevel, PhotonClient } from '$lib/photon-next'

import { dev } from './constants'
import { PlayerTracker } from './player-tracker'

export const appId = envParseString('PHOTON_APP_ID', '<no-app-id>')
export const appVersion = envParseString('PHOTON_APP_VERSION', '1.0')
const defaultReconnectDelay = 3_000

export enum Regions {
  NA = 'US',
  EU = 'EU',
}

interface Queue {
  name: string
  players: number
  timer: number
}

/**
 * Watches one region's lobby for the queue room and the active-player count.
 * Composes a PhotonClient; on any client failure the instance destroys its client and replaces
 * itself in `queueDetectors` after a backoff delay — commands re-read the map on every invocation.
 */
export class QueueDetector {
  readonly client: PhotonClient

  /** `active` is -1 until the first AppStats event arrives. */
  players = { active: -1 }
  currentQueue?: Queue | null
  /** Write-only diagnostic: names of rooms that appeared while another room was already open. */
  potentiallyBuggedQueues: string[] = []
  playerTrackers: PlayerTracker[] = []

  readonly #region: keyof typeof Regions
  readonly #reconnectDelay: number
  readonly #logger: Logger
  #reconnectScheduled = false

  constructor(region: keyof typeof Regions, lastDelay = defaultReconnectDelay) {
    this.#region = region
    this.#reconnectDelay = lastDelay + 2_000

    const regionValue = Regions[region]
    this.#logger = new Logger(`[${regionValue}]`, dev ? LogLevel.DEBUG : LogLevel.INFO)
    this.#logger.debug(`Init ws://${DefaultNameServerAddress.ws}`)

    this.client = new PhotonClient({
      appId,
      appVersion,
      region: regionValue,
      logger: this.#logger,
    })

    this.client.on('appStats', stats => {
      // `peerCount` is the count of all active players (on game servers)
      this.players = { active: stats.peerCount }
    })
    this.client.on('roomList', rooms => this.#onRoomList(rooms))
    this.client.on('roomListUpdate', update => this.#onRoomListUpdate(update))
    this.client.on('error', (error: PhotonError) => {
      this.#logger.error(error.message)
      this.#scheduleReconnect()
    })
    this.client.on('disconnect', () => this.#scheduleReconnect())

    this.client.connect().catch((error: unknown) => {
      this.#logger.error(`Connection failed: ${error instanceof Error ? error.message : String(error)}`)
      this.#scheduleReconnect()
    })
  }

  /**
   * Initial GameList snapshot: adopt the first open room (deliberate fix — legacy dropped the
   * snapshot entirely). No trackers and no bugged-queue warnings for snapshot rooms.
   */
  #onRoomList(rooms: RoomInfo[]): void {
    this.#logger.debug('Initial rooms:', rooms.length, rooms[0]?.name)

    this.#scanRooms(rooms)
  }

  #onRoomListUpdate({ rooms, updated, added, removed }: RoomListUpdate): void {
    this.#logger.debug('Rooms updated:', rooms.length, rooms[0]?.name, updated, added, removed)

    for (const room of added) {
      container.logger.debug(`Found room ${room.name}`)

      this.playerTrackers.push(new PlayerTracker(room, this.#region))
    }

    if (added.length === 1) this.#setCurrentQueue(added[0])
    else if (added.length > 1) {
      this.#logger.warn('More than 1 room is open. This should not happen')

      const mostFilledRoom = added.reduce((previous, current) => {
        return previous.playerCount > current.playerCount ? previous : current
      })
      this.#setCurrentQueue(mostFilledRoom)

      for (const room of added) this.potentiallyBuggedQueues.push(room.name)
    }

    this.#scanRooms(rooms)

    for (const room of removed) {
      if (this.currentQueue?.name === room.name) this.currentQueue = null

      this.playerTrackers = this.playerTrackers.filter(tracker => {
        if (tracker.room.name !== room.name) return true

        tracker.destroy()
        return false
      })
    }
  }

  /** Legacy fallback scan: adopt the first open room when no queue is tracked, else refresh its player count. */
  #scanRooms(rooms: RoomInfo[]): void {
    for (const room of rooms) {
      if (!this.currentQueue?.name && room.isOpen) {
        this.#setCurrentQueue(room)
        break
      } else if (this.currentQueue?.name === room.name) {
        this.currentQueue.players = room.playerCount
        break
      }
    }
  }

  #setCurrentQueue({ name, playerCount }: RoomInfo): void {
    this.currentQueue = {
      name,
      players: playerCount,
      timer: Date.now(),
    }

    this.#logger.info(`New queue ${name}`)
  }

  /**
   * Legacy backoff preserved: each generation waits `lastDelay + 2000` ms (5s, 7s, 9s, ... — never
   * reset on success) before replacing itself in `queueDetectors`. Deliberate fixes over legacy:
   * the dead client is disconnected instead of leaked, and repeated error/disconnect firings
   * schedule only one replacement.
   */
  #scheduleReconnect(): void {
    if (this.#reconnectScheduled) return
    this.#reconnectScheduled = true

    this.client.disconnect()
    this.#logger.info(`Recreating client in ${this.#reconnectDelay}ms`)

    setTimeout(() => {
      queueDetectors[this.#region] = new QueueDetector(this.#region, this.#reconnectDelay)
    }, this.#reconnectDelay)
  }
}

export const queueDetectors = {
  NA: new QueueDetector('NA'),
  EU: new QueueDetector('EU'),
} satisfies Partial<Record<keyof typeof Regions, QueueDetector>>
