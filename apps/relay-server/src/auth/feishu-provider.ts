import { createHash } from 'node:crypto'

import type { RelayOAuthClient } from '../types.js'
import { isRecord } from '../utils.js'
import type { OAuthProfile } from './providers.js'

const includesProviderText = (value: string | undefined, text: string) => (
  typeof value === 'string' && value.toLowerCase().includes(text)
)

export const isFeishuProvider = (provider: string, client: RelayOAuthClient) => (
  includesProviderText(provider, 'feishu') ||
  includesProviderText(client.displayName, 'feishu') ||
  includesProviderText(client.displayName, '飞书') ||
  includesProviderText(client.authorizationUrl, 'accounts.feishu.cn/open-apis/authen/v1/authorize') ||
  includesProviderText(client.tokenUrl, 'open.feishu.cn/open-apis/authen/v2/oauth/token') ||
  includesProviderText(client.userInfoUrl, 'open.feishu.cn/open-apis/authen/v1/user_info')
)

const readFeishuText = (profile: Record<string, unknown>, field: string) => (
  typeof profile[field] === 'string' && profile[field].trim() !== '' ? profile[field].trim() : undefined
)

const feishuFallbackLoginId = (providerUserId: string) => (
  `feishu-${createHash('sha256').update(providerUserId).digest('hex').slice(0, 16)}`
)

const feishuFallbackEmail = (providerUserId: string) => (
  `${feishuFallbackLoginId(providerUserId)}@feishu.relay.invalid`
)

export const readFeishuProfile = (profile: Record<string, unknown>): OAuthProfile => {
  const data = isRecord(profile.data) ? profile.data : profile
  const providerUserId = readFeishuText(data, 'union_id') ?? readFeishuText(data, 'open_id') ??
    readFeishuText(data, 'user_id')
  const tenantKey = readFeishuText(data, 'tenant_key')
  if (providerUserId == null) throw new Error('Feishu profile did not include a stable user id.')
  const id = tenantKey == null ? providerUserId : `${tenantKey}:${providerUserId}`
  const email = readFeishuText(data, 'email') ?? readFeishuText(data, 'enterprise_email') ?? feishuFallbackEmail(id)
  const name = readFeishuText(data, 'name') ?? readFeishuText(data, 'en_name') ?? email
  return {
    id,
    email,
    emailVerified: false,
    loginId: email.endsWith('@feishu.relay.invalid') ? feishuFallbackLoginId(id) : undefined,
    name,
    avatarUrl: readFeishuText(data, 'avatar_url') ??
      readFeishuText(data, 'avatar_big') ??
      readFeishuText(data, 'avatar_middle') ??
      readFeishuText(data, 'avatar_thumb')
  }
}
