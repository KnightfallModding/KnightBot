import { defineRelations } from 'drizzle-orm'

import { configs, events, honeypotIgnores, honeypotVictims, keywords } from './schema'

const schema = { configs, keywords, honeypotsVictims: honeypotVictims, honeypotIgnores, events }

export const relations = defineRelations(schema, r => {
  return {
    configs: {
      honeypotsVictims: r.many.honeypotsVictims(),
      honeypotIgnores: r.many.honeypotIgnores(),
    },
    honeypotsVictims: {
      configs: r.one.configs({
        from: r.honeypotsVictims.configId,
        to: r.configs.id,
      }),
    },
    honeypotIgnores: {
      configs: r.one.configs({
        from: r.honeypotIgnores.configId,
        to: r.configs.id,
      }),
    },
  }
})
