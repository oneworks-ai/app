/* eslint-disable max-lines -- Grok session projection is kept together so native config remains auditable. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import * as TOML from '@iarna/toml'
import { NATIVE_HOOK_BRIDGE_ADAPTER_ENV } from '@oneworks/hooks'
import type { AdapterCtx, AdapterQueryOptions, Config, ModelServiceConfig } from '@oneworks/types'
import {
  omitAdapterCommonConfig,
  parseServiceModelSelector,
  resolveModelServiceConfig,
  resolveProjectOoPath,
  syncSymlinkTarget
} from '@oneworks/utils'
import type { ManagedNpmCliConfig } from '@oneworks/utils/managed-npm-cli'

import { resolveGrokBinaryPath } from '../paths'
import { writeGrokNativeHooks } from './native-hooks'
import { migrateGrokSession } from './migration'

export interface GrokAdapterConfig {
  cli?: ManagedNpmCliConfig
  configContent?: Record<string, unknown>
  disableAutoUpdate?: boolean
  disableMemory?: boolean
  disableSubagents?: boolean
  disableWebSearch?: boolean
  effort?: AdapterQueryOptions['effort']
}

export interface GrokPreparedSession {
  binaryPath: string
  cliModel?: string
  grokHome: string
  spawnEnv: Record<string, string>
}

const ROUTED_MODEL_ALIAS = 'oneworks-session'
const ROUTED_MODEL_API_KEY_ENV = 'ONEWORKS_GROK_MODEL_API_KEY'
const CREDENTIAL_FILES = [
  'auth.json',
  'managed_config.toml',
  'managed_config_cache.json',
  'mcp_credentials.json',
  'requirements.toml',
  'trusted_folders.toml'
] as const

const FORBIDDEN_EXTRA_OPTIONS = [
  '-c',
  '-m',
  '-p',
  '-r',
  '-s',
  '--continue',
  '--cwd',
  '--disallowed-tools',
  '--fork-session',
  '--model',
  '--output-format',
  '--permission-mode',
  '--prompt-file',
  '--prompt-json',
  '--reasoning-effort',
  '--resume',
  '--rules',
  '--session-id',
  '--single',
  '--system-prompt',
  '--system-prompt-override',
  '--tools'
] as const

const asPlainRecord = (value: unknown): Record<string, unknown> => (
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
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const baseValue = result[key]
    result[key] = (
        value != null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        baseValue != null &&
        typeof baseValue === 'object' &&
        !Array.isArray(baseValue)
      )
      ? deepMerge(asPlainRecord(baseValue), asPlainRecord(value))
      : value
  }
  return result
}

const sanitizeTomlValue = (value: unknown): unknown => {
  if (value == null) return undefined
  if (value instanceof Date || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map(sanitizeTomlValue).filter(item => item !== undefined)
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, sanitizeTomlValue(item)] as const)
      .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined)
  )
}

const toProcessEnv = (env: Record<string, string | null | undefined>) => Object.fromEntries(
  Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
)

const resolveMergedModelServices = (ctx: Pick<AdapterCtx, 'configState' | 'configs'>) => {
  if (ctx.configState?.mergedConfig.modelServices != null) {
    return ctx.configState.mergedConfig.modelServices
  }
  return {
    ...(ctx.configs[0]?.modelServices ?? {}),
    ...(ctx.configs[1]?.modelServices ?? {})
  }
}

export const resolveGrokAdapterConfig = (
  ctx: Pick<AdapterCtx, 'configState' | 'configs'>
): GrokAdapterConfig => {
  const mergedEntry = ctx.configState?.mergedConfig.adapters?.grok
  if (mergedEntry != null) {
    return omitAdapterCommonConfig(mergedEntry as Record<string, unknown>) as GrokAdapterConfig
  }

  const projectEntry = asPlainRecord(ctx.configs[0]?.adapters?.grok)
  const userEntry = asPlainRecord(ctx.configs[1]?.adapters?.grok)
  return omitAdapterCommonConfig(deepMerge(projectEntry, userEntry)) as GrokAdapterConfig
}

export const resolveRealGrokHome = (ctx: Pick<AdapterCtx, 'env'>) => {
  const explicit = normalizeString(ctx.env.GROK_HOME) ?? normalizeString(process.env.GROK_HOME)
  if (explicit != null) return explicit
  const realHome = normalizeString(ctx.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    normalizeString(process.env.HOME) ??
    normalizeString(process.env.USERPROFILE)
  if (realHome == null) throw new Error('Grok adapter could not resolve the real user home directory.')
  return resolve(realHome, '.grok')
}

export const resolveGrokSessionHome = (params: {
  ctx: Pick<AdapterCtx, 'ctxId' | 'cwd' | 'env'>
  sessionId: string
}) => resolve(
  resolveProjectOoPath(
    params.ctx.cwd,
    params.ctx.env,
    'caches',
    'adapter-grok',
    'sessions',
    params.sessionId,
  ),
  'home'
)

const readBaseConfig = async (ctx: Pick<AdapterCtx, 'env' | 'logger'>) => {
  const configPath = resolve(resolveRealGrokHome(ctx), 'config.toml')
  try {
    return asPlainRecord(TOML.parse(await readFile(configPath, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      ctx.logger.warn('[grok config] ignoring unreadable real config.toml', { configPath, error })
    }
    return {}
  }
}

const syncCredentials = async (params: {
  ctx: Pick<AdapterCtx, 'env'>
  grokHome: string
}) => {
  const realGrokHome = resolveRealGrokHome(params.ctx)
  await Promise.all(CREDENTIAL_FILES.map(fileName => syncSymlinkTarget({
    sourcePath: resolve(realGrokHome, fileName),
    targetPath: resolve(params.grokHome, fileName),
    type: 'file',
    onMissingSource: 'remove'
  })))
}

const syncSkills = async (params: {
  grokHome: string
  overlays: NonNullable<AdapterQueryOptions['assetPlan']>['overlays']
}) => {
  const skillsDir = resolve(params.grokHome, 'skills')
  await rm(skillsDir, { recursive: true, force: true })
  const skills = params.overlays.filter(overlay => overlay.kind === 'skill')
  if (skills.length === 0) return
  await mkdir(skillsDir, { recursive: true })
  for (const overlay of skills) {
    const targetName = overlay.targetPath
      .replace(/^skills\//u, '')
      .replaceAll('/', '__')
    if (targetName === '' || targetName === '.' || targetName === '..') continue
    await syncSymlinkTarget({
      sourcePath: overlay.sourcePath,
      targetPath: resolve(skillsDir, targetName),
      type: 'dir'
    })
  }
}

const translateMcpServer = (server: NonNullable<Config['mcpServers']>[string]) => {
  if (server.type === 'http' || server.type === 'sse') {
    return {
      url: server.url,
      enabled: true,
      ...(server.headers == null ? {} : { headers: server.headers })
    }
  }
  return {
    command: server.command,
    enabled: true,
    ...(server.args == null ? {} : { args: server.args }),
    ...(server.env == null ? {} : { env: server.env })
  }
}

const normalizeApiBaseUrl = (baseUrl: string) => baseUrl
  .replace(/\/(?:chat\/completions|responses|messages)\/?$/u, '')
  .replace(/\/+$/u, '')

const resolveApiBackend = (service: ModelServiceConfig) => {
  const grokExtra = asPlainRecord(asPlainRecord(service.extra).grok)
  const explicit = normalizeString(grokExtra.apiBackend)
  if (explicit === 'chat_completions' || explicit === 'responses' || explicit === 'messages') return explicit
  return asPlainRecord(asPlainRecord(service.extra).codex).wireApi === 'responses'
    ? 'responses'
    : 'chat_completions'
}

const buildRoutedModel = (params: {
  ctx: Pick<AdapterCtx, 'configState' | 'configs'>
  rawModel?: string
}) => {
  const parsed = parseServiceModelSelector(params.rawModel)
  if (parsed == null) return undefined
  const service = resolveMergedModelServices(params.ctx)[parsed.serviceKey]
  if (service == null) {
    throw new Error(`Grok adapter could not find model service "${parsed.serviceKey}".`)
  }
  const resolved = resolveModelServiceConfig(service, ['modelServices', parsed.serviceKey]).service
  if (resolved == null) {
    throw new Error(`Grok adapter could not resolve model service "${parsed.serviceKey}".`)
  }
  return {
    apiKey: resolved.apiKey,
    cliModel: ROUTED_MODEL_ALIAS,
    config: {
      model: parsed.modelName,
      base_url: normalizeApiBaseUrl(resolved.apiBaseUrl),
      env_key: ROUTED_MODEL_API_KEY_ENV,
      api_backend: resolveApiBackend(resolved)
    }
  }
}

const buildGrokConfig = async (params: {
  adapterConfig: GrokAdapterConfig
  ctx: Pick<AdapterCtx, 'configState' | 'configs' | 'env' | 'logger'>
  mcpServers: Record<string, NonNullable<Config['mcpServers']>[string]>
  routedModel?: ReturnType<typeof buildRoutedModel>
}) => {
  const base = await readBaseConfig(params.ctx)
  const overridden = deepMerge(base, params.adapterConfig.configContent ?? {})
  const cli = {
    ...asPlainRecord(overridden.cli),
    ...(params.adapterConfig.disableAutoUpdate === false ? {} : { auto_update: false })
  }
  return {
    ...overridden,
    cli,
    mcp_servers: Object.fromEntries(
      Object.entries(params.mcpServers).map(([name, server]) => [name, translateMcpServer(server)])
    ),
    ...(params.routedModel == null
      ? {}
      : {
        model: {
          ...asPlainRecord(overridden.model),
          [ROUTED_MODEL_ALIAS]: params.routedModel.config
        }
      })
  }
}

const writeGrokConfig = async (grokHome: string, config: Record<string, unknown>) => {
  const configPath = resolve(grokHome, 'config.toml')
  const sanitized = sanitizeTomlValue(config) as Record<string, unknown>
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, TOML.stringify(sanitized as never), 'utf8')
  return configPath
}

export const prepareGrokSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<GrokPreparedSession> => {
  const adapterConfig = resolveGrokAdapterConfig(ctx)
  const grokHome = resolveGrokSessionHome({ ctx, sessionId: options.sessionId })
  const routedModel = buildRoutedModel({ ctx, rawModel: options.model })
  const cliModel = routedModel?.cliModel ?? (
    options.model == null || options.model.trim() === '' || options.model === 'default'
      ? undefined
      : options.model.trim()
  )

  await mkdir(grokHome, { recursive: true })
  if (options.type === 'resume') {
    await migrateGrokSession({
      cacheRoot: resolveProjectOoPath(ctx.cwd, ctx.env, 'caches'),
      currentGrokHome: grokHome,
      realGrokHome: resolveRealGrokHome(ctx),
      sessionId: options.sessionId
    })
  }
  await syncCredentials({ ctx, grokHome })
  await syncSkills({ grokHome, overlays: options.assetPlan?.overlays ?? [] })
  await writeGrokNativeHooks({ env: ctx.env, grokHome })
  await writeGrokConfig(grokHome, await buildGrokConfig({
    adapterConfig,
    ctx,
    mcpServers: options.assetPlan?.mcpServers ?? {},
    routedModel
  }))

  const nativeHooksActive = ctx.env.__ONEWORKS_PROJECT_GROK_NATIVE_HOOKS_AVAILABLE__ === '1'
  return {
    binaryPath: resolveGrokBinaryPath(ctx.env, ctx.cwd),
    cliModel,
    grokHome,
    spawnEnv: toProcessEnv({
      ...ctx.env,
      GROK_HOME: grokHome,
      ...(routedModel == null ? {} : { [ROUTED_MODEL_API_KEY_ENV]: routedModel.apiKey }),
      __ONEWORKS_GROK_HOOK_MODEL__: nativeHooksActive ? cliModel ?? options.model : undefined,
      __ONEWORKS_GROK_HOOK_RUNTIME__: nativeHooksActive ? options.runtime : undefined,
      __ONEWORKS_GROK_TASK_SESSION_ID__: nativeHooksActive ? options.sessionId : undefined,
      __ONEWORKS_GROK_HOOKS_ACTIVE__: nativeHooksActive ? '1' : undefined,
      [NATIVE_HOOK_BRIDGE_ADAPTER_ENV]: nativeHooksActive ? 'grok' : undefined
    })
  }
}

const isForbiddenExtraOption = (option: string) => FORBIDDEN_EXTRA_OPTIONS.some(
  forbidden => option === forbidden || option.startsWith(`${forbidden}=`)
)

export const validateGrokExtraOptions = (options: string[] | undefined) => {
  for (const option of options ?? []) {
    if (isForbiddenExtraOption(option)) {
      throw new Error(`Grok adapter does not allow extra option "${option}".`)
    }
  }
}

const resolveEffort = (
  requested: AdapterQueryOptions['effort'],
  configured: GrokAdapterConfig['effort']
) => {
  const effort = requested ?? configured
  return effort === 'max' ? 'xhigh' : effort
}

export const buildGrokCommonArgs = (params: {
  adapterConfig: GrokAdapterConfig
  cliModel?: string
  options: AdapterQueryOptions
}) => {
  validateGrokExtraOptions(params.options.extraOptions)
  const args: string[] = []
  if (params.adapterConfig.disableAutoUpdate !== false) args.push('--no-auto-update')
  if (params.adapterConfig.disableMemory === true) args.push('--no-memory')
  if (params.adapterConfig.disableSubagents === true) args.push('--no-subagents')
  if (params.adapterConfig.disableWebSearch === true) args.push('--disable-web-search')
  if (params.cliModel != null) args.push('--model', params.cliModel)

  const effort = resolveEffort(params.options.effort, params.adapterConfig.effort)
  if (effort != null) args.push('--reasoning-effort', effort)
  if (params.options.permissionMode != null) {
    args.push('--permission-mode', params.options.permissionMode)
  }
  if (params.options.systemPrompt != null && params.options.systemPrompt.trim() !== '') {
    args.push(
      params.options.appendSystemPrompt === false ? '--system-prompt-override' : '--rules',
      params.options.systemPrompt
    )
  }
  if ((params.options.tools?.include?.length ?? 0) > 0) {
    args.push('--tools', params.options.tools!.include!.join(','))
  }
  if ((params.options.tools?.exclude?.length ?? 0) > 0) {
    args.push('--disallowed-tools', params.options.tools!.exclude!.join(','))
  }
  return [...args, ...(params.options.extraOptions ?? [])]
}

export const buildGrokHeadlessArgs = (params: {
  adapterConfig: GrokAdapterConfig
  cliModel?: string
  options: AdapterQueryOptions
  promptFile: string
  resume: boolean
}) => [
  ...buildGrokCommonArgs(params),
  '--output-format',
  'streaming-messages-json',
  ...(params.resume
    ? ['--resume', params.options.sessionId]
    : ['--session-id', params.options.sessionId]),
  '--prompt-file',
  params.promptFile
]

export const buildGrokDirectArgs = (params: {
  adapterConfig: GrokAdapterConfig
  cliModel?: string
  options: AdapterQueryOptions
}) => [
  ...buildGrokCommonArgs(params),
  ...(params.options.type === 'resume'
    ? ['--resume', params.options.sessionId]
    : ['--session-id', params.options.sessionId]),
  ...(params.options.description == null || params.options.description.trim() === ''
    ? []
    : [params.options.description.trim()])
]

export const writeGrokPromptFile = async (grokHome: string, prompt: string) => {
  const promptPath = resolve(grokHome, '.oneworks-prompt')
  await writeFile(promptPath, prompt, 'utf8')
  return promptPath
}
