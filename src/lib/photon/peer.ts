import { ConnectionProtocol, PHOTON_VERSION } from './constants'
import { TypedEventEmitter } from './emitter'
import { Logger } from './logger'

/** Structural WebSocket types so the SDK works with any spec-compliant implementation. */
export interface WebSocketLike {
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { wasClean: boolean; code: number; reason: string }) => void) | null
  onerror: ((event: unknown) => void) | null
  send(data: string): void
  close(): void
}

export type WebSocketConstructor = new (url: string, protocols?: string | string[]) => WebSocketLike

/** Response to an operation sent through {@link PhotonPeer#sendOperation}. */
export interface OperationResponse {
  errCode: number
  errMsg: string
  vals: Record<number, any>
}

/** Content of a server event. */
export interface EventData {
  vals: Record<number, any>
}

export type PhotonPeerEvents = {
  connecting: []
  connect: []
  connectFailed: []
  disconnect: []
  connectClosed: []
  timeout: []
  error: [event: unknown]
  /** Emitted for events no listener was registered for through {@link PhotonPeer#onEvent}. */
  unhandledEvent: [code: number, data: EventData]
  /** Emitted for responses no listener was registered for through {@link PhotonPeer#onResponse}. */
  unhandledResponse: [code: number, response: OperationResponse]
}

const FRAME = '~m~'
const JSON_MARKER = '~j~'

interface ProtocolMessage {
  err?: number
  msg?: string
  vals?: unknown[]
  res?: number
  evt?: number
  irs?: number
}

/**
  Low level connection to a Photon server over WebSocket using the JSON protocol.
  Handles framing, keep alive pings, server time synchronization and dispatches
  operation responses and events to registered listeners.
*/
export class PhotonPeer extends TypedEventEmitter<PhotonPeerEvents> {
  /**
    The peer sends a 'keep alive' message when this timeout exceeded after the last
    send operation. Set it below 1000 to disable keep alive.
  */
  keepAliveTimeoutMs = 3_000

  readonly url: string
  readonly logger: Logger

  #webSocketImpl: WebSocketConstructor
  #socket?: WebSocketLike
  #sessionId?: string

  #isConnecting = false
  #isConnected = false
  #isClosing = false

  #responseListeners = new Map<number, Set<(response: OperationResponse) => void>>()
  #eventListeners = new Map<number, Set<(data: EventData) => void>>()

  #initTimestamp = Date.now()
  #lastRtt = 0
  #serverTimeBase = 0
  #serverTimeBaseTimestamp = Date.now()
  #serverTimeBaseLocked = false
  #keepAliveTimer?: ReturnType<typeof setTimeout>

  constructor(protocol: ConnectionProtocol, address: string, logger?: Logger, webSocketImpl?: WebSocketConstructor) {
    super()

    this.url = PhotonPeer.addProtocolPrefix(address, protocol)
    this.logger = logger ?? new Logger('Peer:')

    const impl = webSocketImpl ?? (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket
    if (!impl) throw new Error('WebSocket is not available. Provide an implementation through the constructor.')
    this.#webSocketImpl = impl
  }

  static addProtocolPrefix(address: string, protocol: ConnectionProtocol): string {
    if (address.startsWith('ws://') || address.startsWith('wss://')) return address

    return `${protocol === ConnectionProtocol.Wss ? 'wss' : 'ws'}://${address}`
  }

  isConnecting(): boolean {
    return this.#isConnecting
  }

  isConnected(): boolean {
    return this.#isConnected
  }

  isClosing(): boolean {
    return this.#isClosing
  }

  /** Latest round trip time measurement in milliseconds. */
  get rtt(): number {
    return this.#lastRtt
  }

  /** Server time extrapolation in milliseconds (signed 32 bit integer on the server). */
  getServerTimeMs(): number {
    return (this.#serverTimeBase + (Date.now() - this.#serverTimeBaseTimestamp)) >> 0
  }

  /** Triggers a round trip time measurement, optionally re-synchronizing server time. */
  ping(syncServerTime = false): void {
    this.#ping(syncServerTime)
  }

  /** Opens the connection to the server. */
  connect(appId: string): void {
    this.#sessionId = undefined

    const socket = new this.#webSocketImpl(`${this.url}/${appId}?libversion=${PHOTON_VERSION}`, 'Json')
    this.#socket = socket
    this.#onConnecting()

    socket.onmessage = event => {
      for (const message of this.#decode(String(event.data))) this.#onMessage(message)
    }

    socket.onclose = event => {
      this.logger.debug('onclose: wasClean =', event.wasClean, ', code =', event.code, ', reason =', event.reason)

      if (this.#isConnecting) {
        this.#isConnecting = false
        this.#isConnected = false
        this.logger.error('Connection could not be created:', this.url)
        this.emit('connectFailed')
      } else {
        // 1006 is an abnormal closure, which is how timeouts surface.
        if (event.code === 1006) this.emit('timeout')

        const wasConnected = this.#isConnected
        const wasClosing = this.#isClosing
        this.#isClosing = this.#isConnected = this.#isConnecting = false

        if (wasConnected) this.emit(wasClosing ? 'disconnect' : 'connectClosed')
      }
    }

    socket.onerror = event => {
      this.logger.error('Connection error:', event)
      this.#isConnecting = this.#isConnected = this.#isClosing = false
      this.emit('error', event)
    }
  }

  /** Closes the connection. */
  disconnect(): void {
    this.#isClosing = true
    this.#socket?.close()
  }

  /** Releases resources held by this peer. Safe to call multiple times. */
  destroy(): void {
    clearTimeout(this.#keepAliveTimer)
    this.removeAllListeners()
    this.#responseListeners.clear()
    this.#eventListeners.clear()

    if (this.#socket) {
      this.#socket.onmessage = null
      this.#socket.onclose = null
      this.#socket.onerror = null
      if (this.#isConnected || this.#isConnecting) this.#socket.close()
    }
  }

  /**
    Sends an operation to the server.
    @param code Operation code.
    @param params Parameters as a flattened array of key-value pairs: [key1, value1, key2, value2, ...]
  */
  sendOperation(code: number, params: unknown[] = []): void {
    const data = { req: code, vals: params }
    this.#send(data)
    this.logger.debug('Sent request:', data)
  }

  /**
    Registers a listener for an operation response.
    @returns Function removing the listener when called.
  */
  onResponse(code: number, listener: (response: OperationResponse) => void): () => void {
    let set = this.#responseListeners.get(code)
    if (!set) {
      set = new Set()
      this.#responseListeners.set(code, set)
    }

    set.add(listener)
    return () => set.delete(listener)
  }

  /**
    Registers a listener for a server event.
    @returns Function removing the listener when called.
  */
  onEvent(code: number, listener: (data: EventData) => void): () => void {
    let set = this.#eventListeners.get(code)
    if (!set) {
      set = new Set()
      this.#eventListeners.set(code, set)
    }

    set.add(listener)
    return () => set.delete(listener)
  }

  /** Resolves with the next response received for the given operation code. */
  waitForResponse(code: number): Promise<OperationResponse> {
    return new Promise(resolve => {
      const off = this.onResponse(code, response => {
        off()
        resolve(response)
      })
    })
  }

  #onConnecting(): void {
    this.logger.debug('Connecting to', this.url, '...')
    this.#isConnecting = true
    this.emit('connecting')
    this.#resetKeepAlive()
  }

  #onConnect(): void {
    this.logger.debug('Connected')
    this.#isConnecting = false
    this.#isConnected = true
    this.emit('connect')
    this.#ping(true) // triggers RTT measurement and server time request
    this.#resetKeepAlive()
  }

  #onMessage(message: string): void {
    if (message.startsWith(JSON_MARKER)) {
      this.#onMessageReceived(JSON.parse(message.slice(JSON_MARKER.length)) as ProtocolMessage)
    } else if (!this.#sessionId) {
      // The first plain message is the session id assigned by the server.
      this.#sessionId = message
      this.#onConnect()
    }
  }

  #onMessageReceived(message: ProtocolMessage): void {
    this.logger.debug('Received message:', message)

    const vals = Array.isArray(message.vals) ? this.#pairsToObject(message.vals) : {}

    if (message.res !== undefined) {
      const response: OperationResponse = { errCode: message.err ?? 0, errMsg: message.msg ?? '', vals }
      const listeners = this.#responseListeners.get(message.res)

      if (listeners?.size) for (const listener of [...listeners]) listener(response)
      else this.emit('unhandledResponse', message.res, response)
    } else if (message.evt !== undefined) {
      const listeners = this.#eventListeners.get(message.evt)

      if (listeners?.size) for (const listener of [...listeners]) listener({ vals })
      else this.emit('unhandledEvent', message.evt, { vals })
    } else if (message.irs !== undefined) {
      this.#onInternalResponse(message.vals as number[])
    } else {
      this.logger.error('Received message of unknown type:', message)
    }
  }

  #onInternalResponse(vals: number[]): void {
    const now = Date.now()
    this.#lastRtt = now - this.#initTimestamp - (vals[1] ?? 0)

    if (!this.#serverTimeBaseLocked) {
      this.#serverTimeBase = (vals[2] ?? 0) + this.#lastRtt / 2
      this.#serverTimeBaseTimestamp = now
      this.#serverTimeBaseLocked = true
    }
  }

  #pairsToObject(vals: unknown[]): Record<number, any> {
    const result: Record<number, any> = {}
    if (vals.length % 2 !== 0) {
      this.logger.error('Received invalid values array:', vals)
      return result
    }

    for (let index = 0; index < vals.length; index += 2) {
      result[vals[index] as number] = vals[index + 1]
    }

    return result
  }

  #encode(message: object): string {
    const payload = `${JSON_MARKER}${JSON.stringify(message)}`
    return `${FRAME}${payload.length}${FRAME}${payload}`
  }

  #decode(raw: string): string[] {
    const messages: string[] = []
    let data = raw.includes('\0') ? raw.replaceAll('\0', '') : raw

    while (data.startsWith(FRAME)) {
      data = data.slice(FRAME.length)

      const match = /^(\d+)/.exec(data)
      if (!match?.[1]) break

      const length = Number(match[1])
      data = data.slice(match[1].length + FRAME.length)
      messages.push(data.slice(0, length))
      data = data.slice(length)
    }

    return messages
  }

  #send(data: object, silentWhenDisconnected = false): void {
    if (this.#socket && this.#isConnected && !this.#isClosing) {
      this.#resetKeepAlive()
      this.#socket.send(this.#encode(data))
    } else if (!silentWhenDisconnected) {
      throw new Error(
        this.logger.format('Send failed:', data, `isConnected: ${this.#isConnected}, isClosing: ${this.#isClosing}`)
      )
    }
  }

  #ping(syncServerTime = false): void {
    if (syncServerTime) this.#serverTimeBaseLocked = false

    // Time since peer creation is sent to avoid timestamp overflow on the server side.
    this.#send({ irq: 1, vals: [1, Date.now() - this.#initTimestamp] }, true)
  }

  #resetKeepAlive(): void {
    clearTimeout(this.#keepAliveTimer)
    if (this.keepAliveTimeoutMs >= 1_000) {
      this.#keepAliveTimer = setTimeout(() => this.#ping(), this.keepAliveTimeoutMs)
    }
  }
}
