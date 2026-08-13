import { Buffer } from 'node:buffer'

import {
  collectJunieAuthEnvironmentValues,
  scrubJunieAuthEnvironmentForPersistence,
  scrubJunieAuthValuesForPersistence
} from '@oneworks/adapter-junie/auth-env'
import { resolveAdapterCommonConfig, resolveConfigState, resolveRuntimeAdapterConfigState } from '@oneworks/config'
import type { ConfigSourceState, ResolvedConfigState } from '@oneworks/config'
import { callHook, createAdapterHookBridge } from '@oneworks/hooks'
import type { HookInputs } from '@oneworks/hooks'
import type {
  AdapterCtx,
  AdapterModelFallbackError,
  AdapterOutputEvent,
  AdapterQueryOptions,
  AssetDiagnostic,
  Config,
  TaskDetail,
  WorkspaceAssetAdapter
} from '@oneworks/types'
import { loadAdapter, resolveAdapterRuntimeTarget } from '@oneworks/types/adapter-package'
import {
  CODEX_SHARED_MODEL_SERVICE_KEY,
  CODEX_SHARED_MODEL_TOKEN_ENV,
  createStartupProfiler,
  listServiceModels,
  nowStartupMs,
  resolveAdapterModelCompatibility,
  resolveEffectiveEffort,
  scrubCredentialConfigForPersistence
} from '@oneworks/utils'
import { buildAdapterAssetPlan, resolveSelectedMcpNames } from '@oneworks/workspace-assets'

import { applyKiroPersistenceBoundary, createKiroPersistenceBoundary } from './kiro-persistence'
import { scrubCredentialGraphForPersistence, scrubTaskBaseForPersistence } from './persistence-scrub'
import { prepare } from './prepare'
import { resolveQuerySelection } from './query-selection'
import { sanitizeTaskBaseForPersistence as sanitizeDroidTaskBaseForPersistence } from './task-cache-persistence'
import type { RunTaskOptions } from './type'

const pickFirstNonEmptyString = (values: unknown[]) => (
  values.find((value): value is string => typeof value === 'string' && value.trim() !== '')?.trim()
)

const INHERITED_ADAPTER_ENV = '__ONEWORKS_PROJECT_ADAPTER__'
const INHERITED_MODEL_ENV = '__ONEWORKS_PROJECT_MODEL__'
const RUNTIME_DEFAULT_ADAPTER_ENV = '__ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_ADAPTER__'
const RUNTIME_DEFAULT_MODEL_ENV = '__ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_MODEL__'
const RUNTIME_DEFAULT_EFFORT_ENV = '__ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_EFFORT__'
const RUNTIME_DEFAULT_PERMISSION_MODE_ENV = '__ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_PERMISSION_MODE__'

const CLINE_CREDENTIAL_ENV_KEY_PATTERN =
  /(?:^|_)(?:api_?key|access_?key|account_?key|secret(?:_access)?_?key|client_?secret|password|passwd|token|credential|authorization|private_?key)(?:_|$)/iu

const CLINE_SENSITIVE_ENV_KEYS = new Set([
  'AWS_CONFIG_FILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'SSH_AUTH_SOCK'
])

const CLINE_SENSITIVE_ENV_PREFIXES = [
  'ANTHROPIC_',
  'AWS_',
  'AZURE_',
  'CLINE_API_KEY',
  'GCE_',
  'GCLOUD_',
  'GCP_',
  'GEMINI_',
  'GH_',
  'GITHUB_',
  'GIT_',
  'GOOGLE_',
  'OPENAI_'
]

const isClineCredentialEnvKey = (key: string) => {
  const normalized = key.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').replace(/-/gu, '_').toUpperCase()
  return CLINE_SENSITIVE_ENV_KEYS.has(normalized) ||
    CLINE_SENSITIVE_ENV_PREFIXES.some(prefix => normalized.startsWith(prefix)) ||
    CLINE_CREDENTIAL_ENV_KEY_PATTERN.test(normalized)
}

const omitClineCredentialEnv = (env: AdapterCtx['env']): AdapterCtx['env'] =>
  Object.fromEntries(
    Object.entries(env).filter(([key]) => !isClineCredentialEnvKey(key))
  )

const setNonEmptyEnv = (
  env: Record<string, string | null | undefined>,
  key: string,
  value: unknown
) => {
  const normalized = pickFirstNonEmptyString([value])
  if (normalized == null) {
    delete env[key]
    return
  }
  env[key] = normalized
}

const isStdioMcpServer = (server: NonNullable<Config['mcpServers']>[string]) => 'command' in server

const resolveEffectivePermissionMode = (
  permissionMode: AdapterQueryOptions['permissionMode'],
  configuredDefaultMode: AdapterQueryOptions['permissionMode']
) => {
  if (permissionMode != null && permissionMode !== 'default') return permissionMode
  return configuredDefaultMode ?? permissionMode
}

const resolveEffectiveMcpSelection = (params: {
  assets?: AdapterCtx['assets']
  selection?: AdapterQueryOptions['mcpServers']
}) => ({
  include: params.selection?.include ??
    (
      (params.assets?.defaultIncludeMcpServers.length ?? 0) > 0
        ? params.assets?.defaultIncludeMcpServers
        : undefined
    ),
  exclude: params.selection?.exclude ??
    (
      (params.assets?.defaultExcludeMcpServers.length ?? 0) > 0
        ? params.assets?.defaultExcludeMcpServers
        : undefined
    )
})

const splitRuntimeMcpSelection = (params: {
  assets?: AdapterCtx['assets']
  runtimeServerNames: Set<string>
  selection?: AdapterQueryOptions['mcpServers']
}) => {
  const workspaceServerNames = new Set(Object.keys(params.assets?.mcpServers ?? {}))
  const effectiveSelection = resolveEffectiveMcpSelection({
    assets: params.assets,
    selection: params.selection
  })
  const splitRefs = (refs?: string[]) => {
    const workspaceRefs: string[] = []
    const runtimeRefs = new Set<string>()
    for (const ref of refs ?? []) {
      if (params.runtimeServerNames.has(ref) && !workspaceServerNames.has(ref)) {
        runtimeRefs.add(ref)
        continue
      }
      workspaceRefs.push(ref)
    }
    return { workspaceRefs, runtimeRefs }
  }

  const include = splitRefs(effectiveSelection.include)
  const exclude = splitRefs(effectiveSelection.exclude)

  const result = {
    workspaceSelection: effectiveSelection.include == null && effectiveSelection.exclude == null
      ? undefined
      : {
        ...(effectiveSelection.include == null ? {} : { include: include.workspaceRefs }),
        ...(effectiveSelection.exclude == null ? {} : { exclude: exclude.workspaceRefs })
      },
    runtimeInclude: effectiveSelection.include == null ? undefined : include.runtimeRefs,
    runtimeExclude: exclude.runtimeRefs,
    excludeAllWorkspaceMcp: effectiveSelection.include != null && include.workspaceRefs.length === 0
  }
  return result
}

const formatAdapterModelRuleSuffix = (params: {
  includeModels?: string[]
  excludeModels?: string[]
}) => {
  const parts = []
  if (params.includeModels != null && params.includeModels.length > 0) {
    parts.push(`includeModels=${params.includeModels.join(', ')}`)
  }
  if (params.excludeModels != null && params.excludeModels.length > 0) {
    parts.push(`excludeModels=${params.excludeModels.join(', ')}`)
  }
  return parts.length > 0 ? ` (${parts.join('; ')})` : ''
}

const formatAdapterModelFallbackError = (error: AdapterModelFallbackError) => {
  const ruleSuffix = formatAdapterModelRuleSuffix({
    includeModels: error.includeModels,
    excludeModels: error.excludeModels
  })

  if (error.type === 'missing_default_model') {
    return `Model "${error.requestedModel}" is not allowed for adapter "${error.adapter}"${ruleSuffix}. Configure adapters.${error.adapter}.defaultModel to continue.`
  }

  return `Adapter "${error.adapter}" defaultModel "${error.defaultModel}" is also not allowed${ruleSuffix}.`
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const scrubJunieConfigContent = (
  config: Config | undefined,
  adapterKeys: ReadonlySet<string>,
  authValues: readonly string[]
) => {
  if (config == null || config.adapters == null) return config
  const adapters = config.adapters as Record<string, unknown>
  let nextAdapters: Record<string, unknown> | undefined
  for (const adapterKey of adapterKeys) {
    const entry = adapters[adapterKey]
    if (!isRecord(entry) || !Object.prototype.hasOwnProperty.call(entry, 'configContent')) continue
    nextAdapters ??= { ...adapters }
    nextAdapters[adapterKey] = {
      ...entry,
      configContent: scrubCredentialConfigForPersistence(
        scrubJunieAuthValuesForPersistence(entry.configContent, authValues)
      ) ?? {}
    }
  }
  return nextAdapters == null ? config : { ...config, adapters: nextAdapters as Config['adapters'] }
}

const scrubJunieConfigSource = (
  source: ConfigSourceState | undefined,
  adapterKeys: ReadonlySet<string>,
  authValues: readonly string[]
): ConfigSourceState | undefined => {
  if (source == null) return source
  return {
    ...source,
    rawConfig: scrubJunieConfigContent(source.rawConfig, adapterKeys, authValues),
    resolvedConfig: scrubJunieConfigContent(source.resolvedConfig, adapterKeys, authValues),
    resolvedExtendSources: source.resolvedExtendSources?.map(
      item => scrubJunieConfigSource(item, adapterKeys, authValues)!
    )
  }
}

const resolveJuniePersistenceAdapterKeys = (
  config: Config,
  cwd: string
) => {
  const adapterEntries = config.adapters as Record<string, unknown> | undefined
  return new Set(
    Object.keys(adapterEntries ?? {}).filter((adapterKey) => (
      resolveAdapterRuntimeTarget(adapterKey, { config, cwd }).runtimeAdapter === 'junie'
    ))
  )
}

const sanitizeTaskBaseForPersistence = (
  base: Omit<AdapterCtx, 'logger' | 'cache'>,
  params: {
    cwd: string
    kiroPersistenceBoundary?: ReturnType<typeof createKiroPersistenceBoundary>
    runtimeAdapterType: string
  }
) => {
  const droidSafeBase = sanitizeDroidTaskBaseForPersistence(base, base)
  const credentialSafeBase = scrubTaskBaseForPersistence(droidSafeBase, base)
  const configState = credentialSafeBase.configState as ResolvedConfigState | undefined
  const effectiveConfig = configState?.mergedConfig ?? credentialSafeBase.configs[1] ??
    credentialSafeBase.configs[0] ?? {}
  const junieAdapterKeys = resolveJuniePersistenceAdapterKeys(effectiveConfig, params.cwd)
  const hasJunieConfig = junieAdapterKeys.size > 0
  const authValues = collectJunieAuthEnvironmentValues(credentialSafeBase.env)
  const runtimeEnv = params.runtimeAdapterType === 'cline'
    ? omitClineCredentialEnv(credentialSafeBase.env)
    : credentialSafeBase.env
  const env = params.runtimeAdapterType === 'junie'
    ? scrubJunieAuthEnvironmentForPersistence(runtimeEnv) as AdapterCtx['env']
    : { ...runtimeEnv }
  delete env[CODEX_SHARED_MODEL_TOKEN_ENV]
  delete env.DEEPSEEK_API_KEY
  delete env.DEEPSEEK_BASE_URL
  const stripConfig = (config: Config | undefined) => {
    if (config == null) return config
    const configEnv = config.env == null ? undefined : { ...config.env }
    if (configEnv != null) {
      delete configEnv.DEEPSEEK_API_KEY
      delete configEnv.DEEPSEEK_BASE_URL
    }
    const service = config.modelServices?.[CODEX_SHARED_MODEL_SERVICE_KEY]
    const withoutRuntimeCapabilities: Config = {
      ...config,
      ...(configEnv == null ? {} : { env: configEnv }),
      ...(service == null
        ? {}
        : {
          modelServices: {
            ...config.modelServices,
            [CODEX_SHARED_MODEL_SERVICE_KEY]: {
              ...service,
              apiKey: undefined,
              apiBaseUrl: undefined
            }
          }
        })
    }
    return scrubJunieConfigContent(withoutRuntimeCapabilities, junieAdapterKeys, authValues)
  }
  const mergedConfig = configState?.mergedConfig ?? credentialSafeBase.configs[0] ??
    credentialSafeBase.configs[1] ?? {}
  const dshAdapterKeys = new Set([
    'dsh',
    ...Object.keys(mergedConfig.adapters ?? {}).filter(adapterKey => (
      resolveAdapterRuntimeTarget(adapterKey, { config: mergedConfig, cwd: base.cwd }).runtimeAdapter === 'dsh'
    ))
  ])
  const stripDeepSeekConfigGraph = (value: unknown, parentKey?: string): unknown => {
    if (Array.isArray(value)) return value.map(entry => stripDeepSeekConfigGraph(entry))
    if (value == null || typeof value !== 'object') return value
    if (value instanceof Date || Buffer.isBuffer(value) || value instanceof Error) return value
    if (value instanceof Map) {
      return new Map(
        Array.from(value.entries(), ([key, entry]) => [
          stripDeepSeekConfigGraph(key),
          stripDeepSeekConfigGraph(entry)
        ])
      )
    }
    if (value instanceof Set) {
      return new Set(Array.from(value, entry => stripDeepSeekConfigGraph(entry)))
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'DEEPSEEK_API_KEY' && key !== 'DEEPSEEK_BASE_URL')
        .map(([key, entry]) => {
          const isDshAdapterEntry = parentKey === 'adapters' && entry != null && typeof entry === 'object' && (
            dshAdapterKeys.has(key) ||
            resolveAdapterRuntimeTarget(key, {
                config: { adapters: { [key]: entry } } as Config,
                cwd: credentialSafeBase.cwd
              }).runtimeAdapter === 'dsh'
          )
          if (isDshAdapterEntry) {
            const { baseUrl: _baseUrl, ...safeEntry } = entry as Record<string, unknown>
            return [key, stripDeepSeekConfigGraph(safeEntry, key)]
          }
          return [key, stripDeepSeekConfigGraph(entry, key)]
        })
    )
  }
  const persistentBase = {
    ...credentialSafeBase,
    env,
    configs: [
      stripConfig(credentialSafeBase.configs[0]),
      stripConfig(credentialSafeBase.configs[1])
    ] as AdapterCtx['configs'],
    ...(!hasJunieConfig || credentialSafeBase.assets?.configs == null
      ? {}
      : {
        assets: {
          ...credentialSafeBase.assets,
          configs: [
            stripConfig(credentialSafeBase.assets.configs[0]),
            stripConfig(credentialSafeBase.assets.configs[1])
          ] as AdapterCtx['configs']
        }
      }),
    ...(configState == null
      ? {}
      : {
        configState: {
          ...configState,
          effectiveProjectConfig: stripConfig(configState.effectiveProjectConfig),
          globalConfig: hasJunieConfig ? stripConfig(configState.globalConfig) : configState.globalConfig,
          projectConfig: stripConfig(configState.projectConfig),
          userConfig: stripConfig(configState.userConfig),
          mergedConfig: stripConfig(configState.mergedConfig)!,
          ...(hasJunieConfig
            ? {
              globalSource: scrubJunieConfigSource(configState.globalSource, junieAdapterKeys, authValues),
              projectSource: scrubJunieConfigSource(configState.projectSource, junieAdapterKeys, authValues),
              userSource: scrubJunieConfigSource(configState.userSource, junieAdapterKeys, authValues)
            }
            : {})
        }
      })
  }
  const deepSeekSafeBase = stripDeepSeekConfigGraph(persistentBase) as typeof persistentBase
  const adapterSafeBase = params.runtimeAdapterType === 'kiro' && params.kiroPersistenceBoundary != null
    ? params.kiroPersistenceBoundary.scrub(deepSeekSafeBase)
    : deepSeekSafeBase
  return adapterSafeBase
}

declare module '@oneworks/types' {
  interface Cache {
    base: Omit<AdapterCtx, 'logger' | 'cache'>
    detail: TaskDetail
  }
}

const BASE_NATIVE_BRIDGE_DISABLED_EVENTS: Array<
  'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Stop'
> = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']

const OPENCODE_NATIVE_BRIDGE_DISABLED_EVENTS: Array<
  'SessionStart' | 'PreToolUse' | 'PostToolUse' | 'Stop'
> = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop']

const COPILOT_NATIVE_BRIDGE_DISABLED_EVENTS: Array<
  'PreToolUse' | 'PostToolUse' | 'Stop'
> = ['PreToolUse', 'PostToolUse', 'Stop']

const GROK_NATIVE_BRIDGE_DISABLED_EVENTS: Array<
  'PreToolUse' | 'PostToolUse' | 'Stop'
> = ['PreToolUse', 'PostToolUse', 'Stop']

const JUNIE_NATIVE_BRIDGE_DISABLED_EVENTS: Array<
  'SessionStart' | 'SessionEnd' | 'PreToolUse' | 'Stop' | 'StopFailure'
> = ['SessionStart', 'SessionEnd', 'PreToolUse', 'Stop', 'StopFailure']

const DROID_NATIVE_BRIDGE_DISABLED_EVENTS: Array<
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'Notification'
  | 'SubagentStop'
  | 'PreCompact'
  | 'SessionEnd'
> = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'Notification',
  'SubagentStop',
  'PreCompact',
  'SessionEnd'
]

export const run = async (
  options: RunTaskOptions,
  adapterOptions: AdapterQueryOptions
) => {
  const prepareStartedAt = nowStartupMs()
  const [ctx] = await prepare(options, adapterOptions)
  const configState = resolveConfigState({
    configState: ctx.configState,
    configs: ctx.configs
  })
  const { mergedConfig } = configState
  const effectivePermissionMode = resolveEffectivePermissionMode(
    adapterOptions.permissionMode,
    mergedConfig.permissions?.defaultMode
  )
  const effectiveAdapterOptions: AdapterQueryOptions = effectivePermissionMode === adapterOptions.permissionMode
    ? adapterOptions
    : {
      ...adapterOptions,
      permissionMode: effectivePermissionMode
    }
  if (effectivePermissionMode != null) {
    ctx.env.__ONEWORKS_PROJECT_PERMISSION_MODE__ = effectivePermissionMode
  }
  const inheritedAdapter = pickFirstNonEmptyString([ctx.env[INHERITED_ADAPTER_ENV]])
  const inheritedModel = pickFirstNonEmptyString([ctx.env[INHERITED_MODEL_ENV]])
  const selectionAdapter = pickFirstNonEmptyString([options.adapter, inheritedAdapter])
  const selectionModel = pickFirstNonEmptyString([effectiveAdapterOptions.model, inheritedModel])
  const startupProfiler = createStartupProfiler({
    config: mergedConfig,
    cwd: ctx.cwd,
    ctxId: ctx.ctxId,
    env: ctx.env,
    sessionId: effectiveAdapterOptions.sessionId
  })
  startupProfiler.mark('task.prepare', prepareStartedAt)

  const resolvedSelection = resolveQuerySelection({
    mergedConfig,
    inputAdapter: selectionAdapter,
    inputModel: selectionModel
  })
  const adapterType = resolvedSelection.adapter
  if (adapterType == null) {
    throw new Error('No adapter found in config, please set adapters in config file')
  }
  const adapterTarget = resolveAdapterRuntimeTarget(adapterType, {
    config: mergedConfig,
    cwd: ctx.cwd
  })
  const runtimeAdapterType = adapterTarget.runtimeAdapter
  const runtimeConfigState = resolveRuntimeAdapterConfigState(
    configState,
    adapterType,
    runtimeAdapterType
  )
  const resolvedRuntimeCtx: AdapterCtx = runtimeConfigState === configState
    ? ctx
    : {
      ...ctx,
      configs: [
        runtimeConfigState.effectiveProjectConfig ?? runtimeConfigState.projectConfig,
        runtimeConfigState.userConfig
      ],
      configState: runtimeConfigState
    }
  const kiroPersistenceBoundary = runtimeAdapterType === 'kiro'
    ? createKiroPersistenceBoundary(resolvedRuntimeCtx.env)
    : undefined
  const runtimeCtx = kiroPersistenceBoundary == null
    ? resolvedRuntimeCtx
    : applyKiroPersistenceBoundary(resolvedRuntimeCtx, kiroPersistenceBoundary)
  const { logger, cache, ...base } = runtimeCtx

  const mergedModelServices = mergedConfig.modelServices ?? {}
  const serviceModels = listServiceModels(mergedModelServices)
  const mergedDefaultModelService = pickFirstNonEmptyString([mergedConfig.defaultModelService])
  const supportedEffortAdapters = new Set([
    'claude-code',
    'codex',
    'copilot',
    'dsh',
    'droid',
    'grok',
    'kiro',
    'junie',
    'kimi',
    'opencode',
    'pi'
  ])
  const supportsEffort = supportedEffortAdapters.has(runtimeAdapterType)
  const adapterCommonConfig = supportsEffort
    ? resolveAdapterCommonConfig<Record<string, unknown> & { effort?: AdapterQueryOptions['effort'] }, 'effort'>(
      adapterType,
      {
        mergedConfig
      },
      {
        extraCommonKeys: ['effort']
      }
    )
    : resolveAdapterCommonConfig(adapterType, {
      mergedConfig
    })
  const compatibilityResult = resolveAdapterModelCompatibility({
    adapter: runtimeAdapterType,
    model: resolvedSelection.model,
    adapterConfig: adapterCommonConfig,
    serviceModels,
    preferredServiceKey: mergedDefaultModelService,
    preserveUnknownDefaultModel: true
  })
  if (compatibilityResult.error) {
    throw new Error(formatAdapterModelFallbackError(compatibilityResult.error))
  }

  const loadAdapterStartedAt = startupProfiler.now()
  const adapter = await loadAdapter(adapterTarget.loadSpecifier)
  startupProfiler.mark('task.loadAdapter', loadAdapterStartedAt, {
    adapter: adapterType,
    runtimeAdapter: runtimeAdapterType
  })
  const sanitizeRuntimeArtifact = <T>(value: T): T => (
    adapter.sanitizeRuntimeArtifact?.(runtimeCtx, value) ?? value
  )
  const runtimeArtifactEnv = sanitizeRuntimeArtifact(runtimeCtx.env)
  const runtimeArtifactCtx = runtimeArtifactEnv === runtimeCtx.env
    ? runtimeCtx
    : { ...runtimeCtx, env: runtimeArtifactEnv }
  const cacheSetStartedAt = startupProfiler.now()
  await cache.set(
    'base',
    sanitizeTaskBaseForPersistence(sanitizeRuntimeArtifact(base), {
      cwd: ctx.cwd,
      kiroPersistenceBoundary,
      runtimeAdapterType
    })
  )
  startupProfiler.mark('task.cache.set.base', cacheSetStartedAt)
  const resolvedModel = compatibilityResult.model ?? resolvedSelection.model
  const selectionWarnings = compatibilityResult.warning != null ? [compatibilityResult.warning] : undefined
  if (!supportsEffort && effectiveAdapterOptions.effort != null) {
    throw new Error(`Adapter "${adapterType}" does not support effort`)
  }
  const { effort: resolvedEffort } = supportsEffort
    ? resolveEffectiveEffort({
      explicitEffort: effectiveAdapterOptions.effort,
      model: resolvedModel,
      adapterConfig: adapterCommonConfig,
      configEffort: mergedConfig.effort,
      models: mergedConfig.models
    })
    : { effort: undefined as undefined }
  setNonEmptyEnv(runtimeCtx.env, INHERITED_ADAPTER_ENV, adapterType)
  setNonEmptyEnv(runtimeCtx.env, INHERITED_MODEL_ENV, resolvedModel)
  setNonEmptyEnv(runtimeCtx.env, RUNTIME_DEFAULT_ADAPTER_ENV, adapterType)
  setNonEmptyEnv(runtimeCtx.env, RUNTIME_DEFAULT_MODEL_ENV, resolvedModel)
  setNonEmptyEnv(runtimeCtx.env, RUNTIME_DEFAULT_EFFORT_ENV, resolvedEffort)
  setNonEmptyEnv(runtimeCtx.env, RUNTIME_DEFAULT_PERMISSION_MODE_ENV, effectivePermissionMode)

  const originalOnEvent = effectiveAdapterOptions.onEvent
  const supportedAssetPlanAdapters = new Set<WorkspaceAssetAdapter>([
    'claude-code',
    'cline',
    'codex',
    'copilot',
    'cursor',
    'dsh',
    'droid',
    'gemini',
    'goose',
    'grok',
    'kiro',
    'junie',
    'kimi',
    'opencode',
    'pi',
    'qwen-code'
  ])
  const supportsAssetPlan = (value: string): value is WorkspaceAssetAdapter => (
    supportedAssetPlanAdapters.has(value as WorkspaceAssetAdapter)
  )
  const runtimeMcpServers = Object.fromEntries(
    Object.entries(effectiveAdapterOptions.runtimeMcpServers ?? {})
      .filter(([, server]) => server != null && server.enabled !== false)
      .map(([name, server]) => {
        const { enabled: _enabled, ...resolvedServer } = server as NonNullable<Config['mcpServers']>[string]
        return [name, resolvedServer]
      })
  ) as Record<string, NonNullable<Config['mcpServers']>[string]>
  const runtimeMcpSelection = splitRuntimeMcpSelection({
    assets: runtimeCtx.assets,
    runtimeServerNames: new Set(Object.keys(runtimeMcpServers)),
    selection: effectiveAdapterOptions.mcpServers
  })
  const shouldBuildAssetPlan = effectiveAdapterOptions.executionProfile !== 'structured_no_tools' &&
    runtimeCtx.assets != null && supportsAssetPlan(runtimeAdapterType)
  const selectedWorkspaceMcpServerNames = new Set(
    !shouldBuildAssetPlan || runtimeMcpSelection.excludeAllWorkspaceMcp
      ? []
      : resolveSelectedMcpNames(runtimeCtx.assets!, runtimeMcpSelection.workspaceSelection)
  )
  const assetPlanStartedAt = startupProfiler.now()
  const assetPlanBaseRaw = shouldBuildAssetPlan
    ? await buildAdapterAssetPlan({
      adapter: runtimeAdapterType,
      bundle: runtimeCtx.assets!,
      options: {
        mcpServers: runtimeMcpSelection.workspaceSelection,
        skills: effectiveAdapterOptions.skills,
        promptAssetIds: effectiveAdapterOptions.promptAssetIds
      }
    })
    : undefined
  startupProfiler.mark('task.buildAdapterAssetPlan', assetPlanStartedAt, {
    adapter: adapterType,
    runtimeAdapter: runtimeAdapterType
  })
  const workspaceMcpAssetIds = new Set(
    Object.values(runtimeCtx.assets?.mcpServers ?? {}).map(asset => asset.id)
  )
  const assetPlanBase = assetPlanBaseRaw == null || !runtimeMcpSelection.excludeAllWorkspaceMcp
    ? assetPlanBaseRaw
    : {
      ...assetPlanBaseRaw,
      mcpServers: {},
      diagnostics: assetPlanBaseRaw.diagnostics.filter(diagnostic => !workspaceMcpAssetIds.has(diagnostic.assetId))
    }
  const claimedWorkspaceMcpServerNames = runtimeAdapterType === 'kiro'
    ? selectedWorkspaceMcpServerNames
    : new Set(Object.keys(assetPlanBase?.mcpServers ?? {}))
  const selectedRuntimeMcpServers = Object.fromEntries(
    Object.entries(runtimeMcpServers)
      .filter(([name]) => (
        (runtimeMcpSelection.runtimeInclude == null || runtimeMcpSelection.runtimeInclude.has(name)) &&
        !runtimeMcpSelection.runtimeExclude.has(name)
      ))
  ) as Record<string, NonNullable<Config['mcpServers']>[string]>
  const supportsRuntimeMcpServer = (server: NonNullable<Config['mcpServers']>[string]) => (
    runtimeAdapterType !== 'pi' &&
    runtimeAdapterType !== 'dsh' &&
    runtimeAdapterType !== 'cline' &&
    (runtimeAdapterType !== 'goose' || server.type !== 'sse') &&
    (runtimeAdapterType !== 'kiro' || isStdioMcpServer(server))
  )
  const skippedRuntimeMcpServerNames = Object.entries(selectedRuntimeMcpServers)
    .filter(([, server]) => !supportsRuntimeMcpServer(server))
    .map(([name]) => name)
  const runtimeMcpSkipReason = (name: string) => (
    runtimeAdapterType === 'pi'
      ? `Session companion MCP "${name}" was skipped because Pi has no stable built-in MCP mapping.`
      : runtimeAdapterType === 'dsh'
      ? `Session companion MCP "${name}" was skipped because DSH ACP does not accept MCP servers.`
      : runtimeAdapterType === 'cline'
      ? `Session companion MCP "${name}" was skipped because Cline has no verified stable mapping.`
      : runtimeAdapterType === 'goose'
      ? `Session companion MCP "${name}" was skipped because Goose ACP does not support SSE transport.`
      : `Session companion MCP "${name}" was skipped because verified Kiro ACP supports only stdio transport.`
  )
  if (skippedRuntimeMcpServerNames.length > 0) {
    const message = runtimeAdapterType === 'pi'
      ? '[mcp] Skipping session companion MCP servers because pi has no verified stable mapping'
      : runtimeAdapterType === 'dsh'
      ? '[mcp] Skipping session companion MCP servers because DSH ACP does not accept MCP servers'
      : runtimeAdapterType === 'goose'
      ? '[mcp] Skipping SSE session companion MCP servers because Goose ACP does not support that transport'
      : runtimeAdapterType === 'kiro'
      ? '[mcp] Skipping non-stdio session companion MCP servers because verified Kiro ACP supports stdio only'
      : `[mcp] Skipping unsupported session companion MCP servers for ${runtimeAdapterType}`
    logger.warn({
      runtimeMcpServerNames: skippedRuntimeMcpServerNames
    }, message)
  }
  const runtimeMcpDiagnostics: AssetDiagnostic[] = skippedRuntimeMcpServerNames.map(name => ({
    assetId: `runtime-mcp:${name}`,
    adapter: runtimeAdapterType as WorkspaceAssetAdapter,
    status: 'skipped',
    reason: runtimeMcpSkipReason(name),
    source: 'project',
    origin: 'workspace'
  }))
  const shadowedRuntimeMcpServerNames = Object.keys(runtimeMcpServers)
    .filter(name => claimedWorkspaceMcpServerNames.has(name))
  if (shadowedRuntimeMcpServerNames.length > 0) {
    logger.warn({
      runtimeMcpServerNames: shadowedRuntimeMcpServerNames
    }, '[mcp] Ignoring session companion MCP servers that would shadow workspace MCP servers')
  }
  const effectiveRuntimeMcpServers = Object.fromEntries(
    Object.entries(selectedRuntimeMcpServers)
      .filter(([name, server]) => (
        !claimedWorkspaceMcpServerNames.has(name) && supportsRuntimeMcpServer(server)
      ))
  ) as Record<string, NonNullable<Config['mcpServers']>[string]>
  const assetPlanWithRuntimeDiagnostics = runtimeMcpDiagnostics.length === 0
    ? assetPlanBase
    : assetPlanBase == null
    ? {
      adapter: runtimeAdapterType as WorkspaceAssetAdapter,
      diagnostics: runtimeMcpDiagnostics,
      mcpServers: {},
      overlays: []
    }
    : { ...assetPlanBase, diagnostics: [...assetPlanBase.diagnostics, ...runtimeMcpDiagnostics] }
  const assetPlan = assetPlanWithRuntimeDiagnostics == null
    ? undefined
    : Object.keys(effectiveRuntimeMcpServers).length === 0
    ? assetPlanWithRuntimeDiagnostics
    : {
      ...assetPlanWithRuntimeDiagnostics,
      mcpServers: {
        ...assetPlanWithRuntimeDiagnostics.mcpServers,
        ...effectiveRuntimeMcpServers
      }
    }
  const adapterInitStartedAt = startupProfiler.now()
  await adapter.init?.(runtimeCtx)
  startupProfiler.mark('task.adapter.init', adapterInitStartedAt, {
    adapter: adapterType,
    runtimeAdapter: runtimeAdapterType
  })
  const nativeBridgeDisabledEvents: Array<keyof HookInputs> =
    runtimeAdapterType === 'codex' && runtimeCtx.env.__ONEWORKS_PROJECT_CODEX_NATIVE_HOOKS_AVAILABLE__ === '1'
      ? BASE_NATIVE_BRIDGE_DISABLED_EVENTS
      : runtimeAdapterType === 'claude-code' &&
          runtimeCtx.env.__ONEWORKS_PROJECT_CLAUDE_NATIVE_HOOKS_AVAILABLE__ === '1'
      ? BASE_NATIVE_BRIDGE_DISABLED_EVENTS
      : runtimeAdapterType === 'gemini' && runtimeCtx.env.__ONEWORKS_PROJECT_GEMINI_NATIVE_HOOKS_AVAILABLE__ === '1'
      ? BASE_NATIVE_BRIDGE_DISABLED_EVENTS
      : runtimeAdapterType === 'kimi' && runtimeCtx.env.__ONEWORKS_PROJECT_KIMI_NATIVE_HOOKS_AVAILABLE__ === '1'
      ? BASE_NATIVE_BRIDGE_DISABLED_EVENTS
      : runtimeAdapterType === 'copilot' && runtimeCtx.env.__ONEWORKS_PROJECT_COPILOT_NATIVE_HOOKS_AVAILABLE__ === '1'
      ? COPILOT_NATIVE_BRIDGE_DISABLED_EVENTS
      : runtimeAdapterType === 'cursor' && runtimeCtx.env.__ONEWORKS_PROJECT_CURSOR_NATIVE_HOOKS_AVAILABLE__ === '1'
      ? BASE_NATIVE_BRIDGE_DISABLED_EVENTS
      : runtimeAdapterType === 'droid' && runtimeCtx.env.__ONEWORKS_PROJECT_DROID_NATIVE_HOOKS_AVAILABLE__ === '1'
      ? DROID_NATIVE_BRIDGE_DISABLED_EVENTS
      : runtimeAdapterType === 'grok' && runtimeCtx.env.__ONEWORKS_PROJECT_GROK_NATIVE_HOOKS_AVAILABLE__ === '1'
      ? GROK_NATIVE_BRIDGE_DISABLED_EVENTS
      : runtimeAdapterType === 'kiro' && runtimeCtx.env.__ONEWORKS_PROJECT_KIRO_NATIVE_HOOKS_AVAILABLE__ === '1'
      ? BASE_NATIVE_BRIDGE_DISABLED_EVENTS
      : runtimeAdapterType === 'junie' && runtimeCtx.env.__ONEWORKS_PROJECT_JUNIE_NATIVE_HOOKS_AVAILABLE__ === '1'
      ? JUNIE_NATIVE_BRIDGE_DISABLED_EVENTS
      : runtimeAdapterType === 'qwen-code' &&
          runtimeCtx.env.__ONEWORKS_PROJECT_QWEN_CODE_NATIVE_HOOKS_AVAILABLE__ === '1'
      ? BASE_NATIVE_BRIDGE_DISABLED_EVENTS
      : runtimeAdapterType === 'opencode' && runtimeCtx.env.__ONEWORKS_PROJECT_OPENCODE_NATIVE_HOOKS_AVAILABLE__ === '1'
      ? OPENCODE_NATIVE_BRIDGE_DISABLED_EVENTS
      : []
  const hookRuntimeCtx = runtimeAdapterType === 'cline'
    ? { ...runtimeCtx, env: omitClineCredentialEnv(runtimeCtx.env) }
    : runtimeCtx
  const hookTaskOptions = runtimeAdapterType === 'cline' && options.env != null
    ? { ...options, env: omitClineCredentialEnv(options.env) }
    : options
  const createHookBoundary = <T>(input: T) => {
    const sanitizedInput = sanitizeRuntimeArtifact(input)
    const sanitizedEnv = sanitizeRuntimeArtifact(hookRuntimeCtx.env)
    return scrubCredentialGraphForPersistence({ env: sanitizedEnv, input: sanitizedInput })
  }
  const hookBridgeRuntimeCtx = sanitizeRuntimeArtifact(hookRuntimeCtx)
  const hookBridge = createAdapterHookBridge({
    ctx: hookBridgeRuntimeCtx,
    adapter: runtimeAdapterType,
    runtime: effectiveAdapterOptions.runtime,
    sessionId: effectiveAdapterOptions.sessionId,
    type: effectiveAdapterOptions.type,
    model: resolvedModel,
    disabledEvents: nativeBridgeDisabledEvents
  })
  const wrappedOnEvent = (event: AdapterOutputEvent) => {
    if (event.type === 'init') {
      originalOnEvent({
        ...event,
        data: {
          ...event.data,
          adapter: adapterType,
          effort: runtimeAdapterType === 'kiro' ? event.data.effort : resolvedEffort ?? event.data.effort,
          selectionWarnings: selectionWarnings ?? event.data.selectionWarnings,
          assetDiagnostics: assetPlan?.diagnostics ?? event.data.assetDiagnostics
        }
      })
      return
    }

    if (event.type === 'exit') {
      const { data } = event
      hookBridge.enqueueAfterPendingHooks(async () => {
        try {
          const boundary = createHookBoundary({
            adapter: adapterType,
            cwd: runtimeCtx.cwd,
            sessionId: effectiveAdapterOptions.sessionId,

            options: hookTaskOptions,
            adapterOptions: effectiveAdapterOptions,

            exitCode: data.exitCode,
            stderr: data.stderr
          })
          await callHook('TaskStop', boundary.input, boundary.env)
        } catch (e) {
          const boundary = scrubCredentialGraphForPersistence({
            env: runtimeCtx.env,
            error: e
          })
          logger.error('[Hook] TaskStop failed', boundary.error)
        }
      })
    }

    if (event.type !== 'operation') {
      hookBridge.handleOutput(event)
    }
    originalOnEvent(event)
  }

  const taskStartStartedAt = startupProfiler.now()
  const taskStartBoundary = createHookBoundary({
    adapter: adapterType,
    cwd: runtimeCtx.cwd,
    sessionId: effectiveAdapterOptions.sessionId,

    options: hookTaskOptions,
    adapterOptions: effectiveAdapterOptions
  })
  const taskStartOutput = await callHook(
    'TaskStart',
    taskStartBoundary.input,
    taskStartBoundary.env
  )
  startupProfiler.mark('task.hook.TaskStart', taskStartStartedAt, { adapter: adapterType })
  if (taskStartOutput?.continue === false) {
    throw new Error(taskStartOutput.stopReason ?? 'TaskStart hook blocked task startup')
  }
  const hookBridgeStartedAt = startupProfiler.now()
  await hookBridge.start()
  startupProfiler.mark('task.hookBridge.start', hookBridgeStartedAt, { adapter: adapterType })
  const initialPromptStartedAt = startupProfiler.now()
  const description = await hookBridge.prepareInitialPrompt(effectiveAdapterOptions.description)
  startupProfiler.mark('task.hookBridge.prepareInitialPrompt', initialPromptStartedAt, { adapter: adapterType })
  const queryStartedAt = startupProfiler.now()
  const session = await adapter.query(
    runtimeCtx,
    {
      ...effectiveAdapterOptions,
      assetPlan,
      description,
      effort: resolvedEffort,
      model: resolvedModel,
      onEvent: wrappedOnEvent
    }
  )
  startupProfiler.mark('task.adapter.query', queryStartedAt, { adapter: adapterType })
  const wrappedSession = hookBridge.wrapSession(session)
  const flushBridgeHooks = wrappedSession.flushHooks

  return {
    session: {
      ...wrappedSession,
      get pid() {
        return wrappedSession.pid
      },
      flushHooks: async () => {
        await flushBridgeHooks?.()
        await hookBridge.flush()
      }
    },
    ctx: runtimeCtx,
    resolvedAdapter: adapterType
  }
}
