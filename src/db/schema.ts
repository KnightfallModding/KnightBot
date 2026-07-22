import { objectKeys } from '@sapphire/utilities'
import { sql } from 'drizzle-orm'
import { boolean, bytea, date, pgEnum, snakeCase, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'

import { eventTemplate } from '$lib/constants'
import { Day } from '$lib/schedule'

export const configs = snakeCase.table('configs', {
  id: uuid().primaryKey().defaultRandom(),

  guildId: varchar({ length: 20 }).unique().notNull(),
  name: varchar({ length: 20 }).notNull().default(eventTemplate.name),
  description: varchar({ length: 500 }).notNull().default(eventTemplate.description),
  location: varchar({ length: 30 }).notNull().default(eventTemplate.location),
  banner: bytea('banner').notNull().default(eventTemplate.banner),
  reminder: varchar({ length: 2000 }).notNull().default(eventTemplate.reminder),

  createdAt: date().defaultNow(),
  updatedAt: date()
    .defaultNow()
    .$onUpdate(() => sql`NOW()`),
})

export const dayEnum = pgEnum('day', objectKeys(Day) as [keyof typeof Day, ...Array<keyof typeof Day>])

export const events = snakeCase.table(
  'events',
  {
    id: uuid().primaryKey().defaultRandom(),

    guildId: varchar({ length: 20 })
      .notNull()
      .references(() => configs.guildId, { onDelete: 'cascade' }),
    /** The event ID in Discord. If `null`, it means the event happened when bot was down */
    eventId: varchar({ length: 20 }),
    day: dayEnum().notNull(),
    startsAt: timestamp({ withTimezone: true, mode: 'date' }).notNull(),

    createdAt: date().defaultNow(),
    updatedAt: date()
      .defaultNow()
      .$onUpdate(() => sql`NOW()`),
  },
  table => [unique().on(table.guildId, table.startsAt)]
)

export const keywords = snakeCase.table(
  'keywords',
  {
    id: uuid().primaryKey().defaultRandom(),

    configId: uuid()
      .notNull()
      .references(() => configs.id, { onDelete: 'cascade' }),
    content: varchar({ length: 200 }).notNull(),
    strict: boolean('strict').notNull().default(false),
    regex: boolean('regex').notNull().default(false),

    createdAt: date().defaultNow(),
    updatedAt: date()
      .defaultNow()
      .$onUpdate(() => sql`NOW()`),
  },
  table => [unique().on(table.configId, table.content)]
)
