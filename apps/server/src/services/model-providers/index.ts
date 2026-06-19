/* eslint-disable max-lines -- model provider service keeps related config actions together */
import { updateConfigFile } from '@oneworks/config'
import type { ConfigSource, ModelServiceConfig } from '@oneworks/types'
import {
  getModelProviderDefinition,
  listModelProviderDefinitions,
  resolveModelProviderIdentity,
  resolveModelServiceConfig
} from '@oneworks/utils'

import { loadConfigState } from '#~/services/config/index.js'

import {
  createProviderSecret,
  getProviderAccountStatus,
  getProviderServiceStatus,
  listProviderModels
} from './provider-client.js'

export class ModelProvidersServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'ModelProvidersServiceError'
  }
}

const normalizeString = (
  value: unknown
) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
const normalizeModelIds = (value: unknown) =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(item => normalizeString(item)).filter((item): item is string => item != null)))
    : []

const selectRawSourceConfig = (
  state: Awaited<ReturnType<typeof loadConfigState>>,
  source: ConfigSource
) => {
  if (source === 'global') return state.globalSource?.rawConfig
  if (source === 'project') return state.projectSource?.rawConfig
  if (source === 'user') return state.userSource?.rawConfig
  return undefined
}

const selectResolvedSourceConfig = (
  state: Awaited<ReturnType<typeof loadConfigState>>,
  source: ConfigSource
) => {
  if (source === 'global') return state.globalSource?.resolvedConfig ?? state.globalSource?.rawConfig
  if (source === 'project') return state.projectSource?.resolvedConfig ?? state.projectSource?.rawConfig
  if (source === 'user') return state.userSource?.resolvedConfig ?? state.userSource?.rawConfig
  return undefined
}

const isConfigSource = (value: unknown): value is ConfigSource => (
  value === 'global' || value === 'project' || value === 'user'
)

const mergeMaskedDraftValues = (incoming: unknown, existing: unknown): unknown => {
  if (Array.isArray(incoming)) return incoming
  if (incoming != null && typeof incoming === 'object') {
    const incomingRecord = incoming as Record<string, unknown>
    const existingRecord = (existing != null && typeof existing === 'object' && !Array.isArray(existing))
      ? existing as Record<string, unknown>
      : {}
    return Object.fromEntries(
      Object.entries(incomingRecord).map(([key, value]) => [
        key,
        value === '******' ? existingRecord[key] : mergeMaskedDraftValues(value, existingRecord[key])
      ])
    )
  }
  return incoming
}

const hasMaskedDraftValue = (value: unknown): boolean => {
  if (value === '******') return true
  if (Array.isArray(value)) return value.some(hasMaskedDraftValue)
  if (value != null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasMaskedDraftValue)
  }
  return false
}

const resolveServiceConfig = async (params: {
  draft?: unknown
  serviceKey: string
  source?: unknown
}) => {
  if (params.source != null && !isConfigSource(params.source)) {
    throw new ModelProvidersServiceError('invalid_source', 'Invalid config source.', { source: params.source })
  }
  const state = await loadConfigState()
  const sourceConfig = params.source == null ? undefined : selectResolvedSourceConfig(state, params.source)
  const baseService = params.source == null
    ? state.mergedConfig.modelServices?.[params.serviceKey]
    : sourceConfig?.modelServices?.[params.serviceKey]
  const service = params.draft != null && typeof params.draft === 'object' && !Array.isArray(params.draft)
    ? mergeMaskedDraftValues(params.draft, baseService) as ModelServiceConfig
    : baseService
  if (service == null) {
    throw new ModelProvidersServiceError(
      'model_service_not_found',
      `Model service "${params.serviceKey}" was not found.`
    )
  }
  return service
}

export const listProviderCatalog = () => ({
  providers: listModelProviderDefinitions()
})

export const probeModelProvider = (service: ModelServiceConfig) => {
  const identity = resolveModelProviderIdentity(service)
  const provider = getModelProviderDefinition(identity.provider)
  const resolved = resolveModelServiceConfig(service)
  return {
    identity,
    provider,
    apiBaseUrl: resolved.service?.apiBaseUrl,
    modelSource: resolved.service?.modelSource,
    issues: resolved.issues
  }
}

export const listModelServiceModels = async (params: {
  draft?: unknown
  serviceKey: string
  source?: unknown
}) => ({
  models: await listProviderModels(await resolveServiceConfig(params))
})

export const getModelServiceBalance = async (params: {
  draft?: unknown
  serviceKey: string
  source?: unknown
}) => ({
  account: await getProviderAccountStatus(await resolveServiceConfig(params))
})

export const getModelProviderStatus = async (providerId: string) => ({
  status: await getProviderServiceStatus(providerId)
})

export const getModelServiceStatus = async (params: {
  draft?: unknown
  serviceKey: string
  source?: unknown
}) => {
  const service = await resolveServiceConfig(params)
  const identity = resolveModelProviderIdentity(service)
  if (identity.provider == null) {
    return { status: await getProviderServiceStatus('custom-openai-compatible') }
  }
  return getModelProviderStatus(identity.provider)
}

export const createModelServiceSecret = async (params: {
  draft?: unknown
  serviceKey: string
  source?: unknown
}) => ({
  secret: await createProviderSecret(await resolveServiceConfig(params))
})

export const refreshModelServiceModels = async (params: {
  draft?: unknown
  serviceKey: string
  source: ConfigSource
  models: unknown
}) => {
  if (!isConfigSource(params.source)) {
    throw new ModelProvidersServiceError('invalid_source', 'Invalid config source.', { source: params.source })
  }
  const modelIds = normalizeModelIds(params.models)
  if (modelIds.length === 0) {
    throw new ModelProvidersServiceError('invalid_models', 'At least one model id is required.')
  }

  const state = await loadConfigState()
  const sourceConfig = selectRawSourceConfig(state, params.source)
  const currentServices = sourceConfig?.modelServices ?? {}
  const currentService = currentServices[params.serviceKey]
  if (currentService == null && params.draft == null) {
    throw new ModelProvidersServiceError(
      'model_service_not_in_source',
      `Model service "${params.serviceKey}" does not exist in ${params.source} config.`
    )
  }
  if (currentService == null && hasMaskedDraftValue(params.draft)) {
    throw new ModelProvidersServiceError(
      'model_service_not_in_source',
      `Model service "${params.serviceKey}" does not exist in ${params.source} config.`
    )
  }

  const nextService = params.draft != null && typeof params.draft === 'object' && !Array.isArray(params.draft)
    ? mergeMaskedDraftValues(params.draft, currentService) as ModelServiceConfig
    : currentService

  await updateConfigFile({
    workspaceFolder: state.workspaceFolder,
    source: params.source,
    section: 'modelServices',
    value: {
      ...currentServices,
      [params.serviceKey]: {
        ...nextService,
        models: modelIds
      }
    }
  })

  return { ok: true, serviceKey: params.serviceKey, source: params.source, models: modelIds }
}
