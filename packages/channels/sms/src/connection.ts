/* eslint-disable max-lines -- Twilio REST sending, webhook parsing, and signature validation stay colocated in this package. */
import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'

import type {
  ChannelConnection,
  ChannelEventHandlers,
  ChannelInboundEvent,
  ChannelLogger,
  ChannelWebhookRequest,
  ChannelWebhookResponse
} from '@oneworks/core/channel'
import { defineCreateChannelConnection } from '@oneworks/core/channel'

import type { SmsChannelConfig, SmsChannelMessage, SmsToolCallSummary, TwilioSendMessageResponse } from '#~/types.js'

const defaultApiBaseUrl = 'https://api.twilio.com/2010-04-01'
const maxSmsLength = 1600
const maxToolSummaryLineLength = 320

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const truncateToolSummaryLine = (value: string) => (
  value.length <= maxToolSummaryLineLength ? value : `${value.slice(0, maxToolSummaryLineLength - 3)}...`
)

const toSingleLine = (value: string) => value.replace(/\s+/g, ' ').trim()

const formatToolCallSummaryText = (summary: SmsToolCallSummary) => {
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

const resolveSmsMessageText = (message: SmsChannelMessage) => (
  message.toolCallSummary == null ? message.text : formatToolCallSummaryText(message.toolCallSummary)
)

const splitSmsText = (text: string) => {
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += maxSmsLength) {
    chunks.push(text.slice(index, index + maxSmsLength))
  }
  return chunks.length === 0 ? [''] : chunks
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

const normalizeBodyParams = (body: unknown) => {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return new URLSearchParams()
  }

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === 'string') {
      params.append(key, value)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      params.append(key, String(value))
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') params.append(key, item)
      }
    }
  }
  return params
}

const parseWebhookParams = (request: ChannelWebhookRequest) => {
  if (typeof request.rawBody === 'string' && request.rawBody.trim() !== '') {
    return new URLSearchParams(request.rawBody)
  }
  if (request.rawBody instanceof Uint8Array) {
    const text = Buffer.from(request.rawBody).toString('utf8')
    return new URLSearchParams(text)
  }
  return normalizeBodyParams(request.body)
}

const getParam = (params: URLSearchParams, name: string) => {
  const value = params.get(name)
  return value == null || value.trim() === '' ? undefined : value.trim()
}

const safeCompare = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

const resolveWebhookUrl = (
  config: SmsChannelConfig,
  channelKey: string | undefined
) => {
  const configured = config.webhookUrl?.trim()
  if (configured != null && configured !== '') return configured
  const baseUrl = config.serverBaseUrl?.trim()
  if (baseUrl == null || baseUrl === '' || channelKey == null) return undefined
  return `${trimTrailingSlash(baseUrl)}/channels/sms/${encodeURIComponent(channelKey)}/webhook`
}

const verifyTwilioSignature = (
  config: SmsChannelConfig,
  request: ChannelWebhookRequest,
  params: URLSearchParams,
  channelKey: string | undefined
) => {
  if (config.verifyWebhookSignature === false) return true
  const signature = getHeader(request.headers, 'x-twilio-signature')
  const webhookUrl = resolveWebhookUrl(config, channelKey)
  if (signature == null || webhookUrl == null) return false

  const pairs = [...params.entries()].sort(([left], [right]) => left.localeCompare(right))
  const payload = pairs.reduce((acc, [key, value]) => `${acc}${key}${value}`, webhookUrl)
  const expected = createHmac('sha1', config.authToken).update(payload).digest('base64')
  return safeCompare(signature, expected)
}

const twilioApiFetch = async (
  config: SmsChannelConfig,
  path: string,
  body: URLSearchParams
) => {
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`, 'utf8').toString('base64')
  const response = await globalThis.fetch(`${trimTrailingSlash(config.apiBaseUrl ?? defaultApiBaseUrl)}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  const result = await response.json().catch(() => ({})) as TwilioSendMessageResponse
  if (!response.ok || result.error_code != null) {
    throw new Error(result.error_message ?? result.message ?? `Twilio API failed: HTTP ${response.status}`)
  }
  return result
}

const sendSmsTextMessage = async (
  config: SmsChannelConfig,
  message: SmsChannelMessage
) => {
  let lastMessageId: string | undefined
  for (const chunk of splitSmsText(resolveSmsMessageText(message))) {
    const body = new URLSearchParams()
    body.set('From', config.fromNumber)
    body.set('To', message.receiveId)
    body.set('Body', chunk)
    const result = await twilioApiFetch(
      config,
      `/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
      body
    )
    lastMessageId = result.sid ?? lastMessageId
  }
  return { messageId: lastMessageId }
}

const buildInboundText = (params: URLSearchParams) => {
  const body = getParam(params, 'Body') ?? ''
  const mediaCount = Number.parseInt(getParam(params, 'NumMedia') ?? '0', 10)
  const mediaLines: string[] = []
  if (Number.isFinite(mediaCount) && mediaCount > 0) {
    for (let index = 0; index < mediaCount; index += 1) {
      const url = getParam(params, `MediaUrl${index}`)
      const contentType = getParam(params, `MediaContentType${index}`)
      if (url != null) {
        mediaLines.push(`[SMS media] ${contentType == null ? url : `${contentType} ${url}`}`)
      }
    }
  }
  return [body, ...mediaLines].filter(line => line.trim() !== '').join('\n').trim()
}

const toSmsInboundEvent = (params: URLSearchParams): ChannelInboundEvent | null => {
  const from = getParam(params, 'From')
  const messageSid = getParam(params, 'MessageSid') ?? getParam(params, 'SmsSid')
  const text = buildInboundText(params)
  if (from == null || text === '') return null
  const displayText = `[${from}]:\n${text}`
  return {
    channelType: 'sms',
    sessionType: 'direct',
    channelId: from,
    senderId: from,
    messageId: messageSid,
    text: displayText,
    replyTo: {
      receiveId: from,
      receiveIdType: 'phone'
    },
    raw: {
      params: Object.fromEntries(params.entries()),
      contentItems: [{ type: 'text', text: displayText }]
    }
  }
}

export const createChannelConnection = defineCreateChannelConnection(async (
  config: SmsChannelConfig,
  options?: {
    logger?: ChannelLogger
  }
): Promise<ChannelConnection<SmsChannelMessage>> => {
  let handlers: ChannelEventHandlers | undefined
  let channelKey: string | undefined
  const logger = options?.logger

  const handleWebhook = async (request: ChannelWebhookRequest): Promise<ChannelWebhookResponse> => {
    if (request.method !== 'POST') {
      return { statusCode: 405, body: { error: 'method not allowed' } }
    }
    const params = parseWebhookParams(request)
    if (!verifyTwilioSignature(config, request, params, channelKey)) {
      return { statusCode: 403, body: { error: 'invalid twilio signature' } }
    }
    const inbound = toSmsInboundEvent(params)
    if (inbound != null) {
      await handlers?.message?.(inbound)
    }
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8'
      },
      body: '<Response></Response>'
    }
  }

  return {
    sendMessage: async message => await sendSmsTextMessage(config, message),
    handleWebhook,
    startReceiving: async ({ channelKey: nextChannelKey, handlers: nextHandlers }) => {
      channelKey = nextChannelKey
      handlers = nextHandlers
      if (config.enableWebhook === false) {
        await logger?.info?.({ channelKey, channelType: 'sms' }, '[sms] webhook disabled by channel config')
        return
      }
      await logger?.info?.({
        channelKey,
        channelType: 'sms',
        webhookUrl: resolveWebhookUrl(config, channelKey)
      }, '[sms] webhook ready')
    },
    close: async () => {
      await logger?.debug?.({ channelKey, channelType: 'sms' }, '[sms] channel closed')
    }
  }
})
