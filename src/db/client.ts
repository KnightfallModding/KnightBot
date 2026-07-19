import { envParseString } from '@skyra/env-utilities'
import { drizzle } from 'drizzle-orm/node-postgres'

import { relations } from './relations'

export const db = await drizzle(envParseString('DATABASE_URL'), {
  casing: 'snake_case',
  relations,
})
