/* eslint-disable max-lines -- isolation, provider routing, skills, and MCP staging form one runtime boundary. */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import process from 'node:process'

import type { McpServer } from '@agentclientprotocol/sdk'
import { load as loadYaml } from 'js-yaml'

import type { AdapterCtx, AdapterQueryOptions, Config, ModelServiceConfig } from '@oneworks/types'
import {
  mergeProcessEnvWithProjectEnv,
  parseServiceModelSelector,
  resolveModelServiceApiProtocol,
  resolveModelServiceConfig,
  resolveModelServiceFromMap,
  resolveProjectOoPath,
  sanitizeInheritedNodeRuntimeEnv,
  syncSymlinkTarget
} from '@oneworks/utils'
import { resolveUserShellBinaryPath } from '@oneworks/utils/managed-npm-cli'

import { createGooseProbeEnv } from '../managed-cli'
import { resolveGooseAdapterConfig } from './config'

const ROUTED_PROVIDER_ID = 'oneworks'
const ROUTED_PROVIDER_API_KEY_ENV = 'ONEWORKS_GOOSE_MODEL_API_KEY'

const PROVIDER_AUTH_ENV: Record<string, readonly string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  azure: ['AZURE_OPENAI_API_KEY'],
  bedrock: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'],
  databricks: ['DATABRICKS_TOKEN'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  github_copilot: ['GITHUB_TOKEN'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  groq: ['GROQ_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  perplexity: ['PERPLEXITY_API_KEY'],
  xai: ['XAI_API_KEY']
}
const CREDENTIAL_ENV_PATTERN = /ACCESS_KEY|API_KEY|AUTH_TOKEN|CREDENTIAL|PASSWORD|PRIVATE_KEY|SECRET|TOKEN/iu
const ONEWORKS_PRIVATE_LOADER_ENV_PATTERN = /^__ONEWORKS_.*LOADER.*__$/u

type NativeMcpServer = NonNullable<Config['mcpServers']>[string]

export interface PreparedGooseSession {
  binaryPath: string
  mcpServers: McpServer[]
  model: string
  nativeMode: 'auto' | 'approve' | 'smart_approve' | 'chat'
  spawnEnv: NodeJS.ProcessEnv
}

export interface GoosePrepareDependencies {
  mcpCommandTimeoutMs?: number
}

/**
 * Goose and its MCP descendants are standalone runtimes. In particular, NODE_PATH must not
 * carry One Works' host module search path into those runtimes; MCP dependencies belong to the
 * explicitly selected command and environment instead.
 */
export const sanitizeGooseChildProcessEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const sanitized = sanitizeInheritedNodeRuntimeEnv(env)
  for (const name of Object.keys(sanitized)) {
    if (ONEWORKS_PRIVATE_LOADER_ENV_PATTERN.test(name)) delete sanitized[name]
  }
  return sanitized
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const stringValue = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const resolveRealHome = (ctx: Pick<AdapterCtx, 'env'>) => (
  stringValue(ctx.env.__ONEWORKS_PROJECT_REAL_HOME__) ?? stringValue(process.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    stringValue(process.env.HOME) ?? homedir()
)

export const resolveRealGooseConfigDir = (ctx: Pick<AdapterCtx, 'env'>) => {
  const explicit = stringValue(ctx.env.__ONEWORKS_PROJECT_ADAPTER_GOOSE_CONFIG_DIR__)
  if (explicit != null) return resolve(explicit)
  const realRoot = stringValue(ctx.env.__ONEWORKS_PROJECT_REAL_GOOSE_PATH_ROOT__)
  if (realRoot != null) return resolve(realRoot, 'config')
  const home = resolveRealHome(ctx)
  if (process.platform === 'darwin') return resolve(home, 'Library', 'Application Support', 'Block', 'goose', 'config')
  if (process.platform === 'win32') {
    const appData = stringValue(ctx.env.APPDATA) ?? resolve(home, 'AppData', 'Roaming')
    return resolve(appData, 'Block', 'goose', 'config')
  }
  return resolve(stringValue(ctx.env.XDG_CONFIG_HOME) ?? resolve(home, '.config'), 'goose')
}

const readNativeProviderSelection = async (configDir: string) => {
  try {
    const parsed = loadYaml(await readFile(resolve(configDir, 'config.yaml'), 'utf8'))
    if (!isRecord(parsed)) return {}
    const provider = stringValue(parsed.active_provider) ?? stringValue(parsed.GOOSE_PROVIDER)
    const providers = isRecord(parsed.providers) ? parsed.providers : {}
    const providerEntry = provider == null || !isRecord(providers[provider]) ? {} : providers[provider]
    const model = stringValue(providerEntry.model) ?? stringValue(parsed.GOOSE_MODEL)
    return { model, provider }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return {}
  }
}

const resolveMergedModelServices = (ctx: Pick<AdapterCtx, 'configState' | 'configs'>) => (
  ctx.configState?.mergedConfig.modelServices ?? {
    ...(ctx.configs[0]?.modelServices ?? {}),
    ...(ctx.configs[1]?.modelServices ?? {})
  }
)

const normalizeServiceBaseUrl = (url: string, engine: 'anthropic' | 'openai') => {
  const normalized = url.replace(/\/+$/u, '')
  return engine === 'anthropic'
    ? normalized.replace(/\/messages$/u, '')
    : normalized.replace(/\/(?:chat\/completions|responses)$/u, '')
}

const resolveRoutedModel = (ctx: Pick<AdapterCtx, 'configState' | 'configs'>, rawModel: string | undefined) => {
  const parsed = parseServiceModelSelector(rawModel)
  if (parsed == null) return undefined
  const service = resolveModelServiceFromMap(resolveMergedModelServices(ctx), parsed.serviceKey)
  if (service == null) throw new Error(`Goose adapter could not find model service "${parsed.serviceKey}".`)
  const resolved = resolveModelServiceConfig(service, ['modelServices', parsed.serviceKey]).service
  if (resolved == null) throw new Error(`Goose adapter could not resolve model service "${parsed.serviceKey}".`)
  const protocol = resolveModelServiceApiProtocol(resolved)
  const engine = protocol === 'anthropic-messages'
    ? 'anthropic'
    : protocol === 'openai-chat-completions'
    ? 'openai'
    : undefined
  if (engine == null) throw new Error(`Goose adapter does not support ${protocol ?? 'unknown'} model services.`)
  return {
    apiKey: resolved.apiKey,
    model: parsed.modelName,
    provider: ROUTED_PROVIDER_ID,
    config: buildDeclarativeProvider({ engine, model: parsed.modelName, service: resolved })
  }
}

const buildDeclarativeProvider = (params: {
  engine: 'anthropic' | 'openai'
  model: string
  service: ModelServiceConfig & { apiBaseUrl: string; apiKey: string }
}) => ({
  name: ROUTED_PROVIDER_ID,
  engine: params.engine,
  display_name: 'One Works session',
  description: 'Session-scoped model service routed by One Works',
  api_key_env: params.service.apiKey === '' ? '' : ROUTED_PROVIDER_API_KEY_ENV,
  base_url: normalizeServiceBaseUrl(params.service.apiBaseUrl, params.engine),
  models: [{ name: params.model, context_limit: 128_000 }],
  headers: null,
  timeout_seconds: params.service.timeoutMs == null ? null : Math.max(1, Math.ceil(params.service.timeoutMs / 1000)),
  supports_streaming: true,
  requires_auth: params.service.apiKey !== '',
  preserves_thinking: true
})

const stageSkills = async (gooseRoot: string, options: AdapterQueryOptions) => {
  const skillsDir = resolve(gooseRoot, '.agents', 'skills')
  await rm(skillsDir, { recursive: true, force: true })
  for (const overlay of options.assetPlan?.overlays.filter(entry => entry.kind === 'skill') ?? []) {
    const relativeTarget = overlay.targetPath.replace(/^skills\//u, '').replaceAll('/', '__')
    if (relativeTarget === '' || relativeTarget === '.' || relativeTarget === '..') continue
    await syncSymlinkTarget({
      sourcePath: overlay.sourcePath,
      targetPath: resolve(skillsDir, relativeTarget),
      type: 'dir'
    })
  }
}

const stageNativeAuth = async (params: {
  configDir: string
  gooseRoot: string
  inheritNativeAuth: boolean
}) => {
  await syncSymlinkTarget({
    sourcePath: resolve(params.configDir, 'secrets.yaml'),
    targetPath: resolve(params.gooseRoot, 'config', 'secrets.yaml'),
    type: 'file',
    onMissingSource: 'remove'
  })
  if (!params.inheritNativeAuth) {
    await rm(resolve(params.gooseRoot, 'config', 'secrets.yaml'), { force: true })
  }
}

const resolveMcpCommand = async (
  command: string,
  ctx: AdapterCtx,
  dependencies: GoosePrepareDependencies
) => {
  if (isAbsolute(command)) return command
  if (command.includes('/') || command.includes('\\')) return resolve(ctx.cwd, command)
  return await resolveUserShellBinaryPath({
    binaryName: command,
    childEnvPolicy: 'provided-only',
    env: createGooseProbeEnv(ctx.env),
    timeoutMs: dependencies.mcpCommandTimeoutMs
  }) ?? command
}

const mapMcpServer = async (
  name: string,
  server: NativeMcpServer,
  ctx: AdapterCtx,
  dependencies: GoosePrepareDependencies
): Promise<McpServer> => {
  if (server.type === 'sse') {
    throw new Error(`Goose ACP does not support the selected SSE MCP server "${name}".`)
  }
  if (server.type === 'http') {
    return {
      type: 'http',
      name,
      url: server.url,
      headers: Object.entries(server.headers ?? {}).map(([headerName, value]) => ({ name: headerName, value }))
    }
  }
  return {
    name,
    command: await resolveMcpCommand(server.command, ctx, dependencies),
    args: server.args ?? [],
    env: Object.entries(sanitizeGooseChildProcessEnv(server.env ?? {}))
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([envName, value]) => ({ name: envName, value }))
  }
}

const resolveNativeMode = (
  configured: ReturnType<typeof resolveGooseAdapterConfig>['mode'],
  permissionMode: AdapterQueryOptions['permissionMode']
): PreparedGooseSession['nativeMode'] => {
  if (permissionMode === 'bypassPermissions' || permissionMode === 'dontAsk') return 'auto'
  if (permissionMode === 'plan') return 'chat'
  if (permissionMode === 'acceptEdits') return 'smart_approve'
  return configured ?? 'approve'
}

const filterCredentialEnvironment = (env: NodeJS.ProcessEnv, provider: string | undefined) => {
  const allowed = new Set(PROVIDER_AUTH_ENV[provider?.toLowerCase() ?? ''] ?? [])
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => (
      !CREDENTIAL_ENV_PATTERN.test(name) || allowed.has(name)
    ))
  )
}

export const prepareGooseSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions,
  dependencies: GoosePrepareDependencies = {}
): Promise<PreparedGooseSession> => {
  if ((options.extraOptions?.length ?? 0) > 0) {
    throw new Error(
      'Goose ACP adapter does not accept native extra options; configure skills and MCP through One Works.'
    )
  }
  const adapterConfig = resolveGooseAdapterConfig(ctx)
  const gooseRoot = resolveProjectOoPath(ctx.cwd, ctx.env, 'caches', ctx.ctxId, options.sessionId, 'adapter-goose')
  if (!isAbsolute(gooseRoot)) throw new Error('Goose session root must be absolute.')
  const realConfigDir = resolveRealGooseConfigDir(ctx)
  const native = await readNativeProviderSelection(realConfigDir)
  const routed = resolveRoutedModel(ctx, options.model)
  const selectedModel = options.model == null || options.model.trim() === '' || options.model === 'default'
    ? undefined
    : options.model.trim()
  const provider = routed?.provider ?? stringValue(adapterConfig.provider) ??
    stringValue(ctx.env.GOOSE_PROVIDER) ?? native.provider
  const model = routed?.model ?? selectedModel ?? stringValue(ctx.env.GOOSE_MODEL) ?? native.model

  await stageSkills(gooseRoot, options)
  await stageNativeAuth({
    configDir: realConfigDir,
    gooseRoot,
    inheritNativeAuth: adapterConfig.inheritNativeAuth !== false
  })
  if (routed != null) {
    const providerPath = resolve(gooseRoot, 'config', 'custom_providers', `${ROUTED_PROVIDER_ID}.json`)
    await mkdir(dirname(providerPath), { recursive: true })
    await writeFile(providerPath, `${JSON.stringify(routed.config, null, 2)}\n`, 'utf8')
  }

  const mcpServers = await Promise.all(
    Object.entries(options.assetPlan?.mcpServers ?? {}).map(([name, server]) => (
      mapMcpServer(name, server, ctx, dependencies)
    ))
  )
  const mergedEnv = filterCredentialEnvironment(
    mergeProcessEnvWithProjectEnv(ctx.env, { workspaceFolder: ctx.cwd }),
    provider
  )
  const spawnEnv = Object.fromEntries(
    Object.entries({
      ...mergedEnv,
      GOOSE_PATH_ROOT: gooseRoot,
      GOOSE_PROVIDER: provider,
      GOOSE_MODEL: model,
      XDG_CACHE_HOME: resolve(gooseRoot, 'xdg', 'cache'),
      XDG_CONFIG_HOME: resolve(gooseRoot, 'xdg', 'config'),
      XDG_DATA_HOME: resolve(gooseRoot, 'xdg', 'data'),
      XDG_STATE_HOME: resolve(gooseRoot, 'xdg', 'state'),
      ...(routed?.apiKey ? { [ROUTED_PROVIDER_API_KEY_ENV]: routed.apiKey } : {})
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
  return {
    binaryPath: stringValue(ctx.env.__ONEWORKS_PROJECT_ADAPTER_GOOSE_CLI_PATH__) ?? 'goose',
    mcpServers,
    model: model == null
      ? provider == null ? 'default' : `${provider}/default`
      : provider == null
      ? model
      : `${provider}/${model}`,
    nativeMode: resolveNativeMode(adapterConfig.mode, options.permissionMode),
    spawnEnv
  }
}
