import { readFile } from 'fs/promises'
import { join } from 'path'

import { ApplyOptions } from '@sapphire/decorators'
import { fetch, FetchResultTypes } from '@sapphire/fetch'
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework'
import { Attachment, AttachmentBuilder, MessageFlags, type ModalSubmitInteraction } from 'discord.js'
import { fileTypeFromBuffer } from 'file-type'

import { db } from 'db/client'
import { configs } from 'db/schema'
import { bannerMaxFilesize, eventTemplate, rootDir } from 'lib/constants'
import { occurrence } from 'lib/schedule'
import { createSuccessEmbed } from 'lib/utils'

@ApplyOptions<InteractionHandler.Options>({
  interactionHandlerType: InteractionHandlerTypes.ModalSubmit,
})
export class ConfigHandler extends InteractionHandler {
  public override parse(interaction: ModalSubmitInteraction) {
    if (!interaction.customId.startsWith('config-')) return this.none()

    return this.some()
  }

  public async run(interaction: ModalSubmitInteraction) {
    if (!interaction.inCachedGuild()) return

    const { fields, guildId } = interaction

    const name = fields.getTextInputValue('name').trim() || eventTemplate.name
    const description = fields.getTextInputValue('description').trim() || eventTemplate.description
    const location = fields.getTextInputValue('location').trim() || eventTemplate.location
    const bannerUpload = fields.getUploadedFiles('banner')?.first()

    const data = {
      name,
      description,
      location,
      banner: await this.#getImageBytes(bannerUpload),
    } satisfies Partial<typeof configs.$inferInsert>

    const { eventId } = (await db.query.events.findFirst({
      columns: { eventId: true },
      where: { guildId },
      orderBy: { startsAt: 'desc' },
    })) ?? { eventId: null }

    const [config] = await db
      .insert(configs)
      .values({ guildId, name, description, location })
      .onConflictDoUpdate({
        target: configs.guildId,
        set: data,
      })
      .returning()

    occurrence

    if (eventId)
      interaction.guild.scheduledEvents.fetch(eventId).then(event =>
        event.edit({
          name: config.name,
          description: config.description,
          entityMetadata: { location: config.location },
          image: config.banner ?? eventTemplate.banner,
        })
      )

    const fileType = await fileTypeFromBuffer(data.banner)
    const attachment = new AttachmentBuilder(data.banner, { name: `image.${fileType?.ext}` })

    const embed = createSuccessEmbed(`Configuration has been updated successfully.
Current or updated banner has been attached.`).setImage(`attachment://${attachment.name}`)

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
      files: [attachment],
    })
  }

  async #getImageBytes(upload?: Attachment) {
    const defaultImage = await readFile(join(rootDir, 'assets', 'banner.jpg'))
    if (!upload || !upload.contentType?.startsWith('image/') || upload?.size > bannerMaxFilesize) return defaultImage

    return fetch(upload.url, FetchResultTypes.Buffer).catch(() => defaultImage)
  }
}
