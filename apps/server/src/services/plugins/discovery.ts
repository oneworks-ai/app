import path from 'node:path'
import process from 'node:process'

import type { MarketplaceConfig, PluginConfig, PluginRuntimeSourceGroup } from '@oneworks/types'
import {
  listManagedPluginInstalls,
  resolveGlobalOneWorksAssetsPath,
  resolveProjectHomePath,
  resolveProjectOoPath
} from '@oneworks/utils'
import { resolveConfiguredPluginInstances, resolveRuntimePluginConfig } from '@oneworks/utils/plugin-resolver'
import type { ResolvedPluginInstance } from '@oneworks/utils/plugin-resolver'

import { buildConfigJsonVariables, loadConfigState } from '#~/services/config/index.js'

const pluginConfigKey = (plugin: { id: string; scope?: string }) => `${plugin.id}\0${plugin.scope ?? ''}`
const bundledOfficialPluginPackageIds = new Set([
  '@oneworks/plugin-demo',
  '@oneworks/plugin-demo-extension',
  '@oneworks/plugin-logger',
  '@oneworks/plugin-relay'
])

const isPathInside = (root: string, candidate: string) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (
    relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  )
}

const registerPluginConfigSources = (
  target: Map<string, PluginRuntimeSourceGroup>,
  plugins: PluginConfig | undefined,
  sourceGroup: PluginRuntimeSourceGroup
) => {
  for (const plugin of plugins ?? []) {
    target.set(pluginConfigKey(plugin), sourceGroup)
  }
}

const getMarketplacePluginSourceGroup = (
  marketplaceKey: string,
  pluginName: string,
  sources: Array<{ config?: MarketplaceConfig; sourceGroup: PluginRuntimeSourceGroup }>
) =>
  sources.find(({ config }) => {
    const marketplace = config?.[marketplaceKey]
    const plugin = marketplace?.plugins?.[pluginName]
    return marketplace?.enabled !== false && plugin != null && plugin.enabled !== false
  })?.sourceGroup

const getOneWorksMarketplacePluginSourceGroup = (
  instance: ResolvedPluginInstance,
  sources: Array<{ config?: MarketplaceConfig; sourceGroup: PluginRuntimeSourceGroup }>
) =>
  sources.find(({ config }) =>
    Object.values(config ?? {}).some((marketplace) => {
      if (marketplace.type !== 'oneworks' || marketplace.enabled === false) return false
      const plugin = marketplace.plugins?.[instance.requestId]
      return plugin != null && plugin.enabled !== false && (
        plugin.scope == null || plugin.scope === instance.scope
      )
    })
  )?.sourceGroup

const applyPluginSourceGroup = (
  instance: ResolvedPluginInstance,
  sourceGroup: PluginRuntimeSourceGroup
) => {
  instance.sourceGroup = sourceGroup
  for (const child of instance.children) {
    applyPluginSourceGroup(child, sourceGroup)
  }
}

export const discoverPluginInstances = async () => {
  const {
    globalConfig,
    globalSource,
    mergedConfig,
    projectSource,
    userSource,
    workspaceFolder
  } = await loadConfigState()
  const disableGlobalConfig = mergedConfig?.disableGlobalConfig === true ||
    (globalConfig == null && globalSource?.resolvedConfig?.disableGlobalConfig === true)
  const plugins = await resolveRuntimePluginConfig({
    cwd: workspaceFolder,
    disableGlobalConfig,
    env: process.env,
    includeDefaultOfficialPlugins: true,
    marketplaces: mergedConfig?.marketplaces,
    plugins: mergedConfig?.plugins as PluginConfig | undefined
  })
  const instances = await resolveConfiguredPluginInstances({
    cwd: workspaceFolder,
    plugins,
    includeDisabled: true,
    preferBundledOfficialPlugins: true
  })

  const explicitSourceGroups = new Map<string, PluginRuntimeSourceGroup>()
  registerPluginConfigSources(explicitSourceGroups, globalSource?.resolvedConfig?.plugins, 'global')
  registerPluginConfigSources(explicitSourceGroups, projectSource?.resolvedConfig?.plugins, 'project')
  registerPluginConfigSources(explicitSourceGroups, userSource?.resolvedConfig?.plugins, 'localDev')

  const marketplaceSources = [
    { config: userSource?.resolvedConfig?.marketplaces, sourceGroup: 'localDev' as const },
    { config: projectSource?.resolvedConfig?.marketplaces, sourceGroup: 'project' as const },
    { config: globalSource?.resolvedConfig?.marketplaces, sourceGroup: 'global' as const }
  ]
  const managedSourceGroups = new Map<string, PluginRuntimeSourceGroup>()
  for (const install of await listManagedPluginInstalls(workspaceFolder, { env: process.env })) {
    if (install.config.source.type !== 'marketplace') continue
    const sourceGroup = getMarketplacePluginSourceGroup(
      install.config.source.marketplace,
      install.config.source.plugin,
      marketplaceSources
    )
    if (sourceGroup != null) {
      managedSourceGroups.set(path.resolve(install.oneworksPluginDir), sourceGroup)
    }
  }

  const localDevRoot = resolveProjectOoPath(workspaceFolder, process.env, 'plugins.dev')
  const globalPluginsRoot = resolveGlobalOneWorksAssetsPath(process.env, 'plugins')
  for (const instance of instances) {
    const sourceGroup = isPathInside(localDevRoot, instance.rootDir)
      ? 'localDev'
      : managedSourceGroups.get(path.resolve(instance.rootDir)) ??
        (isPathInside(globalPluginsRoot, instance.rootDir)
          ? 'global'
          : explicitSourceGroups.get(pluginConfigKey({ id: instance.requestId, scope: instance.scope })) ??
            getOneWorksMarketplacePluginSourceGroup(instance, marketplaceSources) ??
            (instance.sourceType === 'package' && instance.packageId != null &&
                bundledOfficialPluginPackageIds.has(instance.packageId)
              ? 'builtIn'
              : 'project'))
    applyPluginSourceGroup(instance, sourceGroup)
  }

  return {
    workspaceFolder,
    projectHome: resolveProjectHomePath(workspaceFolder, process.env),
    jsonVariables: buildConfigJsonVariables(workspaceFolder),
    instances
  }
}
