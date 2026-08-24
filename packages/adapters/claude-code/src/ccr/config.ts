import { createHash } from 'node:crypto'

import type { Config, ModelServiceConfig, ResolvedModelServiceConfig } from '@oneworks/types'
import {
  CODEX_SHARED_MODEL_SERVICE_KEY,
  CODEX_SHARED_MODEL_TOKEN_ENV,
  CODEX_SHARED_MODEL_UPSTREAM_URL_ENV,
  flattenModelServices,
  resolveExplicitModelServiceApiProtocol,
  resolveModelDisplayMetadata,
  resolveModelServiceConfig,
  resolveModelServiceModels
} from '@oneworks/utils'

import { resolveTransformerPath } from './paths'

const DEFAULT_ROUTER_PORT_RANGE_START = 20000
const DEFAULT_ROUTER_PORT_RANGE_SIZE = 20000
const OPENAI_COMPATIBLE_CHAT_COMPLETIONS_PROVIDERS = new Set([
  'openai',
  'moonshot-cn',
  'moonshot-intl',
  'kimi-code',
  'deepseek',
  'qwen',
  'qwen-coding-plan',
  'zhipu',
  'zhipu-coding-plan',
  'minimax-token-plan',
  'tencent-tokenhub-coding-plan',
  'volcengine-ark-coding-plan',
  'baidu-qianfan-coding-plan',
  'google-gemini',
  'openrouter',
  'vercel-ai-gateway',
  'requesty',
  'portkey'
])
const OPENAI_COMPATIBLE_ENDPOINT_PATTERN = /\/(?:chat\/completions|responses|messages)\/?$/u

const getServiceQueryParams = (service: ModelServiceConfig) => {
  const extra = (service.extra ?? {}) as {
    codex?: {
      queryParams?: Record<string, string>
    }
    claudeCodeRouter?: {
      queryParams?: Record<string, string>
    }
  }

  return extra.claudeCodeRouter?.queryParams ?? extra.codex?.queryParams
}

const buildProviderBaseUrl = (
  service: ResolvedModelServiceConfig,
  explicitApiProtocol: ReturnType<typeof resolveExplicitModelServiceApiProtocol>
) => {
  const queryParams = getServiceQueryParams(service)
  const url = new URL(service.apiBaseUrl)
  if (
    (explicitApiProtocol === 'openai-responses' || explicitApiProtocol === 'openai-chat-completions') &&
    !OPENAI_COMPATIBLE_ENDPOINT_PATTERN.test(url.pathname)
  ) {
    const endpoint = explicitApiProtocol === 'openai-responses' ? 'responses' : 'chat/completions'
    url.pathname = `${url.pathname.replace(/\/+$/u, '')}/${endpoint}`
  } else if (
    explicitApiProtocol == null &&
    service.provider != null &&
    OPENAI_COMPATIBLE_CHAT_COMPLETIONS_PROVIDERS.has(service.provider) &&
    !OPENAI_COMPATIBLE_ENDPOINT_PATTERN.test(url.pathname)
  ) {
    url.pathname = `${url.pathname.replace(/\/+$/u, '')}/chat/completions`
  }

  if (queryParams != null) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (typeof value !== 'string' || value.trim() === '') continue
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

const normalizePositiveInteger = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
)

const buildProviderApiKey = (name: string, apiKey: string | undefined) => (
  name === CODEX_SHARED_MODEL_SERVICE_KEY && apiKey != null
    ? `\${${CODEX_SHARED_MODEL_TOKEN_ENV}}`
    : apiKey
)

const buildProviderConfigUrl = (name: string, apiBaseUrl: string) => (
  name === CODEX_SHARED_MODEL_SERVICE_KEY
    ? `\${${CODEX_SHARED_MODEL_UPSTREAM_URL_ENV}}`
    : apiBaseUrl
)

const buildRuntimeProviderFingerprint = (name: string, apiKey: string | undefined, apiBaseUrl: string) => (
  name === CODEX_SHARED_MODEL_SERVICE_KEY && apiKey != null
    ? createHash('sha256').update(`${apiKey}\0${apiBaseUrl}`).digest('hex')
    : undefined
)

export const resolveDefaultClaudeCodeRouterPort = (cwd: string) => {
  const digest = createHash('sha256').update(cwd).digest()
  const hashValue = digest.readUInt32BE(0)
  return DEFAULT_ROUTER_PORT_RANGE_START + (hashValue % DEFAULT_ROUTER_PORT_RANGE_SIZE)
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const hasMaxtokenTransformer = (use: unknown[]) =>
  use.some((entry) => {
    if (entry === 'maxtoken') return true
    return Array.isArray(entry) && entry[0] === 'maxtoken'
  })

const buildProviderTransformer = (
  service: ModelServiceConfig,
  explicitApiProtocol: ReturnType<typeof resolveExplicitModelServiceApiProtocol>
) => {
  const baseValue = service.extra?.claudeCodeRouterTransformer
  const maxOutputTokens = normalizePositiveInteger(service.maxOutputTokens)
  if (
    explicitApiProtocol === 'anthropic-messages' || explicitApiProtocol === 'gemini-generate-content' ||
    explicitApiProtocol === 'gemini-interactions'
  ) {
    throw new Error(`Claude Code Router does not support ${explicitApiProtocol} model services.`)
  }
  const protocolTransformer = explicitApiProtocol === 'openai-responses' ? 'openai-responses' : undefined

  if (maxOutputTokens == null && protocolTransformer == null) return baseValue
  if (!isPlainObject(baseValue)) {
    return {
      use: [
        ...(protocolTransformer == null ? [] : [protocolTransformer]),
        ...(maxOutputTokens == null ? [] : [
          ['maxtoken', { max_tokens: maxOutputTokens }]
        ])
      ]
    }
  }

  const use = Array.isArray(baseValue.use) ? [...baseValue.use] : []
  if (protocolTransformer != null && !use.includes(protocolTransformer)) use.unshift(protocolTransformer)
  if (maxOutputTokens != null && !hasMaxtokenTransformer(use)) {
    use.push(['maxtoken', { max_tokens: maxOutputTokens }])
  }

  return {
    ...baseValue,
    use
  }
}

const normalizeServiceModel = (
  serviceKey: string,
  modelName: string,
  modelServices: Record<string, ModelServiceConfig>,
  modelMetadata?: Config['models']
) => {
  const service = modelServices[serviceKey]
  if (!service) return undefined
  const models = resolveModelServiceModels(service)

  const resolveModelAliases = (candidate: string) =>
    resolveModelDisplayMetadata({
      model: `${serviceKey},${candidate}`,
      models: modelMetadata
    })?.aliases ?? []

  if (models.includes(modelName)) {
    return modelName
  }

  const aliasedModel = models.find(candidate => resolveModelAliases(candidate).includes(modelName))
  if (aliasedModel) {
    return aliasedModel
  }

  return undefined
}

const getServicePriority = (
  modelServices: Record<string, ModelServiceConfig>,
  config?: Config,
  userConfig?: Config
) => {
  const ordered = [
    userConfig?.defaultModelService,
    config?.defaultModelService,
    ...Object.keys(modelServices)
  ]
  const seen = new Set<string>()
  return ordered.filter((value): value is string => {
    if (!value || seen.has(value)) return false
    if (!modelServices[value]) return false
    seen.add(value)
    return true
  })
}

const resolveModelCandidate = (
  candidate: string,
  params: {
    modelServices: Record<string, ModelServiceConfig>
    modelMetadata?: Config['models']
    config?: Config
    userConfig?: Config
    defaultService: string
  }
) => {
  const { modelServices, modelMetadata, config, userConfig, defaultService } = params
  if (candidate.includes(',')) {
    const [serviceKey, modelName] = candidate.split(',').map(item => item.trim())
    if (!serviceKey || !modelName) return undefined
    const normalized = normalizeServiceModel(serviceKey, modelName, modelServices, modelMetadata)
    return normalized ? `${serviceKey},${normalized}` : undefined
  }
  const servicePriority = [
    defaultService,
    ...getServicePriority(modelServices, config, userConfig)
  ].filter((value, index, array) => array.indexOf(value) === index)
  for (const serviceKey of servicePriority) {
    const normalized = normalizeServiceModel(serviceKey, candidate, modelServices, modelMetadata)
    if (normalized) return `${serviceKey},${normalized}`
  }
  return undefined
}

const resolveDefaultModel = (params: {
  config?: Config
  userConfig?: Config
  modelServices: Record<string, ModelServiceConfig>
  selectedModel?: string
}) => {
  const { config, userConfig, selectedModel } = params
  const selectedServiceKey = selectedModel?.includes(',')
    ? selectedModel.split(',', 1)[0]?.trim()
    : undefined
  const flattenedModelServices = flattenModelServices(params.modelServices)
  const resolvedModelServices = Object.fromEntries(
    Object.entries(flattenedModelServices)
      .map(([serviceKey, service]) => {
        const resolved = resolveModelServiceConfig(service, ['modelServices', serviceKey])
        return resolved.service != null ? [serviceKey, resolved.service] as const : undefined
      })
      .filter((entry): entry is readonly [string, ResolvedModelServiceConfig] => entry != null)
  )
  const modelMetadata = {
    ...(config?.models ?? {}),
    ...(userConfig?.models ?? {})
  }
  const providerEntries = Object.entries(resolvedModelServices).flatMap(([name, configValue]) => {
    try {
      // Catalog defaults describe the general upstream wire protocol. CCR has its
      // own provider-specific compatibility routing, so only an explicit service
      // protocol may override that established behavior here.
      const explicitApiProtocol = resolveExplicitModelServiceApiProtocol(flattenedModelServices[name])
      const apiBaseUrl = buildProviderBaseUrl(configValue, explicitApiProtocol)
      const runtimeProviderFingerprint = buildRuntimeProviderFingerprint(name, configValue.apiKey, apiBaseUrl)
      return [
        [name, {
          name,
          api_base_url: buildProviderConfigUrl(name, apiBaseUrl),
          api_key: buildProviderApiKey(name, configValue.apiKey),
          models: resolveModelServiceModels(configValue),
          transformer: buildProviderTransformer(configValue, explicitApiProtocol)
        }, runtimeProviderFingerprint] as const
      ]
    } catch (error) {
      if (selectedServiceKey == null || name === selectedServiceKey) throw error
      return []
    }
  })
  const providers = providerEntries.map(([, provider]) => provider)
  const runtimeProviderFingerprint = providerEntries
    .map(([, , fingerprint]) => fingerprint)
    .find((fingerprint): fingerprint is string => fingerprint != null)
  const modelServices = Object.fromEntries(
    providerEntries.map(([name]) => [name, resolvedModelServices[name]])
  )
  const defaultProvider = providers[0]
  if (!defaultProvider) {
    throw new Error('No modelServices found in config')
  }
  const defaultModelServiceInput = selectedServiceKey ?? userConfig?.defaultModelService ?? config?.defaultModelService
  const defaultModelServiceName = defaultModelServiceInput && modelServices[defaultModelServiceInput]
    ? defaultModelServiceInput
    : defaultProvider.name
  const defaultModelInput = selectedModel ?? userConfig?.defaultModel ?? config?.defaultModel
  const resolvedByInput = defaultModelInput
    ? resolveModelCandidate(defaultModelInput, {
      modelServices,
      modelMetadata,
      config,
      userConfig,
      defaultService: defaultModelServiceName
    })
    : undefined
  if (resolvedByInput) {
    return {
      defaultModel: resolvedByInput,
      providers,
      runtimeProviderFingerprint,
      defaultService: defaultModelServiceName,
      modelServices
    }
  }
  const fallbackModelName = resolveModelServiceModels(modelServices[defaultModelServiceName])?.[0] ??
    defaultProvider.models?.[0]
  if (!fallbackModelName) {
    throw new Error(`模型服务 ${defaultModelServiceName} 无可用模型`)
  }
  const normalizedFallback = normalizeServiceModel(
    defaultModelServiceName,
    fallbackModelName,
    modelServices,
    modelMetadata
  )
  if (!normalizedFallback) {
    throw new Error(`模型服务 ${defaultModelServiceName} 无可用模型`)
  }
  return {
    defaultModel: `${defaultModelServiceName},${normalizedFallback}`,
    providers,
    runtimeProviderFingerprint,
    defaultService: defaultModelServiceName,
    modelServices
  }
}

export const resolveClaudeCodeRouterRuntimeModelServiceEnv = (params: {
  config?: Config
  userConfig?: Config
}) => {
  const modelServices = flattenModelServices({
    ...(params.config?.modelServices ?? {}),
    ...(params.userConfig?.modelServices ?? {})
  })
  const service = modelServices[CODEX_SHARED_MODEL_SERVICE_KEY]
  if (service == null) return {}
  const resolved = resolveModelServiceConfig(service, [
    'modelServices',
    CODEX_SHARED_MODEL_SERVICE_KEY
  ]).service
  if (resolved == null || resolved.apiKey == null) return {}

  return {
    [CODEX_SHARED_MODEL_TOKEN_ENV]: resolved.apiKey,
    [CODEX_SHARED_MODEL_UPSTREAM_URL_ENV]: buildProviderBaseUrl(
      resolved,
      resolveExplicitModelServiceApiProtocol(service)
    )
  }
}

const resolveRouterModel = (params: {
  fallback?: string[]
  defaultModel: string
  defaultService: string
  modelServices: Record<string, ModelServiceConfig>
  modelMetadata?: Config['models']
  config?: Config
  userConfig?: Config
}) => {
  const { fallback, defaultModel, defaultService, modelServices, modelMetadata, config, userConfig } = params
  if (fallback && fallback.length > 0) {
    for (const candidate of fallback) {
      const resolved = resolveModelCandidate(candidate, {
        modelServices,
        modelMetadata,
        config,
        userConfig,
        defaultService
      })
      if (resolved) return resolved
    }
  }
  return defaultModel
}

const resolveCompatibleApiTimeoutMs = (params: {
  defaultService: string
  modelServices: Record<string, ModelServiceConfig>
  adapterOptions?: NonNullable<Config['adapters']>['claude-code']
}) => {
  const { defaultService, modelServices, adapterOptions } = params
  const explicitCcrTimeout = normalizePositiveInteger(
    (adapterOptions?.ccrOptions as Record<string, unknown> | undefined)?.API_TIMEOUT_MS
  )
  if (explicitCcrTimeout != null) return explicitCcrTimeout

  const adapterTimeout = normalizePositiveInteger(adapterOptions?.apiTimeout)
  if (adapterTimeout != null) return adapterTimeout

  const timeoutByService = Object.fromEntries(
    Object.entries(modelServices)
      .map(([serviceKey, service]) => [serviceKey, normalizePositiveInteger(service.timeoutMs)] as const)
      .filter((entry): entry is [string, number] => entry[1] != null)
  )
  const uniqueTimeouts = Array.from(new Set(Object.values(timeoutByService)))
  if (uniqueTimeouts.length === 0) return undefined
  if (uniqueTimeouts.length === 1) return uniqueTimeouts[0]
  return timeoutByService[defaultService] ?? uniqueTimeouts[0]
}

export const generateDefaultCCRConfigJSON = (params: {
  cwd: string
  config?: Config
  userConfig?: Config
  adapterOptions?: NonNullable<Config['adapters']>['claude-code']
  selectedModel?: string
}) => {
  const { cwd, config, userConfig, adapterOptions, selectedModel } = params
  const modelServices = flattenModelServices({
    ...(config?.modelServices ?? {}),
    ...(userConfig?.modelServices ?? {})
  })
  const modelMetadata = {
    ...(config?.models ?? {}),
    ...(userConfig?.models ?? {})
  }
  const {
    defaultModel,
    providers,
    runtimeProviderFingerprint,
    defaultService,
    modelServices: resolvedModelServices
  } = resolveDefaultModel({
    config,
    userConfig,
    modelServices,
    selectedModel
  })
  const loggerEnabled = adapterOptions?.ccrTransformers?.logger ?? true
  const apiTimeoutMs = resolveCompatibleApiTimeoutMs({
    defaultService,
    modelServices: resolvedModelServices,
    adapterOptions
  })
  const routerPort = normalizePositiveInteger(
    (adapterOptions?.ccrOptions as Record<string, unknown> | undefined)?.PORT
  ) ?? resolveDefaultClaudeCodeRouterPort(cwd)
  const transformers = [
    {
      path: resolveTransformerPath('gemini-open-router-polyfill')
    },
    {
      path: resolveTransformerPath('kimi-thinking-polyfill')
    },
    {
      path: resolveTransformerPath('openai-polyfill')
    },
    ...(loggerEnabled
      ? [{ path: resolveTransformerPath('logger') }]
      : [])
  ]
  return JSON.stringify(
    {
      PORT: String(routerPort),
      ...(adapterOptions?.ccrOptions ?? {}),
      ...(apiTimeoutMs != null ? { API_TIMEOUT_MS: apiTimeoutMs } : {}),
      ...(runtimeProviderFingerprint == null
        ? {}
        : { ONEWORKS_RUNTIME_MODEL_CAPABILITY_REVISION: runtimeProviderFingerprint }),
      transformers,
      Providers: providers,
      Router: {
        default: resolveRouterModel({
          fallback: adapterOptions?.modelFallbacks?.default,
          defaultModel,
          defaultService,
          modelServices: resolvedModelServices,
          modelMetadata,
          config,
          userConfig
        }),
        background: resolveRouterModel({
          fallback: adapterOptions?.modelFallbacks?.background,
          defaultModel,
          defaultService,
          modelServices: resolvedModelServices,
          modelMetadata,
          config,
          userConfig
        }),
        think: resolveRouterModel({
          fallback: adapterOptions?.modelFallbacks?.think,
          defaultModel,
          defaultService,
          modelServices: resolvedModelServices,
          modelMetadata,
          config,
          userConfig
        }),
        longContext: resolveRouterModel({
          fallback: adapterOptions?.modelFallbacks?.longContext,
          defaultModel,
          defaultService,
          modelServices: resolvedModelServices,
          modelMetadata,
          config,
          userConfig
        })
      }
    },
    null,
    2
  )
}
