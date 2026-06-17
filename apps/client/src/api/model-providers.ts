import type {
  ConfigSource,
  ModelProviderDefinition,
  ModelProviderIdentity,
  ModelServiceConfig,
  ProviderAccountStatus,
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

export const refreshModelServiceModels = (params: {
  service?: ModelServiceConfig
  serviceKey: string
  source: ConfigSource
  models: string[]
}) => (
  fetchApiJsonOrThrow<{ ok: true; serviceKey: string; source: ConfigSource; models: string[] }>(
    `/api/model-services/${encodeURIComponent(params.serviceKey)}/models/refresh`,
    {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        ...buildServiceActionBody({ service: params.service, source: params.source }),
        models: params.models
      })
    },
    '[api] refresh model service models failed:'
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
