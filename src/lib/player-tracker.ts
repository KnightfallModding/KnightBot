import { objectKeys } from '@sapphire/utilities'

import { Photon } from './photon'
import { appId, appVersion, Regions } from './queue-detector'

interface RPCContent {
  // Actor ID
  '0': number
  // Data from the RPC
  '1': 'serialization error'
  // Unknown property
  '2': number
  // Unknown property
  '4': unknown[]
  // RPC Code
  '5': number
}

enum RPCCodes {
  RPCA_StartGame = 10,
  RPC_WIN = 29,
}

export class PlayerTracker extends Photon.LoadBalancing.LoadBalancingClient {
  room: Photon.LoadBalancing.RoomInfo
  region: keyof typeof Regions
  players: Record<number, string> = {}
  masterActorNr = 0
  masterName?: string
  #errored = false

  constructor(room: Photon.LoadBalancing.RoomInfo, region: keyof typeof Regions) {
    super(Photon.ConnectionProtocol.Ws, appId, appVersion)
    this.autoJoinLobby = false

    this.logger = new Photon.Logger(`[${room.name}]`, Photon.LogLevel.INFO)

    this.room = room
    this.region = region
    this.myActor().setName('<b><color=green>KnightBot</color> <color=yellow>Tracker</color></b>')
    this.myActor().setCustomProperty('UUID', 'knightbot')
    this.connectToRegionMaster(region)
    this.connectToNameServer({
      region,
      lobbyType: Photon.LoadBalancing.Constants.LobbyType.Default,
    })
  }

  override onStateChange(state: number): void {
    if (state === Photon.LoadBalancing.LoadBalancingClient.State.ConnectedToMaster) {
      this.joinRoom(this.room.name)
    }
  }

  override onJoinRoom(): void {
    for (const player of this.myRoomActorsArray()) {
      if (player.isLocal) continue

      this.players[player.actorNr] = player.name
    }

    this.updateMasterClient()
  }

  override onActorJoin(player: Photon.LoadBalancing.Actor): void {
    this.players[player.actorNr] = player.name

    this.updateMasterClient()
  }

  override onActorLeave(player: Photon.LoadBalancing.Actor): void {
    delete this.players[player.actorNr]

    this.updateMasterClient()

    if (objectKeys(this.players).length === 1) this.leaveRoom()
  }

  override onMyRoomPropertiesChange(): void {
    this.updateMasterClient()
  }

  /**
   * Reconciles the tracked master client with the room's current master and
   * logs the transition. The master changes either explicitly (a properties
   * event) or implicitly when the current master leaves the room.
   */
  private updateMasterClient(): void {
    const masterActorNr = this.myRoomMasterActorNr()
    if (masterActorNr === this.masterActorNr) return

    const previousActorNr = this.masterActorNr
    const previousName = this.masterName

    this.masterActorNr = masterActorNr
    this.masterName = this.players[masterActorNr]

    // No master yet (empty room / not joined) — nothing to report.
    if (masterActorNr === 0) return

    if (previousActorNr === 0) {
      this.logger.info(`Master client: ${this.masterName ?? masterActorNr}`)
    } else {
      this.logger.info(
        `Master client changed: ${previousName ?? previousActorNr} → ${this.masterName ?? masterActorNr}`
      )
    }
  }

  override onEvent(code: number, content: unknown): void {
    // When code is 200 (RPC), get its name
    if (code === 200) {
      const isRpcGameOver = (content as RPCContent)[5] === RPCCodes.RPC_WIN
      if (isRpcGameOver) this.leaveRoom()
    }
  }

  override onError(): void {
    this.errored = true
    this.disconnect()
  }

  get errored() {
    return this.#errored
  }

  private set errored(value: boolean) {
    this.#errored = value
  }
}
