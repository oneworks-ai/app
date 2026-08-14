/* eslint-disable max-lines -- Junie session isolation, assets, and controlled CLI arguments stay auditable together. */
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, posix, resolve } from 'node:path'
import process from 'node:process'

import type { AdapterCtx, AdapterMessageContent, AdapterQueryOptions, Config } from '@oneworks/types'
import {
  omitAdapterCommonConfig,
  resolveProjectOoPath,
  scrubCredentialConfigForPersistence,
  syncSymlinkTarget
} from '@oneworks/utils'

import {
  collectJunieAuthEnvironmentValues,
  isJunieRuntimeEnvironmentKey,
  resolveJunieRuntimeEnvironmentKeys,
  scrubJunieAuthValuesForPersistence
} from '../auth-env'
import type { JunieAdapterConfig } from '../config-schema'
import { assertJunieEffort } from '../effort'
import { resolveJunieBinaryPath } from '../paths'
import { buildJunieNativeHookEnv, buildJunieNativeHooksConfig } from './native-hooks'

type McpServerConfig = NonNullable<Config['mcpServers']>[string]

export const DEFAULT_JUNIE_TOOLS = ['read', 'write', 'terminal', 'mcp', 'web', 'subagent']

const CONTROLLED_EXTRA_OPTION_GROUPS = {
  assets: [
    '--agent-default-location',
    '--agent-location',
    '--command-default-location',
    '--command-location',
    '--config-default-locations',
    '--config-location',
    '--extensions-default-location',
    '--ide-guidelines',
    '--mcp-default-locations',
    '--mcp-location',
    '--model-default-locations',
    '--model-location',
    '--skill-default-locations',
    '--skill-location'
  ],
  authentication: [
    '--anthropic-api-key',
    '--auth',
    '--google-api-key',
    '--grok-api-key',
    '--litellm-api-key',
    '--litellm-url',
    '--openai-api-key',
    '--openrouter-api-key'
  ],
  lifecycle: [
    '--',
    '--brave',
    '--plan',
    '--project',
    '--prompt',
    '--resume',
    '--session-id',
    '--task'
  ],
  model: ['--agent-mode', '--effort', '--model', '--provider', '--review'],
  privacy: ['--share-anonymous-statistics', '--skip-update-check'],
  transport: ['--cache-dir', '--input-format', '--json-output-file', '--output-format']
} as const

export type JunieControlledExtraOptionCategory = keyof typeof CONTROLLED_EXTRA_OPTION_GROUPS

const CONTROLLED_EXTRA_OPTION_ALIASES = new Map<string, string>([
  ['-a', '--auth'],
  ['-c', '--cache-dir'],
  // The pinned help does not advertise effort aliases. Reserve these
  // compatibility spellings so advanced args cannot bypass the shared value.
  ['-e', '--effort'],
  ['-effort', '--effort'],
  ['-p', '--project']
])

const CONTROLLED_EXTRA_OPTION_CATEGORIES = new Map<string, JunieControlledExtraOptionCategory>(
  Object.entries(CONTROLLED_EXTRA_OPTION_GROUPS).flatMap(([category, names]) => (
    names.map(name => [name, category as JunieControlledExtraOptionCategory] as const)
  ))
)

const SAFE_SESSION_PATH_SEGMENT = /^[\w.-]{1,128}$/u
const SAFE_LINUX_RUNTIME_DIR = /^\/[^\0\r\n]{1,4095}$/u
const SAFE_LINUX_DBUS_ADDRESS = /^unix:(?:path=\/[^,;\s\0]{1,4095}|abstract=[^,;\s\0]{1,255})(?:,guid=[a-f0-9]{32})?$/iu

const PROCESS_BASICS_ENV_KEYS = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TERM',
  'COLORTERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'USERNAME'
] as const

const PROJECT_NONSECRET_ENV_KEYS = [
  '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__',
  '__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__',
  '__ONEWORKS_PROJECT_LAUNCH_CWD__',
  '__ONEWORKS_PROJECT_BASE_DIR__',
  '__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__',
  '__ONEWORKS_PROJECT_CONFIG_DIR__',
  '__ONEWORKS_PROJECT_CONFIG_DIR_RESOLVE_CWD__',
  '__ONEWORKS_PROJECT_PACKAGE_DIR__',
  '__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__',
  '__ONEWORKS_PROJECT_NODE_PATH__',
  '__ONEWORKS_PROJECT_CTX_ID__',
  '__ONEWORKS_PROJECT_SESSION_ID__',
  '__ONEWORKS_PROJECT_RUN_TYPE__',
  '__ONEWORKS_PROJECT_PERMISSION_MODE__',
  '__ONEWORKS_PROJECT_SERVER_HOST__',
  '__ONEWORKS_PROJECT_SERVER_PORT__',
  '__ONEWORKS_PROJECT_ENABLE_BUILTIN_PERMISSION_HOOKS__'
] as const

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const deepMerge = (base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> => {
  const next = { ...base }
  for (const [key, value] of Object.entries(override)) {
    next[key] = isRecord(next[key]) && isRecord(value)
      ? deepMerge(next[key] as Record<string, unknown>, value)
      : value
  }
  return next
}

export const sanitizeJunieConfigContentForPersistence = (
  value: unknown,
  env: AdapterCtx['env'] = {}
): Record<string, unknown> => {
  const withoutAuthEchoes = scrubJunieAuthValuesForPersistence(
    value,
    collectJunieAuthEnvironmentValues(env)
  )
  const sanitized = scrubCredentialConfigForPersistence(withoutAuthEchoes)
  return isRecord(sanitized) ? sanitized : {}
}

export const resolveJunieAdapterConfig = (
  ctx: Pick<AdapterCtx, 'configState' | 'configs'>
): JunieAdapterConfig => {
  const mergedEntry = ctx.configState?.mergedConfig.adapters?.junie
  if (mergedEntry != null) {
    return omitAdapterCommonConfig(mergedEntry as Record<string, unknown>) as JunieAdapterConfig
  }
  const project = isRecord(ctx.configs[0]?.adapters?.junie) ? ctx.configs[0]!.adapters!.junie! : {}
  const user = isRecord(ctx.configs[1]?.adapters?.junie) ? ctx.configs[1]!.adapters!.junie! : {}
  return omitAdapterCommonConfig(deepMerge(project, user)) as JunieAdapterConfig
}

const copyPresentEnv = (
  target: NodeJS.ProcessEnv,
  source: AdapterCtx['env'],
  keys: readonly string[],
  fallbackToProcess = false
) => {
  for (const key of keys) {
    const hasSourceValue = Object.prototype.hasOwnProperty.call(source, key)
    const value = hasSourceValue ? source[key] : fallbackToProcess ? process.env[key] : undefined
    if (typeof value === 'string') target[key] = value
  }
}

export const buildJunieChildEnv = (params: {
  adapterConfig: JunieAdapterConfig
  env: AdapterCtx['env']
  includeAuth?: boolean
  isolated: NodeJS.ProcessEnv
  nativeHookEnv?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}) => {
  const childEnv: NodeJS.ProcessEnv = {}
  copyPresentEnv(childEnv, params.env, PROCESS_BASICS_ENV_KEYS, true)
  copyPresentEnv(childEnv, params.env, PROJECT_NONSECRET_ENV_KEYS)
  if ((params.platform ?? process.platform) === 'linux') {
    const runtimeDir = params.env.XDG_RUNTIME_DIR
    const sessionBus = params.env.DBUS_SESSION_BUS_ADDRESS
    if (
      typeof runtimeDir === 'string' &&
      runtimeDir === runtimeDir.trim() &&
      posix.isAbsolute(runtimeDir) &&
      SAFE_LINUX_RUNTIME_DIR.test(runtimeDir)
    ) {
      childEnv.XDG_RUNTIME_DIR = runtimeDir
    }
    if (typeof sessionBus === 'string' && SAFE_LINUX_DBUS_ADDRESS.test(sessionBus)) {
      childEnv.DBUS_SESSION_BUS_ADDRESS = sessionBus
    }
  }
  if (params.includeAuth !== false) {
    copyPresentEnv(childEnv, params.env, resolveJunieRuntimeEnvironmentKeys(params.adapterConfig.provider))
  }
  Object.assign(childEnv, params.nativeHookEnv, params.isolated)
  return childEnv
}

export const refreshJunieChildAuthEnv = (params: {
  adapterConfig: JunieAdapterConfig
  baseEnv: NodeJS.ProcessEnv
  env: AdapterCtx['env']
}) => {
  const childEnv = { ...params.baseEnv }
  for (const key of Object.keys(childEnv)) {
    if (isJunieRuntimeEnvironmentKey(key)) delete childEnv[key]
  }
  copyPresentEnv(childEnv, params.env, resolveJunieRuntimeEnvironmentKeys(params.adapterConfig.provider))
  return childEnv
}

const writeJson = async (filePath: string, value: unknown) => {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

const mapMcpServer = (server: McpServerConfig) => {
  if ('command' in server) {
    return {
      command: server.command,
      ...(server.args == null ? {} : { args: server.args }),
      ...(server.env == null ? {} : { env: server.env })
    }
  }
  return {
    url: server.url,
    ...(server.headers == null ? {} : { headers: server.headers })
  }
}

const stageOverlays = async (
  options: AdapterQueryOptions,
  assetsRoot: string
) => {
  const skillsDir = resolve(assetsRoot, 'skills')
  const agentsDir = resolve(assetsRoot, 'agents')
  await Promise.all([
    rm(skillsDir, { recursive: true, force: true }),
    rm(agentsDir, { recursive: true, force: true })
  ])
  for (const overlay of options.assetPlan?.overlays ?? []) {
    if (overlay.kind !== 'skill' && overlay.kind !== 'agent') continue
    const targetRoot = overlay.kind === 'skill' ? skillsDir : agentsDir
    const targetName = overlay.targetPath
      .replace(/^(?:skills|agents)[\\/]/u, '')
      .replaceAll(/[\\/]/gu, '__')
    if (targetName === '' || targetName === '.' || targetName === '..') continue
    await syncSymlinkTarget({
      sourcePath: overlay.sourcePath,
      targetPath: resolve(targetRoot, targetName),
      type: overlay.kind === 'skill' ? 'dir' : 'file'
    })
  }
}

const resolveSessionPathSegment = (sessionId: string) => (
  SAFE_SESSION_PATH_SEGMENT.test(sessionId) && sessionId !== '.' && sessionId !== '..'
    ? sessionId
    : `session-${createHash('sha256').update(sessionId).digest('hex').slice(0, 24)}`
)

const stageMcp = async (options: AdapterQueryOptions, mcpDir: string) => {
  await rm(mcpDir, { recursive: true, force: true })
  await writeJson(resolve(mcpDir, 'mcp.json'), {
    mcpServers: Object.fromEntries(
      Object.entries(options.assetPlan?.mcpServers ?? {}).map(([name, server]) => [name, mapMcpServer(server)])
    )
  })
}

const stageGuidelines = async (options: AdapterQueryOptions, guidelinesPath: string) => {
  const sections: string[] = []
  if (options.permissionMode === 'plan') {
    sections.push([
      '# One Works read-only plan mode',
      '',
      'Analyze the request and produce a plan only. Do not edit files, run mutating commands, or perform the requested changes.',
      'Junie headless does not expose native Plan Mode; this instruction is the required compatibility fallback.'
    ].join('\n'))
  }
  if (options.systemPrompt?.trim()) sections.push(options.systemPrompt.trim())
  if (sections.length === 0) {
    await rm(guidelinesPath, { force: true })
    return undefined
  }
  await mkdir(dirname(guidelinesPath), { recursive: true })
  await writeFile(guidelinesPath, `${sections.join('\n\n')}\n`, 'utf8')
  return guidelinesPath
}

export interface JuniePreparedSession {
  agentsDir: string
  binaryPath: string
  cacheDir: string
  configPath: string
  dataDir: string
  guidelinesPath?: string
  mcpDir: string
  projectDir: string
  skillsDir: string
  spawnEnv: NodeJS.ProcessEnv
}

export const prepareJunieSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<JuniePreparedSession> => {
  const adapterConfig = resolveJunieAdapterConfig(ctx)
  const persistedConfigContent = sanitizeJunieConfigContentForPersistence(adapterConfig.configContent, ctx.env)
  const sessionsRoot = resolveProjectOoPath(ctx.cwd, ctx.env, 'caches', 'adapter-junie', 'sessions')
  const root = resolve(sessionsRoot, resolveSessionPathSegment(options.sessionId))
  const sessionHome = resolve(root, 'home')
  const cacheDir = resolve(root, 'cache')
  const dataDir = resolve(root, 'data')
  const configPath = resolve(root, 'config', 'oneworks.json')
  const assetsRoot = resolve(root, 'assets')
  const mcpDir = resolve(assetsRoot, 'mcp')
  const skillsDir = resolve(assetsRoot, 'skills')
  const agentsDir = resolve(assetsRoot, 'agents')
  const extensionsDir = resolve(assetsRoot, 'extensions-disabled')
  const guidelinesPath = await stageGuidelines(options, resolve(root, 'instructions', 'oneworks.md'))

  await Promise.all([
    mkdir(sessionHome, { recursive: true }),
    mkdir(cacheDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(extensionsDir, { recursive: true }),
    stageOverlays(options, assetsRoot),
    stageMcp(options, mcpDir)
  ])
  const hooks = buildJunieNativeHooksConfig(ctx)
  await writeJson(configPath, deepMerge(persistedConfigContent, hooks ?? {}))

  const nativeHooksActive = ctx.env.__ONEWORKS_PROJECT_JUNIE_NATIVE_HOOKS_AVAILABLE__ === '1'
  return {
    agentsDir,
    binaryPath: resolveJunieBinaryPath(ctx.env, ctx.cwd),
    cacheDir,
    configPath,
    dataDir,
    guidelinesPath,
    mcpDir,
    projectDir: ctx.cwd,
    skillsDir,
    spawnEnv: buildJunieChildEnv({
      adapterConfig,
      env: ctx.env,
      nativeHookEnv: nativeHooksActive ? buildJunieNativeHookEnv({ ctx, options }) : undefined,
      isolated: {
        HOME: sessionHome,
        USERPROFILE: sessionHome,
        XDG_CACHE_HOME: resolve(sessionHome, '.cache'),
        XDG_CONFIG_HOME: resolve(sessionHome, '.config'),
        XDG_DATA_HOME: resolve(sessionHome, '.local', 'share'),
        JUNIE_HOME: dataDir,
        JUNIE_DATA: dataDir
      }
    })
  }
}

export const normalizeJuniePrompt = (content: AdapterMessageContent[]) => (
  content.flatMap((item) => {
    if (item.type === 'text') return item.text.trim() === '' ? [] : [item.text]
    if (item.type === 'image') return [`[Image: ${item.path ?? item.name ?? item.url}]`]
    if (item.type === 'file') return [`[File: ${item.path}]`]
    if (item.type === 'tool_result') {
      return [
        `[Tool result ${item.tool_use_id}]: ${
          typeof item.content === 'string' ? item.content : JSON.stringify(item.content)
        }`
      ]
    }
    return []
  }).join('\n\n').trim()
)

const normalizeExtraOptionName = (option: string) => {
  const equalsIndex = option.indexOf('=')
  return (equalsIndex === -1 ? option : option.slice(0, equalsIndex)).toLowerCase()
}

export const classifyJunieControlledExtraOption = (option: string) => {
  const normalizedName = normalizeExtraOptionName(option)
  const attachedAlias = Array.from(CONTROLLED_EXTRA_OPTION_ALIASES.entries()).find(([alias]) => (
    normalizedName.startsWith(alias) && normalizedName.length > alias.length
  ))
  const canonicalName = CONTROLLED_EXTRA_OPTION_ALIASES.get(normalizedName) ?? attachedAlias?.[1] ?? normalizedName
  const category = CONTROLLED_EXTRA_OPTION_CATEGORIES.get(canonicalName)
  return category == null ? undefined : { canonicalName, category }
}

export const validateJunieExtraOptions = (options: string[] | undefined) => {
  for (const option of options ?? []) {
    const controlled = classifyJunieControlledExtraOption(option)
    if (controlled != null) {
      throw new Error(
        `Junie adapter does not allow controlled or credential option "${option}" ` +
          `(${controlled.category}: ${controlled.canonicalName}).`
      )
    }
  }
}

export const validateJunieEffortSelection = (
  adapterConfig: JunieAdapterConfig,
  options: Pick<AdapterQueryOptions, 'effort'>
) => {
  const effort = options.effort ?? adapterConfig.effort
  if (effort != null) assertJunieEffort(effort)
  return effort
}

export const buildJunieArgs = (params: {
  adapterConfig: JunieAdapterConfig
  nativeSessionId?: string
  options: AdapterQueryOptions
  prepared: JuniePreparedSession
  prompt?: string
  stream: boolean
}) => {
  validateJunieExtraOptions(params.options.extraOptions)
  const { adapterConfig, nativeSessionId, options, prepared } = params
  const args = [
    '--project',
    prepared.projectDir,
    '--cache-dir',
    prepared.cacheDir,
    '--config-default-locations=false',
    '--config-location',
    prepared.configPath,
    '--mcp-default-locations=false',
    '--mcp-location',
    prepared.mcpDir,
    '--skill-default-locations=false',
    '--skill-location',
    prepared.skillsDir,
    '--agent-default-location=false',
    '--agent-location',
    prepared.agentsDir,
    '--command-default-location=false',
    '--model-default-locations=false',
    '--extensions-default-location',
    resolve(prepared.skillsDir, '..', 'extensions-disabled'),
    adapterConfig.disableAutoUpdate === false ? undefined : '--skip-update-check',
    `--share-anonymous-statistics=${adapterConfig.shareAnonymousStatistics === true ? 'true' : 'false'}`,
    '--output-format',
    params.stream ? 'json-stream' : 'text'
  ].filter((value): value is string => value != null)
  if (prepared.guidelinesPath != null) args.push('--ide-guidelines', prepared.guidelinesPath)
  if (options.model != null && options.model !== 'default') args.push('--model', options.model)
  const effort = validateJunieEffortSelection(adapterConfig, options)
  if (effort != null) {
    args.push('--effort', effort)
  }
  if (adapterConfig.provider != null) args.push('--provider', adapterConfig.provider)
  if (adapterConfig.review === true) args.push('--review')
  if (adapterConfig.agentMode != null) args.push('--agent-mode', adapterConfig.agentMode)
  if (nativeSessionId != null) args.push(`--session-id=${nativeSessionId}`, '--resume')
  args.push(...(options.extraOptions ?? []))
  if (params.prompt?.trim()) args.push('--task', params.prompt.trim())
  return args
}

export const getErrorMessage = (error: unknown) => (
  error instanceof Error ? error.message : String(error ?? 'Junie session failed unexpectedly')
)
