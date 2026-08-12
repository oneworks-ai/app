import { createHash } from 'node:crypto'

import type { ModelServiceConfig } from '@oneworks/types'
import {
  flattenModelServices,
  parseServiceModelSelector,
  resolveModelProviderIdentity,
  resolveModelServiceApiProtocol,
  resolveModelServiceConfig
} from '@oneworks/utils'

export type PiCustomApi =
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'openai-completions'
  | 'openai-responses'

export interface PiResolvedModel {
  cliModel?: string
  cliProvider?: string
  env: Record<string, string>
  modelsConfig?: Record<string, unknown>
  reportedModel: string
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeHeaders = (value: unknown) =>
  Object.fromEntries(
    Object.entries(asRecord(value))
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )

const resolveExtra = (service: ModelServiceConfig) => asRecord(asRecord(service.extra).pi)

const inferApi = (service: ModelServiceConfig, baseUrl: string, extra: Record<string, unknown>): PiCustomApi => {
  switch (resolveModelServiceApiProtocol(service)) {
    case 'openai-responses':
      return 'openai-responses'
    case 'openai-chat-completions':
      return 'openai-completions'
    case 'anthropic-messages':
      return 'anthropic-messages'
    case 'gemini-generate-content':
      return 'google-generative-ai'
    case 'gemini-interactions':
      throw new Error('Pi adapter does not support Gemini Interactions model services.')
  }
  const explicitApi = normalizeString(extra.api)
  if (
    explicitApi === 'anthropic-messages' ||
    explicitApi === 'google-generative-ai' ||
    explicitApi === 'openai-completions' ||
    explicitApi === 'openai-responses'
  ) return explicitApi

  const provider = resolveModelProviderIdentity(service).provider?.toLowerCase() ?? ''
  const normalizedUrl = baseUrl.toLowerCase().replace(/\/+$/u, '')
  if (/\/openai(?:\/|$)/u.test(normalizedUrl)) return 'openai-completions'
  if (provider.includes('anthropic') || normalizedUrl.includes('anthropic.com')) return 'anthropic-messages'
  if (provider.includes('google') || provider.includes('gemini') || normalizedUrl.includes('googleapis.com')) {
    return 'google-generative-ai'
  }
  const codexExtra = asRecord(asRecord(service.extra).codex)
  return normalizeString(codexExtra.wireApi) === 'responses' || normalizedUrl.endsWith('/responses')
    ? 'openai-responses'
    : 'openai-completions'
}

const normalizeBaseUrl = (baseUrl: string, api: PiCustomApi) => {
  const value = baseUrl.replace(/\/+$/u, '')
  if (api === 'openai-responses') return value.replace(/\/responses$/u, '')
  if (api === 'openai-completions') return value.replace(/\/(?:chat\/completions|completions)$/u, '')
  if (api === 'anthropic-messages') return value.replace(/\/v1(?:\/messages)?$/u, '')
  return value
}

const toProviderKey = (serviceKey: string) => {
  const slug = serviceKey.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'service'
  const digest = createHash('sha256').update(serviceKey).digest('hex').slice(0, 8)
  return `oneworks-${slug}-${digest}`
}

const toEnvKey = (providerKey: string, suffix: string) => (
  `ONEWORKS_PI_${providerKey}_${suffix}`.replace(/\W+/gu, '_').toUpperCase()
)

const inferReasoning = (model: string, extra: Record<string, unknown>) => (
  typeof extra.reasoning === 'boolean'
    ? extra.reasoning
    : /claude|deepseek-r|gemini-(?:2\.5|3)|gpt-5|kimi-k2|o[134](?:-|$)/iu.test(model)
)

const resolveModelInput = (extra: Record<string, unknown>) => {
  const input = Array.isArray(extra.input)
    ? extra.input.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
    : []
  return input.length > 0 ? [...new Set(input)] : ['text']
}

export const resolvePiModel = (params: {
  model?: string
  provider?: string
  modelServices: Record<string, ModelServiceConfig>
}): PiResolvedModel => {
  const rawModel = params.model?.trim()
  if (rawModel == null || rawModel === '' || rawModel === 'default') {
    return { env: {}, reportedModel: 'default', ...(params.provider ? { cliProvider: params.provider } : {}) }
  }

  const parsed = parseServiceModelSelector(rawModel)
  if (parsed == null) {
    return {
      cliModel: rawModel,
      env: {},
      reportedModel: rawModel,
      ...(params.provider && !rawModel.includes('/') ? { cliProvider: params.provider } : {})
    }
  }

  const service = flattenModelServices(params.modelServices)[parsed.serviceKey]
  if (service == null) throw new Error(`Pi adapter could not find model service "${parsed.serviceKey}".`)
  const resolved = resolveModelServiceConfig(service, ['modelServices', parsed.serviceKey])
  if (resolved.service == null) {
    throw new Error(
      resolved.issues.map(issue => issue.message).join(' ') || `Invalid model service "${parsed.serviceKey}".`
    )
  }

  const resolvedService = resolved.service
  const extra = resolveExtra(resolvedService)
  const api = inferApi(resolvedService, resolvedService.apiBaseUrl, extra)
  const providerKey = toProviderKey(parsed.serviceKey)
  const apiKeyEnv = toEnvKey(providerKey, 'API_KEY')
  const headers = normalizeHeaders(extra.headers)
  const env: Record<string, string> = {}
  const configuredApiKey = resolvedService.apiKey.trim()
  const isLocal = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/iu.test(resolvedService.apiBaseUrl)
  if (configuredApiKey !== '') env[apiKeyEnv] = configuredApiKey

  const renderedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => {
      const headerEnv = toEnvKey(providerKey, `HEADER_${name}`)
      env[headerEnv] = value
      return [name, `$${headerEnv}`]
    })
  )
  const effectiveApiKey = configuredApiKey !== ''
    ? `$${apiKeyEnv}`
    : isLocal || Object.keys(headers).length > 0
    ? 'oneworks-local-or-header-auth'
    : undefined

  const modelConfig = {
    id: parsed.modelName,
    name: normalizeString(extra.name) ?? parsed.modelName,
    reasoning: inferReasoning(parsed.modelName, extra),
    input: resolveModelInput(extra),
    contextWindow: typeof extra.contextWindow === 'number' ? extra.contextWindow : 128000,
    maxTokens: typeof extra.maxTokens === 'number'
      ? extra.maxTokens
      : resolvedService.maxOutputTokens ?? 16384,
    ...(Object.keys(asRecord(extra.compat)).length > 0 ? { compat: asRecord(extra.compat) } : {})
  }

  return {
    cliModel: `${providerKey}/${parsed.modelName}`,
    cliProvider: providerKey,
    env,
    modelsConfig: {
      providers: {
        [providerKey]: {
          baseUrl: normalizeBaseUrl(resolvedService.apiBaseUrl, api),
          api,
          ...(effectiveApiKey != null ? { apiKey: effectiveApiKey } : {}),
          authHeader: typeof extra.authHeader === 'boolean' ? extra.authHeader : false,
          ...(Object.keys(renderedHeaders).length > 0 ? { headers: renderedHeaders } : {}),
          models: [modelConfig]
        }
      }
    },
    reportedModel: `${providerKey}/${parsed.modelName}`
  }
}
