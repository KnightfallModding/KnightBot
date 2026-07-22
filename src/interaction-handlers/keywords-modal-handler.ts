import { ApplyOptions } from '@sapphire/decorators'
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework'
import { MessageFlags, type ModalSubmitInteraction } from 'discord.js'
import { eq } from 'drizzle-orm'

import { db } from 'db/client'
import { keywords } from 'db/schema'
import { KeywordAction } from 'lib/constants'
import { createErrorEmbed, createSuccessEmbed } from 'lib/utils'

@ApplyOptions<InteractionHandler.Options>({
  interactionHandlerType: InteractionHandlerTypes.ModalSubmit,
})
export class ModalHandler extends InteractionHandler {
  public override parse(interaction: ModalSubmitInteraction) {
    if (!interaction.customId.startsWith('keywords-')) return this.none()

    return this.some()
  }

  public async run(interaction: ModalSubmitInteraction) {
    if (!interaction.inCachedGuild()) return

    const [action, ...rest] = interaction.customId.replace('keywords-', '').split('-') as [
      string,
      KeywordAction,
      string[],
    ]
    const content = interaction.fields.getTextInputValue('content')
    const strict = interaction.fields.getCheckbox('strict')
    const regex = interaction.fields.getCheckbox('regex')

    if (action === 'add') {
      try {
        const config = await db.query.configs.findFirst({
          where: { guildId: interaction.guildId },
          columns: { id: true },
        })

        await db.insert(keywords).values({ configId: config!.id, content, strict, regex })

        return interaction.reply({
          embeds: [createSuccessEmbed('Keyword has been added successfully.')],
          flags: MessageFlags.Ephemeral,
        })
      } catch {
        return interaction.reply({
          embeds: [createErrorEmbed('This keyword already exists in the database.')],
          flags: MessageFlags.Ephemeral,
        })
      }
    }

    if (action === 'edit') {
      await db
        .update(keywords)
        .set({ content, strict, regex })
        .where(eq(keywords.id, rest.join('-')))

      return interaction.reply({
        embeds: [createSuccessEmbed('Keyword has been updated successfully.')],
        flags: MessageFlags.Ephemeral,
      })
    }
  }
}
