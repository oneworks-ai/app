/* eslint-disable max-lines -- WeChat API calls and send diagnostics stay colocated. */
import type { ChannelEmojiMessage, ChannelLogger, ChannelMediaMessage } from '@oneworks/core/channel'
import { countChannelTextMessageCharacters, truncateChannelTextMessage } from '@oneworks/core/channel'

import type {
  WechatChannelConfig,
  WechatChannelMessage,
  WechatChatroomMember,
  WechatChatroomMemberListResponse,
  WechatDownloadImageResponse,
  WechatPostMediaResponse,
  WechatPostTextResponse
} from '#~/types.js'

const defaultApiBaseUrl = 'http://api.wechatapi.net/finder/v2/api'
const MAX_WECHAT_LOG_TEXT_PREVIEW_LENGTH = 160

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const resolveApiBaseUrl = (config: WechatChannelConfig) => trimTrailingSlash(config.apiBaseUrl ?? defaultApiBaseUrl)

const truncateWechatLogTextPreview = (value: string) => {
  if (value.length <= MAX_WECHAT_LOG_TEXT_PREVIEW_LENGTH) return value
  return `${value.slice(0, MAX_WECHAT_LOG_TEXT_PREVIEW_LENGTH - 3)}...`
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const buildWechatSendLogContext = (
  message: WechatChannelMessage | ChannelEmojiMessage | ChannelMediaMessage,
  extra?: Record<string, unknown>
) => {
  const baseContext = {
    ...extra,
    channelType: 'wechat',
    receiveId: message.receiveId,
    receiveIdType: message.receiveIdType
  }
  if ('text' in message) {
    const ats = resolveWechatAts(message)
    return {
      ...baseContext,
      atAll: ats === 'notify@all',
      mentionCount: message.mentions?.length ?? 0,
      textLength: message.text.length,
      textPreview: truncateWechatLogTextPreview(message.text),
      hasToolCallSummary: message.toolCallSummary != null
    }
  }
  if ('emoji' in message) {
    return {
      ...baseContext,
      emojiId: message.emoji.id,
      emojiLabel: message.emoji.label,
      emojiPlatform: message.emoji.platform
    }
  }
  return {
    ...baseContext,
    mediaType: message.type,
    src: message.src,
    fileName: message.fileName
  }
}

const resolveWechatAppId = (
  config: WechatChannelConfig,
  appIdsByReceiveId: Map<string, string>,
  receiveId: string
) => {
  const configuredAppId = config.appId?.trim()
  const cachedAppId = appIdsByReceiveId.get(receiveId)?.trim()
  const hasConfiguredAppId = configuredAppId != null && configuredAppId !== ''
  const hasCachedAppId = cachedAppId != null && cachedAppId !== ''
  return {
    appId: hasConfiguredAppId
      ? configuredAppId
      : cachedAppId,
    appIdSource: hasConfiguredAppId
      ? 'config'
      : hasCachedAppId
      ? 'callback-cache'
      : 'missing'
  }
}

const getWechatMessageId = (result: WechatPostTextResponse | WechatPostMediaResponse) => (
  result.data?.newMsgId ?? result.data?.msgId
)

const resolveWechatAts = (message: WechatChannelMessage) => {
  const ids = message.mentions
    ?.map((mention) => mention.type === 'all' || mention.id === 'notify@all' ? 'notify@all' : mention.id.trim())
    .filter(id => id !== '') ?? []
  if (ids.includes('notify@all')) return 'notify@all'
  const uniqueIds = Array.from(new Set(ids))
  return uniqueIds.length === 0 ? undefined : uniqueIds.join(',')
}

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const toPositiveInteger = (value: unknown) => {
  const normalized = typeof value === 'number'
    ? value
    : Number.parseInt(trimNonEmpty(value) ?? '', 10)
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : undefined
}

const resolveWechatEmojiPayload = (message: ChannelEmojiMessage) => {
  const metadata = message.emoji.metadata ?? {}
  const emojiMd5 = trimNonEmpty(metadata.emojiMd5) ??
    trimNonEmpty(metadata.md5) ??
    trimNonEmpty(message.emoji.id)
  const emojiSize = toPositiveInteger(metadata.emojiSize) ??
    toPositiveInteger(metadata.size) ??
    toPositiveInteger(metadata.len)

  if (emojiMd5 == null) {
    throw new Error(`WeChat emoji "${message.emoji.id}" is missing emojiMd5`)
  }
  if (emojiSize == null) {
    throw new Error(`WeChat emoji "${message.emoji.id}" is missing emojiSize`)
  }

  return { emojiMd5, emojiSize }
}

export const postWechatApi = async <T>(
  config: WechatChannelConfig,
  path: string,
  body: unknown
) => {
  const response = await globalThis.fetch(`${resolveApiBaseUrl(config)}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'VideosApi-token': config.token
    },
    body: JSON.stringify(body)
  })

  const text = await response.text()
  let parsed: T & { ret?: number; msg?: string }
  try {
    parsed = JSON.parse(text) as T & { ret?: number; msg?: string }
  } catch {
    throw new Error(`WechatApi ${path} returned non-JSON response`)
  }

  if (!response.ok || parsed.ret !== 200) {
    throw new Error(`WechatApi ${path} failed: ${parsed.msg ?? `HTTP ${response.status}`}`)
  }

  return parsed
}

export const buildCallbackUrl = (config: WechatChannelConfig, channelKey: string) => {
  const publicBaseUrl = config.serverBaseUrl
  if (publicBaseUrl == null || publicBaseUrl.trim() === '') {
    return undefined
  }

  const base = trimTrailingSlash(publicBaseUrl.trim())
  const path = `/channels/wechat/${encodeURIComponent(channelKey)}/webhook`
  return `${base}${path}?secret=${encodeURIComponent(config.webhookSecret)}`
}

export const redactCallbackUrl = (url: string) => url.replace(/([?&]secret=)[^&]*/u, '$1<redacted>')

export const registerCallback = async (
  config: WechatChannelConfig,
  callbackUrl: string
) => {
  await postWechatApi<{ ret?: number; msg?: string }>(config, '/login/setCallback', {
    token: config.callbackToken ?? config.token,
    callbackUrl
  })
}

export const reconnectWechatAccount = async (
  config: WechatChannelConfig,
  appId: string
) => {
  await postWechatApi<{ ret?: number; msg?: string }>(config, '/login/reconnection', {
    appId
  })
}

export const getWechatChatroomMembers = async (
  config: WechatChannelConfig,
  appId: string,
  chatroomId: string
): Promise<WechatChatroomMember[]> => {
  const result = await postWechatApi<WechatChatroomMemberListResponse>(config, '/group/getChatroomMemberList', {
    appId,
    chatroomId
  })
  return result.data?.memberList ?? []
}

export const getWechatChatroomBotMember = async (
  config: WechatChannelConfig,
  appId: string,
  chatroomId: string,
  botWxid: string
): Promise<WechatChatroomMember | undefined> => {
  const members = await getWechatChatroomMembers(config, appId, chatroomId)
  return members.find(member => member.wxid === botWxid || member.userName === botWxid)
}

export const getWechatDownloadImageUrl = async (
  config: WechatChannelConfig,
  input: {
    appId: string
    type: number
    xml: string
  }
) => {
  const result = await postWechatApi<WechatDownloadImageResponse>(config, '/message/downloadImage', input)
  const fileUrl = result.data?.fileUrl?.trim()
  if (fileUrl == null || fileUrl === '') {
    throw new Error('WechatApi /message/downloadImage returned empty fileUrl')
  }
  return fileUrl
}

export const sendWechatTextMessage = async (
  config: WechatChannelConfig,
  appIdsByReceiveId: Map<string, string>,
  message: WechatChannelMessage,
  logger?: ChannelLogger
) => {
  const outboundText = truncateChannelTextMessage(message.text)
  const outboundMessage = outboundText === message.text ? message : { ...message, text: outboundText }
  const { appId, appIdSource } = resolveWechatAppId(config, appIdsByReceiveId, message.receiveId)
  if (appId == null || appId === '') {
    await logger?.error?.(
      buildWechatSendLogContext(outboundMessage, {
        appIdSource
      }),
      '[wechat] postText skipped because appId is missing'
    )
    throw new Error('WechatApi postText failed: missing appId')
  }

  const startedAt = Date.now()
  if (outboundText !== message.text) {
    await logger?.warn?.(
      buildWechatSendLogContext(outboundMessage, {
        originalTextLength: countChannelTextMessageCharacters(message.text),
        outboundTextLength: countChannelTextMessageCharacters(outboundText)
      }),
      '[wechat] truncated text reply before postText'
    )
  }
  await logger?.info?.(
    buildWechatSendLogContext(outboundMessage, {
      apiBaseUrl: resolveApiBaseUrl(config),
      apiPath: '/message/postText',
      appIdSource
    }),
    '[wechat] sending text reply via postText'
  )
  try {
    const ats = resolveWechatAts(outboundMessage)
    const result = await postWechatApi<WechatPostTextResponse>(config, '/message/postText', {
      appId,
      toWxid: outboundMessage.receiveId,
      content: outboundMessage.text,
      ...(ats == null ? {} : { ats })
    })

    const messageId = getWechatMessageId(result)
    await logger?.info?.(
      buildWechatSendLogContext(outboundMessage, {
        apiPath: '/message/postText',
        appIdSource,
        elapsedMs: Date.now() - startedAt,
        ret: result.ret,
        msg: result.msg,
        messageId: messageId == null ? undefined : String(messageId)
      }),
      '[wechat] sent text reply via postText'
    )
    return messageId == null ? undefined : { messageId: String(messageId) }
  } catch (error) {
    await logger?.error?.(
      buildWechatSendLogContext(outboundMessage, {
        apiPath: '/message/postText',
        appIdSource,
        elapsedMs: Date.now() - startedAt,
        error: getErrorMessage(error)
      }),
      '[wechat] failed to send text reply via postText'
    )
    throw error
  }
}

export const sendWechatMediaMessage = async (
  config: WechatChannelConfig,
  appIdsByReceiveId: Map<string, string>,
  message: ChannelMediaMessage,
  logger?: ChannelLogger
) => {
  if (!isHttpUrl(message.src)) {
    throw new Error('WechatApi media send requires an HTTP(S) URL src')
  }

  const { appId, appIdSource } = resolveWechatAppId(config, appIdsByReceiveId, message.receiveId)
  if (appId == null || appId === '') {
    await logger?.error?.(
      buildWechatSendLogContext(message, {
        appIdSource
      }),
      '[wechat] media send skipped because appId is missing'
    )
    throw new Error('WechatApi media send failed: missing appId')
  }

  const apiPath = message.type === 'image' ? '/message/postImage' : '/message/postFile'
  const body = message.type === 'image'
    ? {
      appId,
      toWxid: message.receiveId,
      imgUrl: message.src
    }
    : {
      appId,
      toWxid: message.receiveId,
      fileName: message.fileName ?? 'file',
      fileUrl: message.src
    }

  const startedAt = Date.now()
  await logger?.info?.(
    buildWechatSendLogContext(message, {
      apiBaseUrl: resolveApiBaseUrl(config),
      apiPath,
      appIdSource
    }),
    '[wechat] sending media message'
  )
  try {
    const result = await postWechatApi<WechatPostMediaResponse>(config, apiPath, body)
    const messageId = getWechatMessageId(result)
    await logger?.info?.(
      buildWechatSendLogContext(message, {
        apiPath,
        appIdSource,
        elapsedMs: Date.now() - startedAt,
        ret: result.ret,
        msg: result.msg,
        messageId: messageId == null ? undefined : String(messageId)
      }),
      '[wechat] sent media message'
    )
    return messageId == null ? undefined : { messageId: String(messageId) }
  } catch (error) {
    await logger?.error?.(
      buildWechatSendLogContext(message, {
        apiPath,
        appIdSource,
        elapsedMs: Date.now() - startedAt,
        error: getErrorMessage(error)
      }),
      '[wechat] failed to send media message'
    )
    throw error
  }
}

export const sendWechatEmojiMessage = async (
  config: WechatChannelConfig,
  appIdsByReceiveId: Map<string, string>,
  message: ChannelEmojiMessage,
  logger?: ChannelLogger
) => {
  const { appId, appIdSource } = resolveWechatAppId(config, appIdsByReceiveId, message.receiveId)
  if (appId == null || appId === '') {
    await logger?.error?.(
      buildWechatSendLogContext(message, {
        appIdSource
      }),
      '[wechat] emoji send skipped because appId is missing'
    )
    throw new Error('WechatApi emoji send failed: missing appId')
  }

  const startedAt = Date.now()
  await logger?.info?.(
    buildWechatSendLogContext(message, {
      apiBaseUrl: resolveApiBaseUrl(config),
      apiPath: '/message/postEmoji',
      appIdSource
    }),
    '[wechat] sending emoji message'
  )
  try {
    const emoji = resolveWechatEmojiPayload(message)
    const result = await postWechatApi<WechatPostMediaResponse>(config, '/message/postEmoji', {
      appId,
      toWxid: message.receiveId,
      emojiMd5: emoji.emojiMd5,
      emojiSize: emoji.emojiSize
    })
    const messageId = getWechatMessageId(result)
    await logger?.info?.(
      buildWechatSendLogContext(message, {
        apiPath: '/message/postEmoji',
        appIdSource,
        elapsedMs: Date.now() - startedAt,
        ret: result.ret,
        msg: result.msg,
        messageId: messageId == null ? undefined : String(messageId)
      }),
      '[wechat] sent emoji message'
    )
    return messageId == null ? undefined : { messageId: String(messageId) }
  } catch (error) {
    await logger?.error?.(
      buildWechatSendLogContext(message, {
        apiPath: '/message/postEmoji',
        appIdSource,
        elapsedMs: Date.now() - startedAt,
        error: getErrorMessage(error)
      }),
      '[wechat] failed to send emoji message'
    )
    throw error
  }
}
