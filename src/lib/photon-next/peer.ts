import {
  PhotonAbortError,
  PhotonConnectionError,
  PhotonOperationError,
  PhotonStateError,
  PhotonTimeoutError,
} from './errors'
import type { Logger } from './logger'
import type { PhotonMessage } from './protocol'
import { classifyMessage, decodeFrames, encodeOperation, encodePing, getParam } from './protocol'
import type { DisconnectReason, ServerName, Vals, WebSocketConstructor, WebSocketLike, WireParams } from './types'

export interface PhotonPeerOptions {
  /** Which server this peer talks to — carried into errors and disconnect reasons. */
  name: ServerName
  /** Full connection URL, built by the caller: `ws(s)://<address>/<appId>?libversion=4.3.2.0`. */
  url: string
  /** WebSocket subprotocol; the Photon JSON protocol uses 'Json' (pass it explicitly). */
  subprotocol: string
  logger: Logger
  /** Idle-ping interval in ms; values below 1000 disable keepalive (legacy parity). Default 3000. */
  keepAliveMs?: number
  /** Per-request response timeout in ms. Default 15_000. */
  operationTimeoutMs?: number
  /** Timeout for connect() — socket open THROUGH session handshake — in ms. Default 15_000. */
  connectTimeoutMs?: number
  /** WebSocket constructor override (test injection); defaults to `globalThis.WebSocket`. */
  webSocketImpl?: WebSocketConstructor
}

interface PendingRequest {
  resolve: (vals: Vals) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  /**
   * Set when the request timed out. The slot stays queued so a late response shifts (and discards) THIS
   * tombstone instead of settling the next request for the same op code — the protocol carries no request
   * id, so correlation is FIFO per op code and slots must be consumed in order.
   */
  tombstoned: boolean
}

type PeerPhase = 'created' | 'connecting' | 'open' | 'closed'

/**
 * One WebSocket connection to one Photon server (nameserver, master or game).
 *
 * The peer counts as connected only after the server's first session-id frame (a bare non-`~j~` string),
 * NOT when the socket opens — legacy parity. Operations are promise-correlated FIFO per op code: the
 * socket is ordered and the server answers each op code in order (the same invariant the legacy
 * single-listener model relied on). One peer serves one connection; it is not reusable after close.
 */
export class PhotonPeer {
  readonly name: ServerName
  readonly url: string

  /** Server-pushed event: `{ evt, vals }`. Assigned by the client after construction. */
  onEvent: ((code: number, vals: Vals) => void) | undefined
  /** Fires once, only for UNexpected closes — a close() we initiated never reports. */
  onClose: ((reason: DisconnectReason) => void) | undefined
  /** Fires when the session handshake completes (right after connect() resolves). */
  onSessionOpen: (() => void) | undefined

  private readonly subprotocol: string
  private readonly logger: Logger
  private readonly keepAliveMs: number
  private readonly operationTimeoutMs: number
  private readonly connectTimeoutMs: number
  private readonly webSocketImpl: WebSocketConstructor | undefined

  private socket: WebSocketLike | undefined
  private phase: PeerPhase = 'created'
  /** True once we initiated the close (close() or connect timeout) — suppresses onClose. */
  private closing = false
  private sessionId: string | undefined
  /** Never reset (legacy parity): ping payloads carry `Date.now() - initTimestamp` to avoid server-side overflow. */
  private readonly initTimestamp = Date.now()
  private lastRtt = 0
  private keepAliveTimer: ReturnType<typeof setTimeout> | undefined
  private connectTimer: ReturnType<typeof setTimeout> | undefined
  private connectResolve: (() => void) | undefined
  private connectReject: ((error: Error) => void) | undefined
  private lastSocketError: unknown
  /** FIFO request queues per op code. */
  private readonly pending = new Map<number, PendingRequest[]>()

  constructor(options: PhotonPeerOptions) {
    this.name = options.name
    this.url = options.url
    this.subprotocol = options.subprotocol
    this.logger = options.logger
    this.keepAliveMs = options.keepAliveMs ?? 3000
    this.operationTimeoutMs = options.operationTimeoutMs ?? 15_000
    this.connectTimeoutMs = options.connectTimeoutMs ?? 15_000
    this.webSocketImpl = options.webSocketImpl
  }

  /** Latest measured round-trip time in ms (0 until the first ping response). */
  get rtt(): number {
    return this.lastRtt
  }

  /** True while the session handshake is complete and the socket has not closed. */
  get isOpen(): boolean {
    return this.phase === 'open'
  }

  /**
   * Opens the socket. Resolves when the FIRST session-id frame arrives (not on socket open — legacy
   * parity). Rejects with PhotonConnectionError on close/error before that, or PhotonTimeoutError
   * after connectTimeoutMs.
   */
  connect(): Promise<void> {
    if (this.phase !== 'created') {
      return Promise.reject(new PhotonStateError(`${this.name} peer already used (phase: ${this.phase})`))
    }
    const Impl = this.webSocketImpl ?? globalThis.WebSocket
    return new Promise<void>((resolve, reject) => {
      this.phase = 'connecting'
      this.connectResolve = resolve
      this.connectReject = reject
      let socket: WebSocketLike
      try {
        socket = new Impl(this.url, this.subprotocol)
      } catch (error) {
        this.phase = 'closed'
        this.connectResolve = undefined
        this.connectReject = undefined
        reject(
          new PhotonConnectionError(`Failed to open ${this.name} socket to ${this.url}`, {
            server: this.name,
            address: this.url,
            cause: error,
          })
        )
        return
      }
      this.socket = socket
      socket.onopen = () => this.logger.debug('socket open, awaiting session frame')
      socket.onmessage = event => this.handleMessage(String(event.data))
      socket.onclose = event => this.handleSocketClose(event)
      socket.onerror = event => {
        this.lastSocketError = event
        this.logger.error('socket error', event)
      }
      this.connectTimer = setTimeout(() => {
        this.closing = true // we initiate this close — no onClose
        this.finalize(new PhotonTimeoutError(`${this.name} connect timed out after ${this.connectTimeoutMs}ms`))
        this.closeSocket()
      }, this.connectTimeoutMs)
    })
  }

  /**
   * Sends an operation and returns a promise correlated FIFO per op code. Resolves with the response
   * `vals` when the server `err` is 0/undefined; rejects with PhotonOperationError otherwise, with
   * PhotonTimeoutError after operationTimeoutMs (a late response is then discarded, not mis-correlated),
   * or with PhotonAbortError when the peer closes while the request is in flight.
   */
  request(code: number, params?: WireParams): Promise<Vals> {
    if (this.phase !== 'open') {
      return Promise.reject(new PhotonStateError(`Cannot send operation ${code}: ${this.name} peer is not connected`))
    }
    const frame = encodeOperation(code, params)
    return new Promise<Vals>((resolve, reject) => {
      try {
        this.sendFrame(frame)
      } catch (error) {
        reject(
          new PhotonConnectionError(`Failed to send operation ${code} on ${this.name} peer`, {
            server: this.name,
            address: this.url,
            cause: error,
          })
        )
        return
      }
      const slot: PendingRequest = {
        resolve,
        reject,
        tombstoned: false,
        timer: setTimeout(() => {
          slot.tombstoned = true
          reject(
            new PhotonTimeoutError(
              `Operation ${code} on ${this.name} timed out after ${this.operationTimeoutMs}ms`,
              code
            )
          )
        }, this.operationTimeoutMs),
      }
      const queue = this.pending.get(code)
      if (queue) queue.push(slot)
      else this.pending.set(code, [slot])
    })
  }

  /**
   * Fire-and-forget operation (RaiseEvent, ChangeGroups). A server error response has no slot to settle
   * and is only logged. @throws {PhotonStateError} when the peer is not connected.
   */
  send(code: number, params?: WireParams): void {
    if (this.phase !== 'open') {
      throw new PhotonStateError(`Cannot send operation ${code}: ${this.name} peer is not connected`)
    }
    this.sendFrame(encodeOperation(code, params))
  }

  /**
   * Closes the peer: sets the closing flag (so onClose never fires for a close we initiated), clears the
   * keepalive timer, rejects all pending requests with PhotonAbortError and closes the socket.
   * @param expected false marks the close as part of a failure teardown — logged louder, same behavior.
   */
  close(expected = true): void {
    if (this.phase === 'closed') return
    this.closing = true
    if (expected) this.logger.debug('closing')
    else this.logger.warn('closing (failure teardown)')
    this.finalize(new PhotonAbortError(`${this.name} peer closed`))
    this.closeSocket()
  }

  private handleMessage(data: string): void {
    if (this.phase === 'closed') return
    for (const frame of decodeFrames(data)) {
      let message: PhotonMessage
      try {
        message = classifyMessage(frame)
      } catch (error) {
        this.logger.error('dropping malformed frame:', error)
        continue
      }
      this.dispatchMessage(message)
    }
  }

  private dispatchMessage(message: PhotonMessage): void {
    switch (message.type) {
      case 'session':
        this.handleSession(message.id)
        break
      case 'response':
        this.handleResponse(message.code, message.errCode, message.errMsg, message.vals)
        break
      case 'event':
        this.onEvent?.(message.code, message.vals)
        break
      case 'pingResponse': {
        // { irs: 1, vals: [1, echoedElapsed, 2, serverTimeMs] } — rtt = elapsed now minus echoed elapsed.
        // Server-time sync (param 2) is deliberately dropped.
        const echoed = getParam<number>(message.vals, 1)
        if (typeof echoed === 'number') this.lastRtt = Date.now() - this.initTimestamp - echoed
        break
      }
      case 'unknown':
        this.logger.warn('received message of unknown type')
        break
    }
  }

  private handleSession(id: string): void {
    if (this.sessionId !== undefined) return // later non-~j~ frames are ignored (legacy parity)
    this.sessionId = id
    if (this.phase !== 'connecting') return
    this.phase = 'open'
    if (this.connectTimer !== undefined) {
      clearTimeout(this.connectTimer)
      this.connectTimer = undefined
    }
    const resolve = this.connectResolve
    this.connectResolve = undefined
    this.connectReject = undefined
    this.ping() // legacy pings immediately on connect: seeds rtt and arms the keepalive timer
    resolve?.()
    this.onSessionOpen?.()
  }

  private handleResponse(code: number, errCode: number | undefined, errMsg: string | undefined, vals: Vals): void {
    const queue = this.pending.get(code)
    const slot = queue?.shift()
    if (queue && queue.length === 0) this.pending.delete(code)
    if (!slot) {
      // fire-and-forget ops (RaiseEvent, ChangeGroups) land here — only worth noting on a server error
      if (errCode) this.logger.warn(`unhandled response for operation ${code}: error ${errCode} ${errMsg ?? ''}`)
      return
    }
    if (slot.tombstoned) {
      this.logger.debug(`discarding late response for timed-out operation ${code}`)
      return
    }
    clearTimeout(slot.timer)
    if (errCode !== undefined && errCode !== 0) {
      slot.reject(new PhotonOperationError(code, errCode, errMsg, vals))
    } else {
      slot.resolve(vals)
    }
  }

  private handleSocketClose(event: { code: number; reason: string; wasClean: boolean }): void {
    if (this.phase === 'closed') return // we already tore down (close()/connect timeout)
    const detail = `code ${event.code}${event.reason ? ` (${event.reason})` : ''}`
    if (this.phase !== 'open') {
      // closed before the session handshake: connect() rejection is the report, onClose stays silent
      this.finalize(
        new PhotonConnectionError(`${this.name} socket closed before session handshake: ${detail}`, {
          server: this.name,
          address: this.url,
          cause: this.lastSocketError,
        })
      )
      return
    }
    this.finalize(new PhotonAbortError(`${this.name} peer closed: ${detail}`), {
      server: this.name,
      kind: event.code === 1006 ? 'timeout' : 'remote', // 1006 = abnormal closure
      code: event.code,
      message: `${this.name} socket closed: ${detail}`,
    })
  }

  /**
   * Idempotent teardown shared by every close path: clears timers, rejects a still-pending connect()
   * with `connectError`, rejects all pending requests with PhotonAbortError, and fires onClose(reason)
   * only when the peer was open and the close was not initiated by us.
   */
  private finalize(connectError: Error, reason?: DisconnectReason): void {
    if (this.phase === 'closed') return
    const wasOpen = this.phase === 'open'
    this.phase = 'closed'
    if (this.keepAliveTimer !== undefined) {
      clearTimeout(this.keepAliveTimer)
      this.keepAliveTimer = undefined
    }
    if (this.connectTimer !== undefined) {
      clearTimeout(this.connectTimer)
      this.connectTimer = undefined
    }
    const rejectConnect = this.connectReject
    this.connectResolve = undefined
    this.connectReject = undefined
    rejectConnect?.(connectError)
    if (this.pending.size > 0) {
      const abort =
        connectError instanceof PhotonAbortError
          ? connectError
          : new PhotonAbortError(`${this.name} peer closed while operations were in flight`)
      for (const queue of this.pending.values()) {
        for (const slot of queue) {
          clearTimeout(slot.timer)
          if (!slot.tombstoned) slot.reject(abort)
        }
      }
      this.pending.clear()
    }
    if (wasOpen && !this.closing && reason) this.onClose?.(reason)
  }

  private closeSocket(): void {
    const socket = this.socket
    if (!socket) return
    try {
      socket.close()
    } catch (error) {
      this.logger.debug('socket close threw', error)
    }
  }

  private sendFrame(frame: string): void {
    this.socket!.send(frame)
    this.resetKeepAlive() // every successful send postpones the idle ping (legacy parity)
  }

  private ping(): void {
    if (this.phase !== 'open') return
    try {
      this.sendFrame(encodePing(Date.now() - this.initTimestamp))
    } catch (error) {
      this.logger.warn('keepalive ping failed', error)
    }
  }

  private resetKeepAlive(): void {
    if (this.keepAliveTimer !== undefined) clearTimeout(this.keepAliveTimer)
    if (this.keepAliveMs < 1000) return // legacy parity: values below 1000 disable keepalive
    this.keepAliveTimer = setTimeout(() => this.ping(), this.keepAliveMs)
  }
}
