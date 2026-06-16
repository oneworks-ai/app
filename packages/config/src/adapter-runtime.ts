import type { Config } from '@oneworks/types'
import { mergeAdapterConfigs } from '@oneworks/utils'

import type { ResolvedConfigState } from './load'
import { mergeConfigs } from './merge'

export const remapRuntimeAdapterConfig = (
  config: Config | undefined,
  instanceKey: string,
  runtimeKey: string
): Config | undefined => {
  if (config == null || instanceKey === runtimeKey) return config

  const adapters = config.adapters as Record<string, unknown> | undefined
  const instanceConfig = adapters?.[instanceKey]
  if (instanceConfig == null) return config

  const mergedRuntimeAdapterConfig = mergeAdapterConfigs(
    { [runtimeKey]: adapters?.[runtimeKey] } as Record<string, unknown>,
    { [runtimeKey]: instanceConfig } as Record<string, unknown>
  )[runtimeKey]

  return {
    ...config,
    adapters: {
      ...(adapters ?? {}),
      [runtimeKey]: mergedRuntimeAdapterConfig
    } as Config['adapters']
  }
}

export const resolveRuntimeAdapterConfigState = (
  configState: ResolvedConfigState,
  instanceKey: string,
  runtimeKey: string
): ResolvedConfigState => {
  if (instanceKey === runtimeKey) return configState

  const effectiveProjectConfig = remapRuntimeAdapterConfig(
    configState.effectiveProjectConfig,
    instanceKey,
    runtimeKey
  )
  const projectConfig = remapRuntimeAdapterConfig(configState.projectConfig, instanceKey, runtimeKey)
  const userConfig = remapRuntimeAdapterConfig(configState.userConfig, instanceKey, runtimeKey)
  const resolvedProjectConfig = effectiveProjectConfig ?? projectConfig

  return {
    ...configState,
    effectiveProjectConfig,
    projectConfig: resolvedProjectConfig,
    userConfig,
    mergedConfig: mergeConfigs(resolvedProjectConfig, userConfig) ?? {}
  }
}
