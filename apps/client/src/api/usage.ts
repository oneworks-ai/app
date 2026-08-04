import type { UsageQuery, UsageReport } from '@oneworks/types'

import { buildApiUrl, fetchApiJson } from './base'
import { createLauncherApiUrl } from './launcher'

export const USAGE_DIRECT_TRANSPORT_ID = '__direct__'

const appendUsageQuery = (url: URL, query: UsageQuery) => {
  Object.entries(query).forEach(([key, value]) => {
    if (value == null) return
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value))
  })
  return url
}

export const getUsageReport = (
  query: UsageQuery,
  options: { surface?: 'launcher' | 'workspace' } = {}
) => {
  const path = options.surface === 'launcher' ? '/api/launcher/usage' : '/api/usage'
  const url = new URL(options.surface === 'launcher' ? createLauncherApiUrl(path) : buildApiUrl(path))
  return fetchApiJson<UsageReport>(appendUsageQuery(url, query))
}
