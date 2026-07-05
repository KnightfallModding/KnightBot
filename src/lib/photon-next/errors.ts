import { ErrorCode } from './constants'
import type { ServerName, Vals } from './types'

const errorCodeNames = new Map<number, string>(Object.entries(ErrorCode).map(([name, code]) => [code, name] as const))

/** Friendly name for a well-known server error code (wire `err`), e.g. 32758 → 'GameDoesNotExist'. */
export function errorCodeName(code: number): string | undefined {
  return errorCodeNames.get(code)
}

/** Base class of every error thrown by photon-next. */
export class PhotonError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PhotonError'
  }
}

/** An operation is not allowed in the client's current state. */
export class PhotonStateError extends PhotonError {
  constructor(message: string) {
    super(message)
    this.name = 'PhotonStateError'
  }
}

/** Socket-level failure: the connection could not be opened or closed unexpectedly. */
export class PhotonConnectionError extends PhotonError {
  /** Which server's connection failed. */
  readonly server: ServerName
  /** The address the connection was made to. */
  readonly address: string

  constructor(message: string, info: { server: ServerName; address: string; cause?: unknown }) {
    super(message, info.cause === undefined ? undefined : { cause: info.cause })
    this.name = 'PhotonConnectionError'
    this.server = info.server
    this.address = info.address
  }
}

/** A connect attempt or a pending operation exceeded its timeout. */
export class PhotonTimeoutError extends PhotonError {
  /** Operation code (wire `req`) of the request that timed out; undefined for connect timeouts. */
  readonly operation?: number

  constructor(message: string, operation?: number) {
    super(message)
    this.name = 'PhotonTimeoutError'
    this.operation = operation
  }
}

/** The client was disconnected or destroyed while the operation was in flight. */
export class PhotonAbortError extends PhotonError {
  constructor(message: string) {
    super(message)
    this.name = 'PhotonAbortError'
  }
}

/** The server answered an operation with a non-zero error code (wire `err`). */
export class PhotonOperationError extends PhotonError {
  /** Operation code (wire `req`/`res`) of the failed operation. */
  readonly operation: number
  /** Server error code (wire `err`) — see ErrorCode for well-known values. */
  readonly errorCode: number
  /** Server debug message (wire `msg`), when provided. */
  readonly serverMessage?: string
  /** Response parameters keyed by stringified parameter code. */
  readonly vals: Vals

  constructor(operation: number, errorCode: number, serverMessage: string | undefined, vals: Vals) {
    const friendly = errorCodeName(errorCode)
    super(
      `Operation ${operation} failed with error ${errorCode}${friendly ? ` (${friendly})` : ''}${
        serverMessage ? `: ${serverMessage}` : ''
      }`
    )
    this.name = 'PhotonOperationError'
    this.operation = operation
    this.errorCode = errorCode
    this.serverMessage = serverMessage
    this.vals = vals
  }
}
