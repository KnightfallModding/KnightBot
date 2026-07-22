import { join } from 'path'

import { envParseString, setup } from '@skyra/env-utilities'
import { defineConfig } from 'drizzle-kit'

declare module '@skyra/env-utilities' {
  interface Env {
    DATABASE_PASSWORD: string
    DATABASE_URL: string
  }
}

setup(join(__dirname, '.env'))

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: envParseString('DATABASE_URL') },
})
