import { envParseString } from '@skyra/env-utilities'

import { ConnectionProtocol, Logger, LogLevel, PhotonClient, type RoomInfo } from '$lib/photon'

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

export class QueueDetector {
  readonly client: PhotonClient
  readonly logger: Logger

  totalGames?: number
  players = { active: -1 }
  currentQueue?: Queue | null
  hasQueueConflict = false
  potentiallyBuggedQueues: string[] = []
  countOfPlayersInCurrentQueue: number = 0
  playerTrackers: PlayerTracker[] = []

  #region: keyof typeof Regions
  #reconnectDelay: number
  #reconnectScheduled = false

  constructor(region: keyof typeof Regions, lastDelay = defaultReconnectDelay) {
    const regionValue = Regions[region]

    this.logger = new Logger(`[${regionValue}]`, dev ? LogLevel.DEBUG : LogLevel.INFO)
    this.client = new PhotonClient({
      appId,
      appVersion,
      protocol: ConnectionProtocol.Ws,
      logger: this.logger,
    })

    this.#region = region
    this.#reconnectDelay = lastDelay + 2_000

    this.client.on('appStats', stats => {
      // `stats.peerCount` is the count of all active players
      this.players = { active: stats.peerCount }
    })

    this.client.on('roomListUpdate', (rooms, roomsUpdated, roomsAdded, roomsRemoved) => {
      this.#onRoomListUpdate(rooms, roomsUpdated, roomsAdded, roomsRemoved)
    })

    this.client.on('error', error => {
      this.logger.error(error.message)
      this.#scheduleReconnect()
    })

    void this.#connect(regionValue)
  }

  async #connect(region: Regions) {
    this.logger.debug(`Init ${this.client.nameServerAddress}`)

    try {
      await this.client.connectToRegionMaster(region)
      this.logger.info('Connected and joined lobby')
    } catch {
      // The `error` listener logged the failure and scheduled the reconnection already.
    }
  }

  #scheduleReconnect() {
    if (this.#reconnectScheduled) return
    this.#reconnectScheduled = true

    setTimeout(() => {
      this.client.disconnect()
      queueDetectors[this.#region] = new QueueDetector(this.#region, this.#reconnectDelay)
    }, this.#reconnectDelay)
  }

  #onRoomListUpdate(rooms: RoomInfo[], roomsUpdated: RoomInfo[], roomsAdded: RoomInfo[], roomsRemoved: RoomInfo[]) {
    this.logger.debug('Rooms updated:', rooms.length, rooms[0]?.name, roomsUpdated, roomsAdded, roomsRemoved)

    for (const addedRoom of roomsAdded) {
      const playerTracker = new PlayerTracker(this.#region, addedRoom.name)
      const onActorLeave = () => {
        if (!playerTracker.destroyed) return

        playerTracker.client.off('actorLeave', onActorLeave)

        this.playerTrackers = this.playerTrackers.filter(tracker => tracker.room === playerTracker.room)
      }
      playerTracker.client.on('actorLeave', onActorLeave)

      this.playerTrackers.push(playerTracker)
    }

    if (roomsAdded.length === 1) this.setCurrentQueue(roomsAdded[0])
    else if (roomsAdded.length > 1) {
      this.logger.warn('More than 1 room is open. This should not happen')

      const mostFilledRoom = roomsAdded.reduce((previous, current) => {
        return previous.playerCount > current.playerCount ? previous : current
      })
      this.setCurrentQueue(mostFilledRoom)

      for (const room of roomsAdded) this.potentiallyBuggedQueues.push(room.name)
    }

    for (const room of rooms) {
      if (!this.currentQueue?.name && room.isOpen) {
        this.setCurrentQueue(room)
        break
      } else if (this.currentQueue?.name === room.name) {
        this.currentQueue.players = room.playerCount
        break
      }
    }

    if (roomsRemoved.length) {
      for (const room of roomsRemoved) {
        if (this.currentQueue?.name === room.name) this.currentQueue = null
      }
    }
  }

  private setCurrentQueue({ name, playerCount }: RoomInfo) {
    this.currentQueue = {
      name: name,
      players: playerCount,
      timer: Date.now(),
    }

    this.logger.info(`New queue ${name}`)
  }
}

export const queueDetectors = {
  NA: new QueueDetector('NA'),
  EU: new QueueDetector('EU'),
} satisfies Partial<Record<keyof typeof Regions, QueueDetector>>
