/* eslint-disable max-lines -- Discord Gateway transport and REST normalization stay colocated in this package. */
import type {
  ChannelConnection,
  ChannelEventHandlers,
  ChannelFileMessage,
  ChannelInboundEvent,
  ChannelLogger
} from '@oneworks/core/channel'
import { defineCreateChannelConnection } from '@oneworks/core/channel'

import type {
  DiscordChannelConfig,
  DiscordChannelMessage,
  DiscordGatewayPayload,
  DiscordMessagePayload,
  DiscordSendMessageResponse,
  DiscordToolCallSummary
} from '#~/types.js'

const defaultApiBaseUrl = 'https://discord.com/api/v10'
const defaultGatewayUrl = 'wss://gateway.discord.gg/?v=10&encoding=json'
const discordMessageLimit = 2000
const discordGatewayIntents = 512 | 4096 | 32768

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const maxToolSummaryLineLength = 320

const truncateToolSummaryLine = (value: string) => (
  value.length <= maxToolSummaryLineLength ? value : `${value.slice(0, maxToolSummaryLineLength - 3)}...`
)

const toSingleLine = (value: string) => value.replace(/\s+/g, ' ').trim()

const formatToolCallSummaryText = (summary: DiscordToolCallSummary) => {
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

const resolveDiscordMessageText = (message: DiscordChannelMessage) => (
  message.toolCallSummary == null ? message.text : formatToolCallSummaryText(message.toolCallSummary)
)

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const resolveApiBaseUrl = (config: DiscordChannelConfig) => trimTrailingSlash(config.apiBaseUrl ?? defaultApiBaseUrl)

const discordFetch = async (
  config: DiscordChannelConfig,
  path: string,
  init: RequestInit
) => {
  const response = await globalThis.fetch(`${resolveApiBaseUrl(config)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${config.botToken}`,
      ...init.headers
    }
  })
  if (!response.ok) {
    throw new Error(`Discord API ${path} failed: HTTP ${response.status}`)
  }
  return response
}

const splitDiscordText = (text: string) => {
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += discordMessageLimit) {
    chunks.push(text.slice(index, index + discordMessageLimit))
  }
  return chunks.length === 0 ? [''] : chunks
}

const sendDiscordTextMessage = async (
  config: DiscordChannelConfig,
  message: DiscordChannelMessage
) => {
  let lastMessageId: string | undefined
  for (const content of splitDiscordText(resolveDiscordMessageText(message))) {
    const response = await discordFetch(config, `/channels/${encodeURIComponent(message.receiveId)}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content })
    })
    const result = await response.json() as DiscordSendMessageResponse
    lastMessageId = result.id ?? lastMessageId
  }
  return { messageId: lastMessageId }
}

const sendDiscordFileMessage = async (
  config: DiscordChannelConfig,
  message: ChannelFileMessage
) => {
  const fileContent = typeof message.content === 'string'
    ? message.content
    : message.content.buffer.slice(
      message.content.byteOffset,
      message.content.byteOffset + message.content.byteLength
    ) as ArrayBuffer
  const form = new FormData()
  form.set('payload_json', JSON.stringify({ content: message.fileName }))
  form.set('files[0]', new Blob([fileContent]), message.fileName)

  const response = await discordFetch(config, `/channels/${encodeURIComponent(message.receiveId)}/messages`, {
    method: 'POST',
    body: form
  })
  const result = await response.json() as DiscordSendMessageResponse
  return { messageId: result.id }
}

const formatDiscordSender = (message: DiscordMessagePayload) => {
  const author = message.author
  const id = author?.id
  const name = author?.global_name ?? author?.username
  if (id == null) return undefined
  if (name == null || name === '') return id
  if (author?.discriminator != null && author.discriminator !== '0') {
    return `${id}（${name}#${author.discriminator}）`
  }
  return `${id}（${name}）`
}

const formatDiscordNativeContent = (message: DiscordMessagePayload) => {
  const lines: string[] = []
  for (const sticker of message.stickers ?? []) {
    lines.push(`[Discord sticker] ${sticker.name ?? sticker.id ?? 'unknown'}`)
  }
  for (const embed of message.embeds ?? []) {
    const parts = [
      embed.title == null ? undefined : `title=${embed.title}`,
      embed.description == null ? undefined : `description=${embed.description}`,
      embed.url == null ? undefined : `url=${embed.url}`
    ].filter((item): item is string => item != null)
    lines.push(`[Discord embed] ${parts.join('; ') || 'empty embed'}`)
  }
  return lines.join('\n')
}

const messageMentionsBot = (
  message: DiscordMessagePayload,
  botUserId: string | undefined
) => {
  if (botUserId == null || botUserId === '') return false
  return message.mentions?.some(mention => mention.id === botUserId) === true ||
    message.content?.includes(`<@${botUserId}>`) === true ||
    message.content?.includes(`<@!${botUserId}>`) === true
}

const stripDiscordBotMention = (
  text: string,
  botUserId: string | undefined
) => {
  if (botUserId == null || botUserId === '') {
    return text.trim().replace(/^<@!?\d+>\s*/, '').trim()
  }
  return text
    .replace(new RegExp(`<@!?${botUserId}>\\s*`, 'g'), '')
    .trim()
}

const shouldHandleDiscordMessage = (
  message: DiscordMessagePayload,
  config: DiscordChannelConfig
) => {
  if (message.author?.bot === true || message.channel_id == null || message.id == null) return false
  if (message.guild_id == null) return true
  if (config.respondToAllGuildMessages === true) return true
  if (messageMentionsBot(message, config.botUserId)) return true
  return message.content?.trimStart().startsWith('/') === true
}

const toDiscordInboundEvent = (
  message: DiscordMessagePayload,
  config: DiscordChannelConfig
): ChannelInboundEvent | null => {
  if (!shouldHandleDiscordMessage(message, config)) return null

  const rawText = stripDiscordBotMention(message.content ?? '', config.botUserId)
  const nativeText = rawText === '' ? formatDiscordNativeContent(message) : ''
  const text = rawText === '' ? nativeText : rawText
  if (text === '') return null

  const senderLabel = formatDiscordSender(message)
  const displayText = senderLabel == null ? text : `[${senderLabel}]:\n${text}`
  const channelId = message.channel_id!

  return {
    channelType: 'discord',
    sessionType: message.guild_id == null ? 'direct' : 'group',
    channelId,
    senderId: message.author?.id,
    messageId: message.id,
    text: displayText,
    replyTo: {
      receiveId: channelId,
      receiveIdType: 'channel'
    },
    ack: async () => {
      await discordFetch(config, `/channels/${encodeURIComponent(channelId)}/typing`, { method: 'POST' })
    },
    raw: {
      payload: message,
      stickers: message.stickers,
      embeds: message.embeds,
      contentItems: [{ type: 'text', text: displayText }]
    }
  }
}

const sendDiscordIdentify = (socket: WebSocket, config: DiscordChannelConfig) => {
  socket.send(JSON.stringify({
    op: 2,
    d: {
      token: config.botToken,
      intents: discordGatewayIntents,
      properties: {
        os: 'oneworks',
        browser: 'oneworks',
        device: 'oneworks'
      }
    }
  }))
}

export const createChannelConnection = defineCreateChannelConnection(async (
  config: DiscordChannelConfig,
  options?: {
    logger?: ChannelLogger
  }
): Promise<ChannelConnection<DiscordChannelMessage>> => {
  const logger = options?.logger
  let socket: WebSocket | undefined
  let handlers: ChannelEventHandlers | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined

  const clearHeartbeat = () => {
    if (heartbeatTimer != null) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = undefined
    }
  }

  const handleGatewayPayload = async (payload: DiscordGatewayPayload) => {
    if (payload.op === 10) {
      const interval = (payload.d as { heartbeat_interval?: number } | undefined)?.heartbeat_interval
      clearHeartbeat()
      if (typeof interval === 'number' && interval > 0) {
        heartbeatTimer = setInterval(() => {
          socket?.send(JSON.stringify({ op: 1, d: null }))
        }, interval)
      }
      return
    }

    if (payload.t !== 'MESSAGE_CREATE') return
    const inbound = toDiscordInboundEvent(payload.d as DiscordMessagePayload, config)
    if (inbound == null) return
    await handlers?.message?.(inbound)
  }

  return {
    sendMessage: async message => await sendDiscordTextMessage(config, message),
    sendFileMessage: async message => await sendDiscordFileMessage(config, message),
    startReceiving: async ({ handlers: nextHandlers }) => {
      handlers = nextHandlers
      socket = new WebSocket(config.gatewayUrl ?? defaultGatewayUrl)
      socket.addEventListener('open', () => {
        if (socket != null) {
          sendDiscordIdentify(socket, config)
        }
      })
      socket.addEventListener('message', (event) => {
        void (async () => {
          try {
            const data = typeof event.data === 'string' ? event.data : String(event.data)
            await handleGatewayPayload(JSON.parse(data) as DiscordGatewayPayload)
          } catch (error) {
            await logger?.warn?.({ error: getErrorMessage(error) }, '[discord] failed to handle gateway event')
          }
        })()
      })
    },
    close: async () => {
      clearHeartbeat()
      socket?.close()
      socket = undefined
    }
  }
})
