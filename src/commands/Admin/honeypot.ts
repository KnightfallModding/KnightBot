import { ApplyOptions } from '@sapphire/decorators'
import { Command } from '@sapphire/framework'
import {
  ChannelSelectMenuBuilder,
  ChannelType,
  InteractionContextType,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
} from 'discord.js'

import { dev } from 'lib/constants'

@ApplyOptions<Command.Options>({
  name: 'honeypot',
  description: 'Configure the honeypot channel on this server',
  preconditions: ['OwnerOnly'],
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      builder =>
        builder //
          .setName(this.name)
          .setDescription(this.description)
          .setContexts(InteractionContextType.Guild)
          .setDefaultMemberPermissions(dev ? undefined : PermissionFlagsBits.Administrator),
      { guildIds: ['1224423183155728414'] }
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return

    const modal = new ModalBuilder()
      .setCustomId(`honeypot-config-${interaction.guildId}`)
      .addLabelComponents(this.#createChannelLabel())

    return interaction.showModal(modal)
  }

  #createChannelLabel() {
    const select = new ChannelSelectMenuBuilder() //
      .setCustomId('channel')
      .setMaxValues(1)
      .setChannelTypes(ChannelType.GuildText)
      .setRequired(true)

    return new LabelBuilder()
      .setLabel('Channel')
      .setDescription('The honeypot channel')
      .setChannelSelectMenuComponent(select)
  }
}
