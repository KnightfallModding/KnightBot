/** Log levels. Numeric so levels compare with `<=`: a level is enabled when it is at most the logger's level. */
export enum LogLevel {
  /** Logging off. */
  OFF,
  ERROR,
  WARN,
  INFO,
  /** All logging is enabled. */
  DEBUG,
}

/**
 * Prints messages to the console, prefixed and filtered by level.
 * Each logging method formats its arguments only after checking the logging level, so calls with plain
 * arguments on a disabled level are cheap. For expensive argument computation, guard with
 * `if (logger.isLevelEnabled(LogLevel.DEBUG)) { ... }` first.
 */
export class Logger {
  private prefix: string
  private level: LogLevel

  /**
   * @param prefix All log messages will be prefixed with this.
   * @param level Initial logging level.
   */
  constructor(prefix: string = '', level: LogLevel = LogLevel.INFO) {
    this.prefix = prefix
    this.level = level
  }

  /** Sets the logger prefix. */
  setPrefix(prefix: string) {
    this.prefix = prefix
  }

  /** Gets the logger prefix. */
  getPrefix(): string {
    return this.prefix
  }

  /** Changes the current logging level. */
  setLevel(level: LogLevel) {
    this.level = level
  }

  /** Returns the current logging level. */
  getLevel(): LogLevel {
    return this.level
  }

  /** Checks whether a logging level is active. */
  isLevelEnabled(level: LogLevel): boolean {
    return level <= this.level
  }

  /** Creates a new Logger whose prefix is this logger's prefix extended with `suffix`, at the same level. */
  child(suffix: string): Logger {
    return new Logger(this.prefix ? `${this.prefix} ${suffix}` : suffix, this.level)
  }

  private format0(message: string, ...optionalParams: unknown[]) {
    const prefix = this.prefix ? `${this.prefix} ` : ''
    const params = optionalParams
      .filter(x => x !== undefined)
      .map(x => {
        if (typeof x === 'object' && x !== null) {
          try {
            return JSON.stringify(x)
          } catch (error) {
            return `${x.toString()}(${error})`
          }
        }
        return x?.toString() ?? ''
      })
      .join(' ')

    return `${prefix}${message} ${params}`.trim()
  }

  /**
   * Applies default logger formatting (prefix, space-joined stringified params) to the arguments.
   * @param message String to start formatting with.
   * @param optionalParams Each additional parameter is stringified and appended after a space.
   */
  format(message: string, ...optionalParams: unknown[]): string {
    return this.format0(message, ...optionalParams)
  }

  private log(level: LogLevel, message: string, ...optionalParams: unknown[]) {
    if (level > this.level) return

    const args: unknown[] = this.prefix ? [this.prefix, message, ...optionalParams] : [message, ...optionalParams]

    switch (level) {
      case LogLevel.OFF:
        break
      case LogLevel.ERROR:
        console.error(...args)
        break
      case LogLevel.WARN:
        console.warn(...args)
        break
      case LogLevel.INFO:
        console.info(...args)
        break
      case LogLevel.DEBUG:
        console.debug(...args)
        break
    }
  }

  /** Logs when the level is DEBUG. */
  debug(message: string, ...optionalParams: unknown[]) {
    this.log(LogLevel.DEBUG, message, ...optionalParams)
  }

  /** Logs when the level is DEBUG or INFO. */
  info(message: string, ...optionalParams: unknown[]) {
    this.log(LogLevel.INFO, message, ...optionalParams)
  }

  /** Logs when the level is DEBUG, INFO or WARN. */
  warn(message: string, ...optionalParams: unknown[]) {
    this.log(LogLevel.WARN, message, ...optionalParams)
  }

  /** Logs when the level is DEBUG, INFO, WARN or ERROR. */
  error(message: string, ...optionalParams: unknown[]) {
    this.log(LogLevel.ERROR, message, ...optionalParams)
  }
}
