import { ApplyOptions } from '@sapphire/decorators'
import { Events, Listener } from '@sapphire/framework'
import { Message, PermissionsBitField } from 'discord.js'

import { db } from 'db/client'
import { configs, honeypotVictims } from 'db/schema'

@ApplyOptions<Listener.Options>({})
export class MessageCreateEvent extends Listener<typeof Events.MessageCreate> {
  public override async run(message: Message) {
    if (!message.inGuild() || message.author.bot) return

    const { guild, guildId } = message
    const bot = await guild.members.fetch(this.container.client.user!.id)
    if (!message.channel.permissionsFor(bot).has(PermissionsBitField.Flags.SendMessages)) return

    const config = await db.query.configs.findFirst({
      where: { guildId },
      columns: { id: true, reminder: true, honeypotMode: true, honeypotChannelId: true },
    })
    if (!config) return

    if (message.channelId === config.honeypotChannelId && config.honeypotMode)
      return this.#punishHoneypotSpam(message, config)

    const keywords = await db.query.keywords.findMany({
      where: { configId: config.id },
      columns: {
        content: true,
        strict: true,
        regex: true,
      },
    })
    const event = await db.query.events.findFirst({
      orderBy: { startsAt: 'desc' },
      columns: { eventId: true },
    })

    const scheduledEvent = event?.eventId ? await message.guild.scheduledEvents.fetch(event.eventId) : null
    const messageContent = message.content.toLowerCase()
    const reply = () => message.reply(config.reminder.replaceAll('{{event}}', scheduledEvent ? scheduledEvent.url : ''))

    for (const keyword of keywords) {
      const keywordContent = keyword.content.toLowerCase()

      if (keyword.regex) {
        try {
          const regex = new RegExp(`${keyword.strict ? '^' : ''}${keywordContent}${keyword.strict ? '$' : ''}`)
          if (regex.test(messageContent)) return reply()
        } catch {
          this.container.logger.warn(`Invalid regex keyword: ${keyword.content}`)
        }

        continue
      }

      if (keyword.strict && keywordContent === messageContent) return reply()
      if (!keyword.strict && messageContent.includes(keywordContent)) return reply()
    }
  }

  async #punishHoneypotSpam(
    message: Message<true>,
    config: Required<Pick<typeof configs.$inferInsert, 'id' | 'honeypotMode'>>
  ) {
    if (!message.inGuild() || message.member?.bannable) return

    const ignores = await db.query.honeypotIgnores.findMany({
      where: { configId: config.id },
      columns: {
        ignoredId: true,
        type: true,
      },
    })
    const isIgnored = ignores.some(ignore =>
      ignore.type === 'ROLE'
        ? message.member?.roles.cache.has(ignore.ignoredId)
        : message.author.id === ignore.ignoredId
    )
    if (isIgnored) return

    message.member!.ban({
      reason: 'Message caught in honeypot channel. The last 10 minutes have been deleted.',
      deleteMessageSeconds: 600,
    })
    if (config.honeypotMode === 'SOFT_BAN') message.guild.members.unban(message.author.id)

    await db.insert(honeypotVictims).values({
      configId: config.id!,
      userId: message.author.id,
      mode: config.honeypotMode!,
    })
  }
}
