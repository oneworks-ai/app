import type { IconRef, ModelProviderIdentity, ModelServiceConfig, ResolvedModelServiceConfig } from '@oneworks/types'

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

const PROVIDER_HOST_MATCHERS: Array<{ provider: string; match: (host: string) => boolean }> = [
  { provider: 'openai', match: host => host === 'api.openai.com' },
  { provider: 'anthropic', match: host => host === 'api.anthropic.com' },
  { provider: 'moonshot-cn', match: host => host === 'api.moonshot.cn' },
  { provider: 'moonshot-intl', match: host => host === 'api.moonshot.ai' },
  { provider: 'deepseek', match: host => host === 'api.deepseek.com' },
  { provider: 'minimax', match: host => host === 'api.minimax.io' || host === 'api.minimaxi.com' },
  {
    provider: 'qwen',
    match: host =>
      host === 'dashscope.aliyuncs.com' || host === 'dashscope-intl.aliyuncs.com' ||
      host === 'dashscope-us.aliyuncs.com' || host.endsWith('.dashscope.aliyuncs.com') ||
      host.endsWith('.maas.aliyuncs.com')
  },
  { provider: 'zhipu', match: host => host === 'open.bigmodel.cn' },
  { provider: 'openrouter', match: host => host === 'openrouter.ai' },
  { provider: 'vercel-ai-gateway', match: host => host === 'ai-gateway.vercel.sh' },
  { provider: 'requesty', match: host => host === 'router.requesty.ai' },
  { provider: 'portkey', match: host => host === 'api.portkey.ai' }
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
    const host = new URL(normalized).hostname.toLowerCase()
    return PROVIDER_HOST_MATCHERS.find(entry => entry.match(host))?.provider
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
export const resolveModelServiceApiBaseUrl = (service: ModelServiceConfig | undefined) =>
  normalizeString(service?.apiBaseUrl) ??
    getModelProviderDefinition(resolveModelProviderIdentity(service).provider)?.defaultApiBaseUrl

export const resolveModelServiceModels = (service: ModelServiceConfig | undefined) => {
  const configuredModels = normalizeStringArray(service?.models)
  if (configuredModels.length > 0) return configuredModels
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
      modelSource: configuredModels.length > 0 ? 'configured' : 'provider_catalog',
      ...(providerDefinition != null ? { providerDefinition } : {})
    },
    issues: []
  }
}
