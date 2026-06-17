/* eslint-disable max-lines -- provider HTTP clients share normalization and error handling */
import type {
  ModelProviderDefinition,
  ModelServiceConfig,
  ProviderAccountStatus,
  ProviderModelInfo,
  ProviderSecretResult,
  ProviderServiceStatus,
  ProviderStatusIndicator,
  ResolvedModelServiceConfig
} from '@oneworks/types'
import { getModelProviderDefinition, resolveModelServiceConfig, resolveModelServiceModels } from '@oneworks/utils'

export type ProviderActionErrorCode =
  | 'provider_unsupported'
  | 'missing_api_key'
  | 'upstream_unauthorized'
  | 'upstream_forbidden'
  | 'upstream_rate_limited'
  | 'upstream_unavailable'
  | 'upstream_request_rejected'
  | 'upstream_invalid_response'
  | 'upstream_network_error'
  | 'invalid_provider_config'

export class ProviderActionError extends Error {
  constructor(
    public readonly code: ProviderActionErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'ProviderActionError'
  }
}

const normalizeString = (
  value: unknown
) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
const asRecord = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const asNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
const STATUS_CACHE_TTL_MS = 90_000

const statusCache = new Map<string, { expiresAt: number; status: ProviderServiceStatus }>()

const resolveApiRoot = (service: ResolvedModelServiceConfig) => {
  const url = new URL(service.apiBaseUrl)
  url.pathname = url.pathname
    .replace(/\/chat\/completions\/?$/u, '')
    .replace(/\/responses\/?$/u, '')
    .replace(/\/messages\/?$/u, '')
    .replace(/\/+$/u, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/u, '')
}

const joinApiPath = (root: string, path: string) => `${root.replace(/\/+$/u, '')}/${path.replace(/^\/+/u, '')}`

const resolveService = (service: ModelServiceConfig) => {
  const resolved = resolveModelServiceConfig(service)
  if (resolved.service == null) {
    throw new ProviderActionError('invalid_provider_config', resolved.issues[0]?.message ?? 'Invalid provider config')
  }
  return resolved.service
}

const fetchJson = async (url: string, options?: RequestInit) => {
  let response: Response
  try {
    response = await fetch(url, options)
  } catch (error) {
    throw new ProviderActionError(
      'upstream_network_error',
      error instanceof Error && error.message.trim() !== '' ? error.message : 'Provider network request failed.'
    )
  }
  if (response.status === 401) {
    throw new ProviderActionError('upstream_unauthorized', 'Provider rejected the API key.', response.status)
  }
  if (response.status === 403) {
    throw new ProviderActionError('upstream_forbidden', 'Provider denied this action.', response.status)
  }
  if (response.status === 429) {
    throw new ProviderActionError('upstream_rate_limited', 'Provider rate limit exceeded.', response.status)
  }
  if (!response.ok) {
    const code = response.status >= 500 ? 'upstream_unavailable' : 'upstream_request_rejected'
    throw new ProviderActionError(code, 'Provider action failed.', response.status)
  }
  try {
    return await response.json() as unknown
  } catch {
    throw new ProviderActionError(
      'upstream_invalid_response',
      'Provider returned a non-JSON response.',
      response.status
    )
  }
}

const authHeaders = (service: ResolvedModelServiceConfig) => {
  if (normalizeString(service.apiKey) == null) {
    throw new ProviderActionError('missing_api_key', 'Model service is missing apiKey.')
  }
  return { Authorization: `Bearer ${service.apiKey}` }
}

const mapModel = (value: unknown): ProviderModelInfo | undefined => {
  const record = asRecord(value)
  const id = normalizeString(record.id)
  if (id == null) return undefined
  return {
    id,
    title: normalizeString(record.name) ?? normalizeString(record.title),
    ownedBy: normalizeString(record.owned_by) ?? normalizeString(record.ownedBy),
    createdAt: asNumber(record.created)
  }
}

export const listProviderModels = async (serviceConfig: ModelServiceConfig): Promise<ProviderModelInfo[]> => {
  const service = resolveService(serviceConfig)
  const provider = service.providerDefinition ?? getModelProviderDefinition(service.provider)
  const configuredModels = resolveModelServiceModels(service)
  if (provider?.capabilities?.listModels !== 'api') {
    return configuredModels.map(id => ({ id }))
  }
  const payload = await fetchJson(joinApiPath(resolveApiRoot(service), 'models'), { headers: authHeaders(service) })
  const data = Array.isArray(asRecord(payload).data) ? asRecord(payload).data as unknown[] : []
  const models = data.map(mapModel).filter((item): item is ProviderModelInfo => item != null)
  return models.length > 0 ? models : configuredModels.map(id => ({ id }))
}

const firstBalanceNumber = (...values: unknown[]) => values.map(asNumber).find(value => value != null)

const parseKimiCodeQuotaDetail = (value: unknown) => {
  const record = asRecord(value)
  return {
    limit: asNumber(record.limit),
    remaining: asNumber(record.remaining),
    resetTime: normalizeString(record.resetTime)
  }
}

const normalizeKimiTimeUnit = (value: unknown) => {
  const unit = normalizeString(value)
  if (unit == null) return undefined
  return unit.replace(/^TIME_UNIT_/u, '').toLowerCase()
}

const getKimiCodeAccountStatus = async (
  service: ResolvedModelServiceConfig
): Promise<ProviderAccountStatus> => {
  const payload = await fetchJson(joinApiPath(resolveApiRoot(service), 'usages'), {
    headers: authHeaders(service)
  })
  const record = asRecord(payload)
  const usage = parseKimiCodeQuotaDetail(record.usage)
  const totalQuota = parseKimiCodeQuotaDetail(record.totalQuota)
  const user = asRecord(record.user)
  const membership = asRecord(user.membership)
  const parallel = asRecord(record.parallel)
  const limits = Array.isArray(record.limits) ? record.limits : []
  const windows = limits.map((item) => {
    const limit = asRecord(item)
    const window = asRecord(limit.window)
    const detail = parseKimiCodeQuotaDetail(limit.detail)
    return {
      duration: asNumber(window.duration),
      timeUnit: normalizeKimiTimeUnit(window.timeUnit),
      ...detail
    }
  })

  return {
    kind: 'quota',
    unit: 'request',
    limit: totalQuota.limit ?? usage.limit,
    remaining: totalQuota.remaining ?? usage.remaining,
    resetTime: totalQuota.resetTime ?? usage.resetTime,
    windows,
    parallelLimit: asNumber(parallel.limit),
    plan: normalizeString(membership.level),
    raw: payload
  }
}

export const getProviderAccountStatus = async (serviceConfig: ModelServiceConfig): Promise<ProviderAccountStatus> => {
  const service = resolveService(serviceConfig)
  if (service.provider === 'kimi-code') {
    return getKimiCodeAccountStatus(service)
  }
  if (service.provider === 'moonshot-cn' || service.provider === 'moonshot-intl') {
    const payload = await fetchJson(joinApiPath(resolveApiRoot(service), 'users/me/balance'), {
      headers: authHeaders(service)
    })
    const data = asRecord(asRecord(payload).data)
    return {
      kind: 'balance',
      currency: normalizeString(data.currency),
      available: firstBalanceNumber(data.available_balance, data.available)
    }
  }
  if (service.provider === 'deepseek') {
    const payload = await fetchJson(joinApiPath(resolveApiRoot(service), 'user/balance'), {
      headers: authHeaders(service)
    })
    const balanceInfos = asRecord(payload).balance_infos
    const first = Array.isArray(balanceInfos) ? balanceInfos[0] : undefined
    const balance = asRecord(first)
    return {
      kind: 'balance',
      currency: normalizeString(balance.currency),
      available: firstBalanceNumber(balance.total_balance, balance.topped_up_balance, balance.granted_balance)
    }
  }
  return { kind: 'unsupported', reason: 'Provider does not expose a supported balance or cost API yet.' }
}

const mapStatusIndicator = (indicator: unknown): ProviderStatusIndicator => {
  const value = normalizeString(indicator)
  if (value === 'none' || value === 'operational') return 'operational'
  if (value === 'minor' || value === 'degraded_performance') return 'degraded'
  if (value === 'major' || value === 'partial_outage') return 'partial_outage'
  if (value === 'critical' || value === 'major_outage') return 'major_outage'
  if (value === 'maintenance') return 'maintenance'
  return 'unknown'
}

const matchesComponent = (name: string, provider: ModelProviderDefinition) => (
  (provider.status?.componentMatchers ?? []).length === 0 ||
  (provider.status?.componentMatchers ?? []).some(matcher => name.toLowerCase().includes(matcher.toLowerCase()))
)

export const getProviderServiceStatus = async (providerId: string): Promise<ProviderServiceStatus> => {
  const cached = statusCache.get(providerId)
  if (cached != null && cached.expiresAt > Date.now()) return cached.status

  const provider = getModelProviderDefinition(providerId)
  const status = provider?.status
  const checkedAt = new Date().toISOString()
  if (provider == null || status == null || status.kind === 'unsupported') {
    const result: ProviderServiceStatus = { indicator: 'unsupported', checkedAt, source: 'unsupported' }
    statusCache.set(providerId, { expiresAt: Date.now() + STATUS_CACHE_TTL_MS, status: result })
    return result
  }
  if (status.kind !== 'statuspage' || status.summaryUrl == null) {
    const result: ProviderServiceStatus = {
      indicator: status.kind === 'page_only' ? 'unknown' : 'unsupported',
      pageUrl: status.pageUrl,
      checkedAt,
      source: status.kind
    }
    statusCache.set(providerId, { expiresAt: Date.now() + STATUS_CACHE_TTL_MS, status: result })
    return result
  }
  const payload = asRecord(await fetchJson(status.summaryUrl))
  const pageStatus = asRecord(payload.status)
  const components = (Array.isArray(payload.components) ? payload.components : [])
    .map(item => asRecord(item))
    .filter(item => matchesComponent(normalizeString(item.name) ?? '', provider))
    .map(item => ({ name: normalizeString(item.name) ?? '', status: normalizeString(item.status) ?? 'unknown' }))
  const incidents = (Array.isArray(payload.incidents) ? payload.incidents : [])
    .map(item => asRecord(item))
    .map(item => ({
      name: normalizeString(item.name) ?? '',
      status: normalizeString(item.status),
      impact: normalizeString(item.impact)
    }))
  const result: ProviderServiceStatus = {
    indicator: mapStatusIndicator(pageStatus.indicator),
    description: normalizeString(pageStatus.description),
    pageUrl: status.pageUrl,
    checkedAt,
    components,
    incidents,
    source: 'statuspage'
  }
  statusCache.set(providerId, { expiresAt: Date.now() + STATUS_CACHE_TTL_MS, status: result })
  return result
}

export const createProviderSecret = async (serviceConfig: ModelServiceConfig): Promise<ProviderSecretResult> => {
  const service = resolveService(serviceConfig)
  const provider = service.providerDefinition ?? getModelProviderDefinition(service.provider)
  const url = provider?.portal?.apiKeys ?? provider?.portal?.console ?? provider?.portal?.homepage
  return url != null
    ? { kind: 'console', url, reason: 'This provider secret action requires the official console in this version.' }
    : { kind: 'unsupported', reason: 'Provider does not expose a supported secret API yet.' }
}
