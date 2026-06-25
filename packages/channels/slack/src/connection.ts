/* eslint-disable max-lines -- Slack Socket Mode transport and Web API normalization stay colocated in this package. */
import type {
  ChannelConnection,
  ChannelEventHandlers,
  ChannelFileMessage,
  ChannelInboundEvent,
  ChannelLogger
} from '@oneworks/core/channel'
import { defineCreateChannelConnection } from '@oneworks/core/channel'

import type {
  SlackApiResponse,
  SlackChannelConfig,
  SlackChannelMessage,
  SlackMessageEvent,
  SlackSocketEnvelope,
  SlackToolCallSummary
} from '#~/types.js'

const slackApiBaseUrl = 'https://slack.com/api'

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const maxToolSummaryLineLength = 320

const truncateToolSummaryLine = (value: string) => (
  value.length <= maxToolSummaryLineLength ? value : `${value.slice(0, maxToolSummaryLineLength - 3)}...`
)

const toSingleLine = (value: string) => value.replace(/\s+/g, ' ').trim()

const formatToolCallSummaryText = (summary: SlackToolCallSummary) => {
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

const resolveSlackMessageText = (message: SlackChannelMessage) => (
  message.toolCallSummary == null ? message.text : formatToolCallSummaryText(message.toolCallSummary)
)

const ensureSlackSuccess = (label: string, result: SlackApiResponse) => {
  if (result.ok === false) {
    throw new Error(`${label}: ${result.error ?? 'unknown error'}`)
  }
  return result
}

const postSlackJson = async (
  token: string,
  method: string,
  body: Record<string, unknown>
) => {
  const response = await globalThis.fetch(`${slackApiBaseUrl}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    throw new Error(`${method} failed: HTTP ${response.status}`)
  }
  return await response.json() as SlackApiResponse
}

const parseSlackTarget = (
  receiveId: string,
  threadTs?: string
) => {
  const marker = '#thread='
  const markerIndex = receiveId.indexOf(marker)
  if (markerIndex < 0) {
    return { channel: receiveId, threadTs }
  }

  const channel = receiveId.slice(0, markerIndex)
  const encodedThreadTs = receiveId.slice(markerIndex + marker.length)
  return { channel, threadTs: threadTs ?? decodeURIComponent(encodedThreadTs) }
}

const encodeSlackThreadTarget = (channel: string, threadTs: string | undefined) => (
  threadTs == null || threadTs === '' ? channel : `${channel}#thread=${encodeURIComponent(threadTs)}`
)

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const stripBotMention = (text: string, botUserId: string | undefined) => {
  const trimmed = text.trim()
  if (botUserId == null || botUserId === '') {
    return trimmed.replace(/^<@[A-Z0-9]+>\s*/i, '').trim()
  }
  return trimmed.replace(new RegExp(`<@${escapeRegExp(botUserId)}>\\s*`, 'gi'), '').trim()
}

const isSlackThreadReply = (event: SlackMessageEvent) => (
  event.thread_ts != null && event.thread_ts !== '' && event.thread_ts !== event.ts
)

const shouldHandleSlackMessage = (
  event: SlackMessageEvent,
  config: SlackChannelConfig,
  botUserId: string | undefined
) => {
  if (event.subtype != null || event.bot_id != null || event.channel == null || event.ts == null) return false
  if (event.channel_type === 'im') return true
  if (config.respondToAllChannelMessages === true) return true
  if (isSlackThreadReply(event)) return true
  if (event.type === 'app_mention') return true
  return botUserId != null && event.text?.includes(`<@${botUserId}>`) === true
}

const toSlackInboundEvent = (
  event: SlackMessageEvent,
  config: SlackChannelConfig,
  botUserId: string | undefined
): ChannelInboundEvent | null => {
  if (!shouldHandleSlackMessage(event, config, botUserId)) return null

  const channel = event.channel!
  const senderId = event.user
  const isDirect = event.channel_type === 'im'
  const threadTs = isDirect ? undefined : event.thread_ts ?? event.ts
  const text = stripBotMention(event.text ?? '', botUserId)
  const displayText = senderId == null || senderId === '' ? text : `[${senderId}]:\n${text}`
  const replyReceiveId = encodeSlackThreadTarget(channel, threadTs)

  let acked = false
  const ack = async () => {
    if (acked || event.ts == null) return
    await postSlackJson(config.botToken, 'reactions.add', {
      channel,
      timestamp: event.ts,
      name: 'hourglass_flowing_sand'
    })
    acked = true
  }
  const unack = async () => {
    if (!acked || event.ts == null) return
    await postSlackJson(config.botToken, 'reactions.remove', {
      channel,
      timestamp: event.ts,
      name: 'hourglass_flowing_sand'
    })
    acked = false
  }

  return {
    channelType: 'slack',
    sessionType: isDirect ? 'direct' : 'group',
    channelId: isDirect ? channel : replyReceiveId,
    senderId,
    messageId: event.ts,
    text: displayText,
    replyTo: {
      receiveId: replyReceiveId,
      receiveIdType: 'channel'
    },
    ack,
    unack,
    raw: {
      payload: event,
      accessChannelId: channel,
      threadTs,
      contentItems: [{ type: 'text', text: displayText }]
    }
  }
}

const resolveBotUserId = async (config: SlackChannelConfig, logger?: ChannelLogger) => {
  if (config.botUserId != null && config.botUserId !== '') {
    return config.botUserId
  }
  try {
    const result = ensureSlackSuccess('Slack auth.test failed', await postSlackJson(config.botToken, 'auth.test', {}))
    return result.user_id ?? result.bot_id
  } catch (error) {
    await logger?.warn?.({ error: getErrorMessage(error) }, '[slack] failed to resolve bot user id')
    return undefined
  }
}

const openSlackSocketModeUrl = async (appToken: string) => {
  const result = ensureSlackSuccess(
    'Slack Socket Mode connection open failed',
    await postSlackJson(appToken, 'apps.connections.open', {})
  )
  if (result.url == null || result.url === '') {
    throw new Error('Slack Socket Mode connection open failed: missing url')
  }
  return result.url
}

const sendSlackTextMessage = async (
  config: SlackChannelConfig,
  message: SlackChannelMessage
) => {
  const target = parseSlackTarget(message.receiveId, message.threadTs)
  const result = ensureSlackSuccess(
    'Slack message send failed',
    await postSlackJson(config.botToken, 'chat.postMessage', {
      channel: target.channel,
      text: resolveSlackMessageText(message),
      ...(target.threadTs == null ? {} : { thread_ts: target.threadTs })
    })
  )
  return { messageId: result.ts }
}

const sendSlackFileMessage = async (
  config: SlackChannelConfig,
  message: ChannelFileMessage
) => {
  const target = parseSlackTarget(message.receiveId)
  const fileContent = typeof message.content === 'string'
    ? message.content
    : message.content.buffer.slice(
      message.content.byteOffset,
      message.content.byteOffset + message.content.byteLength
    ) as ArrayBuffer
  const form = new FormData()
  form.set('channels', target.channel)
  form.set('filename', message.fileName)
  form.set('file', new Blob([fileContent]), message.fileName)
  if (target.threadTs != null) {
    form.set('thread_ts', target.threadTs)
  }

  const response = await globalThis.fetch(`${slackApiBaseUrl}/files.upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.botToken}`
    },
    body: form
  })
  if (!response.ok) {
    throw new Error(`Slack file upload failed: HTTP ${response.status}`)
  }
  const result = ensureSlackSuccess('Slack file upload failed', await response.json() as SlackApiResponse)
  return { messageId: result.file?.id }
}

export const createChannelConnection = defineCreateChannelConnection(async (
  config: SlackChannelConfig,
  options?: {
    logger?: ChannelLogger
  }
): Promise<ChannelConnection<SlackChannelMessage>> => {
  const logger = options?.logger
  let socket: WebSocket | undefined
  let handlers: ChannelEventHandlers | undefined
  let botUserId: string | undefined

  const handleEnvelope = async (envelope: SlackSocketEnvelope) => {
    if (envelope.envelope_id != null) {
      socket?.send(JSON.stringify({ envelope_id: envelope.envelope_id }))
    }
    const event = envelope.payload?.event
    if (event == null) return
    const inbound = toSlackInboundEvent(event, config, botUserId)
    if (inbound == null) return
    await handlers?.message?.(inbound)
  }

  return {
    sendMessage: async message => await sendSlackTextMessage(config, message),
    sendFileMessage: async message => await sendSlackFileMessage(config, message),
    startReceiving: async ({ handlers: nextHandlers }) => {
      handlers = nextHandlers
      botUserId = await resolveBotUserId(config, logger)
      const url = await openSlackSocketModeUrl(config.appToken)
      socket = new WebSocket(url)
      socket.addEventListener('message', (event) => {
        void (async () => {
          try {
            const data = typeof event.data === 'string' ? event.data : String(event.data)
            await handleEnvelope(JSON.parse(data) as SlackSocketEnvelope)
          } catch (error) {
            await logger?.warn?.({ error: getErrorMessage(error) }, '[slack] failed to handle socket event')
          }
        })()
      })
    },
    close: async () => {
      socket?.close()
      socket = undefined
    }
  }
})
