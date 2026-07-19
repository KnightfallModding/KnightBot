import { defineRelations } from 'drizzle-orm'

import { configs } from './schema'

export const relations = defineRelations({ configs })
