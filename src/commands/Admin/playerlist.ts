import { ApplyOptions } from '@sapphire/decorators'
import { Command } from '@sapphire/framework'
import { objectKeys, objectValues } from '@sapphire/utilities'
import { Colors, EmbedBuilder, MessageFlags } from 'discord.js'

import { queueDetectors, Regions } from '$lib/queue-detector'

@ApplyOptions<Command.Options>({
  name: 'playerlist',
  description: 'A basic slash command',
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
            input
              .setName('region')
              .setDescription('The region the room is in.')
              .addChoices(objectKeys(Regions).map(key => ({ name: key, value: key })))
          )
          .addBooleanOption(input =>
            input //
              .setName('hidden')
              .setDescription('Make the message hidden (true by default)')
          ),
      {
        guildIds: ['1224423183155728414'],
      }
    )
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const hidden = interaction.options.getBoolean('hidden') ?? true
    const region: keyof typeof Regions = (interaction.options.getString('region') as keyof typeof Regions) ?? 'NA'
    const queueDetector = queueDetectors[region]
    const tracker = queueDetector.playerTrackers.find(tracker => tracker.room.name === queueDetector.currentQueue?.name)
    const room = tracker?.room

    if (!room) {
      return interaction.reply({
        content: 'No public room has been found for this region. Try again later.',
        flags: hidden ? MessageFlags.Ephemeral : [],
      })
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.Gold)
      .setDescription(`Player list for room ${room.name.slice(5)}`)
      .addFields(
        objectValues(tracker.players).map(player => ({
          name: '\u200B',
          value: player.slice(0, 50) + (player.length > 50 ? '…' : ''),
        }))
      )

    return interaction.reply({
      embeds: [embed],
      flags: hidden ? MessageFlags.Ephemeral : [],
    })
  }
}
