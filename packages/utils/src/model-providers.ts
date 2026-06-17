/* eslint-disable max-lines -- model provider resolution keeps host matching, defaults, and plan metadata together. */
import type {
  IconRef,
  ModelProviderCodingPlanDefinition,
  ModelProviderCodingPlanRegion,
  ModelProviderIdentity,
  ModelProviderProtocolEndpoint,
  ModelServiceBillingConfig,
  ModelServiceConfig,
  ResolvedModelServiceConfig
} from '@oneworks/types'

import { MODEL_PROVIDER_DEFINITIONS } from './model-provider-registry'

export { MODEL_PROVIDER_DEFINITIONS } from './model-provider-registry'

export const DEFAULT_MODEL_SERVICE_ICON: IconRef = { kind: 'builtin', id: 'model-service' }
export const DEFAULT_MODEL_ICON: IconRef = { kind: 'builtin', id: 'model' }

export interface ModelServiceResolutionIssue {
  type: 'missing_api_base_url'
  path?: string[]
  message: string
}
export interface ModelServiceResolutionResult {
  service?: ResolvedModelServiceConfig
  issues: ModelServiceResolutionIssue[]
}

const MODEL_PROVIDER_DEFINITION_MAP = new Map(MODEL_PROVIDER_DEFINITIONS.map(provider => [provider.id, provider]))

const matchHost = (url: URL, host: string) => url.hostname.toLowerCase() === host
const matchHostSuffix = (url: URL, suffix: string) => url.hostname.toLowerCase().endsWith(suffix)
const matchPathPrefix = (url: URL, prefix: string) => url.pathname.replace(/\/+$/u, '').startsWith(prefix)

const PROVIDER_HOST_MATCHERS: Array<{ provider: string; match: (url: URL) => boolean }> = [
  { provider: 'openai', match: url => matchHost(url, 'api.openai.com') },
  { provider: 'anthropic', match: url => matchHost(url, 'api.anthropic.com') },
  { provider: 'moonshot-cn', match: url => matchHost(url, 'api.moonshot.cn') },
  { provider: 'moonshot-intl', match: url => matchHost(url, 'api.moonshot.ai') },
  { provider: 'kimi-code', match: url => matchHost(url, 'api.kimi.com') && matchPathPrefix(url, '/coding') },
  { provider: 'deepseek', match: url => matchHost(url, 'api.deepseek.com') },
  {
    provider: 'minimax-token-plan',
    match: url =>
      (matchHost(url, 'api.minimax.io') || matchHost(url, 'api.minimaxi.com')) &&
      matchPathPrefix(url, '/anthropic')
  },
  {
    provider: 'minimax',
    match: url => matchHost(url, 'api.minimax.io') || matchHost(url, 'api.minimaxi.com')
  },
  {
    provider: 'qwen-coding-plan',
    match: url =>
      matchHost(url, 'coding.dashscope.aliyuncs.com') ||
      matchHost(url, 'coding-intl.dashscope.aliyuncs.com')
  },
  {
    provider: 'qwen',
    match: url =>
      matchHost(url, 'dashscope.aliyuncs.com') || matchHost(url, 'dashscope-intl.aliyuncs.com') ||
      matchHost(url, 'dashscope-us.aliyuncs.com') || matchHostSuffix(url, '.dashscope.aliyuncs.com') ||
      matchHostSuffix(url, '.maas.aliyuncs.com')
  },
  {
    provider: 'zhipu-coding-plan',
    match: url => matchHost(url, 'open.bigmodel.cn') && matchPathPrefix(url, '/api/coding')
  },
  { provider: 'zhipu', match: url => matchHost(url, 'open.bigmodel.cn') },
  {
    provider: 'tencent-tokenhub-coding-plan',
    match: url => matchHost(url, 'api.lkeap.cloud.tencent.com') && matchPathPrefix(url, '/coding')
  },
  {
    provider: 'volcengine-ark-coding-plan',
    match: url => matchHost(url, 'ark.cn-beijing.volces.com') && matchPathPrefix(url, '/api/coding')
  },
  {
    provider: 'baidu-qianfan-coding-plan',
    match: url => matchHost(url, 'qianfan.baidubce.com') && url.pathname.includes('/coding')
  },
  { provider: 'openrouter', match: url => matchHost(url, 'openrouter.ai') },
  { provider: 'vercel-ai-gateway', match: url => matchHost(url, 'ai-gateway.vercel.sh') },
  { provider: 'requesty', match: url => matchHost(url, 'router.requesty.ai') },
  { provider: 'portkey', match: url => matchHost(url, 'api.portkey.ai') }
]

const normalizeString = (
  value: unknown
) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
const normalizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(item => normalizeString(item)).filter((item): item is string => item != null)))
    : []

const resolveHostProvider = (apiBaseUrl: unknown) => {
  const normalized = normalizeString(apiBaseUrl)
  if (normalized == null) return undefined
  try {
    const url = new URL(normalized)
    return PROVIDER_HOST_MATCHERS.find(entry => entry.match(url))?.provider
  } catch {
    return undefined
  }
}

export const listModelProviderDefinitions = () => [...MODEL_PROVIDER_DEFINITIONS]

export const getModelProviderDefinition = (provider: unknown) => {
  const providerId = normalizeString(provider)
  return providerId != null ? MODEL_PROVIDER_DEFINITION_MAP.get(providerId) : undefined
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

export const resolveModelServiceApiBaseUrl = (service: ModelServiceConfig | undefined) =>
  normalizeString(service?.apiBaseUrl) ??
    getModelProviderDefinition(resolveModelProviderIdentity(service).provider)?.defaultApiBaseUrl ??
    resolveModelServicePlanProtocolBaseUrl(service, 'openai')

export const resolveModelServiceModels = (service: ModelServiceConfig | undefined) => {
  const configuredModels = normalizeStringArray(service?.models)
  if (configuredModels.length > 0) return configuredModels
  const codingPlanModels = normalizeStringArray(resolveModelServiceCodingPlan(service)?.defaultModels)
  if (codingPlanModels.length > 0) return codingPlanModels
  return normalizeStringArray(getModelProviderDefinition(resolveModelProviderIdentity(service).provider)?.defaultModels)
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
      ...(billing != null ? { billing } : {}),
      ...(codingPlan != null ? { codingPlan } : {}),
      modelSource: configuredModels.length > 0 ? 'configured' : 'provider_catalog',
      ...(providerDefinition != null ? { providerDefinition } : {})
    },
    issues: []
  }
}
