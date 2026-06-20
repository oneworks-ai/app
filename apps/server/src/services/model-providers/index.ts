import type {
  ConfigSource,
  ModelServiceConfig,
  ProviderManagementTokenCreateInput,
  ProviderManagementTokenUpdateInput
} from '@oneworks/types'
import {
  getModelProviderDefinition,
  listModelProviderDefinitions,
  resolveModelProviderIdentity,
  resolveModelServiceConfig,
  resolveModelServiceFromMap
} from '@oneworks/utils'

import { loadConfigState } from '#~/services/config/index.js'

import {
  createProviderManagementToken,
  createProviderSecret,
  deleteProviderManagementToken,
  getProviderAccountStatus,
  getProviderManagementSnapshot,
  getProviderManagementTokenProfile,
  getProviderServiceStatus,
  listProviderModels,
  updateProviderManagementToken
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
    ? resolveModelServiceFromMap(state.mergedConfig.modelServices, params.serviceKey)
    : resolveModelServiceFromMap(sourceConfig?.modelServices, params.serviceKey)
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

export const getModelServiceManagementSnapshot = async (params: {
  draft?: unknown
  serviceKey: string
  source?: unknown
}) => ({
  management: await getProviderManagementSnapshot(await resolveServiceConfig(params))
})

export const createModelServiceManagementToken = async (params: {
  draft?: unknown
  input: ProviderManagementTokenCreateInput
  serviceKey: string
  source?: unknown
}) => ({
  result: await createProviderManagementToken(await resolveServiceConfig(params), params.input)
})

export const updateModelServiceManagementToken = async (params: {
  draft?: unknown
  input: ProviderManagementTokenUpdateInput
  serviceKey: string
  source?: unknown
}) => ({
  result: await updateProviderManagementToken(await resolveServiceConfig(params), params.input)
})

export const deleteModelServiceManagementToken = async (params: {
  draft?: unknown
  serviceKey: string
  source?: unknown
  tokenId: string
}) => ({
  result: await deleteProviderManagementToken(await resolveServiceConfig(params), params.tokenId)
})

export const getModelServiceManagementTokenProfile = async (params: {
  draft?: unknown
  serviceKey: string
  source?: unknown
  tokenId: string
}) => getProviderManagementTokenProfile(await resolveServiceConfig(params), params.tokenId)
