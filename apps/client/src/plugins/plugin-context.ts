import { createContext, useContext } from 'react'

import type { PluginRegistry } from './plugin-registry'

type PluginRegistrySnapshot = ReturnType<PluginRegistry['getSnapshot']>

export interface PluginContextValue {
  refreshPlugins: () => Promise<void>
  registry: PluginRegistry
  reloadPlugin: (scope: string) => Promise<void>
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
