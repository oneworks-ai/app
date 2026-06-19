import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { resolveConfigState } from '@oneworks/config'
import { NATIVE_HOOK_BRIDGE_ADAPTER_ENV } from '@oneworks/hooks'
import type { AdapterCtx, AdapterQueryOptions, Config } from '@oneworks/types'
import { resolveModelServiceConfig, resolveModelServiceModels, resolveProjectOoPath } from '@oneworks/utils'
import { ensureManagedNpmCli } from '@oneworks/utils/managed-npm-cli'

import { ensureClaudeCodeRouterReady } from '../ccr/daemon'
import { CLAUDE_CODE_CLI_PACKAGE, CLAUDE_CODE_CLI_VERSION, resolveClaudeCliPath } from '../ccr/paths'
import { resolveClaudeCodeAdapterConfig } from '../runtime-config'
import { stageClaudePluginDirs } from './plugins'

interface ClaudeExecutionSettings {
  [key: string]: unknown
  mcpServers: Record<string, unknown>
  permissions: {
    allow: string[]
    deny: string[]
    ask: string[]
    defaultMode?: AdapterQueryOptions['permissionMode']
  }
  defaultIncludeMcpServers: string[]
  defaultExcludeMcpServers: string[]
  plansDirectory: string
  env: Record<string, string | null | undefined>
  companyAnnouncements: string[]
}

interface PreparedClaudeExecution {
  cliPath: string
  args: string[]
  env: Record<string, string | null | undefined>
  cwd: string
  sessionId: string
  effort?: AdapterQueryOptions['effort']
  executionType: 'create' | 'resume'
}

const resolveCCRRequestLogContextPath = (
  cwd: string,
  env: Record<string, string | null | undefined>,
  sessionId: string
) =>
  resolveProjectOoPath(
    cwd,
    env as NodeJS.ProcessEnv,
    '.mock',
    '.claude-code-router',
    'request-log-context',
    `${sessionId}.json`
  )

const persistCCRRequestLogContext = async (params: {
  cwd: string
  ctxId: string
  env: Record<string, string | null | undefined>
  sessionId: string
}) => {
  const filePath = resolveCCRRequestLogContextPath(params.cwd, params.env, params.sessionId)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    JSON.stringify({
      ctxId: params.ctxId,
      sessionId: params.sessionId
    }),
    'utf8'
  )
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const deepMerge = (
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMerge(merged[key] as Record<string, unknown>, value)
      continue
    }
    merged[key] = value
  }
  return merged
}

const normalizeEffort = (value: unknown): AdapterQueryOptions['effort'] => (
  value === 'low' || value === 'medium' || value === 'high' || value === 'max'
    ? value
    : undefined
)

const uniqueStrings = (values: string[]) => [...new Set(values)]

const parseModelServiceModel = (value: unknown) => {
  if (typeof value !== 'string' || !value.includes(',')) return undefined
  const [serviceKey, modelName] = value.split(',').map(item => item.trim())
  return serviceKey !== '' && modelName !== '' ? { serviceKey, modelName } : undefined
}

type OfficialAnthropicProvider =
  | 'anthropic'
  | 'deepseek'
  | 'minimax'
  | 'moonshot-cn'
  | 'moonshot-intl'
  | 'openrouter'
  | 'portkey'
  | 'qwen'
  | 'requesty'
  | 'vercel-ai-gateway'
  | 'zhipu'

const OFFICIAL_ANTHROPIC_PROVIDER_HOSTS: Array<{
  match: (host: string) => boolean
  provider: OfficialAnthropicProvider
}> = [
  { match: host => host === 'api.anthropic.com', provider: 'anthropic' },
  { match: host => host === 'api.deepseek.com', provider: 'deepseek' },
  { match: host => host === 'api.minimax.io' || host === 'api.minimaxi.com', provider: 'minimax' },
  { match: host => host === 'api.moonshot.cn', provider: 'moonshot-cn' },
  { match: host => host === 'api.moonshot.ai', provider: 'moonshot-intl' },
  { match: host => host === 'openrouter.ai', provider: 'openrouter' },
  { match: host => host === 'api.portkey.ai', provider: 'portkey' },
  {
    match: host =>
      host === 'dashscope.aliyuncs.com' ||
      host === 'dashscope-intl.aliyuncs.com' ||
      host === 'dashscope-us.aliyuncs.com' ||
      host.endsWith('.dashscope.aliyuncs.com') ||
      host.endsWith('.maas.aliyuncs.com'),
    provider: 'qwen'
  },
  { match: host => host === 'router.requesty.ai', provider: 'requesty' },
  { match: host => host === 'ai-gateway.vercel.sh', provider: 'vercel-ai-gateway' },
  { match: host => host === 'open.bigmodel.cn', provider: 'zhipu' }
]

const OFFICIAL_ANTHROPIC_PROVIDERS = new Set<string>(
  OFFICIAL_ANTHROPIC_PROVIDER_HOSTS.map(entry => entry.provider)
)

const resolveOfficialAnthropicProvider = (
  provider: string | undefined,
  apiBaseUrl: string
): OfficialAnthropicProvider | undefined => {
  if (provider != null && OFFICIAL_ANTHROPIC_PROVIDERS.has(provider)) {
    return provider as OfficialAnthropicProvider
  }
  try {
    const host = new URL(apiBaseUrl).hostname.toLowerCase()
    return OFFICIAL_ANTHROPIC_PROVIDER_HOSTS.find(entry => entry.match(host))?.provider
  } catch {
    return undefined
  }
}

const trimKnownApiPath = (pathname: string) =>
  pathname
    .replace(/\/(?:v\d+\/)?(?:chat\/completions|responses|messages)\/?$/u, '')
    .replace(/\/compatible-mode\/v\d+\/?$/u, '')
    .replace(/\/api\/paas\/v\d+\/?$/u, '')
    .replace(/\/v\d+\/?$/u, '')
    .replace(/\/chat\/completions\/?$/u, '')
    .replace(/\/responses\/?$/u, '')
    .replace(/\/messages\/?$/u, '')
    .replace(/\/+$/u, '')

const formatUrl = (url: URL) => {
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/u, '')
}

const setPath = (apiBaseUrl: string, pathname: string) => {
  const url = new URL(apiBaseUrl)
  url.pathname = pathname
  return formatUrl(url)
}

const resolveAnthropicPathBaseUrl = (apiBaseUrl: string) => {
  const url = new URL(apiBaseUrl)
  const basePath = trimKnownApiPath(url.pathname)
  if (/\/anthropic$/u.test(basePath)) {
    url.pathname = basePath
  } else {
    url.pathname = `${basePath}/anthropic`
  }
  return formatUrl(url)
}

const resolveQwenAnthropicBaseUrl = (apiBaseUrl: string) => {
  const url = new URL(apiBaseUrl)
  const path = url.pathname.replace(/\/+$/u, '')
  const existingIndex = path.indexOf('/apps/anthropic')
  url.pathname = existingIndex >= 0
    ? path.slice(0, existingIndex + '/apps/anthropic'.length)
    : '/apps/anthropic'
  return formatUrl(url)
}

const resolveOpenRouterAnthropicBaseUrl = (apiBaseUrl: string) => {
  const url = new URL(apiBaseUrl)
  url.pathname = '/api'
  return formatUrl(url)
}

const resolveRootAnthropicBaseUrl = (apiBaseUrl: string) => {
  const url = new URL(apiBaseUrl)
  url.pathname = trimKnownApiPath(url.pathname)
  return formatUrl(url)
}

const resolveOfficialAnthropicBaseUrl = (
  provider: OfficialAnthropicProvider,
  apiBaseUrl: string
) => {
  if (provider === 'qwen') return resolveQwenAnthropicBaseUrl(apiBaseUrl)
  if (provider === 'zhipu') return setPath(apiBaseUrl, '/api/anthropic')
  if (provider === 'openrouter') return resolveOpenRouterAnthropicBaseUrl(apiBaseUrl)
  if (provider === 'requesty' || provider === 'vercel-ai-gateway' || provider === 'portkey') {
    return resolveRootAnthropicBaseUrl(apiBaseUrl)
  }
  if (provider === 'anthropic') return setPath(apiBaseUrl, '')
  return resolveAnthropicPathBaseUrl(apiBaseUrl)
}

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const getExtraRecord = (extra: Record<string, unknown> | undefined, key: string) => (
  isPlainObject(extra?.[key]) ? extra[key] as Record<string, unknown> : {}
)

const resolveOfficialAnthropicModelService = (
  model: unknown,
  modelServices: Config['modelServices']
) => {
  const selection = parseModelServiceModel(model)
  if (selection == null) return undefined
  const configuredService = modelServices?.[selection.serviceKey]
  const resolved = resolveModelServiceConfig(configuredService).service
  if (resolved == null) return undefined
  const provider = resolveOfficialAnthropicProvider(resolved.provider, resolved.apiBaseUrl)
  if (provider == null) return undefined
  return {
    apiKey: resolved.apiKey,
    baseUrl: resolveOfficialAnthropicBaseUrl(provider, resolved.apiBaseUrl),
    extra: resolved.extra,
    model: selection.modelName,
    models: resolveModelServiceModels(resolved),
    provider
  }
}

const buildOfficialAnthropicEnv = (
  service: NonNullable<ReturnType<typeof resolveOfficialAnthropicModelService>>,
  currentEnv: Record<string, string | null | undefined>
) => {
  const claudeCodeExtra = getExtraRecord(service.extra, 'claudeCode')
  const providerExtra = getExtraRecord(service.extra, service.provider)
  const customHeaders = normalizeString(
    claudeCodeExtra.anthropicCustomHeaders ??
      claudeCodeExtra.customHeaders ??
      providerExtra.anthropicCustomHeaders ??
      providerExtra.customHeaders
  )
  const portkeyProvider = normalizeString(
    claudeCodeExtra.portkeyProvider ??
      providerExtra.provider ??
      providerExtra.portkeyProvider
  )
  const isZhipuLongContextModel = service.provider === 'zhipu' && /\[1m\]/iu.test(service.model)
  const zhipuHaikuModel = service.provider === 'zhipu' && service.model !== 'glm-4.5-air' &&
      service.models?.includes('glm-4.5-air')
    ? 'glm-4.5-air'
    : service.model

  return {
    ANTHROPIC_BASE_URL: service.baseUrl,
    ...(service.provider === 'anthropic'
      ? {
        ANTHROPIC_API_KEY: service.apiKey,
        ANTHROPIC_AUTH_TOKEN: ''
      }
      : {
        ANTHROPIC_AUTH_TOKEN: service.apiKey,
        ANTHROPIC_API_KEY: ''
      }),
    ANTHROPIC_MODEL: service.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: service.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: service.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: zhipuHaikuModel,
    CLAUDE_CODE_SUBAGENT_MODEL: service.model,
    ...(service.provider === 'moonshot-cn' || service.provider === 'moonshot-intl'
      ? {
        ENABLE_TOOL_SEARCH: currentEnv.ENABLE_TOOL_SEARCH ?? 'false',
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: currentEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW ?? '262144'
      }
      : {}),
    ...(service.provider === 'minimax'
      ? {
        API_TIMEOUT_MS: currentEnv.API_TIMEOUT_MS ?? '3000000',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: currentEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ?? '1',
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: currentEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW ?? '512000'
      }
      : {}),
    ...(service.provider === 'zhipu'
      ? {
        ENABLE_TOOL_SEARCH: currentEnv.ENABLE_TOOL_SEARCH ?? '0',
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: currentEnv.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS ?? '1',
        ...(isZhipuLongContextModel
          ? { CLAUDE_CODE_AUTO_COMPACT_WINDOW: currentEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW ?? '1000000' }
          : {})
      }
      : {}),
    ...(service.provider === 'portkey' && (customHeaders != null || portkeyProvider != null)
      ? {
        ANTHROPIC_CUSTOM_HEADERS: customHeaders ??
          `x-portkey-api-key: ${service.apiKey}\nx-portkey-provider: ${portkeyProvider}`
      }
      : {})
  }
}

export const prepareClaudeExecution = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<PreparedClaudeExecution> => {
  const { env, cwd, cache } = ctx
  const { mergedConfig } = resolveConfigState({
    configState: ctx.configState,
    configs: ctx.configs
  })
  const { common: commonConfig, native: nativeConfig } = resolveClaudeCodeAdapterConfig(ctx)
  const assetPlan = options.assetPlan
  const nativeHooksAvailable = env.__ONEWORKS_PROJECT_CLAUDE_NATIVE_HOOKS_AVAILABLE__ === '1'
  const {
    effort,
    description,
    sessionId,
    model,
    type,
    systemPrompt,
    appendSystemPrompt = true,
    permissionMode,
    mcpServers: inputMCPServersRule,
    tools: inputToolsRule
  } = options
  const resumeState = await cache.get('adapter.claude-code.resume-state')
  const executionType = type === 'resume'
    ? resumeState?.canResume === false
      ? 'create'
      : 'resume'
    : 'create'
  const requestedEffort = effort ?? commonConfig.effort
  const settingsContent = isPlainObject(nativeConfig.settingsContent)
    ? nativeConfig.settingsContent
    : {}
  const nativeEnv = isPlainObject(nativeConfig.nativeEnv)
    ? Object.fromEntries(
      Object.entries(nativeConfig.nativeEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    )
    : {}
  const nativeEnvEffort = normalizeEffort(nativeEnv.CLAUDE_CODE_EFFORT_LEVEL)
  const settingsContentEffort = normalizeEffort(settingsContent.effortLevel)

  let settings: ClaudeExecutionSettings = {
    mcpServers: assetPlan?.mcpServers ?? {
      ...(mergedConfig.mcpServers ?? {})
    },
    permissions: {
      allow: [...(mergedConfig.permissions?.allow ?? [])],
      deny: [...(mergedConfig.permissions?.deny ?? [])],
      ask: [...(mergedConfig.permissions?.ask ?? [])],
      defaultMode: permissionMode ??
        mergedConfig.permissions?.defaultMode
    },
    defaultIncludeMcpServers: [...(mergedConfig.defaultIncludeMcpServers ?? [])],
    defaultExcludeMcpServers: [...(mergedConfig.defaultExcludeMcpServers ?? [])],
    plansDirectory: resolveProjectOoPath(cwd, env, 'works'),
    env: {
      ...(mergedConfig.env ?? {}),
      ...(nativeHooksAvailable
        ? {
          __ONEWORKS_CLAUDE_HOOKS_ACTIVE__: '1',
          [NATIVE_HOOK_BRIDGE_ADAPTER_ENV]: 'claude-code',
          __ONEWORKS_CLAUDE_HOOK_RUNTIME__: options.runtime,
          __ONEWORKS_CLAUDE_TASK_SESSION_ID__: sessionId
        }
        : {})
    } as Record<string, string | null | undefined>,
    companyAnnouncements: [...(mergedConfig.announcements ?? [])]
  }
  if (
    nativeEnvEffort == null &&
    settingsContentEffort == null &&
    (requestedEffort === 'low' || requestedEffort === 'medium' || requestedEffort === 'high')
  ) {
    settings = {
      ...settings,
      effortLevel: requestedEffort
    }
  }
  settings = deepMerge(settings, settingsContent) as ClaudeExecutionSettings
  const officialAnthropicService = resolveOfficialAnthropicModelService(model, mergedConfig.modelServices)
  const useCCR = officialAnthropicService == null && typeof model === 'string' && model.includes(',')
  if (useCCR) {
    const router = await ensureClaudeCodeRouterReady(ctx)
    settings.env = {
      ...settings.env,
      ANTHROPIC_BASE_URL: `http://${router.host}:${router.port}`,
      ANTHROPIC_AUTH_TOKEN: router.apiKey,
      ANTHROPIC_API_KEY: '',
      API_TIMEOUT_MS: String(router.apiTimeoutMs)
    }
    await persistCCRRequestLogContext({
      cwd,
      ctxId: ctx.ctxId,
      env: ctx.env,
      sessionId
    })
  }
  if (officialAnthropicService != null) {
    settings.env = {
      ...settings.env,
      ...buildOfficialAnthropicEnv(officialAnthropicService, settings.env)
    }
  }
  const { mcpServers, ...unresolvedSettings } = settings
  unresolvedSettings.permissions.allow = [
    ...(unresolvedSettings.permissions.allow ?? []),
    ...(inputToolsRule?.include ?? [])
  ]
  unresolvedSettings.permissions.deny = [
    ...(unresolvedSettings.permissions.deny ?? []),
    ...(inputToolsRule?.exclude ?? [])
  ]

  if (options.runtime === 'server') {
    unresolvedSettings.permissions.allow = (unresolvedSettings.permissions.allow ?? [])
      .filter(name => name !== 'AskUserQuestion')
    unresolvedSettings.permissions.deny = uniqueStrings([
      ...(unresolvedSettings.permissions.deny ?? []),
      'AskUserQuestion'
    ])
  }

  const includeMcpServers = inputMCPServersRule?.include ?? settings.defaultIncludeMcpServers
  const excludeMcpServers = inputMCPServersRule?.exclude ?? settings.defaultExcludeMcpServers
  if ((includeMcpServers?.length ?? 0) > 0) {
    Object.keys(mcpServers).forEach((key) => {
      if (!includeMcpServers?.includes(key)) {
        delete mcpServers[key]
      }
    })
  }
  if ((excludeMcpServers?.length ?? 0) > 0) {
    Object.keys(mcpServers).forEach((key) => {
      if (excludeMcpServers?.includes(key)) {
        delete mcpServers[key]
      }
    })
  }

  const { cachePath: mcpCachePath } = await cache.set(
    'adapter.claude-code.mcp',
    { mcpServers }
  )
  const { cachePath: settingsCachePath } = await cache.set(
    'adapter.claude-code.settings',
    settings
  )
  const pluginDirs = await stageClaudePluginDirs({
    cwd,
    ctxId: ctx.ctxId,
    env: ctx.env,
    sessionId
  })

  const args: string[] = [
    ...(description
      ? [JSON.stringify(
        `${(
          description?.trimStart().startsWith('-') ? '\0' : ''
        )}${(
          description.replace(/`/g, "'")
        )}`
      )]
      : []),
    '--mcp-config',
    mcpCachePath,
    '--settings',
    settingsCachePath,
    ...pluginDirs.flatMap(pluginDir => ['--plugin-dir', pluginDir])
  ].filter((a) => typeof a === 'string')

  if (permissionMode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions')
  } else if (
    permissionMode != null &&
    permissionMode !== 'default'
  ) {
    args.push('--permission-mode', permissionMode)
  }

  if (executionType === 'create') {
    args.push('--session-id', sessionId)
  } else {
    args.push('--resume', sessionId)
  }

  const cliModel = officialAnthropicService?.model ?? model
  if (cliModel != null && cliModel !== '') args.push('--model', cliModel)

  if (systemPrompt != null && systemPrompt !== '') {
    args.push(
      appendSystemPrompt ? '--append-system-prompt' : '--system-prompt',
      systemPrompt.replace(/`/g, "'")
    )
  }

  const executionEnv: Record<string, string | null | undefined> = {
    ...env,
    ...(
      requestedEffort === 'max' &&
        nativeEnvEffort == null &&
        settingsContentEffort == null
        ? { CLAUDE_CODE_EFFORT_LEVEL: 'max' }
        : {}
    ),
    ...nativeEnv,
    ...(nativeHooksAvailable
      ? {
        __ONEWORKS_CLAUDE_HOOKS_ACTIVE__: '1',
        [NATIVE_HOOK_BRIDGE_ADAPTER_ENV]: 'claude-code',
        __ONEWORKS_CLAUDE_HOOK_RUNTIME__: options.runtime,
        __ONEWORKS_CLAUDE_TASK_SESSION_ID__: sessionId
      }
      : {})
  }

  const cliPath = await ensureManagedNpmCli({
    adapterKey: 'claude_code',
    binaryName: 'claude',
    bundledPath: resolveClaudeCliPath(cwd, executionEnv, nativeConfig.cli),
    config: nativeConfig.cli,
    cwd,
    defaultPackageName: CLAUDE_CODE_CLI_PACKAGE,
    defaultVersion: CLAUDE_CODE_CLI_VERSION,
    env: executionEnv,
    logger: ctx.logger
  })
  ctx.env.__ONEWORKS_PROJECT_ADAPTER_CLAUDE_CODE_CLI_PATH__ = cliPath

  return {
    cliPath,
    args,
    env: executionEnv,
    cwd,
    sessionId,
    effort: nativeEnvEffort ?? settingsContentEffort ?? requestedEffort,
    executionType
  }
}
