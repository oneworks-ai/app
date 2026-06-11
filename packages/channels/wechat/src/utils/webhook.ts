/* eslint-disable max-lines -- WeChat webhook parsing and diagnostics stay colocated. */
import { createHash, timingSafeEqual } from 'node:crypto'

import type { ChatMessageContent } from '@oneworks/core'
import type {
  ChannelEventHandlers,
  ChannelInboundEvent,
  ChannelLogger,
  ChannelWebhookRequest,
  ChannelWebhookResponse
} from '@oneworks/core/channel'

import type { WechatCallbackPayload, WechatChannelConfig, WechatChatroomMember } from '#~/types.js'

import { getWechatChatroomMembers } from './api'
import { buildWechatMediaContent } from './media-content'

interface NormalizedWechatMessage {
  appId: string
  channelId: string
  contentItems: ChatMessageContent[]
  emojis?: unknown[]
  senderId: string
  sessionType: 'direct' | 'group'
  messageId: string
  text: string
  receiveId: string
  receiveIdType: 'wxid' | 'chatroom'
}

export interface CreateWechatWebhookHandlerOptions {
  config: WechatChannelConfig
  logger?: ChannelLogger
  appIdsByReceiveId: Map<string, string>
  getHandlers: () => ChannelEventHandlers | undefined
}

interface WechatMentionAliasCacheEntry {
  aliases: string[]
  expiresAt: number
}

interface WechatChatroomMemberCacheEntry {
  expiresAt: number
  members: WechatChatroomMember[]
}

const WECHAT_MENTION_ALIAS_CACHE_TTL_MS = 10 * 60 * 1000
const WECHAT_CHATROOM_MEMBER_CACHE_TTL_MS = 10 * 60 * 1000
const WECHAT_WEBHOOK_REPLAY_GRACE_MS = 60 * 1000
const WECHAT_SYSTEM_MESSAGE_TYPES = new Set([51, 10002])
const WECHAT_SYSTEM_DIRECT_SENDERS = new Set(['weixin'])

const getFirstString = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0]
  return value
}

const getHeader = (headers: Record<string, string | string[] | undefined>, key: string) => {
  const normalizedKey = key.toLowerCase()
  for (const [headerKey, value] of Object.entries(headers)) {
    if (headerKey.toLowerCase() === normalizedKey) {
      return getFirstString(value)
    }
  }
  return undefined
}

const safeEqual = (left: string, right: string) => {
  const leftDigest = createHash('sha256').update(left).digest()
  const rightDigest = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

const resolveWebhookSecret = (request: ChannelWebhookRequest) => (
  getFirstString(request.query.secret) ??
    getHeader(request.headers, 'x-oneworks-channel-secret') ??
    getHeader(request.headers, 'x-wechatapi-secret')
)

const verifyWebhookSecret = (config: WechatChannelConfig, request: ChannelWebhookRequest) => {
  const provided = resolveWebhookSecret(request)
  return typeof provided === 'string' && safeEqual(provided, config.webhookSecret)
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isWechatSystemDirectSender = (wxid: string) => WECHAT_SYSTEM_DIRECT_SENDERS.has(wxid)

const asWechatPayload = (body: unknown): WechatCallbackPayload | undefined => {
  if (!isRecord(body)) return undefined
  return body as WechatCallbackPayload
}

const getPayloadLogContext = (payload: WechatCallbackPayload) => ({
  appId: payload.Appid,
  botWxid: payload.Wxid,
  fromWxid: payload.Data?.FromUserName?.string,
  toWxid: payload.Data?.ToUserName?.string,
  messageId: payload.Data?.NewMsgId ?? payload.Data?.MsgId,
  msgType: payload.Data?.MsgType,
  typeName: payload.TypeName
})

const buildPayloadDebugLogContext = (payload: WechatCallbackPayload) => {
  const content = payload.Data?.Content?.string
  return {
    channelType: 'wechat',
    ...getPayloadLogContext(payload),
    dataKeys: payload.Data == null ? [] : Object.keys(payload.Data).sort(),
    contentLength: content?.length ?? 0,
    contentPreview: content == null ? undefined : content.slice(0, 2000),
    rawPayload: payload
  }
}

const resolvePayloadCreateTimeMs = (payload: WechatCallbackPayload) => {
  const value = payload.Data?.CreateTime
  const numeric = typeof value === 'string' ? Number(value) : value
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return undefined
  return numeric > 1_000_000_000_000 ? numeric : numeric * 1000
}

const isStaleReplayPayload = (payload: WechatCallbackPayload, handlerStartedAt: number) => {
  const createTimeMs = resolvePayloadCreateTimeMs(payload)
  if (createTimeMs == null) return false
  return createTimeMs < handlerStartedAt - WECHAT_WEBHOOK_REPLAY_GRACE_MS
}

const stripWechatGroupSpeakerPrefix = (content: string) => {
  const separator = ':\n'
  const index = content.indexOf(separator)
  if (index <= 0) {
    return {
      text: content
    }
  }
  return {
    senderId: content.slice(0, index),
    text: content.slice(index + separator.length)
  }
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const uniqueNonEmptyStrings = (values: Array<string | null | undefined>) => {
  const unique = new Set<string>()
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed != null && trimmed !== '') {
      unique.add(trimmed)
    }
  }
  return [...unique]
}

const getFallbackMentionAliases = (config: WechatChannelConfig) => uniqueNonEmptyStrings([config.title])

const findWechatChatroomMember = (members: readonly WechatChatroomMember[], wxid: string) => (
  members.find(member => member.wxid === wxid || member.userName === wxid)
)

const resolveWechatChatroomMembers = async (
  config: WechatChannelConfig,
  memberCache: Map<string, WechatChatroomMemberCacheEntry>,
  input: {
    appId: string
    chatroomId: string
  },
  logger?: ChannelLogger
) => {
  const cacheKey = `${input.appId}:${input.chatroomId}`
  const cached = memberCache.get(cacheKey)
  const now = Date.now()
  if (cached != null && cached.expiresAt > now) {
    return cached.members
  }

  try {
    const members = await getWechatChatroomMembers(config, input.appId, input.chatroomId)
    memberCache.set(cacheKey, {
      expiresAt: now + WECHAT_CHATROOM_MEMBER_CACHE_TTL_MS,
      members
    })
    return members
  } catch (error) {
    await logger?.warn?.({
      channelType: 'wechat',
      chatroomId: input.chatroomId,
      error: getErrorMessage(error)
    }, '[wechat] failed to resolve chatroom members')
    return []
  }
}

const resolveWechatMentionAliases = async (
  config: WechatChannelConfig,
  aliasCache: Map<string, WechatMentionAliasCacheEntry>,
  memberCache: Map<string, WechatChatroomMemberCacheEntry>,
  input: {
    appId: string
    botWxid?: string
    chatroomId: string
  },
  logger?: ChannelLogger
) => {
  const fallbackAliases = getFallbackMentionAliases(config)
  if (input.botWxid == null || input.botWxid === '') return fallbackAliases

  const cacheKey = `${input.appId}:${input.chatroomId}:${input.botWxid}`
  const cached = aliasCache.get(cacheKey)
  const now = Date.now()
  if (cached != null && cached.expiresAt > now) {
    return cached.aliases
  }

  const members = await resolveWechatChatroomMembers(config, memberCache, {
    appId: input.appId,
    chatroomId: input.chatroomId
  }, logger)
  const member = findWechatChatroomMember(members, input.botWxid)
  const aliases = uniqueNonEmptyStrings([
    member?.displayName,
    member?.nickName,
    ...fallbackAliases
  ])
  aliasCache.set(cacheKey, {
    aliases,
    expiresAt: now + WECHAT_MENTION_ALIAS_CACHE_TTL_MS
  })
  return aliases
}

const stripLeadingWechatMention = (text: string, aliases: readonly string[]) => {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('@')) return text

  const mentionText = trimmed.slice(1)
  const sortedAliases = [...aliases].sort((left, right) => right.length - left.length)
  for (const alias of sortedAliases) {
    if (!mentionText.startsWith(alias)) continue
    const rest = mentionText.slice(alias.length)
    const restTrimmedStart = rest.trimStart()
    if (rest === '' || restTrimmedStart.length !== rest.length) {
      return restTrimmedStart
    }
  }

  return text
}

const buildWechatSenderLabel = (senderId: string, member: WechatChatroomMember | undefined) => {
  const labels = uniqueNonEmptyStrings([
    member?.nickName,
    member?.displayName
  ]).filter(label => label !== senderId)
  if (labels.length === 0) return senderId
  return `${senderId}${labels.map(label => `（${label}）`).join('')}`
}

const resolveWechatSenderLabel = async (
  config: WechatChannelConfig,
  memberCache: Map<string, WechatChatroomMemberCacheEntry>,
  input: {
    appId: string
    chatroomId: string
    senderId: string
  },
  logger?: ChannelLogger
) => {
  const members = await resolveWechatChatroomMembers(config, memberCache, {
    appId: input.appId,
    chatroomId: input.chatroomId
  }, logger)
  return buildWechatSenderLabel(input.senderId, findWechatChatroomMember(members, input.senderId))
}

const normalizeWechatMessage = async (
  payload: WechatCallbackPayload,
  config: WechatChannelConfig,
  aliasCache: Map<string, WechatMentionAliasCacheEntry>,
  memberCache: Map<string, WechatChatroomMemberCacheEntry>,
  logger?: ChannelLogger
): Promise<NormalizedWechatMessage | null> => {
  if (payload.TypeName !== 'AddMsg') return null

  const data = payload.Data
  const msgType = Number(data?.MsgType)
  if (data == null || !Number.isFinite(msgType)) return null
  if (WECHAT_SYSTEM_MESSAGE_TYPES.has(msgType)) return null

  const fromWxid = data.FromUserName?.string
  if (fromWxid == null || fromWxid === '') return null
  if (isWechatSystemDirectSender(fromWxid)) return null

  if (payload.Wxid != null && fromWxid === payload.Wxid) return null

  const appId = payload.Appid ?? config.appId
  if (appId == null || appId === '') return null

  const rawText = data.Content?.string ?? ''
  const isGroup = fromWxid.endsWith('@chatroom')
  const parsedGroupText = isGroup ? stripWechatGroupSpeakerPrefix(rawText) : { text: rawText }
  const mediaMessageId = String(data.NewMsgId ?? data.MsgId ?? `${Date.now()}:${fromWxid}`)
  const mediaContent = msgType === 1
    ? undefined
    : await buildWechatMediaContent(payload, {
      appId,
      config,
      content: parsedGroupText.text,
      messageId: mediaMessageId,
      msgType
    }, logger)
  if (msgType !== 1 && mediaContent == null) return null

  const messageText = msgType === 1 && isGroup && parsedGroupText.text.trimStart().startsWith('@')
    ? stripLeadingWechatMention(
      parsedGroupText.text,
      await resolveWechatMentionAliases(config, aliasCache, memberCache, {
        appId,
        botWxid: payload.Wxid,
        chatroomId: fromWxid
      }, logger)
    )
    : mediaContent?.text ?? parsedGroupText.text
  const senderId = isGroup ? parsedGroupText.senderId ?? fromWxid : fromWxid
  const senderLabel = isGroup
    ? await resolveWechatSenderLabel(config, memberCache, {
      appId,
      chatroomId: fromWxid,
      senderId
    }, logger)
    : senderId
  const messageId = mediaMessageId
  const text = `[${senderLabel}]:\n${messageText}`
  const contentItems: ChatMessageContent[] = [
    { type: 'text', text },
    ...(mediaContent?.contentItems ?? [])
  ]

  return {
    appId,
    channelId: fromWxid,
    contentItems,
    emojis: mediaContent?.emojis,
    senderId,
    sessionType: isGroup ? 'group' : 'direct',
    messageId: `${appId}:${messageId}`,
    text,
    receiveId: fromWxid,
    receiveIdType: isGroup ? 'chatroom' : 'wxid'
  }
}

const toInboundEvent = (
  message: NormalizedWechatMessage,
  payload: WechatCallbackPayload
): ChannelInboundEvent => ({
  channelType: 'wechat',
  sessionType: message.sessionType,
  channelId: message.channelId,
  senderId: message.senderId,
  messageId: message.messageId,
  text: message.text,
  replyTo: {
    receiveId: message.receiveId,
    receiveIdType: message.receiveIdType
  },
  raw: {
    payload,
    contentItems: message.contentItems,
    ...(message.emojis == null || message.emojis.length === 0 ? {} : { emojis: message.emojis })
  }
})

export const createWechatWebhookHandler = ({
  appIdsByReceiveId,
  config,
  getHandlers,
  logger
}: CreateWechatWebhookHandlerOptions) => {
  const aliasCache = new Map<string, WechatMentionAliasCacheEntry>()
  const memberCache = new Map<string, WechatChatroomMemberCacheEntry>()
  const handlerStartedAt = Date.now()

  return async (
    request: ChannelWebhookRequest
  ): Promise<ChannelWebhookResponse> => {
    if (!verifyWebhookSecret(config, request)) {
      return {
        statusCode: 403,
        body: { error: 'invalid webhook secret' }
      }
    }

    const payload = asWechatPayload(request.body)
    if (payload == null) {
      await logger?.warn?.({
        channelType: 'wechat',
        bodyType: request.body == null ? 'nullish' : typeof request.body
      }, '[wechat] ignored webhook because payload is invalid')
      return {
        statusCode: 400,
        body: { error: 'invalid webhook payload' }
      }
    }

    if (isStaleReplayPayload(payload, handlerStartedAt)) {
      await logger?.info?.({
        channelType: 'wechat',
        ...getPayloadLogContext(payload),
        createTimeMs: resolvePayloadCreateTimeMs(payload),
        handlerStartedAt
      }, '[wechat] ignored stale webhook replay')
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: ''
      }
    }

    await logger?.info?.(
      buildPayloadDebugLogContext(payload),
      '[wechat] webhook raw payload debug'
    )

    const message = await normalizeWechatMessage(payload, config, aliasCache, memberCache, logger)
    if (message == null) {
      await logger?.info?.({
        channelType: 'wechat',
        ...getPayloadLogContext(payload)
      }, '[wechat] ignored webhook because payload is not a supported inbound text message')
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: ''
      }
    }

    appIdsByReceiveId.set(message.receiveId, message.appId)
    const inbound = toInboundEvent(message, payload)
    await logger?.info?.({
      channelType: 'wechat',
      channelId: inbound.channelId,
      sessionType: inbound.sessionType,
      senderId: inbound.senderId,
      messageId: inbound.messageId,
      receiveId: message.receiveId,
      receiveIdType: message.receiveIdType,
      contentItemCount: message.contentItems.length,
      textLength: message.text.length
    }, '[wechat] received inbound webhook')
    void Promise.resolve(getHandlers()?.message?.(inbound)).catch((error) => {
      void logger?.error?.({
        channelType: 'wechat',
        channelId: inbound.channelId,
        messageId: inbound.messageId,
        error: error instanceof Error ? error.message : String(error)
      }, '[wechat] Failed to handle inbound webhook message')
    })

    return {
      statusCode: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: ''
    }
  }
}
