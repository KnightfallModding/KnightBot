import { ApplyOptions } from '@sapphire/decorators'
import { Command } from '@sapphire/framework'
import { cast, objectEntries } from '@sapphire/utilities'
import { AutocompleteInteraction, bold, Colors, EmbedBuilder, MessageFlags } from 'discord.js'

import { queueDetectors, Regions } from '$lib/queue-detector'
import { sanitizeTMPTags } from '$lib/utils'
import { maxPlayers } from 'commands/General/queue'

@ApplyOptions<Command.Options>({
  name: 'playerlist',
  description: 'List all the players in public lobbies',
  preconditions: ['OwnerOnly'],
})
export class UserCommand extends Command {
  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand(
      builder =>
        builder //
          .setName(this.name)
          .setDescription(this.description)
          .addStringOption(input =>
            input //
              .setName('region')
              .setDescription('The region the lobby is located in')
              .addChoices(objectEntries(Regions).map(([name, value]) => ({ name: value, value: name })))
          )
          .addStringOption(input =>
            input //
              .setName('lobby')
              .setDescription('The lobby to check')
              .setAutocomplete(true)
          )
          .addBooleanOption(input =>
            input //
              .setName('hidden')
              .setDescription('Make the input visible to everyone. Defaults to false')
          ),
      { guildIds: ['1224423183155728414'] }
    )
  }

  public override autocompleteRun(interaction: AutocompleteInteraction) {
    this.container.logger.debug(`Interaction ${interaction.options.getFocused(true).name} has triggered autocomplete`)

    if (interaction.options.getFocused(true).name !== 'lobby') return

    const region = cast<keyof typeof Regions>(interaction.options.getString('region') ?? 'NA')
    const { playerTrackers } = queueDetectors[region]

    return interaction.respond(
      playerTrackers.map(playerTracker => ({ name: playerTracker.room, value: playerTracker.room }))
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const region = cast<keyof typeof Regions>(interaction.options.getString('region') ?? 'NA')
    const lobby = this.#getRoom(region, interaction.options.getString('lobby'))
    const hidden = interaction.options.getBoolean('hidden') ?? true

    let embed = new EmbedBuilder()

    if (!lobby) {
      embed = embed
        .setColor(Colors.DarkRed)
        .setDescription(`There is currently no public room in region ${bold(region)}. Try again later.`)
    } else {
      embed = embed
        .setColor(Colors.Green)
        .setAuthor({ name: `Room ${lobby.room} • Region ${region}` })
        .addFields(
          lobby.players
            .sort((previous, next) => previous.id - next.id)
            .map(actor => ({
              name: actor.id.toString(),
              value: sanitizeTMPTags(actor.name),
              inline: true,
            }))
        )
        .setFooter({ text: `${lobby.client.room.playerCount} / ${maxPlayers} players` })
    }

    return interaction.reply({
      embeds: [embed],
      flags: hidden ? [MessageFlags.Ephemeral] : [],
    })
  }

  #getRoom(region: keyof typeof Regions, name: string | null) {
    const { currentQueue, playerTrackers } = queueDetectors[region]

    if (name)
      return (
        playerTrackers.find(playerTracker => playerTracker.originalRoomName === name) ??
        playerTrackers.find(playerTracker => playerTracker.originalRoomName === currentQueue?.name)
      )

    return playerTrackers.find(playerTracker => playerTracker.originalRoomName === currentQueue?.name)
  }
}
