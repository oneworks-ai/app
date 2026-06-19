import type { ChannelSendResult } from '@oneworks/core/channel'

import type {
  WeComAccessTokenResponse,
  WeComAppChatSendResponse,
  WeComChannelConfig,
  WeComChannelMessage,
  WeComSendMessageResponse
} from '#~/types.js'

const DEFAULT_WECOM_API_BASE_URL = 'https://qyapi.weixin.qq.com'
const ACCESS_TOKEN_REFRESH_GRACE_MS = 5 * 60 * 1000

interface TokenCacheEntry {
  expiresAt: number
  token: string
}

const tokenCache = new Map<string, TokenCacheEntry>()

const trimTrailingSlash = (value: string) => value.replace(/\/+$/u, '')

const getApiBaseUrl = (config: WeComChannelConfig) => trimTrailingSlash(config.apiBaseUrl ?? DEFAULT_WECOM_API_BASE_URL)

const assertOkJsonResponse = async <TResponse extends { errcode?: number; errmsg?: string }>(
  response: Response,
  label: string
): Promise<TResponse> => {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${text}`)
  }

  const parsed = JSON.parse(text) as TResponse
  if (parsed.errcode != null && parsed.errcode !== 0) {
    throw new Error(`${label} failed: ${parsed.errcode} ${parsed.errmsg ?? ''}`.trim())
  }

  return parsed
}

export const getWeComAccessToken = async (config: WeComChannelConfig) => {
  const cacheKey = `${getApiBaseUrl(config)}\n${config.corpId}\n${config.corpSecret}`
  const cached = tokenCache.get(cacheKey)
  const now = Date.now()
  if (cached != null && cached.expiresAt > now + ACCESS_TOKEN_REFRESH_GRACE_MS) {
    return cached.token
  }

  const url = new URL('/cgi-bin/gettoken', getApiBaseUrl(config))
  url.searchParams.set('corpid', config.corpId)
  url.searchParams.set('corpsecret', config.corpSecret)
  const response = await globalThis.fetch(url)
  const parsed = await assertOkJsonResponse<WeComAccessTokenResponse>(response, 'WeCom gettoken')
  if (parsed.access_token == null || parsed.access_token === '') {
    throw new Error('WeCom gettoken failed: response missing access_token')
  }

  tokenCache.set(cacheKey, {
    token: parsed.access_token,
    expiresAt: now + Math.max((parsed.expires_in ?? 7200) * 1000, ACCESS_TOKEN_REFRESH_GRACE_MS)
  })
  return parsed.access_token
}

const buildWeComMessageContent = (message: WeComChannelMessage) => {
  const msgtype = message.msgtype ?? 'text'
  return msgtype === 'markdown'
    ? {
      markdown: { content: message.text },
      msgtype
    }
    : {
      msgtype,
      text: { content: message.text }
    }
}

const buildDuplicateCheckFields = (message: WeComChannelMessage) => ({
  ...(message.enableDuplicateCheck == null ? {} : { enable_duplicate_check: message.enableDuplicateCheck ? 1 : 0 }),
  ...(message.duplicateCheckInterval == null ? {} : { duplicate_check_interval: message.duplicateCheckInterval })
})

const buildApplicationSendBody = (config: WeComChannelConfig, message: WeComChannelMessage) => {
  const target = message.receiveIdType === 'all'
    ? { touser: '@all' }
    : message.receiveIdType === 'user'
    ? { touser: message.receiveId }
    : message.receiveIdType === 'party'
    ? { toparty: message.receiveId }
    : { totag: message.receiveId }

  return {
    ...target,
    ...buildWeComMessageContent(message),
    ...buildDuplicateCheckFields(message),
    agentid: config.agentId,
    safe: message.safe ?? 0
  }
}

const buildAppChatSendBody = (message: WeComChannelMessage) => ({
  chatid: message.receiveId,
  ...buildWeComMessageContent(message),
  safe: message.safe ?? 0
})

const postWeComApi = async <TResponse extends { errcode?: number; errmsg?: string }>(
  config: WeComChannelConfig,
  path: string,
  body: unknown,
  label: string
) => {
  const accessToken = await getWeComAccessToken(config)
  const url = new URL(path, getApiBaseUrl(config))
  url.searchParams.set('access_token', accessToken)
  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  return await assertOkJsonResponse<TResponse>(response, label)
}

export const sendWeComMessage = async (
  config: WeComChannelConfig,
  message: WeComChannelMessage
): Promise<ChannelSendResult | undefined> => {
  if (message.receiveIdType === 'appchat') {
    await postWeComApi<WeComAppChatSendResponse>(
      config,
      '/cgi-bin/appchat/send',
      buildAppChatSendBody(message),
      'WeCom appchat send'
    )
    return undefined
  }

  const result = await postWeComApi<WeComSendMessageResponse>(
    config,
    '/cgi-bin/message/send',
    buildApplicationSendBody(config, message),
    'WeCom message send'
  )
  return {
    messageId: result.msgid
  }
}

export const clearWeComAccessTokenCacheForTests = () => {
  tokenCache.clear()
}
