import { createRequire } from 'node:module'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import type { Config, PluginConfig, PluginConfigHook } from '@oneworks/types'
import {
  flattenPluginInstances,
  mergeDefaultOfficialPluginConfigs,
  mergePluginConfigs,
  resolveConfiguredPluginInstances,
  resolvePluginConfigEntryPathForInstance
} from '@oneworks/utils/plugin-resolver'

import { mergeConfigs } from './merge'

export const defineConfigPlugin = (plugin: PluginConfigHook) => plugin

export interface ApplyPluginConfigHooksOptions {
  cwd: string
  env?: Record<string, string | null | undefined>
  includeDefaultOfficialPlugins?: boolean
  jsonVariables?: Record<string, string | null | undefined>
  projectConfig?: Config
  userConfig?: Config
}

type ConfigPluginExport =
  | PluginConfigHook
  | {
    config?: Config | PluginConfigHook
    resolveConfig?: PluginConfigHook
  }

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value)
)

const omitConfigLoaderFields = (config: Config | undefined): Config | undefined => {
  if (config == null) return undefined

  const { extend: _extend, ...rest } = config
  return rest
}

const unwrapConfigPluginExport = (mod: unknown) =>
  (
    isRecord(mod) && 'default' in mod ? mod.default : mod
  ) as ConfigPluginExport

const loadConfigPluginExport = async (
  entryPath: string,
  pluginName: string
): Promise<ConfigPluginExport | undefined> => {
  try {
    const entryRequire = createRequire(entryPath)
    const mod = entryRequire(entryPath) as unknown
    return unwrapConfigPluginExport(mod)
  } catch (requireError) {
    try {
      const mod = await import(pathToFileURL(entryPath).href)
      return unwrapConfigPluginExport(mod)
    } catch (importError) {
      console.error(`Failed to load config hook for plugin ${pluginName}:`, requireError, importError)
    }
    return undefined
  }
}

const resolveConfigHook = (
  pluginExport: ConfigPluginExport | undefined
): PluginConfigHook | undefined => {
  if (typeof pluginExport === 'function') return pluginExport
  if (!isRecord(pluginExport)) return undefined

  if (typeof pluginExport.resolveConfig === 'function') {
    return pluginExport.resolveConfig
  }

  if (typeof pluginExport.config === 'function') {
    return pluginExport.config
  }

  if (isRecord(pluginExport.config)) {
    return () => pluginExport.config as Config
  }

  return undefined
}

const isOptionalConfigHookResolutionMiss = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.startsWith('Failed to resolve plugin package ') ||
    message.startsWith('Failed to resolve plugin directory ')
}

const resolvePluginConfigHookInstances = async (
  cwd: string,
  pluginConfigs: PluginConfig
) => {
  const instances: Awaited<ReturnType<typeof resolveConfiguredPluginInstances>> = []
  const resolvedIdentities: string[] = []

  for (const plugin of pluginConfigs) {
    try {
      const resolvedInstances = await resolveConfiguredPluginInstances({
        cwd,
        plugins: [plugin],
        autoInstallManaged: false,
        includeDisabled: true,
        preferBundledOfficialPlugins: true
      })
      for (const instance of resolvedInstances) {
        const identity = instance.packageId == null
          ? `directory:${instance.rootDir}`
          : `package:${instance.packageId}`
        for (let index = resolvedIdentities.length - 1; index >= 0; index--) {
          if (resolvedIdentities[index] !== identity) continue
          resolvedIdentities.splice(index, 1)
          instances.splice(index, 1)
        }
        if (plugin.enabled === false) continue
        resolvedIdentities.push(identity)
        instances.push(instance)
      }
    } catch (error) {
      if (isOptionalConfigHookResolutionMiss(error)) {
        continue
      }
      console.warn(`Failed to resolve config hook for plugin ${plugin.id}:`, error)
    }
  }

  return instances
}

export const applyPluginConfigHooks = async (
  options: ApplyPluginConfigHooksOptions
): Promise<readonly [Config | undefined, Config | undefined]> => {
  const projectConfig = omitConfigLoaderFields(options.projectConfig)
  let userConfig = omitConfigLoaderFields(options.userConfig)
  const env = options.env ?? process.env
  let pluginConfigs: PluginConfig | undefined
  try {
    pluginConfigs = mergeDefaultOfficialPluginConfigs({
      env,
      includeDefaultOfficialPlugins: options.includeDefaultOfficialPlugins,
      plugins: mergePluginConfigs(projectConfig?.plugins, userConfig?.plugins)
    })
  } catch (error) {
    console.warn('Failed to read plugin config hooks from invalid plugin config:', error)
    return [projectConfig, userConfig] as const
  }
  if (pluginConfigs == null || pluginConfigs.length === 0) {
    return [projectConfig, userConfig] as const
  }

  let mergedConfig = mergeConfigs(projectConfig, userConfig) ?? {}
  const jsonVariables = options.jsonVariables ?? {}
  const pluginInstances = await resolvePluginConfigHookInstances(options.cwd, pluginConfigs)

  for (const instance of flattenPluginInstances(pluginInstances)) {
    const pluginName = instance.packageId ?? instance.requestId
    const entryPath = resolvePluginConfigEntryPathForInstance(options.cwd, instance)
    if (entryPath == null) continue

    const pluginExport = await loadConfigPluginExport(entryPath, pluginName)
    const hook = resolveConfigHook(pluginExport)
    if (hook == null) {
      console.warn(`Config hook for plugin ${pluginName} does not export a valid config function.`)
      continue
    }

    try {
      const hookConfig = await hook({
        cwd: options.cwd,
        env,
        jsonVariables,
        projectConfig,
        userConfig,
        mergedConfig,
        plugin: instance
      })
      if (hookConfig == null) continue

      const nextConfig = omitConfigLoaderFields(hookConfig)
      if (nextConfig == null) continue

      userConfig = mergeConfigs(userConfig, nextConfig) ?? nextConfig
      mergedConfig = mergeConfigs(projectConfig, userConfig) ?? {}
    } catch (error) {
      console.error(`Failed to apply config hook for plugin ${pluginName}:`, error)
    }
  }

  return [projectConfig, userConfig] as const
}
