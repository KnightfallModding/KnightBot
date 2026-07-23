import { objectKeys } from '@sapphire/utilities'
import { sql } from 'drizzle-orm'
import { boolean, bytea, date, pgEnum, snakeCase, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'

import { eventTemplate } from '$lib/constants'
import { Day } from '$lib/schedule'

const defaultSchema = {
  id: uuid().primaryKey().defaultRandom(),

  createdAt: date().defaultNow(),
  updatedAt: date()
    .defaultNow()
    .$onUpdate(() => sql`NOW()`),
}

export const configs = snakeCase.table('configs', {
  ...defaultSchema,

  guildId: varchar({ length: 20 }).unique().notNull(),
  name: varchar({ length: 20 }).notNull().default(eventTemplate.name),
  description: varchar({ length: 500 }).notNull().default(eventTemplate.description),
  location: varchar({ length: 30 }).notNull().default(eventTemplate.location),
  banner: bytea('banner').notNull().default(eventTemplate.banner),
  reminder: varchar({ length: 2000 }).notNull().default(eventTemplate.reminder),
})

export const dayEnum = pgEnum('day', objectKeys(Day) as [keyof typeof Day, ...Array<keyof typeof Day>])

export const events = snakeCase.table(
  'events',
  {
    ...defaultSchema,

    guildId: varchar({ length: 20 })
      .notNull()
      .references(() => configs.guildId, { onDelete: 'cascade' }),
    /** The event ID in Discord. If `null`, it means the event happened when bot was down */
    eventId: varchar({ length: 20 }),
    day: dayEnum().notNull(),
    startsAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
  },
  table => [unique().on(table.guildId, table.startsAt)]
)

export const keywords = snakeCase.table(
  'keywords',
  {
    ...defaultSchema,

    configId: uuid()
      .notNull()
      .references(() => configs.id, { onDelete: 'cascade' }),
    content: varchar({ length: 200 }).notNull(),
    strict: boolean('strict').notNull().default(false),
    regex: boolean('regex').notNull().default(false),
  },
  table => [unique().on(table.configId, table.content)]
)
