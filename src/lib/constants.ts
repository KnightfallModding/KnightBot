import { readFile } from 'fs/promises'
import { join } from 'path'

import { envParseString } from '@skyra/env-utilities'
import { bold } from 'discord.js'

export const rootDir = join(import.meta.dirname, '..', '..')
export const srcDir = join(rootDir, 'src')

export const dev = envParseString('NODE_ENV', 'development') !== 'production'

export const eventTemplate = {
  name: 'Bi-Weekly Session',
  description: `Come play with us for the bi-weekly event!

Remember to change region to ${bold('North America')}!
`,
  location: 'Knightfall: A Daring Journey',
  banner: await readFile(join(rootDir, 'assets', 'banner.jpg')),
} as const
