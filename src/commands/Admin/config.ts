import { ApplyOptions } from '@sapphire/decorators'
import { Command } from '@sapphire/framework'
import {
  FileUploadBuilder,
  InteractionContextType,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'

import { db } from 'db/client'
import { configs } from 'db/schema'
import { eventTemplate } from 'lib/constants'

@ApplyOptions<Command.Options>({
  name: 'config',
  description: 'Configure {{bot}} on this server',
  preconditions: ['OwnerOnly'],
})
export class ConfigCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(builder =>
      builder //
        .setName(this.name)
        .setDescription(this.description.replaceAll('{{bot}}', this.container.client.user?.username ?? 'KnightBot'))
        .setContexts(InteractionContextType.Guild)
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return

    const config = await db.query.configs.findFirst({
      where: { guildId: interaction.guildId },
    })

    const modal = new ModalBuilder()
      .setCustomId(`config-${interaction.guildId}`)
      .setTitle(`Configuration panel for ${interaction.guild.name}`)
      .addLabelComponents(
        this.#createNameLabel(config),
        this.#createDescriptionLabel(config),
        this.#createLocationLabel(config),
        this.#createReminderLabel(config),
        this.#createBannerUpload()
      )

    return interaction.showModal(modal)
  }

  #createNameLabel(config?: typeof configs.$inferSelect) {
    const input = new TextInputBuilder()
      .setCustomId('name')
      .setStyle(TextInputStyle.Short)
      .setMinLength(5)
      .setMaxLength(20)
      .setPlaceholder(eventTemplate.name)
      .setValue(config?.name ?? eventTemplate.name)
      .setRequired(false)

    return new LabelBuilder() //
      .setLabel('Name')
      .setDescription("The event's name")
      .setTextInputComponent(input)
  }

  #createDescriptionLabel(config?: typeof configs.$inferSelect) {
    const input = new TextInputBuilder() //
      .setCustomId('description')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(500)
      .setPlaceholder(eventTemplate.description)
      .setValue(config?.description ?? eventTemplate.description)
      .setRequired(false)

    return new LabelBuilder() //
      .setLabel('Description')
      .setDescription("The event's description")
      .setTextInputComponent(input)
  }

  #createLocationLabel(config?: typeof configs.$inferSelect) {
    const input = new TextInputBuilder() //
      .setCustomId('location')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(500)
      .setPlaceholder(eventTemplate.location)
      .setValue(config?.location ?? eventTemplate.location)
      .setRequired(false)

    return new LabelBuilder() //
      .setLabel('Location')
      .setDescription("The event's location")
      .setTextInputComponent(input)
  }

  #createReminderLabel(config?: typeof configs.$inferSelect) {
    const input = new TextInputBuilder() //
      .setCustomId('reminder')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(500)
      .setPlaceholder(eventTemplate.reminder)
      .setValue(config?.reminder ?? eventTemplate.reminder)
      .setRequired(false)

    return new LabelBuilder() //
      .setLabel('Reminder')
      .setDescription('The reminder message that is sent when something uses one of the trigger words')
      .setTextInputComponent(input)
  }

  #createBannerUpload() {
    const upload = new FileUploadBuilder() //
      .setCustomId('banner')
      .setMinValues(1)
      .setRequired(false)

    return new LabelBuilder() //
      .setLabel('Location')
      .setDescription("The event's banner. Non-image files and files heavier than 10 MB will be ignored.")
      .setFileUploadComponent(upload)
  }
}
