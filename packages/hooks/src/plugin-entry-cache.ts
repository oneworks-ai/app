import process from 'node:process'

import type { PluginConfig, ResolvedPluginInstanceMetadata } from '@oneworks/types'
import type { StartupProfiler } from '@oneworks/utils'
import {
  flattenPluginInstances,
  resolveConfiguredPluginInstances,
  resolvePluginHooksEntryPathForInstance
} from '@oneworks/utils/plugin-resolver'

interface ResolvePluginsProfileOptions {
  profiler?: StartupProfiler
  profilePrefix?: string
}

export interface ResolvedHookEntry {
  hooksEntryPath: string
  instance: ResolvedPluginInstanceMetadata
}

const hookEntriesCache = new Map<string, Promise<ResolvedHookEntry[]>>()

const createHookEntriesCacheKey = (cwd: string, config: PluginConfig) => {
  try {
    return JSON.stringify({
      cliPackageDir: process.env.__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__ ?? '',
      config,
      cwd,
      nodePath: process.env.NODE_PATH ?? '',
      packageDir: process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__ ?? ''
    })
  } catch {
    return undefined
  }
}

const flattenResolvedPluginInstances = (
  plugins: ResolvedPluginInstanceMetadata[]
): ResolvedPluginInstanceMetadata[] => (
  plugins.flatMap(plugin => [plugin, ...flattenResolvedPluginInstances(plugin.children)])
)

const createHookEntriesFromFlatInstances = (
  cwd: string,
  instances: ResolvedPluginInstanceMetadata[]
) => (
  instances.flatMap((instance) => {
    const hooksEntryPath = resolvePluginHooksEntryPathForInstance(cwd, instance)
    return hooksEntryPath != null
      ? [{ instance, hooksEntryPath }]
      : []
  })
)

const createHookEntriesFromInstances = (
  cwd: string,
  instances: ResolvedPluginInstanceMetadata[]
) => createHookEntriesFromFlatInstances(cwd, flattenResolvedPluginInstances(instances))

const resolveHookEntries = async (
  cwd: string,
  effectiveConfig: PluginConfig,
  profileOptions: ResolvePluginsProfileOptions,
  profilePrefix: string
) => {
  const resolveInstancesStartedAt = profileOptions.profiler?.now()
  const resolvedInstances = await resolveConfiguredPluginInstances({
    cwd,
    plugins: effectiveConfig
  })
  if (resolveInstancesStartedAt != null) {
    profileOptions.profiler?.mark(`${profilePrefix}.resolveConfiguredPluginInstances`, resolveInstancesStartedAt, {
      count: resolvedInstances.length
    })
  }

  const flattenInstancesStartedAt = profileOptions.profiler?.now()
  const flattenedInstances = flattenPluginInstances(resolvedInstances)
  const entries = createHookEntriesFromFlatInstances(cwd, flattenedInstances)
  if (flattenInstancesStartedAt != null) {
    profileOptions.profiler?.mark(`${profilePrefix}.flattenAndResolveHookEntries`, flattenInstancesStartedAt, {
      flattenedCount: flattenedInstances.length,
      hookEntryCount: entries.length
    })
  }

  return entries
}

export const primeHookEntriesCache = (
  cwd: string,
  effectiveConfig: PluginConfig,
  pluginInstances: ResolvedPluginInstanceMetadata[],
  profileOptions: ResolvePluginsProfileOptions,
  profilePrefix: string
) => {
  const primeStartedAt = profileOptions.profiler?.now()
  const entries = createHookEntriesFromInstances(cwd, pluginInstances)
  const cacheKey = createHookEntriesCacheKey(cwd, effectiveConfig)
  if (cacheKey != null) {
    hookEntriesCache.set(cacheKey, Promise.resolve(entries))
  }
  if (primeStartedAt != null) {
    profileOptions.profiler?.mark(`${profilePrefix}.primeHookEntriesCache`, primeStartedAt, {
      hookEntryCount: entries.length,
      skipped: cacheKey == null
    })
  }
  return entries
}

export const resolveHookEntriesWithCache = async (
  cwd: string,
  effectiveConfig: PluginConfig,
  profileOptions: ResolvePluginsProfileOptions,
  profilePrefix: string
) => {
  const cacheStartedAt = profileOptions.profiler?.now()
  const cacheKey = createHookEntriesCacheKey(cwd, effectiveConfig)
  const cached = cacheKey == null ? undefined : hookEntriesCache.get(cacheKey)
  if (cached != null) {
    const entries = await cached
    if (cacheStartedAt != null) {
      profileOptions.profiler?.mark(`${profilePrefix}.resolveHookEntriesCache`, cacheStartedAt, {
        hit: true,
        hookEntryCount: entries.length
      })
    }
    return entries
  }

  const next = resolveHookEntries(cwd, effectiveConfig, profileOptions, profilePrefix)
  if (cacheKey != null) {
    hookEntriesCache.set(cacheKey, next)
  }

  try {
    const entries = await next
    if (cacheStartedAt != null) {
      profileOptions.profiler?.mark(`${profilePrefix}.resolveHookEntriesCache`, cacheStartedAt, {
        hit: false,
        hookEntryCount: entries.length
      })
    }
    return entries
  } catch (error) {
    if (cacheKey != null) {
      hookEntriesCache.delete(cacheKey)
    }
    throw error
  }
}
