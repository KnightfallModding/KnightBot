import { envParseString } from '@skyra/env-utilities'
import { drizzle } from 'drizzle-orm/node-postgres'

import { relations } from './relations'

export const db = drizzle(envParseString('DATABASE_URL'), { relations })
