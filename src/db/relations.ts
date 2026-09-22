import { defineRelations } from 'drizzle-orm'

import { configs, events, honeypotIgnores, honeypotVictims, keywords } from './schema'

const schema = { configs, keywords, honeypotsVictims: honeypotVictims, honeypotIgnores, events }

export const relations = defineRelations(schema, ({ one, many }) => {
  return {
    configs: {
      honeypotsVictims: many.honeypotsVictims(),
      honeypotIgnores: many.honeypotIgnores(),
    },
    honeypotsVictims: {
      configs: one.configs(),
    },
  }
})
