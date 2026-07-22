import { isAbsolute, resolve } from 'node:path'

import type { MarketplaceConfig, PluginConfig } from '@oneworks/types'
import { mergeProcessEnvWithProjectEnv } from '@oneworks/utils'
import type { StartupProfiler } from '@oneworks/utils'
import {
  resolveDirectoryPluginHooksEntryPath,
  resolvePluginHooksEntryPath,
  resolveRuntimePluginConfig
} from '@oneworks/utils/plugin-resolver'
import type { Plugin } from './context'
import { resolveHookEntriesWithCache } from './plugin-entry-cache'

interface ResolvePluginsProfileOptions {
  env?: Record<string, string | null | undefined>
  marketplaces?: MarketplaceConfig
  profiler?: StartupProfiler
  profilePrefix?: string
}

const resolvePluginEnv = (env: ResolvePluginsProfileOptions['env']): NodeJS.ProcessEnv => {
  return mergeProcessEnvWithProjectEnv(env)
}

const loadPlugin = async (
  entryPath: string,
  name: string,
  config: Record<string, unknown>
): Promise<Partial<Plugin> | null> => {
  try {
    // eslint-disable-next-line ts/no-require-imports
    const module = require(entryPath)
    const factory:
      | Partial<Plugin>
      | ((config: Record<string, unknown>) => Partial<Plugin>) = module.default ?? module

    if (typeof factory === 'function') {
      return factory(config)
    }
    if (typeof factory === 'object' && factory !== null) {
      return factory
    }

    console.warn(`Plugin ${name} does not export a valid plugin factory or object.`)
    return null
  } catch (error) {
    console.error(`Failed to load plugin ${name}:`, error)
    return null
  }
}

const shouldTryPrefixedPluginId = (id: string) => (
  !id.startsWith('@') &&
  !id.startsWith('.') &&
  !id.startsWith('/') &&
  !id.includes('\\')
)

const resolveRawPluginHookEntryPath = (cwd: string, id: string) => {
  if (id.startsWith('./') || id.startsWith('../') || isAbsolute(id)) {
    return resolveDirectoryPluginHooksEntryPath(isAbsolute(id) ? id : resolve(cwd, id))
  }

  return resolvePluginHooksEntryPath(cwd, id) ??
    (shouldTryPrefixedPluginId(id) ? resolvePluginHooksEntryPath(cwd, `@oneworks/plugin-${id}`) : undefined)
}

export const warmConfiguredPluginHookModules = async (
  cwd: string,
  config: PluginConfig | undefined,
  profileOptions: ResolvePluginsProfileOptions = {}
) => {
  const profilePrefix = profileOptions.profilePrefix ?? 'hook.warmConfiguredPluginHookModules'
  const effectiveConfig = (await resolveRuntimePluginConfig({
    cwd,
    marketplaces: profileOptions.marketplaces,
    plugins: config,
    env: resolvePluginEnv(profileOptions.env)
  }) ?? []).filter(plugin => plugin.enabled !== false)
  await Promise.allSettled(
    effectiveConfig.map(async (plugin, index) => {
      const resolveStartedAt = profileOptions.profiler?.now()
      const entryPath = resolveRawPluginHookEntryPath(cwd, plugin.id)
      if (resolveStartedAt != null) {
        profileOptions.profiler?.mark(`${profilePrefix}.resolve.${index}.${plugin.id}`, resolveStartedAt, {
          found: entryPath != null
        })
      }
      if (entryPath == null) return

      const loadStartedAt = profileOptions.profiler?.now()
      try {
        // eslint-disable-next-line ts/no-require-imports
        require(entryPath)
      } finally {
        if (loadStartedAt != null) {
          profileOptions.profiler?.mark(`${profilePrefix}.load.${index}.${plugin.id}`, loadStartedAt, {
            entryPath
          })
        }
      }
    })
  )
  return effectiveConfig.length
}

export const resolvePlugins = async (
  cwd: string,
  config: PluginConfig | undefined,
  profileOptions: ResolvePluginsProfileOptions = {}
): Promise<Partial<Plugin>[]> => {
  const profilePrefix = profileOptions.profilePrefix ?? 'hook.resolvePlugins'
  const resolveConfigStartedAt = profileOptions.profiler?.now()
  const effectiveConfig = await resolveRuntimePluginConfig({
    cwd,
    marketplaces: profileOptions.marketplaces,
    plugins: config,
    env: resolvePluginEnv(profileOptions.env)
  }) ?? []
  if (resolveConfigStartedAt != null) {
    profileOptions.profiler?.mark(`${profilePrefix}.resolveRuntimePluginConfig`, resolveConfigStartedAt, {
      count: effectiveConfig.length
    })
  }
  if (effectiveConfig.length === 0) return []

  const instances = await resolveHookEntriesWithCache(cwd, effectiveConfig, profileOptions, profilePrefix)

  const modules = await Promise.allSettled(
    instances.map(async ({ instance, hooksEntryPath }, index) => {
      const pluginName = instance.packageId ?? instance.requestId
      const loadStartedAt = profileOptions.profiler?.now()
      try {
        return await loadPlugin(hooksEntryPath, pluginName, instance.options)
      } finally {
        if (loadStartedAt != null) {
          profileOptions.profiler?.mark(`${profilePrefix}.loadPlugin.${index}.${pluginName}`, loadStartedAt, {
            entryPath: hooksEntryPath,
            index,
            plugin: pluginName
          })
        }
      }
    })
  )

  const collectModulesStartedAt = profileOptions.profiler?.now()
  const plugins: Partial<Plugin>[] = []
  modules.forEach((result, index) => {
    const pkgName = instances[index]?.instance.packageId ?? instances[index]?.instance.requestId
    if (result.status === 'fulfilled') {
      if (result.value != null) {
        plugins.push(result.value)
      }
      return
    }
    console.error(`Error loading plugin ${pkgName}:`, result.reason)
  })
  if (collectModulesStartedAt != null) {
    profileOptions.profiler?.mark(`${profilePrefix}.collectLoadedPlugins`, collectModulesStartedAt, {
      count: plugins.length,
      resultCount: modules.length
    })
  }

  return plugins
}
