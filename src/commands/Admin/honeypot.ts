import { ApplyOptions } from '@sapphire/decorators'
import { Subcommand } from '@sapphire/plugin-subcommands'
import {
  ChannelSelectMenuBuilder,
  ChannelType,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
} from 'discord.js'
import { and, eq } from 'drizzle-orm'

import { db } from 'db/client'
import { honeypotIgnores } from 'db/schema'
import { dev, HoneypotIgnoreType } from 'lib/constants'
import { createErrorEmbed, createSuccessEmbed, exists } from 'lib/utils'

@ApplyOptions<Subcommand.Options>({
  name: 'honeypot',
  description: 'Configure the honeypot channel on this server',
  preconditions: ['OwnerOnly'],
  subcommands: [
    {
      name: 'config',
      chatInputRun: 'configurationPanel',
    },
    {
      name: 'add-ignore',
      chatInputRun: 'addIgnoredUser',
    },
    {
      name: 'remove-ignore',
      chatInputRun: 'removeIgnoredUser',
    },
  ],
})
export class HoneypotCommand extends Subcommand {
  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand(
      builder =>
        builder //
          .setName(this.name)
          .setDescription(this.description)
          .setContexts(InteractionContextType.Guild)
          .addSubcommand(input =>
            input //
              .setName('config')
              .setDescription('Open the configuration panel')
          )
          .addSubcommand(input =>
            input
              .setName('add-ignore')
              .setDescription('Whitelist a user')
              .addRoleOption(input =>
                input //
                  .setName('role')
                  .setDescription('The role to be the whitelisted')
              )
              .addUserOption(input =>
                input //
                  .setName('user')
                  .setDescription('The user to be whitelisted')
              )
          )
          .addSubcommand(input =>
            input
              .setName('remove-ignore')
              .setDescription('Remove a user from the whitelist')
              .addRoleOption(input =>
                input //
                  .setName('role')
                  .setDescription('The role to be removed from the whitelist')
              )
              .addUserOption(input =>
                input //
                  .setName('user')
                  .setDescription('The user to be removed from the whitelist')
              )
          )
          .setDefaultMemberPermissions(dev ? undefined : PermissionFlagsBits.Administrator),
      { guildIds: dev ? ['1224423183155728414'] : undefined }
    )
  }

  public async configurationPanel(interaction: Subcommand.ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return

    const { honeypotChannelId } = (await db.query.configs.findFirst({
      where: { guildId: interaction.guildId },
      columns: { honeypotChannelId: true },
    })) ?? { honeypotChannelId: null }

    const modal = new ModalBuilder()
      .setCustomId(`honeypot-config-${interaction.guildId}`)
      .setTitle('Honeypot configuration panel')
      .addLabelComponents(this.#createChannelLabel(honeypotChannelId))

    return interaction.showModal(modal)
  }

  public async addIgnoredUser(interaction: Subcommand.ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return

    const { id: configId } =
      (await db.query.configs.findFirst({
        where: {
          guildId: interaction.guildId,
        },
        columns: { id: true },
      })) ?? {}
    if (!configId) {
      return interaction.reply({
        embeds: [createErrorEmbed('You need to configure the honeypot before removing users.')],
        flags: MessageFlags.Ephemeral,
      })
    }

    const role = interaction.options.getRole('role')
    const user = interaction.options.getUser('user')
    if (!user && !role) return

    const type: keyof typeof HoneypotIgnoreType = role ? 'ROLE' : 'USER'
    const ignoredId = (role?.id ?? user?.id)!
    const ignoreExists = await exists(honeypotIgnores, eq(honeypotIgnores.ignoredId, ignoredId))
    if (ignoreExists)
      return interaction.reply({
        embeds: [createErrorEmbed(`${role ?? user} is already whitelisted.`)],
        flags: MessageFlags.Ephemeral,
      })

    await db.insert(honeypotIgnores).values({ configId, ignoredId, type })

    return interaction.reply({
      embeds: [createSuccessEmbed(`${role ?? user} has been whitelisted.`)],
      flags: MessageFlags.Ephemeral,
    })
  }

  public async removeIgnoredUser(interaction: Subcommand.ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return

    const { id: configId } =
      (await db.query.configs.findFirst({
        where: {
          guildId: interaction.guildId,
        },
        columns: { id: true },
      })) ?? {}
    if (!configId) {
      return interaction.reply({
        embeds: [createErrorEmbed('You need to configure the honeypot before removing users.')],
        flags: MessageFlags.Ephemeral,
      })
    }

    const role = interaction.options.getRole('role')
    const user = interaction.options.getUser('user')
    if (!user && !role) return

    const ignoredId = (role?.id ?? user?.id)!
    const ignoreExists = await exists(honeypotIgnores, eq(honeypotIgnores.ignoredId, ignoredId))
    if (!ignoreExists)
      return interaction.reply({
        embeds: [createErrorEmbed(`There is no whitelist for ${role ?? user}.`)],
        flags: MessageFlags.Ephemeral,
      })

    await db.delete(honeypotIgnores).where(
      and(
        eq(honeypotIgnores.configId, configId), //
        eq(honeypotIgnores.ignoredId, ignoredId)
      )
    )

    return interaction.reply({
      embeds: [createSuccessEmbed(`${role ?? user} has been removed from the whitelist.`)],
      flags: MessageFlags.Ephemeral,
    })
  }

  #createChannelLabel(channelId: string | null) {
    let select = new ChannelSelectMenuBuilder()
      .setCustomId('channel')
      .setMaxValues(1)
      .setChannelTypes(ChannelType.GuildText)
      .setRequired(false)
    if (channelId) select = select.addDefaultChannels(channelId)

    return new LabelBuilder()
      .setLabel('Channel')
      .setDescription('The honeypot channel')
      .setChannelSelectMenuComponent(select)
  }
}
