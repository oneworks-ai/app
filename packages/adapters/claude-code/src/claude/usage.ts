import type { AdapterAccountQuotaInfo } from '@oneworks/types'

import { readClaudeDesktopUsageQuotas } from './usage-desktop'
import { readClaudeOauthQuota } from './usage-oauth'

export interface ResolveClaudeQuotaOptions {
  cachedQuota?: AdapterAccountQuotaInfo
  configDir?: string
  expectedEmail?: string
  expectedOrganizationId?: string
  forceNetwork?: boolean
  realHome: string
}

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const selectNewestQuota = (...values: Array<AdapterAccountQuotaInfo | undefined>) => {
  const candidates = values
    .filter((value): value is AdapterAccountQuotaInfo => value != null)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
  const newest = candidates[0]
  if (newest?.metrics == null) return newest
  return {
    ...newest,
    metrics: newest.metrics.map(metric => ({
      ...metric,
      description: metric.description ?? candidates
        .slice(1)
        .flatMap(candidate => candidate.metrics ?? [])
        .find(candidate => candidate.id === metric.id && candidate.description != null)
        ?.description ??
        'Reset time unavailable; refresh to query Claude.'
    }))
  }
}

export const resolveClaudeAccountQuota = async (
  options: ResolveClaudeQuotaOptions
): Promise<AdapterAccountQuotaInfo | undefined> => {
  const organizationId = normalizeString(options.expectedOrganizationId)
  const desktopQuotas = organizationId == null
    ? []
    : await readClaudeDesktopUsageQuotas(options.realHome, organizationId)
  const localQuota = selectNewestQuota(options.cachedQuota, ...desktopQuotas)
  if (options.forceNetwork !== true) return localQuota
  try {
    const remoteQuota = await readClaudeOauthQuota(options)
    return selectNewestQuota(localQuota, remoteQuota)
  } catch {
    return localQuota
  }
}
