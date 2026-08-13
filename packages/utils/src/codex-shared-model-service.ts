import type { AdapterBuiltinModel, Config, ModelServiceConfig } from '@oneworks/types'

export const CODEX_SHARED_MODEL_SERVICE_KEY = 'oneworks-codex'
export const CODEX_SHARED_MODEL_PATH = '/api/internal/codex-shared-model'
export const CODEX_SHARED_MODEL_TOKEN_ENV = '__ONEWORKS_PROJECT_CODEX_SHARED_MODEL_TOKEN__'
export const CODEX_SHARED_MODEL_UPSTREAM_URL_ENV = '__ONEWORKS_PROJECT_CODEX_SHARED_MODEL_UPSTREAM_URL__'

export const isCodexSharedModelEnabled = (config: Config | undefined) => {
  const adapters = config?.adapters as Record<string, unknown> | undefined
  const codex = adapters?.codex
  return codex != null && typeof codex === 'object' &&
    (codex as { shareBuiltinModels?: unknown }).shareBuiltinModels === true
}

export const createCodexSharedModelService = (params: {
  builtinModels?: AdapterBuiltinModel[]
  apiBaseUrl?: string
  apiKey?: string
}): ModelServiceConfig => ({
  title: 'Codex 内置模型',
  description: '通过 One Works PM 和 Codex 官方账号使用的内置模型',
  provider: 'openai',
  apiProtocol: 'openai-chat-completions',
  ...(params.apiBaseUrl == null ? {} : { apiBaseUrl: params.apiBaseUrl }),
  ...(params.apiKey == null ? {} : { apiKey: params.apiKey }),
  models: (params.builtinModels ?? [])
    .map(model => model.value)
    .filter(model => model !== 'default'),
  supportedAdapters: ['claude-code', 'copilot', 'gemini', 'goose', 'grok', 'kimi', 'opencode', 'pi', 'qwen-code']
})

export const withCodexSharedModelService = (
  config: Config | undefined,
  service: ModelServiceConfig
): Config => ({
  ...(config ?? {}),
  modelServices: {
    ...(config?.modelServices ?? {}),
    [CODEX_SHARED_MODEL_SERVICE_KEY]: service
  }
})

export const withoutReservedCodexSharedModelService = (config: Config | undefined) => {
  if (config?.modelServices?.[CODEX_SHARED_MODEL_SERVICE_KEY] == null) return config
  const { [CODEX_SHARED_MODEL_SERVICE_KEY]: _reserved, ...modelServices } = config.modelServices
  return { ...config, modelServices }
}
