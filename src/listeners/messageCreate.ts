import { ApplyOptions } from '@sapphire/decorators'
import { Events, Listener } from '@sapphire/framework'
import { Message, PermissionsBitField } from 'discord.js'

import { db } from 'db/client'

@ApplyOptions<Listener.Options>({})
export class UserEvent extends Listener<typeof Events.MessageCreate> {
  public override async run(message: Message) {
    if (!message.inGuild() || message.author.bot) return

    const { guild, guildId } = message
    const bot = await guild.members.fetch(this.container.client.user!.id)
    if (!message.channel.permissionsFor(bot).has(PermissionsBitField.Flags.SendMessages)) return

    const config = await db.query.configs.findFirst({
      where: { guildId },
      columns: { id: true, reminder: true },
    })
    if (!config) return

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
}
