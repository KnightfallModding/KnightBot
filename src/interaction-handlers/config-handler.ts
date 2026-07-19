import { readFile } from 'fs/promises'
import { join } from 'path'

import { ApplyOptions } from '@sapphire/decorators'
import { fetch, FetchResultTypes } from '@sapphire/fetch'
import { InteractionHandler, InteractionHandlerTypes } from '@sapphire/framework'
import { Attachment, AttachmentBuilder, MessageFlags, type ModalSubmitInteraction } from 'discord.js'

import { db } from 'db/client'
import { configs } from 'db/schema'
import { eventTemplate, rootDir } from 'lib/constants'

@ApplyOptions<InteractionHandler.Options>({
  interactionHandlerType: InteractionHandlerTypes.ModalSubmit,
})
export class ConfigHandler extends InteractionHandler {
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

    await db.insert(configs).values({ guildId, name, description, location }).onConflictDoUpdate({
      target: configs.guildId,
      set: data,
    })

    await interaction.reply({
      content: 'Configuration has been updated successfully.',
      flags: [MessageFlags.Ephemeral],
      files: [new AttachmentBuilder(data.banner)],
    })
  }

  public override parse(interaction: ModalSubmitInteraction) {
    if (!interaction.customId.startsWith('config-')) return this.none()

    return this.some()
  }

  async #getImageBytes(upload?: Attachment) {
    const defaultImage = await readFile(join(rootDir, 'assets', 'banner.jpg'))
    if (!upload || !upload.contentType?.startsWith('image/')) return defaultImage

    return fetch(upload.url, FetchResultTypes.Buffer).catch(() => defaultImage)
  }
}
