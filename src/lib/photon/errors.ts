import type { OperationCode, PeerErrorCode } from './constants'

/** Connection-level failure (peer error, timeout, closed connection, failed authentication). */
export class PhotonError extends Error {
  override readonly name = 'PhotonError'
  readonly code: PeerErrorCode

  constructor(code: PeerErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** An operation was answered by the server with an error code. */
export class PhotonOperationError extends Error {
  override readonly name = 'PhotonOperationError'
  /** Server error code, see {@link ErrorCode}. */
  readonly errorCode: number
  /** Operation this error answers to. */
  readonly operationCode: OperationCode

  constructor(operationCode: OperationCode, errorCode: number, message: string) {
    super(message || `Operation ${operationCode} failed with error ${errorCode}`)
    this.errorCode = errorCode
    this.operationCode = operationCode
  }
}
