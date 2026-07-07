import { ApplyOptions } from '@sapphire/decorators'
import { ApplicationCommandRegistry, Command } from '@sapphire/framework'
import { objectKeys } from '@sapphire/utilities'
import { envParseNumber } from '@skyra/env-utilities'
import { bold, ChatInputCommandInteraction, Colors, EmbedBuilder, MessageFlags } from 'discord.js'

import { dev } from '$lib/constants'
import { queueDetectors } from '$lib/queue-detector'

export const maxPlayers = envParseNumber('PHOTON_MAX_PLAYERS', 28)
export const queueTimer = envParseNumber('PHOTON_QUEUE_TIMER', 120)

@ApplyOptions<Command.Options>({
  name: 'queue',
  description: 'Current queue and number of active players (defaults to NA). AFK players are not included.',
  preconditions: ['BotChannelOnly'],
})
export class QueueCommand extends Command {
  override registerApplicationCommands(registry: ApplicationCommandRegistry) {
    registry.registerChatInputCommand(builder => {
      return builder
        .setName(this.name)
        .setDescription(this.description)
        .addStringOption(builder => {
          builder = builder
            .setName('region')
            .setDescription('Select which region to see the queue of.')
            .addChoices(objectKeys(queueDetectors).map(name => ({ name, value: name })))

          return builder
        })
    })
  }

  override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const region = (interaction.options.getString('region') ?? 'NA') as keyof typeof queueDetectors
    const queueDetector = queueDetectors[region]
    const inGameOrQueue = queueDetector.players.active

    const description = [`Active players: ${bold(inGameOrQueue.toString())}`]
    if (queueDetector.currentQueue) {
      const startedFor = Math.floor((Date.now() - queueDetector.currentQueue.timer) / 1_000)
      const timer = queueTimer - startedFor
      const isDelayed = Math.sign(timer) === -1
      const currentPlayers = `${bold(queueDetector.currentQueue.players.toString())}/${bold(maxPlayers.toString())}.`
      const startMessage = isDelayed ? 'Starting now...' : `Starting in ${bold(timer.toString())} seconds...`

      description.push(`${currentPlayers} ${startMessage}`)
    } else description.push('No active queue.')

    const embed = new EmbedBuilder()
      .setColor(this.getColor(inGameOrQueue))
      .setFooter({ text: `Region: ${region}` })
      .setDescription(
        queueDetector.players.active < 1 //
          ? bold(`No players in ${region}`)
          : description.join('\n')
      )

    interaction.reply({
      embeds: [embed],
      flags: dev ? [MessageFlags.Ephemeral] : [],
    })
  }

  private getColor(players: number) {
    if (players < 4) return Colors.DarkRed
    if (players < maxPlayers) return Colors.Red
    if (players < maxPlayers * 2) return Colors.DarkOrange
    if (players < maxPlayers * 3) return Colors.Orange
    if (players < maxPlayers * 4) return Colors.DarkGreen
    if (players < maxPlayers * 5) return Colors.Green

    return Colors.Gold
  }
}
