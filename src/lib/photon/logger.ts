/**
  Log levels, from silent to most verbose.
*/
export enum LogLevel {
  OFF,
  ERROR,
  WARN,
  INFO,
  DEBUG,
}

const consoleMethods = {
  [LogLevel.ERROR]: console.error,
  [LogLevel.WARN]: console.warn,
  [LogLevel.INFO]: console.info,
  [LogLevel.DEBUG]: console.debug,
} as const

/**
  Prints prefixed messages to the console.
  Arguments are only formatted once the logging level check passed, so calls
  below the current level are cheap.
*/
export class Logger {
  #prefix: string
  #level: LogLevel

  constructor(prefix = '', level: LogLevel = LogLevel.INFO) {
    this.#prefix = prefix
    this.#level = level
  }

  get prefix(): string {
    return this.#prefix
  }

  set prefix(prefix: string) {
    this.#prefix = prefix
  }

  get level(): LogLevel {
    return this.#level
  }

  set level(level: LogLevel) {
    this.#level = Math.min(Math.max(level, LogLevel.OFF), LogLevel.DEBUG)
  }

  isLevelEnabled(level: LogLevel): boolean {
    return level <= this.#level
  }

  /** Creates a new logger sharing this logger's level, with an extended prefix. */
  child(suffix: string): Logger {
    return new Logger(this.#prefix ? `${this.#prefix} ${suffix}` : suffix, this.#level)
  }

  debug(message: string, ...params: unknown[]): void {
    this.#log(LogLevel.DEBUG, message, params)
  }

  info(message: string, ...params: unknown[]): void {
    this.#log(LogLevel.INFO, message, params)
  }

  warn(message: string, ...params: unknown[]): void {
    this.#log(LogLevel.WARN, message, params)
  }

  error(message: string, ...params: unknown[]): void {
    this.#log(LogLevel.ERROR, message, params)
  }

  /** Formats a message the same way log output is formatted. */
  format(message: string, ...params: unknown[]): string {
    const formatted = params
      .filter(param => param !== undefined)
      .map(param => {
        if (typeof param === 'object' && param !== null) {
          try {
            return JSON.stringify(param)
          } catch (error) {
            return `${String(param)}(${error})`
          }
        }

        return String(param)
      })
      .join(' ')

    const prefix = this.#prefix ? `${this.#prefix} ` : ''
    return `${prefix}${message}${formatted ? ` ${formatted}` : ''}`
  }

  #log(level: LogLevel, message: string, params: unknown[]): void {
    if (level > this.#level || level === LogLevel.OFF) return

    const method = consoleMethods[level as keyof typeof consoleMethods]
    if (this.#prefix) method(this.#prefix, message, ...params)
    else method(message, ...params)
  }
}
