import { defineRelations } from 'drizzle-orm'

import { configs, events, keywords } from './schema'

export const relations = defineRelations({ configs, events, keywords })
