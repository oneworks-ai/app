import type {
  PluginDetailAssetGroup,
  PluginDetailAssetKind,
  PluginMarketplaceCatalogResponse,
  PluginReadmeVariant,
  PluginRuntimeEndpoint
} from '@oneworks/types'

import { buildApiUrl, fetchApiJson } from '#~/api/base'
import { createServerUrlFromBase, normalizeServerBaseUrl } from '#~/runtime-config'

import type { PluginRuntimeInstance } from './plugin-manifest'

interface PluginListResponse {
  diagnostics?: unknown[]
  plugins?: PluginRuntimeInstance[]
  runtime?: PluginRuntimeEndpoint
}

interface PluginApiSourceOptions {
  serverBaseUrl?: string
}

interface PluginRuntimeEndpointsResponse {
  endpoints?: PluginRuntimeEndpoint[]
}

export interface PluginReadme extends PluginReadmeVariant {}
export type { PluginDetailAssetGroup, PluginDetailAssetKind }

export interface PluginSnapshot {
  diagnostics?: unknown[]
  plugins: PluginRuntimeInstance[]
  runtime?: PluginRuntimeEndpoint
}

interface PluginReadmeResponse {
  readme: PluginReadme | null
  readmes?: PluginReadme[]
  scope: string
}

interface PluginAssetsResponse {
  groups?: PluginDetailAssetGroup[]
  scope: string
}

const encodePluginAssetPath = (assetPath: string) =>
  assetPath
    .split('/')
    .filter(part => part !== '')
    .map(encodeURIComponent)
    .join('/')

const normalizePluginInstance = (instance: PluginRuntimeInstance): PluginRuntimeInstance => ({
  ...instance,
  clientEntryUrl: instance.clientEntryUrl ?? instance.client?.clientEntryUrl,
  devClientEntryUrl: instance.devClientEntryUrl ?? instance.client?.devClientEntryUrl,
  plugin: instance.plugin ?? (
    instance.contributions == null
      ? undefined
      : { contributions: instance.contributions }
  )
})

const createPluginApiUrl = (path: string, serverBaseUrl?: string) => {
  const normalizedServerBaseUrl = normalizeServerBaseUrl(serverBaseUrl)
  return normalizedServerBaseUrl == null
    ? buildApiUrl(path)
    : createServerUrlFromBase(normalizedServerBaseUrl, path)
}

export const listPlugins = async (options: PluginApiSourceOptions = {}) => {
  const snapshot = await listPluginSnapshot(options)
  return snapshot.plugins
}

export const listPluginRuntimeEndpoints = async (options: PluginApiSourceOptions = {}) => {
  const response = await fetchApiJson<PluginRuntimeEndpointsResponse>(
    createPluginApiUrl('/api/plugins/runtime/endpoints', options.serverBaseUrl)
  )
  return response.endpoints ?? []
}

export const listPluginSnapshot = async (options: PluginApiSourceOptions = {}): Promise<PluginSnapshot> => {
  const response = await fetchApiJson<PluginListResponse | PluginRuntimeInstance[]>(
    createPluginApiUrl('/api/plugins', options.serverBaseUrl)
  )
  const plugins = Array.isArray(response) ? response : response.plugins ?? []
  return {
    diagnostics: Array.isArray(response) ? undefined : response.diagnostics,
    plugins: plugins.map(normalizePluginInstance),
    runtime: Array.isArray(response) ? undefined : response.runtime
  }
}

export const listPluginMarketplaceCatalog = async () => (
  fetchApiJson<PluginMarketplaceCatalogResponse>('/api/plugins/marketplace/catalog', {
    timeoutMs: 60_000
  })
)

export const setPluginWatch = async (
  scope: string,
  enabled: boolean,
  options: PluginApiSourceOptions = {}
) => {
  const response = await fetchApiJson<{
    scope: string
    watch: { enabled: boolean }
  }>(createPluginApiUrl(`/api/plugins/${encodeURIComponent(scope)}/watch`, options.serverBaseUrl), {
    body: JSON.stringify({ enabled }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  })
  return response.watch
}

export const setPluginEnabled = async (
  scope: string,
  enabled: boolean,
  target: 'workspace' | 'global' = 'workspace',
  options: PluginApiSourceOptions = {}
) => {
  const response = await fetchApiJson<{
    scope: string
    state: { enabled: boolean }
  }>(createPluginApiUrl(`/api/plugins/${encodeURIComponent(scope)}/enabled`, options.serverBaseUrl), {
    body: JSON.stringify({ enabled, target }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  })
  return response.state
}

export const setPluginOptions = async (
  scope: string,
  options: Record<string, unknown>,
  target: 'workspace' | 'global' = 'workspace',
  sourceOptions: PluginApiSourceOptions = {}
) => {
  const response = await fetchApiJson<{
    scope: string
    state: { options: Record<string, unknown> }
  }>(createPluginApiUrl(`/api/plugins/${encodeURIComponent(scope)}/options`, sourceOptions.serverBaseUrl), {
    body: JSON.stringify({ options, target }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH'
  })
  return response.state.options
}

export const getPluginReadme = async (scope: string, options: PluginApiSourceOptions = {}) => {
  const response = await fetchApiJson<PluginReadmeResponse>(
    createPluginApiUrl(`/api/plugins/${encodeURIComponent(scope)}/readme`, options.serverBaseUrl)
  )
  const readmes = response.readmes ?? (response.readme == null ? [] : [response.readme])
  return {
    readme: response.readme ?? readmes[0],
    readmes
  }
}

export const getPluginAssets = async (scope: string, options: PluginApiSourceOptions = {}) => {
  const response = await fetchApiJson<PluginAssetsResponse>(
    createPluginApiUrl(`/api/plugins/${encodeURIComponent(scope)}/assets`, options.serverBaseUrl)
  )
  return response.groups ?? []
}

export const buildPluginReadmeAssetUrl = (
  scope: string,
  assetPath: string,
  options: PluginApiSourceOptions = {}
) => (
  createPluginApiUrl(
    `/api/plugins/${encodeURIComponent(scope)}/readme/assets/${encodePluginAssetPath(assetPath)}`,
    options.serverBaseUrl
  )
)
