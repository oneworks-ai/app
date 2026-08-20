import type { PublicPluginRuntimeEndpoint as PluginRuntimeEndpoint } from '@oneworks/types'
import { createContext, useContext } from 'react'

import type { PluginRegistry } from './plugin-registry'

type PluginRegistrySnapshot = ReturnType<PluginRegistry['getSnapshot']>

export type PluginRuntimeSource = 'current' | 'manager'

export interface PluginContributionRuntimeSource {
  pluginServerBaseUrl?: string
  registry: PluginRegistry
  runtimeSource: PluginRuntimeSource
  snapshot: PluginRegistrySnapshot
}

export interface PluginRefreshOptions {
  isCurrent?: () => boolean
}

export interface PluginRefreshResult {
  applied: boolean
}

export interface PluginContextValue {
  contributionRuntimeSources: PluginContributionRuntimeSource[]
  pluginSnapshotStatus: 'error' | 'loading' | 'ready'
  pluginServerBaseUrl?: string
  ready: boolean
  refreshPlugins: (options?: PluginRefreshOptions) => Promise<PluginRefreshResult>
  registry: PluginRegistry
  reloadPlugin: (scope: string) => Promise<void>
  runtimeEndpoint?: PluginRuntimeEndpoint
  snapshot: PluginRegistrySnapshot
}

export const PluginContext = createContext<PluginContextValue | null>(null)

export const usePluginContext = () => {
  const value = useContext(PluginContext)
  if (value == null) {
    throw new Error('PluginProvider is missing')
  }
  return value
}

export const useOptionalPluginContext = () => useContext(PluginContext)
