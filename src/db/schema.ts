import { objectKeys } from '@sapphire/utilities'
import { sql } from 'drizzle-orm'
import { bytea, date, pgEnum, pgTable, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'

import { Day } from '$lib/schedule'

export const configs = pgTable('configs', {
  id: uuid().primaryKey().defaultRandom(),

  guildId: varchar({ length: 20 }).unique().notNull(),
  name: varchar({ length: 20 }).notNull(),
  description: varchar({ length: 500 }).notNull(),
  location: varchar({ length: 30 }).notNull(),
  banner: bytea('banner'),

  createdAt: date().defaultNow(),
  updatedAt: date()
    .defaultNow()
    .$onUpdate(() => sql`NOW()`),
})

export const dayEnum = pgEnum('day', objectKeys(Day) as [keyof typeof Day, ...Array<keyof typeof Day>])

export const events = pgTable(
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
