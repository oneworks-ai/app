import { resolveAdapterCommonConfig, resolveConfigState, resolveRuntimeAdapterConfigState } from '@oneworks/config'
import { callHook, createAdapterHookBridge } from '@oneworks/hooks'
import type { HookInputs } from '@oneworks/hooks'
import type {
  AdapterCtx,
  AdapterModelFallbackError,
  AdapterOutputEvent,
  AdapterQueryOptions,
  Config,
  TaskDetail,
  WorkspaceAssetAdapter
} from '@oneworks/types'
import { loadAdapter, resolveAdapterRuntimeTarget } from '@oneworks/types'
import {
  createStartupProfiler,
  listServiceModels,
  nowStartupMs,
  resolveAdapterModelCompatibility,
  resolveEffectiveEffort
} from '@oneworks/utils'
import { buildAdapterAssetPlan } from '@oneworks/workspace-assets'

import { prepare } from './prepare'
import { resolveQuerySelection } from './query-selection'
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

  return {
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
  const runtimeCtx: AdapterCtx = runtimeConfigState === configState
    ? ctx
    : {
      ...ctx,
      configs: [
        runtimeConfigState.effectiveProjectConfig ?? runtimeConfigState.projectConfig,
        runtimeConfigState.userConfig
      ],
      configState: runtimeConfigState
    }
  const { logger, cache, ...base } = runtimeCtx

  const cacheSetStartedAt = startupProfiler.now()
  await cache.set('base', base)
  startupProfiler.mark('task.cache.set.base', cacheSetStartedAt)

  const mergedModelServices = mergedConfig.modelServices ?? {}
  const serviceModels = listServiceModels(mergedModelServices)
  const mergedDefaultModelService = pickFirstNonEmptyString([mergedConfig.defaultModelService])
  const supportedEffortAdapters = new Set(['claude-code', 'codex', 'copilot', 'kimi', 'opencode'])
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
    'codex',
    'copilot',
    'gemini',
    'kimi',
    'opencode'
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
  const assetPlanStartedAt = startupProfiler.now()
  const assetPlanBaseRaw = runtimeCtx.assets == null || !supportsAssetPlan(runtimeAdapterType)
    ? undefined
    : await buildAdapterAssetPlan({
      adapter: runtimeAdapterType,
      bundle: runtimeCtx.assets,
      options: {
        mcpServers: runtimeMcpSelection.workspaceSelection,
        skills: effectiveAdapterOptions.skills,
        promptAssetIds: effectiveAdapterOptions.promptAssetIds
      }
    })
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
  const selectedRuntimeMcpServers = Object.fromEntries(
    Object.entries(runtimeMcpServers)
      .filter(([name]) => (
        (runtimeMcpSelection.runtimeInclude == null || runtimeMcpSelection.runtimeInclude.has(name)) &&
        !runtimeMcpSelection.runtimeExclude.has(name)
      ))
  ) as Record<string, NonNullable<Config['mcpServers']>[string]>
  const workspaceMcpServerNames = new Set(Object.keys(assetPlanBase?.mcpServers ?? {}))
  const shadowedRuntimeMcpServerNames = Object.keys(selectedRuntimeMcpServers)
    .filter(name => workspaceMcpServerNames.has(name))
  if (shadowedRuntimeMcpServerNames.length > 0) {
    logger.warn({
      runtimeMcpServerNames: shadowedRuntimeMcpServerNames
    }, '[mcp] Ignoring session companion MCP servers that would shadow workspace MCP servers')
  }
  const effectiveRuntimeMcpServers = Object.fromEntries(
    Object.entries(selectedRuntimeMcpServers)
      .filter(([name]) => !workspaceMcpServerNames.has(name))
  ) as Record<string, NonNullable<Config['mcpServers']>[string]>
  const assetPlan = assetPlanBase == null
    ? undefined
    : Object.keys(effectiveRuntimeMcpServers).length === 0
    ? assetPlanBase
    : {
      ...assetPlanBase,
      mcpServers: {
        ...assetPlanBase.mcpServers,
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
      : runtimeAdapterType === 'opencode' && runtimeCtx.env.__ONEWORKS_PROJECT_OPENCODE_NATIVE_HOOKS_AVAILABLE__ === '1'
      ? OPENCODE_NATIVE_BRIDGE_DISABLED_EVENTS
      : []
  const hookBridge = createAdapterHookBridge({
    ctx: runtimeCtx,
    adapter: runtimeAdapterType,
    runtime: effectiveAdapterOptions.runtime,
    sessionId: effectiveAdapterOptions.sessionId,
    type: effectiveAdapterOptions.type,
    model: resolvedModel,
    disabledEvents: nativeBridgeDisabledEvents
  })
  let taskStopQueue = Promise.resolve()
  const wrappedOnEvent = (event: AdapterOutputEvent) => {
    hookBridge.handleOutput(event)

    if (event.type === 'init') {
      originalOnEvent({
        ...event,
        data: {
          ...event.data,
          adapter: adapterType,
          effort: resolvedEffort ?? event.data.effort,
          selectionWarnings: selectionWarnings ?? event.data.selectionWarnings,
          assetDiagnostics: assetPlan?.diagnostics ?? event.data.assetDiagnostics
        }
      })
      return
    }

    if (event.type === 'exit') {
      const { data } = event

      taskStopQueue = taskStopQueue
        .catch((e) => {
          logger.error('[Hook] TaskStop queue failed', e)
        })
        .then(async () => {
          await callHook('TaskStop', {
            adapter: adapterType,
            cwd: runtimeCtx.cwd,
            sessionId: effectiveAdapterOptions.sessionId,

            options,
            adapterOptions: effectiveAdapterOptions,

            exitCode: data.exitCode,
            stderr: data.stderr
          }, runtimeCtx.env)
        })
        .catch((e) => {
          logger.error('[Hook] TaskStop failed', e)
        })
    }
    originalOnEvent(event)
  }

  const taskStartStartedAt = startupProfiler.now()
  const taskStartOutput = await callHook('TaskStart', {
    adapter: adapterType,
    cwd: runtimeCtx.cwd,
    sessionId: effectiveAdapterOptions.sessionId,

    options,
    adapterOptions: effectiveAdapterOptions
  }, runtimeCtx.env)
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
        await taskStopQueue
      }
    },
    ctx: runtimeCtx,
    resolvedAdapter: adapterType
  }
}
