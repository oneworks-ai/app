import type { ProviderAccountStatus } from '@oneworks/types'

const ACCOUNT_STATUS_QUOTA_CACHE_TTL_MS = 60_000
const ACCOUNT_STATUS_BALANCE_CACHE_TTL_MS = 5 * 60_000
const accountStatusCache = new Map<string, { expiresAt: number; value: ProviderAccountStatus }>()

const getAccountStatusCacheTtl = (value: ProviderAccountStatus) => (
  value.kind === 'balance' || value.kind === 'cost'
    ? ACCOUNT_STATUS_BALANCE_CACHE_TTL_MS
    : ACCOUNT_STATUS_QUOTA_CACHE_TTL_MS
)

export const getCachedModelServiceAccountStatus = (fingerprint: string) => {
  const cached = accountStatusCache.get(fingerprint)
  if (cached == null) return null
  if (cached.expiresAt <= Date.now()) {
    accountStatusCache.delete(fingerprint)
    return null
  }
  return cached.value
}

export const setCachedModelServiceAccountStatus = (fingerprint: string, value: ProviderAccountStatus) => {
  accountStatusCache.set(fingerprint, {
    expiresAt: Date.now() + getAccountStatusCacheTtl(value),
    value
  })
}
