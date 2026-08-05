import { PluginProvider } from '#~/plugins/PluginProvider'

import { PluginStoreRoute } from './PluginStoreRoute'

export function WorkspacePluginStoreRoute() {
  return (
    <PluginProvider runtimeSource='current'>
      <PluginStoreRoute />
    </PluginProvider>
  )
}
