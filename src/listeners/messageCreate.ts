import { ApplyOptions } from '@sapphire/decorators'
import { Events, Listener } from '@sapphire/framework'
import { Message, PermissionsBitField } from 'discord.js'

import { db } from 'db/client'

@ApplyOptions<Listener.Options>({})
export class UserEvent extends Listener<typeof Events.MessageCreate> {
  public override async run(message: Message) {
    this.container.logger.debug('Message received.')

    if (!message.inGuild() || message.author.bot) return

    this.container.logger.debug('Message is in guild.')

    const { guild, guildId } = message
    const member = await guild.members.fetch(this.container.client.user!.id)
    if (member.permissions.has(PermissionsBitField.Flags.SendMessages)) return

    this.container.logger.debug('Bot has permission to speak.')

    const config = await db.query.configs.findFirst({
      where: { guildId },
      columns: { id: true, reminder: true },
    })
    if (!config) return

    this.container.logger.debug('Config found.')

    const keywords = await db.query.keywords.findMany({
      where: { configId: config.id },
      columns: { content: true, strict: true },
    })

    for (const keyword of keywords) {
      if (keyword.strict && keyword.content === message.content) return message.reply(config.reminder)
      if (!keyword.strict && message.content.includes(keyword.content)) return message.reply(config.reminder)

      console.log(`Passed all the tests for ${keyword.content} type ${keyword.strict}`)
    }
  }
}
