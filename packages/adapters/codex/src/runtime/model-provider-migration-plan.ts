import type { ModelServiceConfig } from '@oneworks/types'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const readInteger = (value: unknown, minimum = 0) => (
  typeof value === 'number' && Number.isInteger(value) && value >= minimum ? value : undefined
)

const readBoolean = (value: unknown) => typeof value === 'boolean' ? value : undefined

const readStringRecord = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

const readJsonRecord = (value: unknown) => isRecord(value) ? value : undefined
const buildEnvReference = (envKey: string) => ['${', envKey, '}'].join('')

interface CodexNativeProviderExtra {
  auth?: Record<string, unknown>
  aws?: Record<string, unknown>
  envHeaders?: Record<string, string>
  envKey?: string
  envKeyInstructions?: string
  headers?: Record<string, string>
  nativeProvider: true
  providerId: string
  queryParams?: Record<string, string>
  requestMaxRetries?: number
  requiresOpenAIAuth?: boolean
  streamIdleTimeoutMs?: number
  streamMaxRetries?: number
  supportsWebsockets?: boolean
  useBuiltinProvider?: boolean
  useOpenAIBaseUrl?: boolean
  websocketConnectTimeoutMs?: number
  wireApi?: string
}

export interface CodexModelProviderMigrationPlan {
  defaultModel?: string
  modelServices: Record<string, ModelServiceConfig>
  selectedProviderId?: string
  selectedServiceKey?: string
  skippedProviderIds: string[]
}

const buildMigratedModelService = (params: {
  model: string | undefined
  provider: Record<string, unknown>
  providerId: string
  selectedProviderId: string | undefined
  useBuiltinProvider: boolean
  useOpenAIBaseUrl: boolean
}): ModelServiceConfig => {
  const { model, provider, providerId, selectedProviderId, useBuiltinProvider, useOpenAIBaseUrl } = params
  const envKey = readString(provider.env_key)
  const bearerToken = readString(provider.experimental_bearer_token)
  const wireApi = readString(provider.wire_api)
  const headers = readStringRecord(provider.http_headers)
  const envHeaders = readStringRecord(provider.env_http_headers)
  const queryParams = readStringRecord(provider.query_params)
  const envKeyInstructions = readString(provider.env_key_instructions)
  const requestMaxRetries = readInteger(provider.request_max_retries)
  const streamMaxRetries = readInteger(provider.stream_max_retries)
  const websocketConnectTimeoutMs = readInteger(provider.websocket_connect_timeout_ms)
  const requiresOpenAIAuth = readBoolean(provider.requires_openai_auth)
  const supportsWebsockets = readBoolean(provider.supports_websockets)
  const auth = readJsonRecord(provider.auth)
  const aws = readJsonRecord(provider.aws)
  const apiBaseUrl = readString(provider.base_url)
  const streamIdleTimeoutMs = readInteger(provider.stream_idle_timeout_ms)
  const nativeProvider: CodexNativeProviderExtra = {
    nativeProvider: true,
    providerId,
    ...(useBuiltinProvider ? { useBuiltinProvider: true } : {}),
    ...(useOpenAIBaseUrl ? { useOpenAIBaseUrl: true } : {}),
    ...(wireApi == null ? {} : { wireApi }),
    ...(headers == null ? {} : { headers }),
    ...(envHeaders == null ? {} : { envHeaders }),
    ...(queryParams == null ? {} : { queryParams }),
    ...(envKey == null ? {} : { envKey }),
    ...(envKeyInstructions == null ? {} : { envKeyInstructions }),
    ...(requestMaxRetries == null ? {} : { requestMaxRetries }),
    ...(streamIdleTimeoutMs == null ? {} : { streamIdleTimeoutMs }),
    ...(streamMaxRetries == null ? {} : { streamMaxRetries }),
    ...(websocketConnectTimeoutMs == null ? {} : { websocketConnectTimeoutMs }),
    ...(requiresOpenAIAuth == null ? {} : { requiresOpenAIAuth }),
    ...(supportsWebsockets == null ? {} : { supportsWebsockets }),
    ...(auth == null ? {} : { auth }),
    ...(aws == null ? {} : { aws })
  }

  return {
    title: readString(provider.name) ?? providerId,
    provider: providerId,
    ...(apiBaseUrl == null ? {} : { apiBaseUrl }),
    ...(envKey != null
      ? { apiKey: buildEnvReference(envKey) }
      : bearerToken == null
      ? {}
      : { apiKey: bearerToken }),
    ...(model != null && selectedProviderId === providerId ? { models: [model] } : {}),
    supportedAdapters: ['codex'],
    ...(streamIdleTimeoutMs == null || streamIdleTimeoutMs === 0 ? {} : { timeoutMs: streamIdleTimeoutMs }),
    extra: {
      codex: nativeProvider
    }
  }
}

export const buildCodexModelProviderMigrationPlan = (
  nativeConfig: Record<string, unknown>
): CodexModelProviderMigrationPlan => {
  const model = readString(nativeConfig.model)
  const configuredProviders = isRecord(nativeConfig.model_providers)
    ? { ...nativeConfig.model_providers }
    : {}
  const openAIBaseUrl = readString(nativeConfig.openai_base_url)
  const selectedProviderId = readString(nativeConfig.model_provider) ?? (openAIBaseUrl == null ? undefined : 'openai')
  const builtinProviders = new Map([
    ['openai', 'OpenAI'],
    ['ollama', 'Ollama'],
    ['lmstudio', 'LM Studio'],
    ['amazon-bedrock', 'Amazon Bedrock']
  ])
  const builtinProviderIds = new Set(builtinProviders.keys())
  const openAIBaseUrlProviderIds = new Set<string>()

  if (openAIBaseUrl != null && !Object.hasOwn(configuredProviders, 'openai')) {
    configuredProviders.openai = { name: 'OpenAI', base_url: openAIBaseUrl }
    openAIBaseUrlProviderIds.add('openai')
  }
  if (
    selectedProviderId != null &&
    builtinProviders.has(selectedProviderId) &&
    !Object.hasOwn(configuredProviders, selectedProviderId)
  ) {
    configuredProviders[selectedProviderId] = { name: builtinProviders.get(selectedProviderId) }
  }

  const skippedProviderIds: string[] = []
  const modelServices = Object.fromEntries(
    Object.entries(configuredProviders).flatMap(([providerIdValue, providerValue]) => {
      const providerId = readString(providerIdValue)
      if (providerId == null || providerId.includes(',') || !isRecord(providerValue)) {
        if (providerId != null) skippedProviderIds.push(providerId)
        return []
      }
      return [[
        providerId,
        buildMigratedModelService({
          model,
          provider: providerValue,
          providerId,
          selectedProviderId,
          useBuiltinProvider: builtinProviderIds.has(providerId),
          useOpenAIBaseUrl: openAIBaseUrlProviderIds.has(providerId)
        })
      ]]
    })
  )
  const selectedServiceKey = selectedProviderId != null && !selectedProviderId.includes(',')
    ? selectedProviderId
    : undefined

  return {
    modelServices,
    skippedProviderIds,
    ...(selectedProviderId == null ? {} : { selectedProviderId }),
    ...(selectedServiceKey == null ? {} : { selectedServiceKey }),
    ...(selectedServiceKey == null || model == null ? {} : { defaultModel: `${selectedServiceKey},${model}` })
  }
}
