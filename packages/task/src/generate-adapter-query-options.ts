import process from 'node:process'

import { buildConfigJsonVariables, loadConfigState, mergeConfigs } from '@oneworks/config'
import type { AdapterQueryOptions, PluginConfig } from '@oneworks/types'
import { createStartupProfiler } from '@oneworks/utils'
import { resolvePromptAssetSelection, resolveWorkspaceAssetBundle } from '@oneworks/workspace-assets'

import {
  buildQueryOptionsCacheKey,
  isQueryOptionsCacheEnabled,
  readQueryOptionsCache,
  writeQueryOptionsCache
} from './generate-adapter-query-options-cache'
import { resolveQuerySelection } from './query-selection'
import { resolveWorkspaceTaskTarget } from './workspace-target'

export async function generateAdapterQueryOptions(
  type: 'spec' | 'entity' | 'workspace' | undefined,
  name?: string,
  cwd: string = process.cwd(),
  input?: {
    skills?: AdapterQueryOptions['skills']
    adapter?: string
    model?: string
    plugins?: PluginConfig
    updateConfiguredSkills?: boolean
  }
) {
  const startupProfiler = createStartupProfiler({
    cwd,
    env: process.env,
    ctxId: process.env.__ONEWORKS_PROJECT_CTX_ID__
  })
  const workspaceStartedAt = startupProfiler.now()
  const workspace = type === 'workspace'
    ? await resolveWorkspaceTaskTarget({ cwd, name })
    : undefined
  startupProfiler.mark('generateAdapterQueryOptions.resolveWorkspaceTaskTarget', workspaceStartedAt, {
    enabled: type === 'workspace'
  })
  const effectiveCwd = workspace?.cwd ?? cwd
  const promptType = type === 'workspace' ? undefined : type
  const promptName = type === 'workspace' ? undefined : name

  const variablesStartedAt = startupProfiler.now()
  const jsonVariables = buildConfigJsonVariables(effectiveCwd, process.env)
  startupProfiler.mark('generateAdapterQueryOptions.buildConfigJsonVariables', variablesStartedAt, {
    count: Object.keys(jsonVariables).length
  })
  const configStartedAt = startupProfiler.now()
  const {
    effectiveProjectConfig,
    projectConfig,
    userConfig,
    mergedConfig
  } = await loadConfigState({ cwd: effectiveCwd, jsonVariables })
  const config = effectiveProjectConfig ?? projectConfig
  startupProfiler.mark('generateAdapterQueryOptions.loadConfigState', configStartedAt)
  const mergePluginsStartedAt = startupProfiler.now()
  const mergedPlugins = mergeConfigs(
    {
      plugins: mergedConfig?.plugins
    },
    {
      plugins: input?.plugins
    }
  )?.plugins
  startupProfiler.mark('generateAdapterQueryOptions.mergePlugins', mergePluginsStartedAt, {
    count: mergedPlugins?.length ?? 0
  })
  const selectionStartedAt = startupProfiler.now()
  const selection = resolveQuerySelection({
    mergedConfig,
    inputAdapter: input?.adapter,
    inputModel: input?.model
  })
  startupProfiler.mark('generateAdapterQueryOptions.resolveQuerySelection', selectionStartedAt, {
    adapter: selection.adapter,
    model: selection.model
  })
  const cacheKey = isQueryOptionsCacheEnabled(input)
    ? buildQueryOptionsCacheKey({
      adapter: selection.adapter,
      config: {
        effectiveProjectConfig,
        projectConfig,
        userConfig,
        mergedConfig
      },
      cwd: effectiveCwd,
      input: {
        skills: input?.skills
      },
      model: selection.model,
      name: promptName,
      plugins: mergedPlugins,
      type: promptType
    })
    : undefined
  if (cacheKey != null) {
    const cacheReadStartedAt = startupProfiler.now()
    const cached = await readQueryOptionsCache(effectiveCwd, cacheKey).catch(() => undefined)
    startupProfiler.mark('generateAdapterQueryOptions.cacheRead', cacheReadStartedAt, {
      hit: cached != null
    })
    if (cached != null) {
      const [data, resolvedOptions] = cached
      return [
        data,
        {
          ...resolvedOptions,
          workspace
        }
      ] as const
    }
  }
  const bundleStartedAt = startupProfiler.now()
  const bundle = await resolveWorkspaceAssetBundle({
    cwd: effectiveCwd,
    configs: [config, userConfig],
    plugins: mergedPlugins,
    syncConfiguredSkills: input?.updateConfiguredSkills === true,
    updateConfiguredSkills: input?.updateConfiguredSkills === true,
    warnMissingConfiguredSkills: true
  })
  startupProfiler.mark('generateAdapterQueryOptions.resolveWorkspaceAssetBundle', bundleStartedAt, {
    assetCount: bundle.assets.length
  })
  const promptSelectionStartedAt = startupProfiler.now()
  const [data, resolvedOptions] = await resolvePromptAssetSelection({
    bundle,
    type: promptType,
    name: promptName,
    adapter: selection.adapter,
    input
  })
  startupProfiler.mark('generateAdapterQueryOptions.resolvePromptAssetSelection', promptSelectionStartedAt, {
    promptAssetCount: resolvedOptions.promptAssetIds?.length ?? 0
  })
  if (cacheKey != null) {
    const cacheWriteStartedAt = startupProfiler.now()
    await writeQueryOptionsCache({
      cacheKey,
      cwd: effectiveCwd,
      data,
      resolvedOptions
    }).catch(() => undefined)
    startupProfiler.mark('generateAdapterQueryOptions.cacheWrite', cacheWriteStartedAt)
  }
  return [
    data,
    {
      ...resolvedOptions,
      workspace
    } as Partial<AdapterQueryOptions> & {
      workspace?: Awaited<ReturnType<typeof resolveWorkspaceTaskTarget>>
    }
  ] as const
}
