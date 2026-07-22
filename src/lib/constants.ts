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
  reminder: `Click "${bold('Interested')}" to receive a notification when the next event start!

[Event link]({{event}})`,
} as const

/** Filesize is maximum 10 MB */
export const bannerMaxFilesize = 10485760

export const keywordActions = ['add', 'edit', 'remove'] as const
export type KeywordAction = (typeof keywordActions)[number]
