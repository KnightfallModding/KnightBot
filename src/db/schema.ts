import { sql } from 'drizzle-orm'
import { boolean, bytea, pgEnum, snakeCase, timestamp, unique, uuid, varchar } from 'drizzle-orm/pg-core'

import { eventTemplate, HoneypotIgnoreType, HoneypotMode } from '$lib/constants'
import { Day } from '$lib/schedule'
import { enumKeys } from '$lib/utils'

const snowflakeVarchar = () => varchar({ length: 20 })

const defaultSchema = {
  id: uuid().primaryKey().defaultRandom(),

  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => sql`NOW()`),
}

export const honeypotModeEnum = pgEnum('mode', enumKeys(HoneypotMode))

export const configs = snakeCase.table('configs', {
  ...defaultSchema,

  guildId: snowflakeVarchar().unique().notNull(),
  name: varchar({ length: 100 }).notNull().default(eventTemplate.name),
  description: varchar({ length: 1000 }).notNull().default(eventTemplate.description),
  location: varchar({ length: 100 }).notNull().default(eventTemplate.location),
  banner: bytea().notNull().default(eventTemplate.banner),
  reminder: varchar({ length: 2000 }).notNull().default(eventTemplate.reminder),

  honeypotChannelId: varchar({ length: 20 }),
  honeypotMode: honeypotModeEnum(),
})

export const dayEnum = pgEnum('day', enumKeys(Day))

export const events = snakeCase.table(
  'events',
  {
    ...defaultSchema,

    guildId: snowflakeVarchar()
      .notNull()
      .references(() => configs.guildId, { onDelete: 'cascade' }),
    /** The event ID in Discord. If `null`, it means the event happened when bot was down */
    eventId: snowflakeVarchar(),
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
    strict: boolean().notNull().default(false),
    regex: boolean().notNull().default(false),
  },
  table => [unique().on(table.configId, table.content)]
)

export const honeypotVictims = snakeCase.table(
  'honeypotsVictims',
  {
    ...defaultSchema,

    configId: uuid()
      .notNull()
      .references(() => configs.id, { onDelete: 'cascade' }),
    userId: snowflakeVarchar().notNull(),
    mode: honeypotModeEnum().notNull(),
  },
  table => [unique().on(table.configId, table.userId)]
)

export const ignoreTypeEnum = pgEnum('ignoreType', enumKeys(HoneypotIgnoreType))

export const honeypotIgnores = snakeCase.table(
  'honeypotIgnores',
  {
    ...defaultSchema,

    configId: uuid()
      .notNull()
      .references(() => configs.id, { onDelete: 'cascade' }),
    type: ignoreTypeEnum().notNull(),
    ignoredId: snowflakeVarchar().notNull(),
  },
  table => [unique().on(table.configId, table.type, table.ignoredId)]
)
