import type {
  ChatInputCommandSuccessPayload,
  Command,
  ContextMenuCommandSuccessPayload,
  MessageCommandSuccessPayload,
} from '@sapphire/framework'
import { container } from '@sapphire/framework'
import { cyan } from 'colorette'
import { type APIUser, type Guild, type User } from 'discord.js'

export const pickRandom = <T>(array: readonly T[]): T => {
  const { length } = array

  return array[Math.floor(Math.random() * length)]
}

export const logSuccessCommand = (
  payload: ContextMenuCommandSuccessPayload | ChatInputCommandSuccessPayload | MessageCommandSuccessPayload
) => {
  let successLoggerData: ReturnType<typeof getSuccessLoggerData>

  if ('interaction' in payload) {
    successLoggerData = getSuccessLoggerData(payload.interaction.guild, payload.interaction.user, payload.command)
  } else {
    successLoggerData = getSuccessLoggerData(payload.message.guild, payload.message.author, payload.command)
  }

  container.logger.debug(
    `${successLoggerData.shard} - ${successLoggerData.commandName} ${successLoggerData.author} ${successLoggerData.sentAt}`
  )
}

export const getSuccessLoggerData = (guild: Guild | null, user: User, command: Command) => {
  const shard = getShardInfo(guild?.shardId ?? 0)
  const commandName = getCommandInfo(command)
  const author = getAuthorInfo(user)
  const sentAt = getGuildInfo(guild)

  return { shard, commandName, author, sentAt }
}

const getShardInfo = (id: number) => {
  return `[${cyan(id.toString())}]`
}

const getCommandInfo = (command: Command) => {
  return cyan(command.name)
}

const getAuthorInfo = (author: User | APIUser) => {
  return `${author.username}[${cyan(author.id)}]`
}

const getGuildInfo = (guild: Guild | null) => {
  if (guild === null) return 'Direct Messages'
  return `${guild.name}[${cyan(guild.id)}]`
}

export const toFixed = (value: number) => {
  return parseFloat(value.toFixed(2))
}

const NOPARSE_CLOSE = '</noparse>'

// case-insensitive search that only ever lowercases fixed-size windows: lowercasing the
// whole string would misalign indices, since toLowerCase() can change length ('İ' → 'i̇')
const findNoparseEnd = (text: string, from: number) => {
  let index = from

  while (true) {
    const candidate = text.indexOf('<', index)

    if (candidate === -1) return -1
    if (text.slice(candidate, candidate + NOPARSE_CLOSE.length).toLowerCase() === NOPARSE_CLOSE) return candidate

    index = candidate + 1
  }
}

export const sanitizeTMPTags = (text: string) => {
  let result = ''
  let index = 0
  // cached position of the last '>' search, so a flood of '<' with no '>' after it
  // is scanned once instead of once per '<'
  let gt = 0

  while (index < text.length) {
    const open = text.indexOf('<', index)

    if (open === -1) {
      result += text.slice(index)
      break
    }

    result += text.slice(index, open)

    if (gt !== -1 && gt <= open) gt = text.indexOf('>', open + 1)

    const close = gt
    const nextOpen = text.indexOf('<', open + 1)

    // no '>' before the next '<' or the end of the string → malformed tag, drop it
    if (close === -1 || (nextOpen !== -1 && nextOpen < close)) {
      index = nextOpen === -1 ? text.length : nextOpen
      continue
    }

    // TMP renders everything inside <noparse> verbatim, so that content is visible text
    if (text.slice(open + 1, close).toLowerCase() === 'noparse') {
      const end = findNoparseEnd(text, close + 1)

      if (end === -1) {
        result += text.slice(close + 1)
        break
      }

      result += text.slice(close + 1, end)
      index = end + NOPARSE_CLOSE.length
      continue
    }

    index = close + 1
  }

  return result.trim()
}
