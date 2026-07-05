import process from 'node:process'

import type { PluginConfig } from '@oneworks/types'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { resolveConfiguredPluginInstances, resolveRuntimePluginConfig } from '@oneworks/utils/plugin-resolver'

import { buildConfigJsonVariables, loadConfigState } from '#~/services/config/index.js'

export const discoverPluginInstances = async () => {
  const { globalConfig, globalSource, mergedConfig, workspaceFolder } = await loadConfigState()
  const disableGlobalConfig = mergedConfig?.disableGlobalConfig === true ||
    (globalConfig == null && globalSource?.resolvedConfig?.disableGlobalConfig === true)
  const plugins = await resolveRuntimePluginConfig({
    cwd: workspaceFolder,
    disableGlobalConfig,
    env: process.env,
    plugins: mergedConfig?.plugins as PluginConfig | undefined
  })
  const instances = await resolveConfiguredPluginInstances({
    cwd: workspaceFolder,
    plugins,
    includeDisabled: true,
    preferBundledOfficialPlugins: true
  })

  return {
    workspaceFolder,
    projectHome: resolveProjectHomePath(workspaceFolder, process.env),
    jsonVariables: buildConfigJsonVariables(workspaceFolder),
    instances
  }
}
