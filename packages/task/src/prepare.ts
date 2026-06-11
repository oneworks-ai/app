import process from 'node:process'

import {
  buildConfigJsonVariables,
  loadConfigState,
  mergeConfigs,
  resolveUseDefaultOneworksMcpServer
} from '@oneworks/config'
import { syncConfiguredMarketplacePlugins } from '@oneworks/managed-plugins'
import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'
import {
  createStartupProfiler,
  mergeProcessEnvWithProjectEnv,
  migrateProjectHomeSegments,
  nowStartupMs
} from '@oneworks/utils'
import { getCacheWithLegacyFallback, setCache } from '@oneworks/utils/cache'
import { createLogger } from '@oneworks/utils/create-logger'
import { resolveServerLogLevel } from '@oneworks/utils/log-level'
import { uuid } from '@oneworks/utils/uuid'
import { resolveWorkspaceAssetBundle } from '@oneworks/workspace-assets'

import type { RunTaskOptions } from './type'

export const prepare = async (
  options: RunTaskOptions,
  adapterOptions: AdapterQueryOptions
) => {
  const cwd = options.cwd ?? process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? process.cwd()

  const {
    sessionId = uuid()
  } = adapterOptions
  const {
    ctxId = process.env.__ONEWORKS_PROJECT_CTX_ID__ ?? sessionId,
    env: envFromOptions
  } = options
  const {
    __IS_LOADER_CLI__: _0,
    ...prevEnv
  } = mergeProcessEnvWithProjectEnv(envFromOptions, { workspaceFolder: cwd })
  const env: Record<string, string | null | undefined> = {
    ...prevEnv,
    __ONEWORKS_PROJECT_CTX_ID__: ctxId,
    __ONEWORKS_PROJECT_SESSION_ID__: sessionId,
    __ONEWORKS_PROJECT_RUN_TYPE__: adapterOptions.runtime,
    __ONEWORKS_PROJECT_PERMISSION_MODE__: adapterOptions.permissionMode ?? prevEnv.__ONEWORKS_PROJECT_PERMISSION_MODE__,
    __ONEWORKS_PROJECT_ENABLE_BUILTIN_PERMISSION_HOOKS__: (
        adapterOptions.runtime === 'server' || adapterOptions.runtime === 'mcp'
      )
      ? '1'
      : undefined,
    // 移除 NODE_OPTIONS 环境变量，防止干扰子进程的运行环境
    NODE_OPTIONS: undefined
  }
  await migrateProjectHomeSegments(cwd, env)
  const logger = createLogger(
    cwd,
    ctxId,
    sessionId,
    env?.LOG_PREFIX ?? '',
    resolveServerLogLevel(env),
    env as NodeJS.ProcessEnv
  )

  const jsonVariables = buildConfigJsonVariables(cwd, env)
  const configLoadStartedAt = nowStartupMs()
  const configState = await loadConfigState({ cwd, env, jsonVariables })
  const {
    effectiveProjectConfig,
    projectConfig,
    userConfig,
    mergedConfig
  } = configState
  const config = effectiveProjectConfig ?? projectConfig
  const startupProfiler = createStartupProfiler({
    config: mergedConfig,
    cwd,
    ctxId,
    env,
    sessionId
  })
  startupProfiler.mark('prepare.loadConfigState', configLoadStartedAt)
  const mergedPlugins = mergeConfigs(
    {
      plugins: mergedConfig?.plugins
    },
    {
      plugins: options.plugins
    }
  )?.plugins
  const assetsStartedAt = startupProfiler.now()
  const assets = adapterOptions.assetBundle ?? await (async () => {
    if (adapterOptions.type === 'create') {
      const syncResults = await syncConfiguredMarketplacePlugins({
        cwd,
        env,
        marketplaces: mergedConfig?.marketplaces
      })
      const updatedPlugins = syncResults
        .filter(result => result.action !== 'skipped')
        .map(result => `${result.plugin}@${result.marketplace}`)
      if (updatedPlugins.length > 0) {
        logger.info({ plugins: updatedPlugins }, '[plugins] Synchronized declared marketplace plugins')
      }
    }

    return resolveWorkspaceAssetBundle({
      cwd,
      configs: [config, userConfig],
      env,
      plugins: mergedPlugins,
      syncConfiguredSkills: options.updateConfiguredSkills === true,
      updateConfiguredSkills: options.updateConfiguredSkills === true,
      warnMissingConfiguredSkills: true,
      useDefaultOneworksMcpServer: resolveUseDefaultOneworksMcpServer({
        runtimeValue: adapterOptions.useDefaultOneworksMcpServer,
        projectConfig: config,
        userConfig
      })
    })
  })()
  startupProfiler.mark('prepare.resolveAssets', assetsStartedAt, {
    bundled: adapterOptions.assetBundle != null
  })
  return [
    {
      ctxId,
      cwd,
      env,
      cache: {
        set: (key, value) => setCache(cwd, ctxId, sessionId, key, value, env as NodeJS.ProcessEnv),
        get: (key) => getCacheWithLegacyFallback(cwd, ctxId, sessionId, key, env as NodeJS.ProcessEnv)
      },
      logger,
      configs: [config, userConfig],
      configState,
      assets
    } satisfies AdapterCtx
  ] as const
}
