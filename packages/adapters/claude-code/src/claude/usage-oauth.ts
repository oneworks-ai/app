import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import type { AdapterAccountQuotaInfo } from '@oneworks/types'

import type { ResolveClaudeQuotaOptions } from './usage'
import { readClaudeOauthCredential } from './usage-oauth-credential'
import { parseClaudeUsageQuota } from './usage-quota'

const CACHE_TTL_MS = 5 * 60 * 1000
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile'
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const RESPONSE_MAX_BYTES = 1_000_000

interface ClaudeOauthProfile {
  email?: string
  organizationId?: string
}

interface CacheEntry {
  expiresAt: number
  profile?: ClaudeOauthProfile
  quota?: AdapterAccountQuotaInfo
  retryAt?: number
}

const cache = new Map<string, CacheEntry>()

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const readBoundedResponseText = async (response: Response) => {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > RESPONSE_MAX_BYTES) {
    throw new Error('Claude OAuth response exceeded the maximum accepted size.')
  }
  if (response.body == null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      totalBytes += chunk.value.byteLength
      if (totalBytes > RESPONSE_MAX_BYTES) {
        await reader.cancel()
        throw new Error('Claude OAuth response exceeded the maximum accepted size.')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), totalBytes).toString('utf8')
}

const requestJson = async (url: string, accessToken: string) => {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'anthropic-beta': 'oauth-2025-04-20'
    },
    signal: AbortSignal.timeout(10_000)
  })
  const content = await readBoundedResponseText(response)
  try {
    return { body: content === '' ? undefined : JSON.parse(content) as unknown, response }
  } catch {
    return { body: undefined, response }
  }
}

const parseProfile = (value: unknown): ClaudeOauthProfile | undefined => {
  if (!isRecord(value)) return undefined
  const account = isRecord(value.account) ? value.account : undefined
  const organization = isRecord(value.organization) ? value.organization : undefined
  const profile = {
    email: normalizeString(account?.email),
    organizationId: normalizeString(organization?.uuid)
  }
  return profile.email == null || profile.organizationId == null ? undefined : profile
}

const profileMatches = (profile: ClaudeOauthProfile | undefined, options: ResolveClaudeQuotaOptions) => (
  profile?.email != null &&
  profile.organizationId != null &&
  options.expectedEmail != null &&
  options.expectedOrganizationId != null &&
  profile.email.toLowerCase() === options.expectedEmail.toLowerCase() &&
  profile.organizationId === options.expectedOrganizationId
)

const parseRetryAt = (value: string | null, now: number) => {
  if (value == null) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp > now ? timestamp : undefined
}

const cacheRetryAfter = (
  key: string,
  response: Response,
  now: number,
  profile?: ClaudeOauthProfile
) => {
  cache.set(key, {
    expiresAt: now + CACHE_TTL_MS,
    profile,
    retryAt: parseRetryAt(response.headers.get('retry-after'), now) ?? now + CACHE_TTL_MS
  })
}

export const readClaudeOauthQuota = async (
  options: ResolveClaudeQuotaOptions
): Promise<AdapterAccountQuotaInfo | undefined> => {
  const now = Date.now()
  const credential = await readClaudeOauthCredential(options)
  if (credential == null || (credential.expiresAt != null && credential.expiresAt <= now + 30_000)) {
    return undefined
  }
  const key = createHash('sha256').update(credential.accessToken).digest('hex')
  const cached = cache.get(key)
  if (cached?.retryAt != null && cached.retryAt > now) return undefined
  if (cached != null && cached.expiresAt > now && cached.quota != null) {
    return profileMatches(cached.profile, options) ? cached.quota : undefined
  }
  const profileResult = await requestJson(PROFILE_URL, credential.accessToken)
  if (profileResult.response.status === 429) {
    cacheRetryAfter(key, profileResult.response, now)
    return undefined
  }
  if (!profileResult.response.ok) return undefined
  const profile = parseProfile(profileResult.body)
  if (!profileMatches(profile, options)) {
    cache.set(key, { expiresAt: now + CACHE_TTL_MS, profile })
    return undefined
  }
  const usageResult = await requestJson(USAGE_URL, credential.accessToken)
  if (usageResult.response.status === 429) {
    cacheRetryAfter(key, usageResult.response, now, profile)
    return undefined
  }
  if (!usageResult.response.ok) return undefined
  const quota = parseClaudeUsageQuota(usageResult.body, now, now)
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, profile, quota })
  return quota
}
