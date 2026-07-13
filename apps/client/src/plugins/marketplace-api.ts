import type { PluginMarketplaceCatalogResponse, PluginMarketplaceInstallTarget } from '@oneworks/types'

import { fetchApiJson } from '#~/api/base'
import { createPluginApiUrl } from './api'
import type { PluginApiSourceOptions } from './api'

export const listPluginMarketplaceCatalog = async (options: PluginApiSourceOptions = {}) => (
  fetchApiJson<PluginMarketplaceCatalogResponse>(
    createPluginApiUrl(
      '/api/plugins/marketplace/catalog',
      options.serverBaseUrl
    ),
    {
      timeoutMs: 60_000
    }
  )
)

export const resolvePluginMarketplaceVersions = async (
  generation: string,
  items: Array<{ marketplace: string; plugin: string }>,
  options: PluginApiSourceOptions = {}
) =>
  fetchApiJson<{
    versions: Array<{ marketplace: string; plugin: string; version: string }>
  }>(createPluginApiUrl('/api/plugins/marketplace/versions', options.serverBaseUrl), {
    body: JSON.stringify({ generation, items }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    timeoutMs: 30_000
  })

export const syncPluginMarketplaceSelection = async (
  marketplace: string,
  plugin: string,
  enabled: boolean,
  target?: PluginMarketplaceInstallTarget,
  sourceOptions: PluginApiSourceOptions = {}
) =>
  fetchApiJson<{ results: Array<{ action: string; marketplace: string; plugin: string }> }>(
    createPluginApiUrl(
      `/api/plugins/marketplace/plugins/${encodeURIComponent(marketplace)}/${encodeURIComponent(plugin)}/${
        target == null ? 'sync' : 'selection'
      }`,
      sourceOptions.serverBaseUrl
    ),
    {
      body: JSON.stringify({ enabled, ...(target != null ? { target } : {}) }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      timeoutMs: 120_000
    }
  )
