/* eslint-disable max-lines -- Telegram webhook transport and Bot API normalization stay colocated in this package. */
import type {
  ChannelConnection,
  ChannelEventHandlers,
  ChannelFileMessage,
  ChannelInboundEvent,
  ChannelLogger,
  ChannelWebhookRequest,
  ChannelWebhookResponse
} from '@oneworks/core/channel'
import { defineCreateChannelConnection } from '@oneworks/core/channel'

import type {
  TelegramApiResponse,
  TelegramChannelConfig,
  TelegramChannelMessage,
  TelegramMessage,
  TelegramSendMessageResult,
  TelegramToolCallSummary,
  TelegramUpdate
} from '#~/types.js'

const defaultApiBaseUrl = 'https://api.telegram.org'

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const maxToolSummaryLineLength = 320

const truncateToolSummaryLine = (value: string) => (
  value.length <= maxToolSummaryLineLength ? value : `${value.slice(0, maxToolSummaryLineLength - 3)}...`
)

const toSingleLine = (value: string) => value.replace(/\s+/g, ' ').trim()

const formatToolCallSummaryText = (summary: TelegramToolCallSummary) => {
  const lines = [summary.title?.trim() || `工具调用（${summary.items.length}）`]

  for (const item of summary.items) {
    lines.push(`工具: ${item.name}`)
    lines.push(`状态: ${item.status === 'success' ? '成功' : item.status === 'error' ? '失败' : '执行中'}`)
    if (item.argsText != null) {
      lines.push(`参数: ${truncateToolSummaryLine(toSingleLine(item.argsText))}`)
    }
    if (item.resultText != null) {
      lines.push(
        `${item.status === 'error' ? '错误' : '结果'}: ${truncateToolSummaryLine(toSingleLine(item.resultText))}`
      )
    }
    if (item.detailUrl != null) {
      lines.push(`详情: ${item.detailUrl}`)
    }
    if (item.exportJsonUrl != null) {
      lines.push(`导出: ${item.exportJsonUrl}`)
    }
  }

  return lines.join('\n')
}

const resolveTelegramMessageText = (message: TelegramChannelMessage) => (
  message.toolCallSummary == null ? message.text : formatToolCallSummaryText(message.toolCallSummary)
)

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const resolveTelegramApiBaseUrl = (config: TelegramChannelConfig) => (
  `${trimTrailingSlash(config.apiBaseUrl ?? defaultApiBaseUrl)}/bot${config.botToken}`
)

const telegramApi = async <T>(
  config: TelegramChannelConfig,
  method: string,
  body: BodyInit,
  headers?: Record<string, string>
) => {
  const response = await globalThis.fetch(`${resolveTelegramApiBaseUrl(config)}/${method}`, {
    method: 'POST',
    headers,
    body
  })
  if (!response.ok) {
    throw new Error(`Telegram ${method} failed: HTTP ${response.status}`)
  }
  const result = await response.json() as TelegramApiResponse<T>
  if (result.ok === false) {
    throw new Error(`Telegram ${method} failed: ${result.description ?? 'unknown error'}`)
  }
  return result.result
}

const telegramJsonApi = async <T>(
  config: TelegramChannelConfig,
  method: string,
  payload: Record<string, unknown>
) =>
  await telegramApi<T>(config, method, JSON.stringify(payload), {
    'Content-Type': 'application/json'
  })

const parseTelegramTarget = (
  receiveId: string,
  overrides?: {
    messageThreadId?: number
    replyMessageId?: number
  }
) => {
  const [chatId, ...parts] = receiveId.split('#')
  let messageThreadId = overrides?.messageThreadId
  let replyMessageId = overrides?.replyMessageId

  for (const part of parts) {
    if (part.startsWith('thread=')) {
      const value = Number.parseInt(decodeURIComponent(part.slice('thread='.length)), 10)
      if (Number.isFinite(value)) messageThreadId = value
    } else if (part.startsWith('reply=')) {
      const value = Number.parseInt(decodeURIComponent(part.slice('reply='.length)), 10)
      if (Number.isFinite(value)) replyMessageId = value
    }
  }

  return { chatId, messageThreadId, replyMessageId }
}

const encodeTelegramTarget = (
  chatId: string,
  options: {
    messageThreadId?: number
    replyMessageId?: number
  } = {}
) => {
  const parts = [chatId]
  if (options.messageThreadId != null) {
    parts.push(`thread=${encodeURIComponent(String(options.messageThreadId))}`)
  }
  if (options.replyMessageId != null) {
    parts.push(`reply=${encodeURIComponent(String(options.replyMessageId))}`)
  }
  return parts.join('#')
}

const buildTelegramMessagePayload = (
  message: TelegramChannelMessage
) => {
  const target = parseTelegramTarget(message.receiveId, {
    messageThreadId: message.messageThreadId,
    replyMessageId: message.replyMessageId
  })
  return {
    chat_id: target.chatId,
    text: resolveTelegramMessageText(message),
    ...(target.messageThreadId == null ? {} : { message_thread_id: target.messageThreadId }),
    ...(target.replyMessageId == null
      ? {}
      : {
        reply_parameters: {
          message_id: target.replyMessageId
        }
      })
  }
}

const sendTelegramTextMessage = async (
  config: TelegramChannelConfig,
  message: TelegramChannelMessage
) => {
  const result = await telegramJsonApi<TelegramSendMessageResult>(
    config,
    'sendMessage',
    buildTelegramMessagePayload(message)
  )
  return { messageId: result?.message_id == null ? undefined : String(result.message_id) }
}

const sendTelegramFileMessage = async (
  config: TelegramChannelConfig,
  message: ChannelFileMessage
) => {
  const target = parseTelegramTarget(message.receiveId)
  const fileContent = typeof message.content === 'string'
    ? message.content
    : message.content.buffer.slice(
      message.content.byteOffset,
      message.content.byteOffset + message.content.byteLength
    ) as ArrayBuffer
  const form = new FormData()
  form.set('chat_id', target.chatId)
  form.set('document', new Blob([fileContent]), message.fileName)
  if (target.messageThreadId != null) {
    form.set('message_thread_id', String(target.messageThreadId))
  }
  if (target.replyMessageId != null) {
    form.set('reply_parameters', JSON.stringify({ message_id: target.replyMessageId }))
  }
  const result = await telegramApi<TelegramSendMessageResult>(config, 'sendDocument', form)
  return { messageId: result?.message_id == null ? undefined : String(result.message_id) }
}

const getHeader = (
  headers: Record<string, string | string[] | undefined>,
  name: string
) => {
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue
    return Array.isArray(value) ? value[0] : value
  }
  return undefined
}

const getQueryValue = (
  query: Record<string, string | string[] | undefined>,
  name: string
) => {
  const value = query[name]
  return Array.isArray(value) ? value[0] : value
}

const verifyTelegramWebhookSecret = (
  config: TelegramChannelConfig,
  request: ChannelWebhookRequest
) => {
  const secret = config.webhookSecret
  if (secret == null || secret === '') return true
  const received = getQueryValue(request.query, 'secret') ??
    getHeader(request.headers, 'x-oneworks-channel-secret') ??
    getHeader(request.headers, 'x-telegram-bot-api-secret-token')
  return received === secret
}

const isTelegramGroup = (message: TelegramMessage) => {
  const type = message.chat?.type
  return type === 'group' || type === 'supergroup' || type === 'channel'
}

const resolveTelegramSenderLabel = (message: TelegramMessage) => {
  const sender = message.from
  const id = sender?.id == null ? undefined : String(sender.id)
  if (id == null) return undefined
  const name = [sender?.first_name, sender?.last_name].filter(Boolean).join(' ').trim()
  const username = sender?.username == null ? undefined : `@${sender.username}`
  const details = [name === '' ? undefined : name, username].filter(Boolean).join(' / ')
  return details === '' ? id : `${id}（${details}）`
}

const normalizeTelegramText = (
  message: TelegramMessage,
  config: TelegramChannelConfig
) => {
  let text = message.text ?? message.caption ?? ''
  if (config.botUsername != null && config.botUsername !== '') {
    text = text.replace(new RegExp(`^(/\\w+)@${config.botUsername}\\b`, 'i'), '$1')
  }
  if (text.trim() !== '') return text.trim()

  if (message.sticker != null) {
    return [
      '[Telegram sticker]',
      message.sticker.emoji == null ? undefined : `emoji=${message.sticker.emoji}`,
      message.sticker.set_name == null ? undefined : `set=${message.sticker.set_name}`,
      message.sticker.file_id == null ? undefined : `file_id=${message.sticker.file_id}`
    ].filter(Boolean).join(' ')
  }

  if (message.document != null) {
    return [
      '[Telegram document]',
      message.document.file_name == null ? undefined : `name=${message.document.file_name}`,
      message.document.mime_type == null ? undefined : `mime=${message.document.mime_type}`,
      message.document.file_id == null ? undefined : `file_id=${message.document.file_id}`
    ].filter(Boolean).join(' ')
  }

  if ((message.photo?.length ?? 0) > 0) {
    const largest = [...(message.photo ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]
    return [
      '[Telegram photo]',
      largest?.width == null || largest.height == null ? undefined : `${largest.width}x${largest.height}`,
      largest?.file_id == null ? undefined : `file_id=${largest.file_id}`
    ].filter(Boolean).join(' ')
  }

  return ''
}

const toTelegramInboundEvent = (
  update: TelegramUpdate,
  config: TelegramChannelConfig
): ChannelInboundEvent | null => {
  const message = update.message ?? update.edited_message
  if (message == null || message.message_id == null || message.chat?.id == null) return null
  if (message.from?.is_bot === true) return null

  const chatId = String(message.chat.id)
  const isGroup = isTelegramGroup(message)
  const messageThreadId = isGroup ? message.message_thread_id : undefined
  const bindingChannelId = isGroup && messageThreadId != null
    ? encodeTelegramTarget(chatId, { messageThreadId })
    : chatId
  const replyReceiveId = encodeTelegramTarget(chatId, {
    messageThreadId,
    replyMessageId: message.message_id
  })
  const text = normalizeTelegramText(message, config)
  if (text === '') return null

  const senderId = message.from?.id == null ? undefined : String(message.from.id)
  const senderLabel = resolveTelegramSenderLabel(message)
  const displayText = senderLabel == null ? text : `[${senderLabel}]:\n${text}`

  return {
    channelType: 'telegram',
    sessionType: isGroup ? 'group' : 'direct',
    channelId: bindingChannelId,
    senderId,
    messageId: String(message.message_id),
    text: displayText,
    replyTo: {
      receiveId: replyReceiveId,
      receiveIdType: 'chat_id'
    },
    raw: {
      update,
      message,
      accessChannelId: chatId,
      bindingChannelId,
      messageThreadId,
      contentItems: [{ type: 'text', text: displayText }]
    }
  }
}

const buildWebhookUrl = (
  config: TelegramChannelConfig,
  channelKey: string
) => {
  const baseUrl = config.serverBaseUrl?.trim()
  if (baseUrl == null || baseUrl === '') return undefined
  return `${trimTrailingSlash(baseUrl)}/channels/telegram/${encodeURIComponent(channelKey)}/webhook`
}

const setTelegramWebhook = async (
  config: TelegramChannelConfig,
  url: string
) => {
  await telegramJsonApi(config, 'setWebhook', {
    url,
    ...(config.webhookSecret == null ? {} : { secret_token: config.webhookSecret })
  })
}

export const createChannelConnection = defineCreateChannelConnection(async (
  config: TelegramChannelConfig,
  options?: {
    logger?: ChannelLogger
  }
): Promise<ChannelConnection<TelegramChannelMessage>> => {
  const logger = options?.logger
  let handlers: ChannelEventHandlers | undefined

  const handleWebhook = async (request: ChannelWebhookRequest): Promise<ChannelWebhookResponse> => {
    if (!verifyTelegramWebhookSecret(config, request)) {
      return { statusCode: 403, body: { error: 'invalid webhook secret' } }
    }
    const inbound = toTelegramInboundEvent(request.body as TelegramUpdate, config)
    if (inbound != null) {
      await handlers?.message?.(inbound)
    }
    return { statusCode: 200, body: '' }
  }

  return {
    sendMessage: async message => await sendTelegramTextMessage(config, message),
    sendFileMessage: async message => await sendTelegramFileMessage(config, message),
    handleWebhook,
    startReceiving: async ({ channelKey, handlers: nextHandlers }) => {
      handlers = nextHandlers
      if (config.autoSetWebhook !== true || channelKey == null) return
      const webhookUrl = buildWebhookUrl(config, channelKey)
      if (webhookUrl == null) {
        await logger?.info?.(
          { channelType: 'telegram', channelKey },
          '[telegram] webhook ready; missing public server URL'
        )
        return
      }
      try {
        await setTelegramWebhook(config, webhookUrl)
        await logger?.info?.({ channelType: 'telegram', channelKey }, '[telegram] webhook registered')
      } catch (error) {
        await logger?.error?.(
          { channelType: 'telegram', channelKey, error: getErrorMessage(error) },
          '[telegram] webhook registration failed'
        )
      }
    }
  }
})
