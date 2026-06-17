import type { ChannelLogger } from '@oneworks/core/channel'
import { truncateChannelTextMessage } from '@oneworks/core/channel'

import type { QQAccessTokenResponse, QQChannelConfig, QQChannelMessage, QQSendMessageResponse } from '#~/types.js'

const DEFAULT_API_BASE_URL = 'https://api.sgroup.qq.com'
const DEFAULT_ACCESS_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000
const DEFAULT_ACCESS_TOKEN_EXPIRES_IN_SECONDS = 7_200
const MAX_QQ_LOG_TEXT_PREVIEW_LENGTH = 160

interface AccessTokenCacheEntry {
  expiresAt: number
  token: string
}

const accessTokenCache = new Map<string, AccessTokenCacheEntry>()

const trimTrailingSlash = (value: string) => value.replace(/\/+$/u, '')

const resolveApiBaseUrl = (config: QQChannelConfig) => trimTrailingSlash(config.apiBaseUrl ?? DEFAULT_API_BASE_URL)

const resolveAccessTokenUrl = (config: QQChannelConfig) => config.accessTokenUrl ?? DEFAULT_ACCESS_TOKEN_URL

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const truncateTextPreview = (value: string) => {
  if (value.length <= MAX_QQ_LOG_TEXT_PREVIEW_LENGTH) return value
  return `${value.slice(0, MAX_QQ_LOG_TEXT_PREVIEW_LENGTH - 3)}...`
}

const parseJsonResponse = async <T>(response: Response, label: string): Promise<T> => {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${label} returned non-JSON response`)
  }
}

const ensureQQSuccess = <T extends { code?: number; message?: string }>(
  result: T,
  label: string,
  status?: number
) => {
  if (status != null && (status < 200 || status >= 300)) {
    throw new Error(`${label} failed: HTTP ${status}`)
  }
  if (result.code != null && result.code !== 0) {
    throw new Error(`${label} failed: ${result.message ?? `code ${result.code}`}`)
  }
  return result
}

export const getQQAccessToken = async (config: QQChannelConfig) => {
  const cacheKey = `${config.appId}\n${config.appSecret}\n${resolveAccessTokenUrl(config)}`
  const cached = accessTokenCache.get(cacheKey)
  const now = Date.now()
  if (cached != null && cached.expiresAt > now) {
    return cached.token
  }

  const response = await globalThis.fetch(resolveAccessTokenUrl(config), {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      appId: config.appId,
      clientSecret: config.appSecret
    })
  })
  const result = ensureQQSuccess(
    await parseJsonResponse<QQAccessTokenResponse>(response, 'QQ AccessToken request'),
    'QQ AccessToken request',
    response.status
  )
  const token = result.access_token?.trim()
  if (token == null || token === '') {
    throw new Error('QQ AccessToken request failed: missing access_token')
  }

  const expiresIn = Number(result.expires_in ?? DEFAULT_ACCESS_TOKEN_EXPIRES_IN_SECONDS)
  const expiresInMs = Number.isFinite(expiresIn) && expiresIn > 0
    ? expiresIn * 1000
    : DEFAULT_ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000
  accessTokenCache.set(cacheKey, {
    token,
    expiresAt: now + Math.max(1, expiresInMs - ACCESS_TOKEN_REFRESH_SKEW_MS)
  })
  return token
}

const buildQQMessageEndpoint = (config: QQChannelConfig, message: QQChannelMessage) => {
  const receiveId = encodeURIComponent(message.receiveId)
  const path = message.receiveIdType === 'guild_id'
    ? `/dms/${receiveId}/messages`
    : `/channels/${receiveId}/messages`
  return `${resolveApiBaseUrl(config)}${path}`
}

const buildQQTextMessageBody = (message: QQChannelMessage) => ({
  content: truncateChannelTextMessage(message.text),
  msg_type: 0,
  ...(message.msgId == null ? {} : { msg_id: message.msgId }),
  ...(message.eventId == null ? {} : { event_id: message.eventId }),
  ...(message.msgSeq == null ? {} : { msg_seq: message.msgSeq })
})

export const sendQQChannelTextMessage = async (
  config: QQChannelConfig,
  message: QQChannelMessage,
  logger?: ChannelLogger
) => {
  const body = buildQQTextMessageBody(message)
  const startedAt = Date.now()
  const accessToken = await getQQAccessToken(config)

  await logger?.info?.({
    channelType: 'qq-channel',
    receiveId: message.receiveId,
    receiveIdType: message.receiveIdType,
    textLength: body.content.length,
    textPreview: truncateTextPreview(body.content),
    passive: message.msgId != null || message.eventId != null
  }, '[qq-channel] sending text message')

  try {
    const response = await globalThis.fetch(buildQQMessageEndpoint(config, message), {
      method: 'POST',
      headers: {
        authorization: `QQBot ${accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    const result = ensureQQSuccess(
      await parseJsonResponse<QQSendMessageResponse>(response, 'QQ send message'),
      'QQ send message',
      response.status
    )
    await logger?.info?.({
      channelType: 'qq-channel',
      receiveId: message.receiveId,
      receiveIdType: message.receiveIdType,
      messageId: result.id,
      elapsedMs: Date.now() - startedAt
    }, '[qq-channel] sent text message')
    return { messageId: result.id }
  } catch (error) {
    await logger?.error?.({
      channelType: 'qq-channel',
      receiveId: message.receiveId,
      receiveIdType: message.receiveIdType,
      error: getErrorMessage(error),
      elapsedMs: Date.now() - startedAt
    }, '[qq-channel] failed to send text message')
    throw error
  }
}
