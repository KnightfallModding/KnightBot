import { pickRandom } from '@sapphire/utilities'

import { Actor, ConnectionProtocol, EventCode, Logger, LogLevel, PhotonClient } from './photon'
import { appId, appVersion, Regions } from './queue-detector'

interface Player {
  id: number
  name: string
}

interface RPCEvent {
  /** The ID of the RPC */
  '5': number
}

enum RPCCodes {
  RPCA_StartGame = 10,
}

export class PlayerTracker {
  readonly client: PhotonClient
  readonly logger: Logger
  readonly room: string
  readonly originalRoomName: string

  destroyed = false
  players: Player[] = []

  #masterClientId: number = 0

  constructor(region: keyof typeof Regions, room: string) {
    this.room = room.replace('Room: ', '')
    this.originalRoomName = room

    this.logger = new Logger(this.room, LogLevel.OFF)
    this.client = new PhotonClient({
      appId,
      appVersion,
      protocol: ConnectionProtocol.Ws,
      logger: this.logger,
      autoJoinLobby: false,
    })
    this.client.myActor.setName('<color=green>KnightBot</color> <color=blue>Tracker</color>')

    this.#connect(Regions[region])
    this.client.on('actorJoin', this.#onActorJoin)
    this.client.on('actorPropertiesChange', this.#onActorPropertiesChange)
    this.client.on('event', this.#onEvent)
    this.client.on('actorLeave', this.#onActorLeave)
  }

  async #connect(region: Regions) {
    try {
      await this.client.connectToRegionMaster(region)
      const room = await this.client.joinRoom(this.originalRoomName)
      this.#masterClientId = room.masterClientId

      for (const { actorNr, name, isLocal } of this.client.actors.values()) {
        if (isLocal) continue

        this.players.push({
          id: actorNr,
          name,
        })
      }

      this.logger.info('Player Tracker connected')
    } catch {}
  }

  #onActorJoin = (actor: Actor) => {
    if (actor.isLocal) return

    this.players.push({
      id: actor.actorNr,
      name: actor.name,
    })
  }

  #onActorPropertiesChange = () => {
    const { actors, myActor, room } = this.client

    // If MasterClient hasn't changed, ignore
    if (room.masterClientId === this.#masterClientId) return

    // If new MasterClient is the bot, change it back
    if (room.masterClientId === myActor.actorNr) {
      const randomPlayer = pickRandom([...actors.keys().filter(id => id !== myActor.actorNr)])
      room.setMasterClient(randomPlayer)

      return
    }

    this.#masterClientId = room.masterClientId
  }

  #onEvent = (code: number, content: unknown) => {
    if (code === EventCode.RPC) this.#onRpc(content as RPCEvent)
  }

  #onRpc = (content: RPCEvent) => {
    if (content[5] === RPCCodes.RPCA_StartGame) this.#destroy()
  }

  #onActorLeave = () => {
    if (this.client.room.playerCount === 1) this.#destroy()
  }

  #destroy = async () => {
    this.client.off('actorJoin', this.#onActorJoin)
    this.client.off('actorLeave', this.#onActorLeave)
    this.client.off('actorPropertiesChange', this.#onActorPropertiesChange)

    try {
      await this.client.leaveRoom()
    } finally {
      this.destroyed = true
    }
  }
}
