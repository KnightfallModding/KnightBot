import { ApplyOptions } from '@sapphire/decorators'
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework'
import { Colors, EmbedBuilder, MessageFlags, type ModalSubmitInteraction } from 'discord.js'
import { eq } from 'drizzle-orm'

import { db } from 'db/client'
import { keywords } from 'db/schema'
import { KeywordAction } from 'lib/constants'

@ApplyOptions<InteractionHandler.Options>({
  interactionHandlerType: InteractionHandlerTypes.ModalSubmit,
})
export class ModalHandler extends InteractionHandler {
  public async run(interaction: ModalSubmitInteraction) {
    if (!interaction.inCachedGuild()) return

    const [action, ...rest] = interaction.customId.replace('keywords-', '').split('-') as [
      string,
      KeywordAction,
      string[],
    ]
    const content = interaction.fields.getTextInputValue('content')
    const strict = interaction.fields.getCheckbox('strict')

    if (action === 'add') {
      try {
        const config = await db.query.configs.findFirst({
          where: { guildId: interaction.guildId },
          columns: { id: true },
        })

        await db.insert(keywords).values({ configId: config!.id, content, strict })

        const embed = new EmbedBuilder() //
          .setColor(Colors.Green)
          .setDescription('Keyword has been added successfully.')

        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        })
      } catch {
        const embed = new EmbedBuilder()
          .setColor(Colors.Red)
          .setDescription('This keyword already exists in the database.')

        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        })
      }
    }
    if (action === 'edit') {
      await db
        .update(keywords)
        .set({ content, strict })
        .where(eq(keywords.id, rest.join('-')))

      const embed = new EmbedBuilder() //
        .setColor(Colors.Green)
        .setDescription('Keyword has been updated successfully.')

      return interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      })
    }
  }

  public override parse(interaction: ModalSubmitInteraction) {
    if (!interaction.customId.startsWith('keywords-')) return this.none()

    return this.some()
  }
}
