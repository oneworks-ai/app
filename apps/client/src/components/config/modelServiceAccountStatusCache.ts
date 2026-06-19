import type { ProviderAccountStatus } from '@oneworks/types'

const ACCOUNT_STATUS_CACHE_TTL_MS = 60_000
const accountStatusCache = new Map<string, { expiresAt: number; value: ProviderAccountStatus }>()

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
    expiresAt: Date.now() + ACCOUNT_STATUS_CACHE_TTL_MS,
    value
  })
}
