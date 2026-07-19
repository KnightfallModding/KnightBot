import { sql } from 'drizzle-orm'
import { bytea, date, pgTable, uuid, varchar } from 'drizzle-orm/pg-core'

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
