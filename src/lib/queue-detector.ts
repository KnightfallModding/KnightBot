import { envParseString } from '@skyra/env-utilities'

import { Photon } from '$lib/photon'

import { dev } from './constants'

export const appId = envParseString('PHOTON_APP_ID', '<no-app-id>')
export const appVersion = envParseString('PHOTON_APP_VERSION', '1.0')

export enum Regions {
  NA = 'US',
  EU = 'EU',
}

interface Queue {
  name: string
  players: number
  timer: number
}

export class QueueDetector extends Photon.LoadBalancing.LoadBalancingClient {
  override logger: Photon.Logger

  totalGames?: number
  players = { active: -1 }
  currentQueue?: Queue | null
  hasQueueConflict = false
  potentiallyBuggedQueues: string[] = []
  countOfPlayersInCurrentQueue: number = 0

  #region: keyof typeof Regions

  constructor(region: keyof typeof Regions) {
    super(Photon.ConnectionProtocol.Ws, appId, appVersion)

    const regionValue = Regions[region]

    this.logger = new Photon.Logger(`[${regionValue}]`, dev ? Photon.LogLevel.DEBUG : Photon.LogLevel.INFO)
    this.logger.debug(`Init ${this.getNameServerAddress()}`)

    this.connectToRegionMaster(regionValue)
    this.connectToNameServer({
      region,
      lobbyType: Photon.LoadBalancing.Constants.LobbyType.Default,
    })

    this.#region = region
  }

  override onAppStats(_errorCode: number, _errorMsg: string, stats: Record<string, string>) {
    // `stats.PeerCount` gets the count of all active players
    this.players = { active: parseInt(stats.peerCount) }
  }

  override onError(_errorCode: number, errorMsg: string): void {
    this.logger.error(errorMsg)

    setTimeout(() => {
      queueDetectors[this.#region] = new QueueDetector(this.#region)
    }, 3_000)
  }

  override onRoomListUpdate(
    rooms: Photon.LoadBalancing.RoomInfo[],
    roomsUpdated: Photon.LoadBalancing.RoomInfo[],
    roomsAdded: Photon.LoadBalancing.RoomInfo[],
    roomsRemoved: Photon.LoadBalancing.RoomInfo[]
  ) {
    this.logger.debug('Rooms updated:', rooms.length, rooms[0]?.name, roomsUpdated, roomsAdded, roomsRemoved)

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

  private setCurrentQueue({ name, playerCount }: Photon.LoadBalancing.RoomInfo) {
    this.currentQueue = {
      name: name,
      players: playerCount,
      timer: Date.now(),
    }

    this.logger.info(`New queue ${name}`)
  }
}

export const queueDetectors = {
  NA: new QueueDetector(Regions.NA),
  EU: new QueueDetector(Regions.EU),
} satisfies Partial<Record<keyof typeof Regions, QueueDetector>>
