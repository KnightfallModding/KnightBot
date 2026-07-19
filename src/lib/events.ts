import { container } from '@sapphire/framework'
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  type Guild,
  type GuildScheduledEvent,
} from 'discord.js'
import { and, eq } from 'drizzle-orm'

import { eventTemplate } from '$lib/constants'
import { occurrencesUpTo, type Occurrence } from '$lib/schedule'
import { db } from 'db/client'
import { configs, events } from 'db/schema'

let timer: NodeJS.Timeout | undefined

/**
 * Synchronizes the events between the database and Discord by:
 * - inserting a row for every occurrence whose time has passed (missed during downtime)
 * - adopting Discord scheduled events that match an occurrence into their rows
 * - creating the next upcoming session on Discord when it is missing there
 *
 * Re-runs itself right after the next session starts, so the following one gets scheduled without a reboot.
 */
export const syncEvents = async () => {
  const { logger } = container
  const now = new Date()
  const { past, next } = occurrencesUpTo(now)

  const guildConfigs = await db.query.configs.findMany()

  for (const config of guildConfigs) {
    try {
      await syncGuild(config, [...past, next])
    } catch (error) {
      logger.error(`Failed to sync events for guild ${config.guildId}`, error)
    }
  }

  scheduleNextSync(next)
}

const syncGuild = async (config: typeof configs.$inferSelect, occurrences: Occurrence[]) => {
  const guild = await container.client.guilds.fetch(config.guildId)
  const scheduled = await guild.scheduledEvents.fetch()

  // A scheduled event starting exactly at an occurrence's time is that occurrence's event
  const discordByTime = new Map<number, GuildScheduledEvent>()
  for (const event of scheduled.values()) {
    if (event.scheduledStartTimestamp !== null) discordByTime.set(event.scheduledStartTimestamp, event)
  }

  const rows = await db.query.events.findMany({ where: { guildId: config.guildId } })
  const rowByTime = new Map(rows.map(row => [row.startsAt.getTime(), row]))

  // Backfill a row for every occurrence that is missing one, adopting a matching Discord
  // event's id when there is one
  const missing = occurrences
    .filter(occurrence => !rowByTime.has(occurrence.startsAt.getTime()))
    .map(occurrence => ({
      guildId: config.guildId,
      day: occurrence.day,
      startsAt: occurrence.startsAt,
      eventId: discordByTime.get(occurrence.startsAt.getTime())?.id ?? null,
    }))
  if (missing.length > 0) {
    await db.insert(events).values(missing).onConflictDoNothing()
    container.logger.info(`Backfilled ${missing.length} event(s) for guild ${config.guildId}`)
  }

  // Adopt Discord events into rows that lost (or never had) their id
  for (const row of rows) {
    const match = discordByTime.get(row.startsAt.getTime())
    if (match && row.eventId !== match.id) {
      await db.update(events).set({ eventId: match.id }).where(eq(events.id, row.id))
    }
  }

  // The next session must exist on Discord: create it unless a matching event is already
  // there, or the row's known event still exists
  const next = occurrences.at(-1)!
  const nextRow = rowByTime.get(next.startsAt.getTime())
  const exists =
    discordByTime.has(next.startsAt.getTime()) || (nextRow?.eventId != null && scheduled.has(nextRow.eventId))
  if (exists) return

  const created = await createDiscordEvent(guild, config, next)
  await db
    .update(events)
    .set({ eventId: created.id })
    .where(and(eq(events.guildId, config.guildId), eq(events.startsAt, next.startsAt)))
  container.logger.info(
    `Scheduled "${created.name}" (${created.id}) in guild ${config.guildId} for ${next.startsAt.toISOString()}`
  )
}

const createDiscordEvent = (guild: Guild, config: typeof configs.$inferSelect, occurrence: Occurrence) => {
  return guild.scheduledEvents.create({
    name: config.name,
    description: config.description,
    scheduledStartTime: occurrence.startsAt,
    scheduledEndTime: occurrence.endsAt,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: GuildScheduledEventEntityType.External,
    entityMetadata: { location: config.location },
    image: config.banner ?? eventTemplate.banner,
  })
}

const scheduleNextSync = (next: Occurrence) => {
  clearTimeout(timer)

  // Shortly after the next session starts it counts as past, so re-syncing then schedules
  // the one after it. Gaps are at most 15 days, well within setTimeout's ~24-day limit.
  const delay = next.startsAt.getTime() - Date.now() + 60_000
  timer = setTimeout(() => {
    syncEvents().catch(error => container.logger.error('Scheduled event sync failed', error))
  }, delay)
}
