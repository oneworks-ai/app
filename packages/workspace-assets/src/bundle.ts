import type { Config, PluginConfig, WorkspaceAssetBundle } from '@oneworks/types'

import { collectWorkspaceAssets } from './bundle-internal'

export async function resolveWorkspaceAssetBundle(params: {
  cwd: string
  configs?: [Config?, Config?]
  env?: Record<string, string | null | undefined>
  plugins?: PluginConfig
  overlaySource?: string
  syncConfiguredSkills?: boolean
  updateConfiguredSkills?: boolean
  useDefaultOneworksMcpServer?: boolean
  warnMissingConfiguredSkills?: boolean
}): Promise<WorkspaceAssetBundle> {
  const collected = await collectWorkspaceAssets(params)

  return {
    cwd: params.cwd,
    configs: collected.configs,
    pluginConfigs: collected.pluginConfigs,
    pluginInstances: collected.pluginInstances,
    assets: collected.assets,
    rules: collected.rules,
    specs: collected.specs,
    entities: collected.entities,
    skills: collected.skills,
    workspaces: collected.workspaces,
    mcpServers: collected.mcpServers,
    hookPlugins: collected.hookPlugins,
    opencodeOverlayAssets: collected.opencodeOverlayAssets,
    defaultIncludeMcpServers: collected.defaultIncludeMcpServers,
    defaultExcludeMcpServers: collected.defaultExcludeMcpServers
  }
}
