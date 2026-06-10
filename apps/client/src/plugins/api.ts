import type {
  PluginDetailAssetGroup,
  PluginDetailAssetKind,
  PluginMarketplaceCatalogResponse,
  PluginReadmeVariant
} from '@oneworks/types'

import { buildApiUrl, fetchApiJson } from '#~/api/base'

import type { PluginRuntimeInstance } from './plugin-manifest'

interface PluginListResponse {
  diagnostics?: unknown[]
  plugins?: PluginRuntimeInstance[]
}

export interface PluginReadme extends PluginReadmeVariant {}
export type { PluginDetailAssetGroup, PluginDetailAssetKind }

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

export const listPlugins = async () => {
  const response = await fetchApiJson<PluginListResponse | PluginRuntimeInstance[]>('/api/plugins')
  const plugins = Array.isArray(response) ? response : response.plugins ?? []
  return plugins.map(normalizePluginInstance)
}

export const listPluginMarketplaceCatalog = async () => (
  fetchApiJson<PluginMarketplaceCatalogResponse>('/api/plugins/marketplace/catalog', {
    timeoutMs: 60_000
  })
)

export const setPluginWatch = async (scope: string, enabled: boolean) => {
  const response = await fetchApiJson<{
    scope: string
    watch: { enabled: boolean }
  }>(`/api/plugins/${encodeURIComponent(scope)}/watch`, {
    body: JSON.stringify({ enabled }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  })
  return response.watch
}

export const setPluginEnabled = async (
  scope: string,
  enabled: boolean,
  target: 'workspace' | 'global' = 'workspace'
) => {
  const response = await fetchApiJson<{
    scope: string
    state: { enabled: boolean }
  }>(`/api/plugins/${encodeURIComponent(scope)}/enabled`, {
    body: JSON.stringify({ enabled, target }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  })
  return response.state
}

export const setPluginOptions = async (
  scope: string,
  options: Record<string, unknown>,
  target: 'workspace' | 'global' = 'workspace'
) => {
  const response = await fetchApiJson<{
    scope: string
    state: { options: Record<string, unknown> }
  }>(`/api/plugins/${encodeURIComponent(scope)}/options`, {
    body: JSON.stringify({ options, target }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH'
  })
  return response.state.options
}

export const getPluginReadme = async (scope: string) => {
  const response = await fetchApiJson<PluginReadmeResponse>(`/api/plugins/${encodeURIComponent(scope)}/readme`)
  const readmes = response.readmes ?? (response.readme == null ? [] : [response.readme])
  return {
    readme: response.readme ?? readmes[0],
    readmes
  }
}

export const getPluginAssets = async (scope: string) => {
  const response = await fetchApiJson<PluginAssetsResponse>(`/api/plugins/${encodeURIComponent(scope)}/assets`)
  return response.groups ?? []
}

export const buildPluginReadmeAssetUrl = (scope: string, assetPath: string) => (
  buildApiUrl(`/api/plugins/${encodeURIComponent(scope)}/readme/assets/${encodePluginAssetPath(assetPath)}`)
)
