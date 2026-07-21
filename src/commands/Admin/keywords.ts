import { ApplyOptions } from '@sapphire/decorators'
import { Command } from '@sapphire/framework'
import {
  AutocompleteInteraction,
  CheckboxBuilder,
  Colors,
  EmbedBuilder,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'
import { eq, or } from 'drizzle-orm'

import { KeywordAction } from '$lib/constants'
import { db } from 'db/client'
import { keywords } from 'db/schema'

@ApplyOptions<Command.Options>({
  name: 'keywords',
  description: 'Configure reminder keywords on this server',
  preconditions: ['OwnerOnly'],
})
export class UserCommand extends Command {
  #prefix = 'keywords'

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(builder =>
      builder //
        .setName(this.name)
        .setDescription(this.description)
        .addSubcommand(input =>
          input //
            .setName('add')
            .setDescription('Add a keyword')
        )
        .addSubcommand(input =>
          input //
            .setName('edit')
            .setDescription('Edit a keyword')
            .addStringOption(input =>
              input //
                .setName('keyword')
                .setDescription('The keyword to edit')
                .setAutocomplete(true)
                .setRequired(true)
            )
        )
        .addSubcommand(input =>
          input //
            .setName('remove')
            .setDescription('Remove a keyword')
            .addStringOption(input =>
              input //
                .setName('keyword')
                .setDescription('The keyword to edit')
                .setAutocomplete(true)
                .setRequired(true)
            )
        )
        .setContexts(InteractionContextType.Guild)
    )
  }

  override async autocompleteRun(interaction: AutocompleteInteraction) {
    const content = interaction.options.getString('keyword', true)
    const keywords = await db.query.keywords.findMany({
      where: {
        content: { ilike: `%${content}%` },
      },
      columns: {
        id: true,
        content: true,
        strict: true,
      },
      limit: 20,
    })

    return interaction.respond(
      keywords.map(keyword => ({
        name: `${keyword.content}${keyword.strict ? ' (strict)' : ''}`,
        value: keyword.id,
      }))
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return

    const action = interaction.options.getSubcommand(true) as KeywordAction

    let modal: ModalBuilder

    if (action === 'add') modal = this.#createAddModal()
    if (action === 'edit') {
      const config = await db.query.configs.findFirst({
        where: { guildId: interaction.guildId },
        columns: { id: true },
      })
      if (!config) {
        const command = await this.container.client.application?.commands
          .fetch()
          .then(commands => commands.find(command => command.name === 'config'))

        return interaction.reply({
          content: `This server hasn't been configured yet. Please run ${command}`,
          flags: MessageFlags.Ephemeral,
        })
      }

      const target = interaction.options.getString('keyword', true)
      const keyword = await db.query.keywords.findFirst({
        where: {
          configId: config.id,
          OR: [{ id: target }, { content: target }],
        },
        columns: {
          id: true,
          content: true,
          strict: true,
        },
      })
      if (!keyword) {
        const embed = new EmbedBuilder().setColor(Colors.Red).setDescription('The passed keyword does not exist.')

        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        })
      }

      modal = this.#createEditModal(keyword)
    }
    if (action === 'remove') {
      const target = interaction.options.getString('keyword', true)
      try {
        const [keyword] = await db
          .delete(keywords)
          .where(
            or(
              eq(keywords.id, target), //
              eq(keywords.content, target)
            )
          )
          .returning()

        const embed = new EmbedBuilder()
          .setColor(Colors.Green)
          .setDescription(`Keyword ${keyword.content} has been deleted.`)

        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        })
      } catch {
        const embed = new EmbedBuilder().setColor(Colors.Red).setDescription('The passed keyword does not exist.')

        return interaction.reply({
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        })
      }
    }

    return interaction.showModal(modal!)
  }

  #createAddModal() {
    return new ModalBuilder() //
      .setCustomId(`${this.#prefix}-add`)
      .setTitle('Add a new keyword')
      .addLabelComponents(
        this.#createContentLabel(this.#createContentInput()),
        this.#createStrictLabel(this.#createStrictCheckbox())
      )
  }
  #createEditModal(keyword: Pick<typeof keywords.$inferSelect, 'id' | 'content' | 'strict'>) {
    return new ModalBuilder() //
      .setCustomId(this.#prefix + '-edit-' + keyword.id)
      .setTitle('Add a new keyword')
      .addLabelComponents(
        this.#createContentLabel(this.#createContentInput().setValue(keyword.content)),
        this.#createStrictLabel(this.#createStrictCheckbox().setDefault(keyword.strict))
      )
  }

  #createContentInput() {
    return new TextInputBuilder()
      .setCustomId('content')
      .setStyle(TextInputStyle.Short)
      .setMinLength(3)
      .setMaxLength(20)
      .setRequired(true)
  }

  #createContentLabel(input: TextInputBuilder) {
    return new LabelBuilder()
      .setLabel('Content')
      .setDescription('The keyword to trigger the reminder')
      .setTextInputComponent(input)
  }

  #createStrictCheckbox() {
    return new CheckboxBuilder() //
      .setCustomId('strict')
      .setDefault(false)
  }

  #createStrictLabel(checkbox: CheckboxBuilder) {
    return new LabelBuilder()
      .setLabel('Strict')
      .setDescription('Check to make the message trigger ONLY if strictly equal to the keyword')
      .setCheckboxComponent(checkbox)
  }
}
