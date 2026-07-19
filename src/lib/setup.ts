// Unless explicitly defined, set NODE_ENV as development:
process.env.NODE_ENV ??= 'development'

import { join } from 'path'
import { inspect } from 'util'

import { ApplicationCommandRegistries, RegisterBehavior } from '@sapphire/framework'
import '@sapphire/plugin-editable-commands/register'
import '@sapphire/plugin-logger/register'
import '@sapphire/plugin-subcommands/register'
import { setup, type ArrayString, type NumberString } from '@skyra/env-utilities'
import * as colorette from 'colorette'
import { Snowflake } from 'discord.js'

import { rootDir } from './constants'

// Set default behavior to bulk overwrite
ApplicationCommandRegistries.setDefaultBehaviorWhenNotIdentical(RegisterBehavior.BulkOverwrite)

// Read env var
setup({ path: join(rootDir, '.env') })

// Set default inspection depth
inspect.defaultOptions.depth = 1

// Enable colorette
colorette.createColors({ useColor: true })

declare module '@skyra/env-utilities' {
  interface Env {
    OWNERS: ArrayString

    PHOTON_APP_ID: string
    PHOTON_APP_VERSION: string
    PHOTON_MAX_PLAYERS: NumberString
    PHOTON_QUEUE_TIMER: NumberString

    BOT_CHANNEL_ID: Snowflake

    DATABASE_PASSWORD: string
    DATABASE_URL: string
  }
}
