// Pure encode/decode functions for the Photon JSON-over-WebSocket wire format (SDK 4.3.2.0).
// Frames: `~m~<length>~m~<payload>`; JSON payloads are prefixed `~j~`. `length` counts UTF-16 code
// units of the payload (including the `~j~` prefix) — consistent on both ends because WebSocket text
// frames are delivered as JS strings.

import { PhotonError } from './errors'
import type { Vals, WireParams } from './types'

/** A classified server→client message. Field priority on the wire: `res` → `evt` → `irs`. */
export type PhotonMessage =
  /** A non-`~j~` frame: the session id. The first one is the "connected" signal; later ones are ignored. */
  | { type: 'session'; id: string }
  /** Operation response `{ res, err?, msg?, vals }`. `errCode` is the raw `err` field — undefined when omitted. */
  | { type: 'response'; code: number; errCode: number | undefined; errMsg: string | undefined; vals: Vals }
  /** Server-pushed event `{ evt, vals }` — events carry no err/msg. */
  | { type: 'event'; code: number; vals: Vals }
  /** Internal ping reply `{ irs: 1, vals: [1, echoedElapsed, 2, serverTimeMs] }` — never surfaces to consumers. */
  | { type: 'pingResponse'; vals: Vals }
  /** A `~j~` payload that parsed to a non-object or an object with none of res/evt/irs. */
  | { type: 'unknown' }

/** Wraps a payload string in one `~m~<length>~m~<payload>` frame. */
export function encodeFrame(payload: string): string {
  return `~m~${payload.length}~m~${payload}`
}

/**
 * Encodes an operation request frame: `{ req: <code>, vals: [k1, v1, k2, v2, ...] }` as `~m~len~m~~j~{json}`.
 * `vals` is the FLAT pair array the server expects — parameter codes stay numeric via `Number(key)`.
 * Entries whose value is `undefined` are skipped (so optional parameters can be passed unconditionally).
 */
export function encodeOperation(code: number, params?: WireParams): string {
  const vals: unknown[] = []
  if (params) {
    for (const key of Object.keys(params)) {
      const value = params[Number(key)]
      if (value !== undefined) vals.push(Number(key), value)
    }
  }
  return encodeFrame(`~j~${JSON.stringify({ req: code, vals })}`)
}

/** Encodes the keepalive ping request `{ irq: 1, vals: [1, <ms since peer construction>] }`. */
export function encodePing(elapsedMs: number): string {
  return encodeFrame(`~j~${JSON.stringify({ irq: 1, vals: [1, elapsedMs] })}`)
}

/**
 * Extracts ALL `~m~<length>~m~<payload>` frames from a raw WebSocket message.
 * NUL characters are stripped first; anything that does not start a well-formed frame header is
 * tolerated as trailing garbage (parsing stops there). The legacy SDK joined multiple frames with
 * commas (`decoded.toString()`) — a latent corruption bug; callers must iterate this array instead.
 */
export function decodeFrames(raw: string): string[] {
  const frames: string[] = []
  let data = raw.includes('\0') ? raw.replace(/\0/g, '') : raw
  while (data !== '') {
    const header = /^~m~(\d+)~m~/.exec(data)
    if (!header) break
    const length = Number(header[1])
    const start = header[0].length
    frames.push(data.slice(start, start + length))
    data = data.slice(start + length)
  }
  return frames
}

interface RawEnvelope {
  res?: unknown
  evt?: unknown
  irs?: unknown
  err?: unknown
  msg?: unknown
  vals?: unknown
}

/**
 * Classifies one decoded frame. Non-`~j~` frames are session ids; `~j~` frames are JSON envelopes
 * dispatched by field priority `res` → `evt` → `irs` (legacy parity). Flat `vals` pair arrays are
 * converted to objects keyed by STRINGIFIED parameter codes.
 * @throws {SyntaxError} when a `~j~` payload is not valid JSON (legacy threw uncaught in onmessage).
 * @throws {PhotonError} when `vals` is present but not an even-length array (protocol error).
 */
export function classifyMessage(frame: string): PhotonMessage {
  if (!frame.startsWith('~j~')) return { type: 'session', id: frame }
  const parsed: unknown = JSON.parse(frame.slice(3))
  if (typeof parsed !== 'object' || parsed === null) return { type: 'unknown' }
  const raw = parsed as RawEnvelope
  if (raw.res !== undefined) {
    return {
      type: 'response',
      code: Number(raw.res),
      errCode: raw.err === undefined ? undefined : Number(raw.err),
      errMsg: raw.msg === undefined ? undefined : String(raw.msg),
      vals: valsToObject(raw.vals),
    }
  }
  if (raw.evt !== undefined) return { type: 'event', code: Number(raw.evt), vals: valsToObject(raw.vals) }
  if (raw.irs !== undefined) return { type: 'pingResponse', vals: valsToObject(raw.vals) }
  return { type: 'unknown' }
}

/** Reads a response/event parameter: `vals` objects are keyed by stringified parameter codes. */
export function getParam<T>(vals: Vals, code: number): T | undefined {
  return vals[String(code)] as T | undefined
}

function valsToObject(raw: unknown): Vals {
  if (raw === undefined) return {}
  if (!Array.isArray(raw)) throw new PhotonError('Protocol error: vals is not an array')
  if (raw.length % 2 !== 0) throw new PhotonError(`Protocol error: odd-length vals array (${raw.length} items)`)
  const vals: Vals = {}
  for (let i = 0; i < raw.length; i += 2) {
    vals[String(raw[i])] = raw[i + 1]
  }
  return vals
}
