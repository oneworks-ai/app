/* eslint-disable max-lines -- model provider API wrappers intentionally stay in one typed module. */
import type {
  ConfigSource,
  ModelProviderDefinition,
  ModelProviderIdentity,
  ModelServiceConfig,
  ProviderAccountStatus,
  ProviderManagementMutationResult,
  ProviderManagementSnapshot,
  ProviderManagementTokenCreateInput,
  ProviderManagementTokenProfileResult,
  ProviderManagementTokenUpdateInput,
  ProviderModelInfo,
  ProviderSecretResult,
  ProviderServiceStatus
} from '@oneworks/types'

import { fetchApiJsonOrThrow, jsonHeaders } from './base'

export interface ModelProviderProbeResponse {
  identity: ModelProviderIdentity
  provider?: ModelProviderDefinition
  apiBaseUrl?: string
  modelSource?: string
  issues: Array<{ type: string; path?: string[]; message: string }>
}

export const listModelProviders = () => (
  fetchApiJsonOrThrow<{ providers: ModelProviderDefinition[] }>(
    '/api/model-providers',
    { method: 'GET' },
    '[api] list model providers failed:'
  )
)

export const probeModelProvider = (service: ModelServiceConfig) => (
  fetchApiJsonOrThrow<ModelProviderProbeResponse>(
    '/api/model-providers/probe',
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ service })
    },
    '[api] probe model provider failed:'
  )
)

export const getModelProviderStatus = (providerId: string) => (
  fetchApiJsonOrThrow<{ status: ProviderServiceStatus }>(
    `/api/model-providers/${encodeURIComponent(providerId)}/status`,
    { method: 'GET' },
    '[api] get model provider status failed:'
  )
)

const buildServiceActionBody = (params?: { service?: ModelServiceConfig; source?: ConfigSource }) => ({
  ...(params?.service != null ? { service: params.service } : {}),
  ...(params?.source != null ? { source: params.source } : {})
})

export const listModelServiceModels = (
  serviceKey: string,
  params?: { service?: ModelServiceConfig; source?: ConfigSource }
) => (
  fetchApiJsonOrThrow<{ models: ProviderModelInfo[] }>(
    `/api/model-services/${encodeURIComponent(serviceKey)}/models/list`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(buildServiceActionBody(params))
    },
    '[api] list model service models failed:'
  )
)

export const getModelServiceBalance = (
  serviceKey: string,
  params?: { service?: ModelServiceConfig; source?: ConfigSource }
) => (
  fetchApiJsonOrThrow<{ account: ProviderAccountStatus }>(
    `/api/model-services/${encodeURIComponent(serviceKey)}/balance`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(buildServiceActionBody(params))
    },
    '[api] get model service balance failed:'
  )
)

export const getModelServiceStatus = (
  serviceKey: string,
  params?: { service?: ModelServiceConfig; source?: ConfigSource }
) => (
  fetchApiJsonOrThrow<{ status: ProviderServiceStatus }>(
    `/api/model-services/${encodeURIComponent(serviceKey)}/status`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(buildServiceActionBody(params))
    },
    '[api] get model service status failed:'
  )
)

export const createModelServiceSecret = (
  serviceKey: string,
  params?: { service?: ModelServiceConfig; source?: ConfigSource }
) => (
  fetchApiJsonOrThrow<{ secret: ProviderSecretResult }>(
    `/api/model-services/${encodeURIComponent(serviceKey)}/secrets`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(buildServiceActionBody(params))
    },
    '[api] create model service secret failed:'
  )
)

export const getModelServiceManagementSnapshot = (
  serviceKey: string,
  params?: { service?: ModelServiceConfig; source?: ConfigSource }
) => (
  fetchApiJsonOrThrow<{ management: ProviderManagementSnapshot }>(
    `/api/model-services/${encodeURIComponent(serviceKey)}/management`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(buildServiceActionBody(params))
    },
    '[api] get model service management snapshot failed:'
  )
)

export const createModelServiceManagementToken = (
  serviceKey: string,
  input: ProviderManagementTokenCreateInput,
  params?: { service?: ModelServiceConfig; source?: ConfigSource }
) => (
  fetchApiJsonOrThrow<{ result: ProviderManagementMutationResult }>(
    `/api/model-services/${encodeURIComponent(serviceKey)}/management/tokens`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        ...buildServiceActionBody(params),
        input
      })
    },
    '[api] create model service management token failed:'
  )
)

export const updateModelServiceManagementToken = (
  serviceKey: string,
  tokenId: string,
  input: Omit<ProviderManagementTokenUpdateInput, 'id'>,
  params?: { service?: ModelServiceConfig; source?: ConfigSource }
) => (
  fetchApiJsonOrThrow<{ result: ProviderManagementMutationResult }>(
    `/api/model-services/${encodeURIComponent(serviceKey)}/management/tokens/${encodeURIComponent(tokenId)}`,
    {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({
        ...buildServiceActionBody(params),
        input
      })
    },
    '[api] update model service management token failed:'
  )
)

export const deleteModelServiceManagementToken = (
  serviceKey: string,
  tokenId: string,
  params?: { service?: ModelServiceConfig; source?: ConfigSource }
) => (
  fetchApiJsonOrThrow<{ result: ProviderManagementMutationResult }>(
    `/api/model-services/${encodeURIComponent(serviceKey)}/management/tokens/${encodeURIComponent(tokenId)}`,
    {
      method: 'DELETE',
      headers: jsonHeaders,
      body: JSON.stringify(buildServiceActionBody(params))
    },
    '[api] delete model service management token failed:'
  )
)

export const getModelServiceManagementTokenProfile = (
  serviceKey: string,
  tokenId: string,
  params?: { service?: ModelServiceConfig; source?: ConfigSource }
) => (
  fetchApiJsonOrThrow<ProviderManagementTokenProfileResult>(
    `/api/model-services/${encodeURIComponent(serviceKey)}/management/tokens/${encodeURIComponent(tokenId)}/profile`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(buildServiceActionBody(params))
    },
    '[api] get model service management token profile failed:'
  )
)
