import { objectKeys } from '@sapphire/utilities'

import { Logger, LogLevel, PhotonClient, type RoomInfo } from '$lib/photon-next'

import { appId, appVersion, Regions } from './queue-detector'

/**
 * Payload of PUN RPC events (code 200) on the Json subprotocol: what Photon documents as a
 * byte-keyed hashtable arrives as an object keyed by STRINGIFIED parameter numbers.
 */
interface RPCContent {
  /** Actor/view ID (PUN netViewID; owner = viewID/1000 by PUN convention). */
  '0': number
  /** RPC data payload — always this literal: Photon's JSON bridge cannot serialize the binary PUN payload. */
  '1': 'serialization error'
  /** Unknown (PUN uses key 2 for the server timestamp). */
  '2': number
  /** Unknown (PUN uses key 4 for the RPC parameter array). */
  '4': unknown[]
  /** RPC method shortcut index — the game's RPC list index. */
  '5': number
}

enum RPCCodes {
  RPCA_StartGame = 10,
  RPC_WIN = 29,
}

/** PUN RPC event code. */
const RPC_EVENT_CODE = 200

/**
 * Joins a detected room with its own PhotonClient to enumerate the players in it.
 * Leaves (and disconnects) on game over (RPC_WIN) or once the bot is the only player left.
 */
export class PlayerTracker {
  readonly client: PhotonClient
  readonly room: RoomInfo
  players: Record<number, string> = {}
  masterActorNr = 0
  masterName?: string

  readonly #logger: Logger
  #errored = false
  #destroyed = false

  constructor(room: RoomInfo, region: keyof typeof Regions) {
    this.room = room
    this.#logger = new Logger(`[${room.name}]`, LogLevel.INFO)
    this.client = new PhotonClient({
      appId,
      appVersion,
      region: Regions[region],
      joinLobby: false,
      name: '<b><color=green>KnightBot</color> <color=yellow>Tracker</color></b>',
      customProperties: { UUID: 'knightbot' },
      logger: this.#logger,
    })

    this.client.on('actorJoin', actor => {
      if (actor.isLocal) return

      this.players[actor.actorNr] = actor.name
    })

    this.client.on('actorLeave', (actor, cleanup) => {
      delete this.players[actor.actorNr]

      // cleanup leaves cascade from our own teardown — only a real leave may trigger "bot alone → leave"
      if (!cleanup && objectKeys(this.players).length === 1) void this.destroy()
    })

    this.client.on('masterClientChange', current => this.#updateMasterClient(current?.actorNr ?? 0))

    this.client.on('photonEvent', ({ code, data }) => {
      if (code !== RPC_EVENT_CODE) return

      const isRpcGameOver = (data as RPCContent | undefined)?.['5'] === RPCCodes.RPC_WIN
      if (isRpcGameOver) void this.destroy()
    })

    this.client.on('error', error => {
      this.#errored = true
      this.#logger.error('Client error:', error.message)
      void this.destroy()
    })

    void this.#start().catch((error: unknown) => {
      this.#errored = true
      this.#logger.error('Failed to track room:', error)
      void this.destroy()
    })
  }

  get errored() {
    return this.#errored
  }

  async #start(): Promise<void> {
    await this.client.connect()
    await this.client.joinRoom(this.room.name)

    // Seed from the roster excluding the local actor; the self Join event then adds the bot
    // (legacy parity: the bot IS in its own list)
    for (const actor of this.client.actors.values()) {
      if (actor.isLocal) continue

      this.players[actor.actorNr] = actor.name
    }

    this.#updateMasterClient(this.client.masterClientId)
  }

  /**
   * Reconciles the tracked master client with the room's current master and
   * logs the transition. The master changes either explicitly (a properties
   * event) or implicitly when the current master leaves the room — the client
   * folds both into `masterClientChange`.
   */
  #updateMasterClient(masterActorNr: number): void {
    if (masterActorNr === this.masterActorNr) return

    const previousActorNr = this.masterActorNr
    const previousName = this.masterName

    this.masterActorNr = masterActorNr
    this.masterName = this.players[masterActorNr]

    // No master yet (empty room / not joined) — nothing to report.
    if (masterActorNr === 0) return

    if (previousActorNr === 0) {
      this.#logger.info(`Master client: ${this.masterName ?? masterActorNr}`)
    } else {
      this.#logger.info(
        `Master client changed: ${previousName ?? previousActorNr} → ${this.masterName ?? masterActorNr}`
      )
    }
  }

  /** Idempotent teardown: leave the room when joined, then disconnect the client. */
  async destroy(): Promise<void> {
    if (this.#destroyed) return
    this.#destroyed = true

    try {
      await this.client.leaveRoom()
    } catch {
      // Leave failures are tolerated — teardown proceeds regardless
    }

    this.client.disconnect()
  }
}
