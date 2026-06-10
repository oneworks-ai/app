/* eslint-disable max-lines -- Manual channel send payload normalization and dispatch stay colocated. */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { cwd as processCwd } from 'node:process'

import type {
  ChannelEmojiMessage,
  ChannelEmojiReference,
  ChannelFileMessage,
  ChannelMediaMessage,
  ChannelTextMention
} from '@oneworks/core/channel'
import { MAX_CHANNEL_TEXT_MESSAGE_LENGTH, countChannelTextMessageCharacters } from '@oneworks/core/channel'
import { findChannelEmojiRegistryEntry } from '@oneworks/utils'

import { resolveChannelMemoryRoot } from '#~/services/session/channel-context.js'
import { logger } from '#~/utils/logger.js'

import type { ChannelTextMessage } from './middleware/@types/index.js'
import type { ChannelRuntimeState } from './types'

type ManualPayloadType = 'emoji' | 'file' | 'image' | 'text'

interface ManualPayload {
  emoji?: ChannelEmojiReference
  emojiId?: string
  emojiMd5?: string
  emojiSize?: number
  fileName?: string
  mentions?: ChannelTextMention[]
  platform?: string
  src?: string
  text?: string
  type: ManualPayloadType
}

export interface SendManualChannelMessageInput {
  channelKey: string
  cwd?: string
  mentions?: unknown
  payload: unknown
  receiveId?: string
  receiveIdType?: string
  sessionId?: string
}

export type SendManualChannelMessageResult =
  | { ok: true; messageId?: string; type: ManualPayloadType }
  | { ok: false; message: string; statusCode: number }

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const ESCAPED_LINE_BREAK_RE = /\\r\\n|\\n|\\r/gu

const normalizeEscapedLineBreaks = (value: string) => (
  value.replace(ESCAPED_LINE_BREAK_RE, '\n')
)

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const normalizePayloadType = (value: unknown): ManualPayloadType | undefined => {
  const normalized = trimNonEmpty(value)?.toLowerCase()
  if (normalized === 'text' || normalized === 'image' || normalized === 'file' || normalized === 'emoji') {
    return normalized
  }
  return undefined
}

const normalizePositiveInteger = (value: unknown) => {
  const normalized = typeof value === 'number'
    ? value
    : Number.parseInt(trimNonEmpty(value) ?? '', 10)
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : undefined
}

const normalizeMentionType = (value: unknown): ChannelTextMention['type'] | undefined => {
  const normalized = trimNonEmpty(value)?.toLowerCase()
  if (normalized === 'all' || normalized === 'user') return normalized
  return undefined
}

const normalizeMention = (value: unknown): ChannelTextMention | undefined => {
  const id = trimNonEmpty(value)
  if (id != null) return { id }
  if (!isRecord(value)) return undefined

  const recordId = trimNonEmpty(value.id) ??
    trimNonEmpty(value.userId) ??
    trimNonEmpty(value.wxid) ??
    trimNonEmpty(value.openId)
  if (recordId == null) return undefined

  return {
    id: recordId,
    label: trimNonEmpty(value.label) ?? trimNonEmpty(value.name),
    platform: trimNonEmpty(value.platform),
    type: normalizeMentionType(value.type)
  }
}

const normalizeMentions = (value: unknown) => {
  if (!Array.isArray(value)) return undefined
  const mentions = value.map(normalizeMention).filter((item): item is ChannelTextMention => item != null)
  return mentions.length === 0 ? undefined : mentions
}

const normalizeEmojiReference = (value: unknown): ChannelEmojiReference | undefined => {
  if (!isRecord(value)) return undefined
  const id = trimNonEmpty(value.id)
  const platform = trimNonEmpty(value.platform)
  if (id == null || platform == null) return undefined
  const aliases = Array.isArray(value.aliases)
    ? value.aliases.map(trimNonEmpty).filter((item): item is string => item != null)
    : undefined
  const tags = Array.isArray(value.tags)
    ? value.tags.map(trimNonEmpty).filter((item): item is string => item != null)
    : undefined
  return {
    id,
    platform,
    ...(aliases == null || aliases.length === 0 ? {} : { aliases }),
    ...(trimNonEmpty(value.label) == null ? {} : { label: trimNonEmpty(value.label) }),
    ...(trimNonEmpty(value.note) == null ? {} : { note: trimNonEmpty(value.note) }),
    ...(tags == null || tags.length === 0 ? {} : { tags }),
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {})
  }
}

const parsePayload = (payload: unknown): ManualPayload | { error: string } => {
  const textPayload = trimNonEmpty(payload)
  if (textPayload != null) {
    return { type: 'text', text: normalizeEscapedLineBreaks(textPayload) }
  }

  if (!isRecord(payload)) {
    return { error: 'Message payload must be text or an object.' }
  }

  const rawType = trimNonEmpty(payload.type)
  const type = normalizePayloadType(rawType) ?? 'text'
  if (rawType != null && normalizePayloadType(rawType) == null) {
    return { error: `Unsupported message type: ${rawType}.` }
  }
  if (type === 'text') {
    const text = trimNonEmpty(payload.text) ?? trimNonEmpty(payload.content)
    if (text == null) return { error: 'Text message requires text.' }
    return { type, text: normalizeEscapedLineBreaks(text), mentions: normalizeMentions(payload.mentions) }
  }

  if (type === 'emoji') {
    const emoji = normalizeEmojiReference(payload.emoji)
    if (emoji != null) return { type, emoji }

    const emojiMd5 = trimNonEmpty(payload.emojiMd5) ?? trimNonEmpty(payload.md5)
    const emojiSize = normalizePositiveInteger(payload.emojiSize) ??
      normalizePositiveInteger(payload.size) ??
      normalizePositiveInteger(payload.len)
    const emojiId = trimNonEmpty(payload.id) ?? trimNonEmpty(payload.emojiId) ?? emojiMd5
    const platform = trimNonEmpty(payload.platform)
    if (emojiId == null) return { error: 'Emoji message requires id or emojiMd5.' }
    return { type, emojiId, emojiMd5, emojiSize, platform }
  }

  const src = trimNonEmpty(payload.src) ?? trimNonEmpty(payload.url) ?? trimNonEmpty(payload.filePath)
  if (src == null) return { error: `${type} message requires src.` }

  return {
    type,
    src,
    fileName: trimNonEmpty(payload.fileName) ?? trimNonEmpty(payload.name)
  }
}

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const resolveUrlFileName = (url: string, fallback: string) => {
  try {
    const pathname = new URL(url).pathname
    const name = path.basename(decodeURIComponent(pathname))
    return name === '' || name === '/' ? fallback : name
  } catch {
    return fallback
  }
}

const resolveLocalFilePath = (src: string, cwd?: string) => (
  path.isAbsolute(src)
    ? src
    : path.resolve(cwd ?? processCwd(), src)
)

const loadFileMessage = async (
  payload: ManualPayload,
  input: {
    cwd?: string
    receiveId: string
    receiveIdType: string
  }
): Promise<ChannelFileMessage> => {
  const src = payload.src ?? ''
  const fallbackFileName = payload.type === 'image' ? 'image' : 'file'
  if (isHttpUrl(src)) {
    const response = await globalThis.fetch(src)
    if (!response.ok) {
      throw new Error(`Failed to download ${payload.type} source: HTTP ${response.status}`)
    }
    return {
      receiveId: input.receiveId,
      receiveIdType: input.receiveIdType,
      fileName: payload.fileName ?? resolveUrlFileName(src, fallbackFileName),
      content: new Uint8Array(await response.arrayBuffer())
    }
  }

  const filePath = resolveLocalFilePath(src, input.cwd)
  return {
    receiveId: input.receiveId,
    receiveIdType: input.receiveIdType,
    fileName: payload.fileName ?? path.basename(filePath),
    content: await readFile(filePath)
  }
}

const buildMediaMessage = (
  payload: ManualPayload,
  input: {
    receiveId: string
    receiveIdType: string
  }
): ChannelMediaMessage => ({
  receiveId: input.receiveId,
  receiveIdType: input.receiveIdType,
  type: payload.type === 'image' ? 'image' : 'file',
  src: payload.src ?? '',
  ...(payload.fileName != null ? { fileName: payload.fileName } : {})
})

const resolveEmojiReference = async (
  payload: ManualPayload,
  input: {
    channelType: string
    cwd?: string
  }
): Promise<ChannelEmojiReference | { error: string }> => {
  if (payload.emoji != null) return payload.emoji

  if (payload.emojiMd5 != null && payload.emojiSize != null) {
    const platform = payload.platform ?? input.channelType
    return {
      id: payload.emojiId ?? payload.emojiMd5,
      platform,
      metadata: {
        emojiMd5: payload.emojiMd5,
        emojiSize: payload.emojiSize
      }
    }
  }

  const emojiId = payload.emojiId
  if (emojiId == null) return { error: 'Emoji message requires id or emojiMd5.' }
  const emoji = await findChannelEmojiRegistryEntry(resolveChannelMemoryRoot(input.cwd), {
    id: emojiId,
    platform: payload.platform ?? input.channelType
  })
  if (emoji == null) {
    return { error: `Emoji "${emojiId}" was not found in the ${payload.platform ?? input.channelType} registry.` }
  }
  return {
    id: emoji.id,
    platform: emoji.platform,
    ...(emoji.aliases == null || emoji.aliases.length === 0 ? {} : { aliases: emoji.aliases }),
    ...(emoji.label == null ? {} : { label: emoji.label }),
    ...(emoji.note == null ? {} : { note: emoji.note }),
    ...(emoji.tags == null || emoji.tags.length === 0 ? {} : { tags: emoji.tags }),
    ...(emoji.metadata == null ? {} : { metadata: emoji.metadata })
  }
}

const buildEmojiMessage = async (
  payload: ManualPayload,
  input: {
    channelType: string
    cwd?: string
    receiveId: string
    receiveIdType: string
  }
): Promise<ChannelEmojiMessage | { error: string }> => {
  const emoji = await resolveEmojiReference(payload, input)
  if ('error' in emoji) return emoji
  return {
    receiveId: input.receiveId,
    receiveIdType: input.receiveIdType,
    emoji
  }
}

const mergeMentions = (...groups: Array<ChannelTextMention[] | undefined>) => {
  const merged = groups.flatMap(group => group ?? [])
  return merged.length === 0 ? undefined : merged
}

export const sendManualChannelMessage = async (
  states: Map<string, ChannelRuntimeState>,
  input: SendManualChannelMessageInput
): Promise<SendManualChannelMessageResult> => {
  const state = states.get(input.channelKey)
  if (state?.connection == null) {
    return {
      ok: false,
      statusCode: 404,
      message: `Channel "${input.channelKey}" is not connected.`
    }
  }

  const sessionId = trimNonEmpty(input.sessionId)
  if (sessionId != null && state.config?.silentSessions?.includes(sessionId) === true) {
    return {
      ok: false,
      statusCode: 403,
      message: `Channel session "${sessionId}" is silent and cannot send messages.`
    }
  }

  const receiveId = trimNonEmpty(input.receiveId)
  if (receiveId == null) {
    return {
      ok: false,
      statusCode: 400,
      message: 'Missing receiveId. Pass --to or run from a channel session context.'
    }
  }

  const receiveIdType = trimNonEmpty(input.receiveIdType) ?? 'chat_id'
  const payload = parsePayload(input.payload)
  if ('error' in payload) {
    return {
      ok: false,
      statusCode: 400,
      message: payload.error
    }
  }
  if (payload.type === 'text') {
    const textLength = countChannelTextMessageCharacters(payload.text ?? '')
    if (textLength > MAX_CHANNEL_TEXT_MESSAGE_LENGTH) {
      return {
        ok: false,
        statusCode: 400,
        message: `Text message is too long: ${textLength}/${MAX_CHANNEL_TEXT_MESSAGE_LENGTH} characters.`
      }
    }
  }
  const mentions = mergeMentions(payload.mentions, normalizeMentions(input.mentions))

  try {
    if (payload.type === 'text') {
      const message: ChannelTextMessage = {
        ...(mentions == null ? {} : { mentions }),
        receiveId,
        receiveIdType,
        text: payload.text ?? ''
      }
      const result = await state.connection.sendMessage(message)
      return { ok: true, type: 'text', messageId: result?.messageId }
    }

    if (payload.type === 'emoji') {
      if (state.connection.sendEmojiMessage == null) {
        return {
          ok: false,
          statusCode: 501,
          message: `Channel "${input.channelKey}" does not support emoji messages.`
        }
      }
      const emojiMessage = await buildEmojiMessage(payload, {
        channelType: state.type,
        cwd: input.cwd,
        receiveId,
        receiveIdType
      })
      if ('error' in emojiMessage) {
        return {
          ok: false,
          statusCode: 400,
          message: emojiMessage.error
        }
      }
      const result = await state.connection.sendEmojiMessage(emojiMessage)
      return { ok: true, type: 'emoji', messageId: result?.messageId }
    }

    if (state.connection.sendMediaMessage != null && isHttpUrl(payload.src ?? '')) {
      const result = await state.connection.sendMediaMessage(buildMediaMessage(payload, {
        receiveId,
        receiveIdType
      }))
      return { ok: true, type: payload.type, messageId: result?.messageId }
    }

    if (state.connection.sendFileMessage != null) {
      const result = await state.connection.sendFileMessage(
        await loadFileMessage(payload, {
          cwd: input.cwd,
          receiveId,
          receiveIdType
        })
      )
      return { ok: true, type: payload.type, messageId: result?.messageId }
    }

    if (state.connection.sendMediaMessage != null) {
      const result = await state.connection.sendMediaMessage(buildMediaMessage(payload, {
        receiveId,
        receiveIdType
      }))
      return { ok: true, type: payload.type, messageId: result?.messageId }
    }

    return {
      ok: false,
      statusCode: 501,
      message: `Channel "${input.channelKey}" does not support ${payload.type} messages.`
    }
  } catch (error) {
    logger.warn({
      channelKey: input.channelKey,
      channelType: state.type,
      messageType: payload.type,
      receiveId,
      receiveIdType,
      error: error instanceof Error ? error.message : String(error)
    }, '[channel] Manual channel send failed')
    return {
      ok: false,
      statusCode: 500,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
