/* eslint-disable max-lines -- Qwen's isolated filesystem and provider projection stay auditable together. */
import { Buffer } from 'node:buffer'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import { NATIVE_HOOK_BRIDGE_ADAPTER_ENV } from '@oneworks/hooks'
import type { AdapterCtx, AdapterMessageContent, AdapterQueryOptions, Config } from '@oneworks/types'
import {
  isCredentialBearingKey,
  omitAdapterCommonConfig,
  parseServiceModelSelector,
  resolveModelProviderIdentity,
  resolveModelServiceConfig,
  resolveModelServiceFromMap,
  resolveProjectOoPath,
  syncSymlinkTarget
} from '@oneworks/utils'
import type { resolveModelServiceApiProtocol } from '@oneworks/utils'
import type { ManagedNpmCliConfig } from '@oneworks/utils/managed-npm-cli'

import { resolveQwenCodeBinaryPath } from '../paths'
import type { QwenNativeHooksSettings } from './native-hooks'
import { buildQwenNativeHooksSettings } from './native-hooks'
import { createQwenRuntimeRedactor } from './redaction'

export interface QwenCodeAdapterConfig {
  cli?: ManagedNpmCliConfig
  disableAutoUpdate?: boolean
  disableExtensions?: boolean
  disableSubagents?: boolean
  nativePromptCommands?: 'allow' | 'reject'
  settingsContent?: Record<string, unknown>
  telemetry?: 'inherit' | 'off'
}

export interface QwenPreparedSession {
  binaryPath: string
  cliModel?: string
  qwenHome: string
  runtimeDir: string
  spawnEnv: Record<string, string>
}

type ApprovalMode = 'auto-edit' | 'auto' | 'default' | 'plan' | 'yolo'

const ROUTED_PROVIDER_ID = 'openai'
const ROUTED_API_KEY_ENV = 'OPENAI_API_KEY'
const MAX_STDIN_BYTES = 8 * 1024 * 1024
const FORBIDDEN_EXTRA_OPTIONS = [
  '-i',
  '-m',
  '-p',
  '-r',
  '-s',
  '--approval-mode',
  '--continue',
  '--delete-session',
  '--extensions',
  '--include-directories',
  '--include-partial-messages',
  '--list-extensions',
  '--list-sessions',
  '--model',
  '--output-format',
  '--prompt',
  '--prompt-interactive',
  '--resume',
  '--sandbox',
  '--system-prompt',
  '--append-system-prompt',
  '--yolo'
] as const
const FORBIDDEN_PROMPT_PREFIX = /^\/(?![/*])/u
const FORBIDDEN_AT_REFERENCE = /(?:^|[\s(])@(?:\/|\.{1,2}\/|~\/|[a-z]:[\\/])/imu

const asRecord = (value: unknown): Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const deepMerge = (
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> => {
  const result = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const current = result[key]
    result[key] = value != null && typeof value === 'object' && !Array.isArray(value) &&
        current != null && typeof current === 'object' && !Array.isArray(current)
      ? deepMerge(asRecord(current), asRecord(value))
      : value
  }
  return result
}

const toProcessEnv = (env: Record<string, string | null | undefined>) => (
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
)

const QWEN_CHILD_CREDENTIAL_ENV_ALLOWLIST = new Set([ROUTED_API_KEY_ENV])

/**
 * Qwen receives normal project/runtime variables (including PATH, locale, and proxy settings),
 * but unrelated ambient credential namespaces are not inherited. The verified OpenAI key is the
 * sole credential variable bridged to the 0.21.11 child process.
 */
export const filterQwenChildInheritedEnv = (env: AdapterCtx['env']) =>
  Object.fromEntries(
    Object.entries(env).filter(([key]) => (
      !isCredentialBearingKey(key) || QWEN_CHILD_CREDENTIAL_ENV_ALLOWLIST.has(key)
    ))
  )

export const resolveQwenCodeAdapterConfig = (
  ctx: Pick<AdapterCtx, 'configState' | 'configs'>
): QwenCodeAdapterConfig => {
  const merged = ctx.configState?.mergedConfig.adapters?.['qwen-code']
  if (merged != null) {
    return omitAdapterCommonConfig(merged as Record<string, unknown>) as QwenCodeAdapterConfig
  }
  return omitAdapterCommonConfig(deepMerge(
    asRecord(ctx.configs[0]?.adapters?.['qwen-code']),
    asRecord(ctx.configs[1]?.adapters?.['qwen-code'])
  )) as QwenCodeAdapterConfig
}

export const resolveRealQwenHome = (ctx: Pick<AdapterCtx, 'env'>) => {
  const explicit = normalizeString(ctx.env.QWEN_HOME) ?? normalizeString(process.env.QWEN_HOME)
  if (explicit != null) return explicit
  const realHome = normalizeString(ctx.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    normalizeString(process.env.HOME) ?? normalizeString(process.env.USERPROFILE)
  if (realHome == null) throw new Error('Qwen Code adapter could not resolve the real user home directory.')
  return resolve(realHome, '.qwen')
}

export const resolveQwenSessionRoots = (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  sessionId: string
}) => {
  const root = resolveProjectOoPath(
    params.ctx.cwd,
    params.ctx.env,
    'caches',
    'adapter-qwen-code',
    'sessions',
    params.sessionId
  )
  return {
    qwenHome: resolve(root, 'home'),
    runtimeDir: resolve(root, 'runtime')
  }
}

const sanitizeGenerationConfig = (value: unknown) => {
  const source = asRecord(value)
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !['customHeaders', 'extra_body', 'extraBody'].includes(key))
  )
}

const sanitizeProvider = (value: unknown) => {
  const source = asRecord(value)
  const allowedKeys = [
    'id',
    'name',
    'description',
    'envKey',
    'baseUrl',
    'capabilities',
    'models',
    'generationConfig'
  ] as const
  return Object.fromEntries(allowedKeys.flatMap((key) => {
    if (!(key in source)) return []
    return [[key, key === 'generationConfig' ? sanitizeGenerationConfig(source[key]) : source[key]]]
  }))
}

const readSafeBaseSettings = async (ctx: Pick<AdapterCtx, 'env' | 'logger'>) => {
  const realQwenHome = resolveRealQwenHome(ctx)
  const settingsPath = resolve(realQwenHome, 'settings.json')
  const redactor = createQwenRuntimeRedactor({ env: ctx.env, qwenHome: realQwenHome })
  try {
    const source = asRecord(JSON.parse(await readFile(settingsPath, 'utf8')))
    const security = asRecord(source.security)
    const auth = asRecord(security.auth)
    const model = asRecord(source.model)
    const providers = asRecord(source.modelProviders)
    const selectedType = normalizeString(auth.selectedType)
    const supportedSelectedType = selectedType != null &&
        ['openai', 'anthropic', 'gemini', 'vertex-ai', 'qwen-oauth'].includes(selectedType)
      ? selectedType
      : undefined
    return {
      ...(source.$version == null ? {} : { $version: source.$version }),
      ...(supportedSelectedType == null
        ? {}
        : { security: { auth: { selectedType: supportedSelectedType } } }),
      ...(normalizeString(model.name) == null ? {} : { model: { name: model.name } }),
      modelProviders: Object.fromEntries(
        Object.entries(providers).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.map(sanitizeProvider) : []
        ])
      ),
      providerProtocol: asRecord(source.providerProtocol)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      ctx.logger.warn(
        '[qwen-code config] ignoring unreadable real settings.json',
        redactor.unknown({ settingsPath, error })
      )
    }
    return {}
  }
}

const resolveMergedModelServices = (ctx: Pick<AdapterCtx, 'configState' | 'configs'>) => (
  ctx.configState?.mergedConfig.modelServices ?? {
    ...(ctx.configs[0]?.modelServices ?? {}),
    ...(ctx.configs[1]?.modelServices ?? {})
  }
)

const normalizeApiBaseUrl = (value: string) =>
  value
    .replace(/\/(?:chat\/completions|messages|responses)\/?$/u, '')
    .replace(/\/+$/u, '')

const validateSettingsContent = (settingsContent: Record<string, unknown> | undefined) => {
  if (settingsContent == null) return
  if ('modelProviders' in settingsContent || 'providerProtocol' in settingsContent) {
    throw new Error(
      'Qwen Code adapter settingsContent cannot configure model providers. Use an OpenAI Chat Completions model service selector.'
    )
  }
  if (Object.keys(asRecord(asRecord(settingsContent.security).auth)).length > 0) {
    throw new Error(
      'Qwen Code adapter settingsContent cannot select or configure authentication providers.'
    )
  }
}

const mapProtocol = (protocol: ReturnType<typeof resolveModelServiceApiProtocol>) => {
  if (protocol === 'openai-chat-completions') return 'openai' as const
  throw new Error(
    `Qwen Code 0.21.11 routed models require explicit OpenAI Chat Completions protocol; received ${
      protocol ?? 'no apiProtocol'
    }.`
  )
}

const validateRoutedBaseUrl = (value: unknown) => {
  const normalized = normalizeString(value)
  if (normalized == null) throw new Error('Qwen Code routed model service requires a non-empty apiBaseUrl.')
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error('Qwen Code routed model service apiBaseUrl must be an absolute HTTP(S) URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Qwen Code routed model service apiBaseUrl must use HTTP or HTTPS.')
  }
  return normalized
}

const buildRoutedModel = (params: {
  ctx: Pick<AdapterCtx, 'configState' | 'configs'>
  rawModel?: string
}) => {
  const parsed = parseServiceModelSelector(params.rawModel)
  if (parsed == null) {
    if (params.rawModel?.includes(',') === true) {
      throw new Error('Qwen Code routed model selector requires a non-empty service key and model name.')
    }
    return undefined
  }
  const service = resolveModelServiceFromMap(resolveMergedModelServices(params.ctx), parsed.serviceKey)
  if (service == null) {
    throw new Error(`Qwen Code adapter could not find model service "${parsed.serviceKey}".`)
  }
  const resolved = resolveModelServiceConfig(service, ['modelServices', parsed.serviceKey]).service
  if (resolved == null) {
    throw new Error(`Qwen Code adapter could not resolve model service "${parsed.serviceKey}".`)
  }
  if (normalizeString(parsed.modelName) == null) {
    throw new Error('Qwen Code routed model selector requires a non-empty model name.')
  }
  if (normalizeString(resolved.apiKey) == null) {
    throw new Error(`Qwen Code routed model service "${parsed.serviceKey}" requires an API key.`)
  }
  const provider = resolveModelProviderIdentity(resolved)
  if (provider.confidence !== 'configured' || provider.provider !== ROUTED_PROVIDER_ID) {
    throw new Error(
      `Qwen Code routed model service "${parsed.serviceKey}" requires provider "${ROUTED_PROVIDER_ID}".`
    )
  }
  const protocol = mapProtocol(resolved.apiProtocol)
  return {
    apiKey: resolved.apiKey,
    cliModel: parsed.modelName,
    providerId: ROUTED_PROVIDER_ID,
    protocol,
    provider: {
      id: parsed.modelName,
      name: 'One Works session model service',
      envKey: ROUTED_API_KEY_ENV,
      baseUrl: normalizeApiBaseUrl(validateRoutedBaseUrl(resolved.apiBaseUrl))
    }
  }
}

const translateMcpServer = (server: NonNullable<Config['mcpServers']>[string]) => {
  if (server.type === 'sse') {
    return { url: server.url, ...(server.headers == null ? {} : { headers: server.headers }) }
  }
  if (server.type === 'http') {
    return { httpUrl: server.url, ...(server.headers == null ? {} : { headers: server.headers }) }
  }
  return {
    command: server.command,
    ...(server.args == null ? {} : { args: server.args }),
    ...(server.env == null ? {} : { env: server.env })
  }
}

const syncSkills = async (params: {
  overlays: NonNullable<AdapterQueryOptions['assetPlan']>['overlays']
  qwenHome: string
}) => {
  const skillsDir = resolve(params.qwenHome, 'skills')
  await rm(skillsDir, { recursive: true, force: true })
  const overlays = params.overlays.filter(overlay => overlay.kind === 'skill')
  if (overlays.length === 0) return
  await mkdir(skillsDir, { recursive: true })
  for (const overlay of overlays) {
    const targetName = overlay.targetPath.replace(/^skills\//u, '').replaceAll('/', '__')
    if (targetName === '' || targetName === '.' || targetName === '..') continue
    await syncSymlinkTarget({
      sourcePath: overlay.sourcePath,
      targetPath: resolve(skillsDir, targetName),
      type: 'dir'
    })
  }
}

const writeSystemPrompt = async (params: {
  qwenHome: string
  systemPrompt?: string
}) => {
  const promptPath = resolve(params.qwenHome, 'ONEWORKS.md')
  await rm(promptPath, { force: true })
  if (params.systemPrompt == null || params.systemPrompt.trim() === '') return undefined
  await writeFile(promptPath, params.systemPrompt, { encoding: 'utf8', mode: 0o600 })
  return promptPath
}

const buildSettings = async (params: {
  adapterConfig: QwenCodeAdapterConfig
  ctx: Pick<AdapterCtx, 'env' | 'logger'>
  mcpServers: Record<string, NonNullable<Config['mcpServers']>[string]>
  nativeHooks: QwenNativeHooksSettings
  promptPath?: string
  routedModel?: ReturnType<typeof buildRoutedModel>
  noTools: boolean
}) => {
  const inherited = await readSafeBaseSettings(params.ctx)
  const extended = deepMerge(inherited, params.adapterConfig.settingsContent ?? {})
  const routedProviders = params.routedModel == null
    ? {}
    : {
      modelProviders: {
        [params.routedModel.providerId]: [params.routedModel.provider]
      },
      providerProtocol: {
        [params.routedModel.providerId]: params.routedModel.protocol
      },
      security: { auth: { selectedType: params.routedModel.providerId } },
      model: { name: params.routedModel.cliModel }
    }
  const extendedTools = asRecord(extended.tools)
  const existingExcludedTools = Array.isArray(extendedTools.exclude)
    ? extendedTools.exclude.filter((value): value is string => typeof value === 'string')
    : []
  const tools = params.noTools || params.adapterConfig.disableSubagents === true
    ? {
      ...extendedTools,
      ...(params.noTools ? { core: [] } : {}),
      ...(params.adapterConfig.disableSubagents === true
        ? {
          exclude: Array.from(
            new Set([
              ...existingExcludedTools,
              'agent',
              'list_agents',
              'send_message',
              'wait_agent'
            ])
          )
        }
        : {})
    }
    : undefined
  const adapterOwned = {
    $version: 4,
    general: {
      ...asRecord(extended.general),
      enableAutoUpdate: params.adapterConfig.disableAutoUpdate === false,
      enableAutoUpdateNotification: params.adapterConfig.disableAutoUpdate === false
    },
    ...(params.promptPath == null ? {} : { context: { fileName: ['QWEN.md', params.promptPath] } }),
    ...(params.adapterConfig.telemetry === 'inherit'
      ? {}
      : {
        telemetry: { enabled: false, logPrompts: false },
        privacy: { usageStatisticsEnabled: false }
      }),
    ...(Object.keys(params.mcpServers).length === 0
      ? { mcpServers: {} }
      : {
        mcpServers: Object.fromEntries(
          Object.entries(params.mcpServers).map(([key, server]) => [key, translateMcpServer(server)])
        )
      }),
    ...(tools == null ? {} : { tools }),
    ...(params.nativeHooks.hooksConfig == null ? {} : { hooksConfig: params.nativeHooks.hooksConfig }),
    ...(params.nativeHooks.hooks == null ? {} : { hooks: params.nativeHooks.hooks }),
    ...routedProviders
  }
  const merged = deepMerge(extended, adapterOwned)
  if (params.routedModel == null) return merged
  return {
    ...merged,
    model: { name: params.routedModel.cliModel },
    modelProviders: {
      [params.routedModel.providerId]: [params.routedModel.provider]
    },
    providerProtocol: {
      [params.routedModel.providerId]: params.routedModel.protocol
    },
    security: { auth: { selectedType: params.routedModel.providerId } }
  }
}

export const prepareQwenSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<QwenPreparedSession> => {
  const adapterConfig = resolveQwenCodeAdapterConfig(ctx)
  validateSettingsContent(adapterConfig.settingsContent)
  const { qwenHome, runtimeDir } = resolveQwenSessionRoots({ ctx, sessionId: options.sessionId })
  const routedModel = buildRoutedModel({ ctx, rawModel: options.model })
  const cliModel = routedModel?.cliModel ?? (
    options.model == null || options.model.trim() === '' || options.model === 'default'
      ? undefined
      : options.model.trim()
  )
  await mkdir(qwenHome, { recursive: true })
  await mkdir(runtimeDir, { recursive: true })
  await syncSkills({ qwenHome, overlays: options.assetPlan?.overlays ?? [] })
  const promptPath = await writeSystemPrompt({ qwenHome, systemPrompt: options.systemPrompt })
  const noTools = options.executionProfile === 'structured_no_tools'
  const nativeHooks = buildQwenNativeHooksSettings(ctx.env)
  const settings = await buildSettings({
    adapterConfig,
    ctx,
    mcpServers: noTools ? {} : options.assetPlan?.mcpServers ?? {},
    nativeHooks,
    promptPath,
    routedModel,
    noTools
  })
  const settingsPath = resolve(qwenHome, 'settings.json')
  const temporarySettingsPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporarySettingsPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
    await rename(temporarySettingsPath, settingsPath)
  } finally {
    await rm(temporarySettingsPath, { force: true })
  }

  const hooksActive = ctx.env.__ONEWORKS_PROJECT_QWEN_CODE_NATIVE_HOOKS_AVAILABLE__ === '1'
  return {
    binaryPath: resolveQwenCodeBinaryPath(ctx.env, ctx.cwd),
    cliModel,
    qwenHome,
    runtimeDir,
    spawnEnv: toProcessEnv({
      ...filterQwenChildInheritedEnv(ctx.env),
      HOME: qwenHome,
      USERPROFILE: qwenHome,
      QWEN_HOME: qwenHome,
      QWEN_RUNTIME_DIR: runtimeDir,
      QWEN_OAUTH: routedModel == null ? ctx.env.QWEN_OAUTH : undefined,
      NO_BROWSER: 'true',
      CI: 'true',
      OPENAI_BASE_URL: routedModel == null ? ctx.env.OPENAI_BASE_URL : undefined,
      OPENAI_MODEL: routedModel == null ? ctx.env.OPENAI_MODEL : undefined,
      QWEN_MODEL: routedModel == null ? ctx.env.QWEN_MODEL : undefined,
      ...(routedModel == null ? {} : { [ROUTED_API_KEY_ENV]: routedModel.apiKey }),
      __ONEWORKS_QWEN_CODE_HOOK_MODEL__: hooksActive ? cliModel ?? options.model : undefined,
      __ONEWORKS_QWEN_CODE_HOOK_RUNTIME__: hooksActive ? options.runtime : undefined,
      __ONEWORKS_QWEN_CODE_TASK_SESSION_ID__: hooksActive ? options.sessionId : undefined,
      __ONEWORKS_QWEN_CODE_HOOKS_ACTIVE__: hooksActive ? '1' : undefined,
      [NATIVE_HOOK_BRIDGE_ADAPTER_ENV]: hooksActive ? 'qwen-code' : undefined
    })
  }
}

export const resolveQwenApprovalMode = (mode: AdapterQueryOptions['permissionMode']): ApprovalMode => {
  switch (mode) {
    case 'acceptEdits':
      return 'auto-edit'
    case 'plan':
      return 'plan'
    case 'dontAsk':
      return 'auto'
    case 'bypassPermissions':
      return 'yolo'
    default:
      return 'default'
  }
}

const isForbiddenExtraOption = (value: string) =>
  FORBIDDEN_EXTRA_OPTIONS.some(
    option => value === option || value.startsWith(`${option}=`)
  )

export const validateQwenSelection = (params: {
  adapterConfig: QwenCodeAdapterConfig
  extraOptions?: string[]
  prompt?: string
}) => {
  for (const option of params.extraOptions ?? []) {
    if (isForbiddenExtraOption(option)) {
      throw new Error(`Qwen Code adapter does not allow extra option "${option}".`)
    }
  }
  if (params.adapterConfig.nativePromptCommands !== 'allow') {
    const prompt = params.prompt?.trimStart() ?? ''
    if (FORBIDDEN_PROMPT_PREFIX.test(prompt)) {
      throw new Error('Qwen Code slash commands are disabled in the adapter. Send plain text instead.')
    }
    if (FORBIDDEN_AT_REFERENCE.test(prompt)) {
      throw new Error('Qwen Code @path expansion is disabled in the adapter. Reference files as assets instead.')
    }
  }
}

export const buildQwenHeadlessArgs = (params: {
  adapterConfig: QwenCodeAdapterConfig
  cliModel?: string
  options: AdapterQueryOptions
  resumeSessionId?: string
}) => {
  validateQwenSelection({
    adapterConfig: params.adapterConfig,
    extraOptions: params.options.extraOptions
  })
  const args = [
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--approval-mode',
    resolveQwenApprovalMode(params.options.permissionMode)
  ]
  if (
    params.options.executionProfile === 'structured_no_tools' ||
    params.adapterConfig.disableExtensions !== false
  ) args.push('--extensions', 'none')
  if (params.cliModel != null) args.push('--model', params.cliModel)
  if (params.resumeSessionId != null && params.resumeSessionId.trim() !== '') {
    args.push('--resume', params.resumeSessionId)
  }
  return [...args, ...(params.options.extraOptions ?? [])]
}

export const buildQwenDirectArgs = (params: {
  adapterConfig: QwenCodeAdapterConfig
  cliModel?: string
  options: AdapterQueryOptions
  resumeSessionId?: string
}) => {
  validateQwenSelection({
    adapterConfig: params.adapterConfig,
    extraOptions: params.options.extraOptions,
    prompt: params.options.description
  })
  const args = ['--approval-mode', resolveQwenApprovalMode(params.options.permissionMode)]
  if (
    params.options.executionProfile === 'structured_no_tools' ||
    params.adapterConfig.disableExtensions !== false
  ) args.push('--extensions', 'none')
  if (params.cliModel != null) args.push('--model', params.cliModel)
  if (params.resumeSessionId != null && params.resumeSessionId.trim() !== '') {
    args.push('--resume', params.resumeSessionId)
  }
  if (params.options.description != null && params.options.description.trim() !== '') {
    args.push('--prompt-interactive', params.options.description.trim())
  }
  return [...args, ...(params.options.extraOptions ?? [])]
}

export const normalizeQwenPrompt = (content: AdapterMessageContent[]) =>
  content.flatMap((item) => {
    if (item.type === 'text') return item.text.trim() === '' ? [] : [item.text.trim()]
    if (item.type === 'image') return item.url.trim() === '' ? [] : [`Attached image: ${item.url.trim()}`]
    if (item.type === 'file') return item.path.trim() === '' ? [] : [`Attached file: ${item.path.trim()}`]
    if (item.type === 'tool_result') return [String(item.content)]
    if (item.type === 'tool_use') return [`Tool request: ${item.name}`]
    return []
  }).join('\n\n').trim() || 'Continue.'

export const ensureQwenPromptSize = (prompt: string) => {
  if (Buffer.byteLength(prompt) > MAX_STDIN_BYTES) {
    throw new Error(`Qwen Code prompt exceeds the ${MAX_STDIN_BYTES} byte stdin limit.`)
  }
}

export const mapQwenExitCode = (exitCode: number | null | undefined) => {
  switch (exitCode) {
    case 41:
      return 'auth'
    case 42:
      return 'input'
    case 44:
      return 'sandbox'
    case 52:
      return 'config'
    case 53:
      return 'turn_limit'
    case 54:
      return 'tool_execution'
    case 130:
      return 'cancelled'
    default:
      return exitCode === 0 ? undefined : 'process_exit'
  }
}

export const getQwenErrorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error ?? 'Qwen Code session failed unexpectedly')
)

export const toQwenAdapterError = (
  error: unknown,
  overrides: Partial<{ code: string; details: unknown; fatal: boolean; message: string }> = {}
) => ({
  message: overrides.message ?? getQwenErrorMessage(error),
  ...(overrides.code == null ? {} : { code: overrides.code }),
  ...(overrides.details === undefined ? {} : { details: overrides.details }),
  fatal: overrides.fatal ?? true
})

const collectChatFiles = async (directoryPath: string): Promise<string[]> => {
  let entries
  try {
    entries = await import('node:fs/promises').then(module => module.readdir(directoryPath, { withFileTypes: true }))
  } catch {
    return []
  }
  return (await Promise.all(entries.map(async (entry) => {
    const path = resolve(directoryPath, entry.name)
    if (entry.isDirectory()) return collectChatFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') && dirname(path).split(/[\\/]/u).at(-1) === 'chats'
      ? [path]
      : []
  }))).flat()
}

export const resolveLatestQwenSessionId = async (params: {
  ctx: Pick<AdapterCtx, 'env' | 'logger'>
  minMtimeMs?: number
  runtimeDir: string
}) => {
  const redactor = createQwenRuntimeRedactor({
    env: params.ctx.env,
    runtimeDir: params.runtimeDir
  })
  const files = await collectChatFiles(resolve(params.runtimeDir, 'projects'))
  const records = await Promise.all(files.map(async (filePath) => {
    try {
      const fileStat = await stat(filePath)
      if (params.minMtimeMs != null && fileStat.mtimeMs < params.minMtimeMs) return undefined
      const line = (await readFile(filePath, 'utf8')).split(/\r?\n/u).find(Boolean)
      const sessionId = normalizeString(asRecord(JSON.parse(line ?? '{}')).sessionId)
      return sessionId == null ? undefined : { sessionId, mtimeMs: fileStat.mtimeMs }
    } catch (error) {
      params.ctx.logger.warn(
        '[qwen-code session] ignoring unreadable transcript',
        redactor.unknown({ filePath, error })
      )
      return undefined
    }
  }))
  return records.filter((record): record is NonNullable<typeof record> => record != null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.sessionId
}
