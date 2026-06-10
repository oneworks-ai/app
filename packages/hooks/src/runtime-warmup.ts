import process from 'node:process'

import { buildConfigJsonVariables, loadConfig } from '@oneworks/config'
import type { PluginConfig, ResolvedPluginInstanceMetadata } from '@oneworks/types'
import { createStartupProfiler } from '@oneworks/utils'
import { mergePluginConfigs } from '@oneworks/utils/plugin-resolver'

import { resolvePlugins, warmConfiguredPluginHookModules } from './loader'
import { primeHookEntriesCache } from './plugin-entry-cache'

interface HookRuntimeWarmupInput {
  cwd: string
  light?: boolean
  pluginConfig?: PluginConfig
  pluginInstances?: ResolvedPluginInstanceMetadata[]
  sessionId?: string
}

export const warmHookRuntime = async (
  input: HookRuntimeWarmupInput,
  env: Record<string, string | null | undefined> = process.env
) => {
  const workspaceFolder = env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? input.cwd ?? process.env.HOME ?? '/'
  const ctxId = env.__ONEWORKS_PROJECT_CTX_ID__ ?? input.sessionId ?? 'default'
  const startupProfiler = createStartupProfiler({
    cwd: workspaceFolder,
    env,
    ctxId,
    sessionId: input.sessionId
  })

  if (input.pluginConfig != null && input.pluginInstances != null) {
    primeHookEntriesCache(
      workspaceFolder,
      input.pluginConfig,
      input.pluginInstances,
      {
        profiler: startupProfiler,
        profilePrefix: 'hook.workerWarmup.resolvePlugins'
      },
      'hook.workerWarmup.resolvePlugins'
    )
    const resolvePluginsStartedAt = startupProfiler.now()
    const plugins = await resolvePlugins(workspaceFolder, input.pluginConfig, {
      env,
      profiler: startupProfiler,
      profilePrefix: 'hook.workerWarmup.resolvePlugins'
    })
    startupProfiler.mark('hook.workerWarmup.resolvePlugins', resolvePluginsStartedAt, {
      count: plugins.length,
      primed: true
    })
    return {
      pluginCount: plugins.length
    }
  }

  const buildVariablesStartedAt = startupProfiler.now()
  const jsonVariables = buildConfigJsonVariables(workspaceFolder, env)
  startupProfiler.mark('hook.workerWarmup.buildConfigJsonVariables', buildVariablesStartedAt, {
    count: Object.keys(jsonVariables).length
  })

  const loadConfigStartedAt = startupProfiler.now()
  const [config, userConfig] = await loadConfig({
    cwd: workspaceFolder,
    env,
    jsonVariables
  })
  startupProfiler.mark('hook.workerWarmup.loadConfig', loadConfigStartedAt)

  const mergePluginConfigStartedAt = startupProfiler.now()
  const pluginConfig = mergePluginConfigs(config?.plugins, userConfig?.plugins)
  startupProfiler.mark('hook.workerWarmup.mergePluginConfig', mergePluginConfigStartedAt, {
    count: pluginConfig?.length ?? 0
  })

  if (input.light === true) {
    const warmModulesStartedAt = startupProfiler.now()
    await warmConfiguredPluginHookModules(workspaceFolder, pluginConfig, {
      profiler: startupProfiler,
      profilePrefix: 'hook.workerWarmup.warmConfiguredPluginHookModules'
    })
    startupProfiler.mark('hook.workerWarmup.warmConfiguredPluginHookModules', warmModulesStartedAt, {
      count: pluginConfig?.length ?? 0
    })
    return {
      pluginCount: pluginConfig?.length ?? 0
    }
  }

  const resolvePluginsStartedAt = startupProfiler.now()
  const plugins = await resolvePlugins(workspaceFolder, pluginConfig, {
    env,
    profiler: startupProfiler,
    profilePrefix: 'hook.workerWarmup.resolvePlugins'
  })
  startupProfiler.mark('hook.workerWarmup.resolvePlugins', resolvePluginsStartedAt, {
    count: plugins.length
  })

  return {
    pluginCount: plugins.length
  }
}
