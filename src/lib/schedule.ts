// Pure schedule definitions and occurrence math. This module is imported by the Drizzle
// schema, so it must stay free of side effects (fs reads, top-level await) for drizzle-kit
// to be able to bundle it.

export enum Day {
  SATURDAY = 'Saturday',
  SUNDAY = 'Sunday',
}

export type DayKey = keyof typeof Day

/**
 * The very first session — Sunday 12 January 2025 at 22:00 Europe/Paris.
 * It anchors the fortnightly alternation: one session every two weeks,
 * alternating between Sunday and Saturday.
 */
export const firstEvent = {
  year: 2025,
  month: 0,
  day: 12,
  weekday: 'SUNDAY',
} as const satisfies { year: number; month: number; day: number; weekday: DayKey }

export const eventSchedule = {
  timeZone: 'Europe/Paris',
  hour: 22,
  durationMs: 2 * 60 * 60 * 1000,
} as const

// The anchor weekday repeats every 28 days; the alternate weekday sits in the weekend two
// weeks after the anchor's, i.e. 13 days later when the anchor is a Sunday, 15 when it is
// a Saturday. Gaps therefore alternate 13/15 days, averaging one session every two weeks.
const PERIOD_DAYS = 28
const ALTERNATE_OFFSET_DAYS = firstEvent.weekday === 'SUNDAY' ? 13 : 15
const ALTERNATE_WEEKDAY: DayKey = firstEvent.weekday === 'SUNDAY' ? 'SATURDAY' : 'SUNDAY'

export interface Occurrence {
  day: DayKey
  startsAt: Date
  endsAt: Date
}

const wallClockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: eventSchedule.timeZone,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

// Resolve "hour o'clock on this calendar day in the schedule's timezone" to a UTC instant.
// Start from the wall-clock time read as UTC, then correct by the offset Intl reports;
// iterating twice keeps it exact across DST boundaries.
const wallClockToUTC = (year: number, month: number, day: number, hour: number) => {
  const target = Date.UTC(year, month, day, hour)
  let timestamp = target

  for (let i = 0; i < 2; i++) {
    const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
    for (const part of wallClockFormatter.formatToParts(timestamp)) parts[part.type] = part.value

    const wall = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!)
    timestamp += target - wall
  }

  return new Date(timestamp)
}

export const occurrence = (n: number): Occurrence => {
  const offsetDays = PERIOD_DAYS * Math.floor(n / 2) + (n % 2 === 1 ? ALTERNATE_OFFSET_DAYS : 0)
  const startsAt = wallClockToUTC(firstEvent.year, firstEvent.month, firstEvent.day + offsetDays, eventSchedule.hour)

  return {
    day: n % 2 === 1 ? ALTERNATE_WEEKDAY : firstEvent.weekday,
    startsAt,
    endsAt: new Date(startsAt.getTime() + eventSchedule.durationMs),
  }
}

/** Every occurrence from the first event whose start has passed `now`, plus the next upcoming one. */
export const occurrencesUpTo = (now: Date) => {
  const past: Occurrence[] = []

  for (let n = 0; ; n++) {
    const current = occurrence(n)
    if (current.startsAt > now) return { past, next: current }

    past.push(current)
  }
}
