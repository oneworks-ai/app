import process from 'node:process'

import {
  buildConfigJsonVariables,
  loadConfigState,
  mergeConfigs,
  resolveUseDefaultOneworksMcpServer
} from '@oneworks/config'
import { syncConfiguredMarketplacePlugins } from '@oneworks/managed-plugins'
import type { AdapterBuiltinModel, AdapterCtx, AdapterQueryOptions, Config } from '@oneworks/types'
import { loadAdapterModelServiceModels } from '@oneworks/types'
import {
  CODEX_SHARED_MODEL_PATH,
  CODEX_SHARED_MODEL_SERVICE_KEY,
  CODEX_SHARED_MODEL_TOKEN_ENV,
  createCodexSharedModelService,
  createStartupProfiler,
  isCodexSharedModelEnabled,
  mergeProcessEnvWithProjectEnv,
  migrateProjectHomeSegments,
  nowStartupMs,
  sanitizeOneWorksLoaderEnv,
  withoutReservedCodexSharedModelService
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
  const prevEnv = sanitizeOneWorksLoaderEnv(
    mergeProcessEnvWithProjectEnv(envFromOptions, { workspaceFolder: cwd })
  )
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
  const loadedConfigState = await loadConfigState({ cwd, env, jsonVariables })
  const sharingEnabled = isCodexSharedModelEnabled(loadedConfigState.mergedConfig)
  const sharedModelToken = env[CODEX_SHARED_MODEL_TOKEN_ENV]
  const serverPort = env.__ONEWORKS_PROJECT_SERVER_PORT__
  const canMaterializeSharedModel = sharingEnabled &&
    typeof sharedModelToken === 'string' && sharedModelToken !== '' &&
    typeof serverPort === 'string' && serverPort !== ''
  let sharedBuiltinModels: AdapterBuiltinModel[] | undefined
  if (canMaterializeSharedModel) {
    try {
      sharedBuiltinModels = loadAdapterModelServiceModels('codex', { cwd })
    } catch {
      sharedBuiltinModels = undefined
    }
  }
  const withSharedModel = (value: Config | undefined) => {
    const sanitized = withoutReservedCodexSharedModelService(value)
    if (!canMaterializeSharedModel || sanitized == null) return sanitized
    return {
      ...sanitized,
      modelServices: {
        ...(sanitized.modelServices ?? {}),
        [CODEX_SHARED_MODEL_SERVICE_KEY]: createCodexSharedModelService({
          builtinModels: sharedBuiltinModels,
          apiBaseUrl: `http://127.0.0.1:${serverPort}${CODEX_SHARED_MODEL_PATH}/v1`,
          apiKey: sharedModelToken
        })
      }
    }
  }
  const configState = {
    ...loadedConfigState,
    effectiveProjectConfig: withSharedModel(loadedConfigState.effectiveProjectConfig),
    projectConfig: withSharedModel(loadedConfigState.projectConfig),
    userConfig: withSharedModel(loadedConfigState.userConfig),
    mergedConfig: withSharedModel(loadedConfigState.mergedConfig)!
  }
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
