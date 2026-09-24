import { ApplyOptions } from '@sapphire/decorators'
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework'
import { ChannelType, MessageFlags, type ModalSubmitInteraction } from 'discord.js'

import { db } from 'db/client'
import { configs } from 'db/schema'
import { createSuccessEmbed } from 'lib/utils'

@ApplyOptions<InteractionHandler.Options>({
  interactionHandlerType: InteractionHandlerTypes.ModalSubmit,
})
export class HoneypotHandler extends InteractionHandler {
  public override parse(interaction: ModalSubmitInteraction) {
    if (!interaction.customId.startsWith('honeypot-config-')) return this.none()

    return this.some()
  }

  public async run(interaction: ModalSubmitInteraction) {
    if (!interaction.inCachedGuild()) return

    const { guildId } = interaction
    const channelId =
      interaction.fields.getSelectedChannels('channel', false, [ChannelType.GuildText])?.first()?.id ?? null
    const data = { honeypotChannelId: channelId } satisfies Partial<typeof configs.$inferInsert>

    const { honeypotChannelId: previousChannelId } = (await db.query.configs.findFirst({
      where: { guildId },
      columns: { honeypotChannelId: true },
    })) ?? { honeypotChannelId: null }

    let embed = createSuccessEmbed()
    if (channelId === previousChannelId)
      embed = embed.setDescription("Channel ID is identical. Config hasn't been updated.")
    else if (!channelId) embed = embed.setDescription('Honeypot channel has been reset correctly.')
    else {
      await db
        .insert(configs)
        .values({ guildId: interaction.guildId, honeypotChannelId: channelId })
        .onConflictDoUpdate({
          target: configs.guildId,
          set: data,
        })
      embed = embed.setDescription(
        [
          'Honeypot configuration has been updated successfully.', //
          `<#${channelId}> will now catch spammers.`,
        ].join('\n')
      )
    }

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    })
  }
}
