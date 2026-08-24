/* eslint-disable max-lines -- model provider resolution keeps host matching, defaults, and plan metadata together. */
import type {
  IconRef,
  ModelProviderCatalog,
  ModelProviderCodingPlanDefinition,
  ModelProviderCodingPlanRegion,
  ModelProviderDefinition,
  ModelProviderIdentity,
  ModelProviderProtocolEndpoint,
  ModelServiceBillingConfig,
  ModelServiceConfig,
  ResolvedModelServiceConfig
} from '@oneworks/types'
import type { ModelServiceApiProtocol } from '@oneworks/types/model-service-protocol'
import { MODEL_SERVICE_API_PROTOCOLS } from '@oneworks/types/model-service-protocol'

import { MODEL_PROVIDER_CATALOG, validateModelProviderCatalog } from '@oneworks/model-provider-catalog'

export { MODEL_PROVIDER_DEFINITIONS } from './model-provider-registry'

export const DEFAULT_MODEL_SERVICE_ICON: IconRef = { kind: 'builtin', id: 'model-service' }
export const DEFAULT_MODEL_ICON: IconRef = { kind: 'builtin', id: 'model' }
export const MODEL_SERVICE_COLLECTION_SEPARATOR = '/'

const MODEL_SERVICE_API_PROTOCOL_SET = new Set<ModelServiceApiProtocol>(MODEL_SERVICE_API_PROTOCOLS)

export interface ModelServiceResolutionIssue {
  type: 'missing_api_base_url'
  path?: string[]
  message: string
}
export interface ModelServiceResolutionResult {
  service?: ResolvedModelServiceConfig
  issues: ModelServiceResolutionIssue[]
}

let activeModelProviderCatalog = MODEL_PROVIDER_CATALOG
let modelProviderDefinitionMap = new Map<string, ModelProviderDefinition>(
  activeModelProviderCatalog.providers.map(provider => [provider.id, provider])
)

export const installModelProviderCatalog = (catalog: unknown) => {
  activeModelProviderCatalog = validateModelProviderCatalog(catalog)
  modelProviderDefinitionMap = new Map(
    activeModelProviderCatalog.providers.map(provider => [provider.id, provider])
  )
}

export const resetModelProviderCatalog = () => installModelProviderCatalog(MODEL_PROVIDER_CATALOG)

export const getModelProviderCatalog = (): ModelProviderCatalog => activeModelProviderCatalog

const matchesCatalogHost = (hostname: string, catalogHost: string) => (
  catalogHost.startsWith('*.')
    ? hostname.endsWith(catalogHost.slice(1))
    : hostname === catalogHost
)

const normalizeString = (
  value: unknown
) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
const normalizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(item => normalizeString(item)).filter((item): item is string => item != null)))
    : []

const asRecord = (value: unknown): Record<string, unknown> | undefined => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
)

export const getModelServiceProfiles = (service: ModelServiceConfig | undefined) => (
  asRecord(service?.profiles) ?? asRecord(service?.services)
)

export const isModelServiceCollection = (service: ModelServiceConfig | undefined) => (
  service?.kind === 'collection' || getModelServiceProfiles(service) != null
)

export const buildCollectionModelServiceKey = (collectionKey: string, serviceKey: string) =>
  `${collectionKey}${MODEL_SERVICE_COLLECTION_SEPARATOR}${serviceKey}`

export const DEFAULT_MODEL_SERVICE_PROFILE_KEY = 'default'

export const resolveUniqueModelServiceKey = (baseKey: string, existingKeys: Set<string>) => {
  if (!existingKeys.has(baseKey)) return baseKey
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${baseKey}-${index}`
    if (!existingKeys.has(candidate)) return candidate
  }
  return `${baseKey}-${Date.now()}`
}

const modelServiceProfileFieldKeys = [
  'apiBaseUrl',
  'apiProtocol',
  'apiKey',
  'models',
  'supportedAdapters',
  'unsupportedAdapters',
  'timeoutMs',
  'maxOutputTokens',
  'extra'
] as const satisfies ReadonlyArray<keyof ModelServiceConfig>

export const promoteModelServiceToProvider = (
  service: ModelServiceConfig
): ModelServiceConfig => {
  const provider: ModelServiceConfig = {
    ...service,
    kind: 'collection'
  }
  const profile: ModelServiceConfig = {}

  for (const fieldKey of modelServiceProfileFieldKeys) {
    if (provider[fieldKey] === undefined) continue
    Object.assign(profile, { [fieldKey]: provider[fieldKey] })
    delete provider[fieldKey]
  }

  delete provider.services
  provider.profiles = {
    [DEFAULT_MODEL_SERVICE_PROFILE_KEY]: profile
  }
  return provider
}

const hashRuntimeId = (value: string) => {
  let hash = 0x811C9DC5
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Convert a user-facing service selector into an adapter-safe native identifier.
 * Plain legacy service keys are preserved; composite Profile selectors get a
 * deterministic suffix so they cannot collide with a similarly named service.
 */
export const buildModelServiceRuntimeId = (serviceKey: string) => {
  const normalized = serviceKey.trim()
  if (/^[\w-]+$/u.test(normalized)) return normalized
  const prefix = normalized
    .replace(/[^\w-]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'service'
  return `${prefix}-${hashRuntimeId(normalized)}`
}

export const parseCollectionModelServiceKey = (serviceKey: string) => {
  const separatorIndex = serviceKey.indexOf(MODEL_SERVICE_COLLECTION_SEPARATOR)
  if (separatorIndex <= 0 || separatorIndex >= serviceKey.length - 1) return undefined
  const collectionKey = normalizeString(serviceKey.slice(0, separatorIndex))
  const childServiceKey = normalizeString(serviceKey.slice(separatorIndex + 1))
  if (collectionKey == null || childServiceKey == null) return undefined
  return { collectionKey, childServiceKey }
}

export const resolveCollectionModelService = (
  collection: ModelServiceConfig,
  serviceKey: string
): ModelServiceConfig | undefined => {
  const profiles = getModelServiceProfiles(collection)
  const child = profiles?.[serviceKey]
  if (child == null || typeof child !== 'object' || Array.isArray(child)) return undefined
  const childService = child as ModelServiceConfig
  return {
    ...(collection.provider != null ? { provider: collection.provider } : {}),
    ...(collection.icon != null ? { icon: collection.icon } : {}),
    ...(collection.homepageUrl != null ? { homepageUrl: collection.homepageUrl } : {}),
    ...(collection.apiBaseUrl != null ? { apiBaseUrl: collection.apiBaseUrl } : {}),
    ...(collection.apiProtocol != null ? { apiProtocol: collection.apiProtocol } : {}),
    ...(collection.billing != null ? { billing: collection.billing } : {}),
    ...(collection.codingPlan != null ? { codingPlan: collection.codingPlan } : {}),
    ...(collection.providerOptions != null ? { providerOptions: collection.providerOptions } : {}),
    ...childService,
    kind: 'service'
  }
}

/**
 * Resolves the upstream wire protocol. Explicit config always wins; legacy hints
 * remain supported so existing model-service entries do not change behavior.
 */
export const resolveExplicitModelServiceApiProtocol = (
  service: ModelServiceConfig | undefined
): ModelServiceApiProtocol | undefined => {
  if (service?.apiProtocol != null) {
    if (MODEL_SERVICE_API_PROTOCOL_SET.has(service.apiProtocol)) return service.apiProtocol
    throw new Error(`Unsupported model service apiProtocol: ${JSON.stringify(service.apiProtocol)}.`)
  }
  return undefined
}

export const resolveModelServiceApiProtocol = (
  service: ModelServiceConfig | undefined
): ModelServiceApiProtocol | undefined => {
  const explicitProtocol = resolveExplicitModelServiceApiProtocol(service)
  if (explicitProtocol != null) return explicitProtocol

  const extra = asRecord(service?.extra)
  const codexExtra = asRecord(extra?.codex)
  const codexWireApi = normalizeString(codexExtra?.wireApi)
  if (codexWireApi === 'responses') return 'openai-responses'
  if (codexWireApi === 'chat') return 'openai-chat-completions'

  const piExtra = asRecord(extra?.pi)
  switch (normalizeString(piExtra?.api)) {
    case 'openai-responses':
      return 'openai-responses'
    case 'openai-completions':
      return 'openai-chat-completions'
    case 'anthropic-messages':
      return 'anthropic-messages'
    case 'google-generative-ai':
      return 'gemini-generate-content'
  }

  const apiBaseUrl = normalizeString(service?.apiBaseUrl)?.toLowerCase()
  if (apiBaseUrl == null) {
    return getModelProviderDefinition(resolveModelProviderIdentity(service).provider)?.defaultApiProtocol
  }
  if (/\/responses\/?(?:[?#].*)?$/u.test(apiBaseUrl)) return 'openai-responses'
  if (/\/chat\/completions\/?(?:[?#].*)?$/u.test(apiBaseUrl)) return 'openai-chat-completions'
  if (/\/messages\/?(?:[?#].*)?$/u.test(apiBaseUrl)) return 'anthropic-messages'
  if (apiBaseUrl.includes(':generatecontent') || apiBaseUrl.includes(':streamgeneratecontent')) {
    return 'gemini-generate-content'
  }
  return getModelProviderDefinition(resolveModelProviderIdentity(service).provider)?.defaultApiProtocol
}

export const resolveModelServiceFromMap = (
  modelServices: Record<string, ModelServiceConfig> | undefined,
  serviceKey: string
): ModelServiceConfig | undefined => {
  const directService = modelServices?.[serviceKey]
  if (directService != null) return directService
  const parsed = parseCollectionModelServiceKey(serviceKey)
  if (parsed == null) return undefined
  const collection = modelServices?.[parsed.collectionKey]
  if (collection == null || !isModelServiceCollection(collection)) return undefined
  return resolveCollectionModelService(collection, parsed.childServiceKey)
}

export const flattenModelServices = (
  modelServices: Record<string, ModelServiceConfig>
): Record<string, ModelServiceConfig> => {
  const flattened: Record<string, ModelServiceConfig> = {}
  for (const [serviceKey, service] of Object.entries(modelServices)) {
    const normalizedServiceKey = normalizeString(serviceKey)
    if (normalizedServiceKey == null || service == null) continue
    if (!isModelServiceCollection(service)) {
      flattened[normalizedServiceKey] = service
    }
  }
  for (const [serviceKey, service] of Object.entries(modelServices)) {
    const normalizedServiceKey = normalizeString(serviceKey)
    if (normalizedServiceKey == null || service == null || !isModelServiceCollection(service)) continue
    const profiles = getModelServiceProfiles(service)
    for (const childServiceKey of Object.keys(profiles ?? {})) {
      const normalizedChildServiceKey = normalizeString(childServiceKey)
      if (normalizedChildServiceKey == null) continue
      const childService = resolveCollectionModelService(service, normalizedChildServiceKey)
      if (childService == null) continue
      const compositeKey = buildCollectionModelServiceKey(normalizedServiceKey, normalizedChildServiceKey)
      if (flattened[compositeKey] == null) flattened[compositeKey] = childService
    }
  }
  return flattened
}

const resolveHostProvider = (apiBaseUrl: unknown) => {
  const normalized = normalizeString(apiBaseUrl)
  if (normalized == null) return undefined
  try {
    const url = new URL(normalized)
    const hostname = url.hostname.toLowerCase()
    const pathname = url.pathname.replace(/\/+$/u, '')
    return activeModelProviderCatalog.hostMatchers.find(entry => (
      entry.hosts.some(host => matchesCatalogHost(hostname, host.toLowerCase())) &&
      (entry.pathPrefix == null || pathname.startsWith(entry.pathPrefix)) &&
      (entry.pathIncludes == null || pathname.includes(entry.pathIncludes))
    ))?.provider
  } catch {
    return undefined
  }
}

export const listModelProviderDefinitions = () => [...activeModelProviderCatalog.providers]

export const getModelProviderDefinition = (provider: unknown) => {
  const providerId = normalizeString(provider)
  return providerId != null ? modelProviderDefinitionMap.get(providerId) : undefined
}

export const resolveModelProviderIdentity = (service: ModelServiceConfig | undefined): ModelProviderIdentity => {
  const configuredProvider = normalizeString(service?.provider)
  const hostProvider = resolveHostProvider(service?.apiBaseUrl)
  if (configuredProvider != null) {
    return {
      provider: configuredProvider,
      confidence: 'configured',
      ...(hostProvider != null && hostProvider !== configuredProvider
        ? {
          warnings: [
            `Configured provider "${configuredProvider}" does not match apiBaseUrl host provider "${hostProvider}".`
          ]
        }
        : {})
    }
  }
  return hostProvider != null
    ? { provider: hostProvider, confidence: 'host_match' }
    : { confidence: 'none' }
}

export const normalizeIconRef = (value: unknown): IconRef | undefined => {
  const normalized = normalizeString(value)
  if (normalized == null) return undefined
  if (normalized.startsWith('builtin:')) {
    return normalizeString(normalized.slice('builtin:'.length)) != null
      ? { kind: 'builtin', id: normalized.slice('builtin:'.length).trim() }
      : undefined
  }
  if (normalized.startsWith('material:')) {
    return normalizeString(normalized.slice('material:'.length)) != null
      ? { kind: 'material', name: normalized.slice('material:'.length).trim() }
      : undefined
  }
  if (normalized.startsWith('data:')) return { kind: 'data', value: normalized }
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return { kind: 'url', url: normalized }
  return { kind: 'builtin', id: normalized }
}

export const resolveModelProviderIcon = (provider: unknown) =>
  getModelProviderDefinition(provider)?.icon ?? DEFAULT_MODEL_SERVICE_ICON
export const resolveModelServiceIcon = (service: ModelServiceConfig | undefined) =>
  normalizeIconRef(service?.icon) ?? getModelProviderDefinition(resolveModelProviderIdentity(service).provider)?.icon ??
    DEFAULT_MODEL_SERVICE_ICON
export const resolveModelProviderDescription = (provider: unknown) =>
  normalizeString(getModelProviderDefinition(provider)?.description)
export const resolveModelServiceDescription = (service: ModelServiceConfig | undefined) =>
  normalizeString(service?.description) ??
    resolveModelProviderDescription(resolveModelProviderIdentity(service).provider)
export const resolveModelServiceHomepageUrl = (service: ModelServiceConfig | undefined) =>
  normalizeString(service?.homepageUrl) ??
    getModelProviderDefinition(resolveModelProviderIdentity(service).provider)?.portal?.homepage

const mergeBilling = (
  base: ModelServiceBillingConfig | undefined,
  override: ModelServiceBillingConfig | undefined
): ModelServiceBillingConfig | undefined => {
  if (base == null) return override
  if (override == null) return base
  return {
    ...base,
    ...override,
    quotaWindows: override.quotaWindows ?? base.quotaWindows,
    notes: override.notes ?? base.notes
  }
}

const mergeProtocols = (
  base: ModelProviderCodingPlanDefinition['protocols'] | undefined,
  override: ModelProviderCodingPlanDefinition['protocols'] | undefined
): ModelProviderCodingPlanDefinition['protocols'] | undefined => {
  if (base == null) return override
  if (override == null) return base
  return {
    openai: {
      ...base.openai,
      ...override.openai
    } as ModelProviderProtocolEndpoint,
    anthropic: {
      ...base.anthropic,
      ...override.anthropic
    } as ModelProviderProtocolEndpoint
  }
}

const mergeStringLists = (
  ...values: Array<string[] | undefined>
) => Array.from(new Set(values.flatMap(value => value ?? []).map(item => item.trim()).filter(Boolean)))

const resolveCodingPlanRegion = (
  plan: ModelProviderCodingPlanDefinition | undefined,
  regionId: unknown
): ModelProviderCodingPlanRegion | undefined => {
  const regions = plan?.regions ?? []
  const normalizedRegionId = normalizeString(regionId)
  if (normalizedRegionId != null) return regions.find(region => region.id === normalizedRegionId)
  return regions.length === 1 && plan?.protocols == null ? regions[0] : undefined
}

export const resolveModelServiceCodingPlan = (
  service: ModelServiceConfig | undefined
): ModelProviderCodingPlanDefinition | undefined => {
  const providerPlan = getModelProviderDefinition(resolveModelProviderIdentity(service).provider)?.codingPlan
  const servicePlan = service?.codingPlan
  if (providerPlan == null && servicePlan == null) return undefined
  const region = resolveCodingPlanRegion(providerPlan, servicePlan?.region)
  const billing = mergeBilling(
    mergeBilling(providerPlan?.billing, region?.billing),
    servicePlan?.billing
  )
  const defaultModels = normalizeStringArray(servicePlan?.defaultModels).length > 0
    ? normalizeStringArray(servicePlan?.defaultModels)
    : normalizeStringArray(region?.defaultModels).length > 0
    ? normalizeStringArray(region?.defaultModels)
    : normalizeStringArray(providerPlan?.defaultModels)
  const protocols = mergeProtocols(
    mergeProtocols(providerPlan?.protocols, region?.protocols),
    servicePlan?.protocols
  )
  return {
    supported: servicePlan?.supported ?? providerPlan?.supported ?? true,
    official: servicePlan?.official ?? providerPlan?.official,
    kind: servicePlan?.kind ?? region?.billing?.kind ?? providerPlan?.kind,
    title: normalizeString(servicePlan?.title) ?? providerPlan?.title,
    planHomeUrl: normalizeString(servicePlan?.planHomeUrl) ??
      normalizeString(region?.planHomeUrl) ??
      providerPlan?.planHomeUrl,
    keyHomeUrl: normalizeString(servicePlan?.keyHomeUrl) ?? normalizeString(region?.keyHomeUrl) ??
      providerPlan?.keyHomeUrl,
    docsUrl: normalizeString(servicePlan?.docsUrl) ?? normalizeString(region?.docsUrl) ?? providerPlan?.docsUrl,
    ...(billing != null ? { billing } : {}),
    ...(protocols != null ? { protocols } : {}),
    ...(providerPlan?.regions != null ? { regions: providerPlan.regions } : {}),
    ...(defaultModels.length > 0 ? { defaultModels } : {}),
    restrictions: mergeStringLists(providerPlan?.restrictions, region?.restrictions, servicePlan?.restrictions),
    notes: mergeStringLists(providerPlan?.notes, servicePlan?.notes)
  }
}

export const resolveModelServiceBilling = (service: ModelServiceConfig | undefined) => (
  mergeBilling(
    getModelProviderDefinition(resolveModelProviderIdentity(service).provider)?.billing,
    mergeBilling(resolveModelServiceCodingPlan(service)?.billing, service?.billing)
  )
)

export const resolveModelServicePlanProtocolBaseUrl = (
  service: ModelServiceConfig | undefined,
  protocol: 'openai' | 'anthropic'
) => normalizeString(resolveModelServiceCodingPlan(service)?.protocols?.[protocol]?.baseUrl)

export const resolveModelServiceApiBaseUrl = (service: ModelServiceConfig | undefined) => {
  const explicitApiBaseUrl = normalizeString(service?.apiBaseUrl)
  if (explicitApiBaseUrl != null) return explicitApiBaseUrl

  const apiProtocol = resolveModelServiceApiProtocol(service)
  const planProtocol = apiProtocol === 'anthropic-messages'
    ? 'anthropic'
    : apiProtocol === 'openai-responses' || apiProtocol === 'openai-chat-completions'
    ? 'openai'
    : undefined
  const planApiBaseUrl = planProtocol == null
    ? undefined
    : resolveModelServicePlanProtocolBaseUrl(service, planProtocol)
  return planApiBaseUrl ??
    getModelProviderDefinition(resolveModelProviderIdentity(service).provider)?.defaultApiBaseUrl
}

export const resolveModelServiceModels = (service: ModelServiceConfig | undefined) => {
  const configuredModels = normalizeStringArray(service?.models)
  const codingPlanModels = normalizeStringArray(resolveModelServiceCodingPlan(service)?.defaultModels)
  if (codingPlanModels.length > 0) return mergeStringLists(codingPlanModels, configuredModels)
  const providerModels = normalizeStringArray(
    getModelProviderDefinition(resolveModelProviderIdentity(service).provider)?.defaultModels
  )
  if (providerModels.length > 0) return mergeStringLists(providerModels, configuredModels)
  if (configuredModels.length > 0) return configuredModels
  return []
}

export const resolveModelServiceConfig = (
  service: ModelServiceConfig | undefined,
  path?: string[]
): ModelServiceResolutionResult => {
  if (service == null) {
    return { issues: [{ type: 'missing_api_base_url', path, message: 'Model service config is missing.' }] }
  }
  const identity = resolveModelProviderIdentity(service)
  const providerDefinition = getModelProviderDefinition(identity.provider)
  const apiBaseUrl = resolveModelServiceApiBaseUrl(service)
  const apiProtocol = resolveModelServiceApiProtocol(service)
  const billing = resolveModelServiceBilling(service)
  const codingPlan = resolveModelServiceCodingPlan(service)
  const configuredModels = normalizeStringArray(service.models)
  if (apiBaseUrl == null) {
    return {
      issues: [{
        type: 'missing_api_base_url',
        path: path != null ? [...path, 'apiBaseUrl'] : ['apiBaseUrl'],
        message: 'Model service requires apiBaseUrl unless provider supplies a default base URL.'
      }]
    }
  }
  return {
    service: {
      ...service,
      ...(identity.provider != null ? { provider: identity.provider } : {}),
      apiBaseUrl,
      ...(apiProtocol != null ? { apiProtocol } : {}),
      apiKey: service.apiKey ?? '',
      ...(billing != null ? { billing } : {}),
      ...(codingPlan != null ? { codingPlan } : {}),
      modelSource: configuredModels.length > 0 ? 'configured' : 'provider_catalog',
      ...(providerDefinition != null ? { providerDefinition } : {})
    },
    issues: []
  }
}
