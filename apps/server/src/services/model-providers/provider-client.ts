/* eslint-disable max-lines -- provider HTTP clients share normalization and error handling */
import { createHash } from 'node:crypto'

import type {
  ModelProviderDefinition,
  ModelServiceConfig,
  ProviderAccountStatus,
  ProviderManagementGroup,
  ProviderManagementMutationResult,
  ProviderManagementSnapshot,
  ProviderManagementToken,
  ProviderManagementTokenCreateInput,
  ProviderManagementTokenProfileResult,
  ProviderManagementTokenUpdateInput,
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
const normalizeStringRecord = (value: unknown) => {
  const record = asRecord(value)
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, itemValue]) => [normalizeString(key), normalizeString(itemValue)] as const)
      .filter((entry): entry is [string, string] => entry[0] != null && entry[1] != null)
  )
}
const asNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
const STATUS_CACHE_TTL_MS = 90_000
const NEW_API_MANAGEMENT_CACHE_TTL_MS = 60_000

const statusCache = new Map<string, { expiresAt: number; status: ProviderServiceStatus }>()
const newApiManagementCache = new Map<string, { expiresAt: number; payload: unknown; scope: string }>()

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
const NEW_API_QUOTA_PER_USD = 500_000

const normalizeNewApiQuotaAmount = (value: unknown) => {
  const amount = asNumber(value)
  return amount == null ? undefined : amount / NEW_API_QUOTA_PER_USD
}

const toNewApiQuotaAmount = (value: unknown) => {
  const amount = asNumber(value)
  return amount == null ? undefined : Math.round(amount * NEW_API_QUOTA_PER_USD)
}

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
    unit: 'percent',
    limit: totalQuota.limit ?? usage.limit,
    remaining: totalQuota.remaining ?? usage.remaining,
    resetTime: totalQuota.resetTime ?? usage.resetTime,
    windows,
    parallelLimit: asNumber(parallel.limit),
    plan: normalizeString(membership.level),
    raw: payload
  }
}

const resolveNewApiRoot = (service: ResolvedModelServiceConfig) => {
  const url = new URL(service.apiBaseUrl)
  url.pathname = url.pathname
    .replace(/\/v1\/?$/u, '')
    .replace(/\/+$/u, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/u, '')
}

const normalizeNewApiManagementRoot = (baseUrl: string) => {
  const url = new URL(baseUrl)
  url.pathname = url.pathname
    .replace(/\/v1\/?$/u, '')
    .replace(/\/+$/u, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/u, '')
}

const normalizeNewApiTokenKey = (value: unknown) => {
  const key = normalizeString(value)
  if (key == null) return undefined
  return key.startsWith('sk-') ? key : `sk-${key}`
}

const maskNewApiTokenKey = (value: unknown) => {
  const key = normalizeNewApiTokenKey(value)
  if (key == null) return undefined
  const raw = key.slice('sk-'.length)
  if (raw.length <= 4) return `sk-${'*'.repeat(raw.length)}`
  if (raw.length <= 8) return `sk-${raw.slice(0, 2)}****${raw.slice(-2)}`
  return `sk-${raw.slice(0, 4)}**********${raw.slice(-4)}`
}

const normalizeNewApiModelLimits = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map(item => normalizeString(item)).filter((item): item is string => item != null)
  }
  if (typeof value === 'string') {
    return value.split(',').map(item => normalizeString(item)).filter((item): item is string => item != null)
  }
  if (value != null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => enabled === true)
      .map(([model]) => model)
  }
  return undefined
}

const requireNewApiManagement = (service: ResolvedModelServiceConfig) => {
  const endpointKind = normalizeString(service.management?.endpointKind)
  if (endpointKind != null && endpointKind !== 'newapi') {
    throw new ProviderActionError('provider_unsupported', `Unsupported management endpoint "${endpointKind}".`)
  }
  if (service.provider !== 'micu' && endpointKind !== 'newapi') {
    throw new ProviderActionError('provider_unsupported', 'Provider does not expose a New API management endpoint.')
  }
  const managementApiKey = normalizeString(service.management?.apiKey)
  if (managementApiKey == null) {
    throw new ProviderActionError('missing_api_key', 'Model service is missing management.apiKey.')
  }
  const managementHeaders = normalizeStringRecord(service.management?.headers)
  const legacyManagementUserId = normalizeString(service.management?.userId)
  if (legacyManagementUserId != null && managementHeaders['New-Api-User'] == null) {
    managementHeaders['New-Api-User'] = legacyManagementUserId
  }
  const root = normalizeNewApiManagementRoot(
    normalizeString(service.management?.baseUrl) ?? resolveNewApiRoot(service)
  )
  return {
    headers: {
      Authorization: `Bearer ${managementApiKey}`,
      ...managementHeaders
    },
    root
  }
}

const stableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, itemValue]) => [key, stableJsonValue(itemValue)])
    )
  }
  return value
}

const hashCacheKey = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(stableJsonValue(value)))
    .digest('hex')

const getNewApiManagementCacheScope = (
  management: ReturnType<typeof requireNewApiManagement>
) =>
  hashCacheKey({
    headers: management.headers,
    root: management.root
  })

const getNewApiManagementCacheEntry = (
  service: ResolvedModelServiceConfig,
  path: string
) => {
  const management = requireNewApiManagement(service)
  const scope = getNewApiManagementCacheScope(management)
  return {
    key: `${scope}:${path}`,
    scope
  }
}

const clearNewApiManagementCache = (service: ResolvedModelServiceConfig) => {
  const management = requireNewApiManagement(service)
  const scope = getNewApiManagementCacheScope(management)
  for (const [key, item] of newApiManagementCache.entries()) {
    if (item.scope === scope) newApiManagementCache.delete(key)
  }
}

const fetchNewApiManagementJson = async (
  service: ResolvedModelServiceConfig,
  path: string,
  options?: RequestInit
) => {
  const management = requireNewApiManagement(service)
  const headers = {
    ...management.headers,
    ...(options?.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(options?.headers ?? {})
  }
  const payload = await fetchJson(joinApiPath(management.root, path), {
    ...options,
    headers
  })
  const record = asRecord(payload)
  if (record.success === false || record.code === false) {
    throw new ProviderActionError(
      'upstream_request_rejected',
      normalizeString(record.message) ?? 'Provider rejected the New API management request.'
    )
  }
  return payload
}

const fetchCachedNewApiManagementJson = async (
  service: ResolvedModelServiceConfig,
  path: string
) => {
  const cache = getNewApiManagementCacheEntry(service, path)
  const cached = newApiManagementCache.get(cache.key)
  if (cached != null && cached.expiresAt > Date.now()) return cached.payload

  const payload = await fetchNewApiManagementJson(service, path)
  newApiManagementCache.set(cache.key, {
    expiresAt: Date.now() + NEW_API_MANAGEMENT_CACHE_TTL_MS,
    payload,
    scope: cache.scope
  })
  return payload
}

const fetchOptionalCachedNewApiManagementJson = async (
  service: ResolvedModelServiceConfig,
  path: string
) => {
  try {
    return await fetchCachedNewApiManagementJson(service, path)
  } catch {
    return undefined
  }
}

const unwrapNewApiData = (payload: unknown) => {
  const record = asRecord(payload)
  return record.data ?? payload
}

const normalizeNewApiAccountStatus = (payload: unknown): ProviderAccountStatus => {
  const data = asRecord(unwrapNewApiData(payload))
  return {
    available: normalizeNewApiQuotaAmount(data.quota),
    currency: 'CNY',
    kind: 'balance',
    raw: payload
  }
}

const mapNewApiGroup = (value: unknown): ProviderManagementGroup | undefined => {
  if (typeof value === 'string') return { id: value, title: value }
  const record = asRecord(value)
  const id = normalizeString(record.id) ??
    normalizeString(record.name) ??
    normalizeString(record.group) ??
    normalizeString(record.code)
  if (id == null) return undefined
  return {
    id,
    title: normalizeString(record.name) ?? normalizeString(record.title) ?? id,
    description: normalizeString(record.description),
    ratio: asNumber(record.ratio) ?? asNumber(record.group_ratio),
    raw: value
  }
}

const mapNewApiToken = (value: unknown): ProviderManagementToken | undefined => {
  const record = asRecord(value)
  const id = normalizeString(record.id) ?? (asNumber(record.id) == null ? undefined : String(asNumber(record.id)))
  if (id == null) return undefined
  return {
    id,
    name: normalizeString(record.name),
    key: maskNewApiTokenKey(record.key),
    status: asNumber(record.status),
    group: normalizeString(record.group),
    quota: normalizeNewApiQuotaAmount(record.quota ?? record.remain_quota),
    remaining: normalizeNewApiQuotaAmount(record.remain_quota),
    unlimited: record.unlimited_quota === true,
    expiredAt: asNumber(record.expired_time) ?? asNumber(record.expires_at),
    createdAt: asNumber(record.created_time) ?? asNumber(record.created_at),
    accessedAt: asNumber(record.accessed_time) ?? asNumber(record.accessed_at),
    modelLimits: normalizeNewApiModelLimits(record.model_limits),
    modelLimitsEnabled: record.model_limits_enabled === true
  }
}

const normalizeNewApiList = (payload: unknown) => {
  const data = unwrapNewApiData(payload)
  if (Array.isArray(data)) return data
  const record = asRecord(data)
  if (Array.isArray(record.items)) return record.items
  if (Array.isArray(record.data)) return record.data
  return []
}

const buildNewApiTokenPayload = (
  input: ProviderManagementTokenCreateInput | ProviderManagementTokenUpdateInput
) => ({
  ...('id' in input ? { id: asNumber(input.id) ?? input.id } : {}),
  name: normalizeString(input.name),
  expired_time: input.expiredAt ?? -1,
  ...(input.quota == null ? {} : { remain_quota: toNewApiQuotaAmount(input.quota) }),
  ...(input.unlimited == null ? {} : { unlimited_quota: input.unlimited }),
  ...(input.modelLimitsEnabled == null ? {} : { model_limits_enabled: input.modelLimitsEnabled }),
  ...(input.modelLimits == null ? {} : { model_limits: input.modelLimits }),
  ...(normalizeString(input.allowIps) == null ? {} : { allow_ips: normalizeString(input.allowIps) }),
  ...(normalizeString(input.group) == null ? {} : { group: normalizeString(input.group) }),
  ...('status' in input && input.status != null ? { status: input.status } : {})
})

const buildNewApiTokenProfile = (
  tokenId: string | undefined,
  tokenData: Record<string, unknown>,
  fallbackName: string
): ModelServiceConfig | undefined => {
  const tokenKey = normalizeNewApiTokenKey(tokenData.key)
  if (tokenKey == null) return undefined
  const group = normalizeString(tokenData.group)
  return {
    apiKey: tokenKey,
    description: group == null ? undefined : `New API token group: ${group}`,
    extra: {
      ...(group == null ? {} : { group }),
      ...(tokenId == null ? {} : { newapiTokenId: tokenId })
    },
    title: normalizeString(tokenData.name) ?? fallbackName
  }
}

const getMicuAccountStatus = async (
  service: ResolvedModelServiceConfig
): Promise<ProviderAccountStatus> => {
  if (normalizeString(service.management?.apiKey) != null) {
    return normalizeNewApiAccountStatus(await fetchCachedNewApiManagementJson(service, 'api/user/self'))
  }

  const payload = await fetchJson(joinApiPath(resolveNewApiRoot(service), 'api/usage/token'), {
    headers: authHeaders(service)
  })
  const record = asRecord(payload)
  if (record.code !== true) {
    throw new ProviderActionError(
      'upstream_request_rejected',
      normalizeString(record.message) ?? 'Provider rejected the token usage request.'
    )
  }
  const data = asRecord(record.data)
  return {
    kind: 'quota',
    currency: 'USD',
    limit: normalizeNewApiQuotaAmount(data.total_granted),
    remaining: normalizeNewApiQuotaAmount(data.total_available),
    unlimited: data.unlimited_quota === true,
    used: normalizeNewApiQuotaAmount(data.total_used),
    raw: payload
  }
}

export const getProviderManagementSnapshot = async (
  serviceConfig: ModelServiceConfig
): Promise<ProviderManagementSnapshot> => {
  const service = resolveService(serviceConfig)
  requireNewApiManagement(service)
  const [accountPayload, tokensPayload, groupsPayload, modelsPayload] = await Promise.all([
    fetchCachedNewApiManagementJson(service, 'api/user/self'),
    fetchCachedNewApiManagementJson(service, 'api/token/?p=0&page_size=100'),
    fetchOptionalCachedNewApiManagementJson(service, 'api/user/self/groups'),
    fetchOptionalCachedNewApiManagementJson(service, 'api/user/models')
  ])
  return {
    account: normalizeNewApiAccountStatus(accountPayload),
    groups: normalizeNewApiList(groupsPayload)
      .map(mapNewApiGroup)
      .filter((group): group is ProviderManagementGroup => group != null),
    kind: 'newapi',
    models: normalizeNewApiList(modelsPayload)
      .map(mapModel)
      .filter((model): model is ProviderModelInfo => model != null),
    tokens: normalizeNewApiList(tokensPayload)
      .map(mapNewApiToken)
      .filter((token): token is ProviderManagementToken => token != null)
  }
}

export const createProviderManagementToken = async (
  serviceConfig: ModelServiceConfig,
  input: ProviderManagementTokenCreateInput
): Promise<ProviderManagementMutationResult> => {
  const service = resolveService(serviceConfig)
  const payload = await fetchNewApiManagementJson(service, 'api/token/', {
    body: JSON.stringify(buildNewApiTokenPayload(input)),
    method: 'POST'
  })
  clearNewApiManagementCache(service)
  const tokenData = asRecord(unwrapNewApiData(payload))
  const token = mapNewApiToken(tokenData)
  const profile = buildNewApiTokenProfile(token?.id, tokenData, input.name)
  return {
    message: normalizeString(asRecord(payload).message),
    ...(profile == null ? {} : { profile }),
    ...(token == null ? {} : { token }),
    success: true
  }
}

export const updateProviderManagementToken = async (
  serviceConfig: ModelServiceConfig,
  input: ProviderManagementTokenUpdateInput
): Promise<ProviderManagementMutationResult> => {
  const service = resolveService(serviceConfig)
  const payload = await fetchNewApiManagementJson(service, 'api/token/', {
    body: JSON.stringify(buildNewApiTokenPayload(input)),
    method: 'PUT'
  })
  clearNewApiManagementCache(service)
  return {
    message: normalizeString(asRecord(payload).message),
    success: true,
    token: mapNewApiToken(unwrapNewApiData(payload))
  }
}

export const deleteProviderManagementToken = async (
  serviceConfig: ModelServiceConfig,
  tokenId: string
): Promise<ProviderManagementMutationResult> => {
  const service = resolveService(serviceConfig)
  const payload = await fetchNewApiManagementJson(service, `api/token/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE'
  })
  clearNewApiManagementCache(service)
  return {
    message: normalizeString(asRecord(payload).message),
    success: true
  }
}

export const getProviderManagementTokenProfile = async (
  serviceConfig: ModelServiceConfig,
  tokenId: string
): Promise<ProviderManagementTokenProfileResult> => {
  const service = resolveService(serviceConfig)
  const payload = await fetchNewApiManagementJson(service, `api/token/${encodeURIComponent(tokenId)}`)
  const data = asRecord(unwrapNewApiData(payload))
  const profile = buildNewApiTokenProfile(tokenId, data, `Token ${tokenId}`)
  if (profile == null) {
    throw new ProviderActionError('upstream_invalid_response', 'Provider did not return a usable token key.')
  }
  return {
    profile
  }
}

export const getProviderAccountStatus = async (serviceConfig: ModelServiceConfig): Promise<ProviderAccountStatus> => {
  const service = resolveService(serviceConfig)
  if (service.provider === 'kimi-code') {
    return getKimiCodeAccountStatus(service)
  }
  if (service.provider === 'micu') {
    return getMicuAccountStatus(service)
  }
  if (service.provider === 'moonshot-cn' || service.provider === 'moonshot-intl') {
    const payload = await fetchJson(joinApiPath(resolveApiRoot(service), 'users/me/balance'), {
      headers: authHeaders(service)
    })
    const data = asRecord(asRecord(payload).data)
    return {
      kind: 'balance',
      currency: normalizeString(data.currency) ?? (service.provider === 'moonshot-intl' ? 'USD' : 'CNY'),
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
