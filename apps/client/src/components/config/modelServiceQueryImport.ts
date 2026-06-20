import type { ModelServiceConfig } from '@oneworks/types'

export const modelServiceImportQueryKeys = [
  'action',
  'import',
  'newModelService',
  'modelService',
  'modelServiceConfig',
  'modelServiceKey',
  'serviceKey',
  'key',
  'provider',
  'title',
  'name',
  'description',
  'icon',
  'homepageUrl',
  'homeUrl',
  'apiBaseUrl',
  'baseUrl',
  'api_base_url',
  'base_url',
  'apiKey',
  'api_key',
  'models',
  'model',
  'timeoutMs',
  'maxOutputTokens'
]

export interface ModelServiceQueryImport {
  key: string
  service: ModelServiceConfig
}

const importActionValues = new Set([
  'createModelService',
  'importModelService',
  'modelService',
  'newModelService'
])

const stringFieldParams = [
  ['provider', ['provider']],
  ['title', ['title', 'name']],
  ['description', ['description']],
  ['icon', ['icon']],
  ['homepageUrl', ['homepageUrl', 'homeUrl']],
  ['apiBaseUrl', ['apiBaseUrl', 'baseUrl', 'api_base_url', 'base_url']],
  ['apiKey', ['apiKey', 'api_key']]
] as const

const optionalNumberFieldParams = [
  ['timeoutMs', ['timeoutMs']],
  ['maxOutputTokens', ['maxOutputTokens']]
] as const

const getFirstQueryValue = (params: URLSearchParams, keys: readonly string[]) => {
  for (const key of keys) {
    const value = params.get(key)
    if (value != null && value.trim() !== '') return value.trim()
  }
  return undefined
}

const isRecordObject = (value: unknown): value is Record<string, unknown> => (
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value)
)

const normalizeServiceKey = (value: string | undefined) => {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized === '' ? undefined : normalized
}

const getImportKey = (params: URLSearchParams, service: Partial<ModelServiceConfig>) => (
  normalizeServiceKey(getFirstQueryValue(params, ['modelServiceKey', 'serviceKey', 'key'])) ??
    normalizeServiceKey(service.provider) ??
    normalizeServiceKey(service.title) ??
    'model-service'
)

const tryParseJsonObject = (value: string | undefined) => {
  if (value == null) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecordObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

const parseModels = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
  }

  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = tryParseJsonObject(`{"models":${value}}`)?.models
  if (Array.isArray(parsed)) return parseModels(parsed)
  return value.split(/[,\n]/u).map(item => item.trim()).filter(Boolean)
}

const normalizeServiceConfig = (raw: Record<string, unknown>) => {
  const service: Partial<ModelServiceConfig> = {}

  stringFieldParams.forEach(([field]) => {
    const value = raw[field]
    if (typeof value === 'string' && value.trim() !== '') {
      service[field] = value.trim()
    }
  })

  const models = parseModels(raw.models)
  if (models != null && models.length > 0) {
    service.models = models
  }

  optionalNumberFieldParams.forEach(([field]) => {
    const value = raw[field]
    const numberValue = typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : undefined
    if (numberValue != null && Number.isFinite(numberValue)) {
      service[field] = numberValue
    }
  })

  if (isRecordObject(raw.billing)) service.billing = raw.billing
  if (isRecordObject(raw.codingPlan)) service.codingPlan = raw.codingPlan
  if (isRecordObject(raw.providerOptions)) service.providerOptions = raw.providerOptions
  if (isRecordObject(raw.management)) service.management = raw.management
  if (isRecordObject(raw.extra)) service.extra = raw.extra

  return service
}

const hasDirectModelServiceParams = (params: URLSearchParams) => (
  stringFieldParams.some(([, keys]) => getFirstQueryValue(params, keys) != null) ||
  getFirstQueryValue(params, ['models', 'model']) != null
)

const shouldParseDirectParams = (params: URLSearchParams) => {
  const action = getFirstQueryValue(params, ['action', 'import'])
  if (action != null && importActionValues.has(action)) return true
  if (getFirstQueryValue(params, ['newModelService']) != null) return true
  return params.get('tab') === 'modelServices' && hasDirectModelServiceParams(params)
}

export const parseModelServiceQueryImport = (params: URLSearchParams): ModelServiceQueryImport | undefined => {
  const encodedConfig = getFirstQueryValue(params, ['modelServiceConfig', 'modelService'])
  const rawConfig = tryParseJsonObject(encodedConfig)
  const rawService = rawConfig != null
    ? rawConfig
    : shouldParseDirectParams(params)
    ? {
      ...Object.fromEntries(
        stringFieldParams.flatMap(([field, keys]) => {
          const value = getFirstQueryValue(params, keys)
          return value == null ? [] : [[field, value]]
        })
      ),
      models: getFirstQueryValue(params, ['models']) ?? getFirstQueryValue(params, ['model']),
      timeoutMs: getFirstQueryValue(params, ['timeoutMs']),
      maxOutputTokens: getFirstQueryValue(params, ['maxOutputTokens'])
    }
    : undefined

  if (rawService == null) return undefined

  const service = normalizeServiceConfig(rawService)
  return {
    key: getImportKey(params, service),
    service: {
      ...service,
      apiKey: service.apiKey ?? ''
    }
  }
}
