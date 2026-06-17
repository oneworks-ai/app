import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import { resolveConfigState } from '@oneworks/config'
import { NATIVE_HOOK_BRIDGE_ADAPTER_ENV } from '@oneworks/hooks'
import type { AdapterCtx, AdapterQueryOptions, Config, ModelServiceConfig } from '@oneworks/types'
import { createStartupProfiler, mergeProcessEnvWithProjectEnv, resolveModelServiceConfig } from '@oneworks/utils'
import { createLogger } from '@oneworks/utils/create-logger'

import { resolveCodexBinaryPath } from '#~/paths.js'
import { CodexRpcError } from '#~/protocol/rpc.js'
import type { CodexInputItem, CodexSandboxPolicy } from '#~/types.js'
import { prepareCodexSessionHome } from './accounts'
import { buildNativeConfigOverrideArgs, mergeCodexConfigOverrides, resolveCodexAdapterConfig } from './config'
import { buildMcpServerPermissionSubjectKeys, resolveManagedPermissionDecision } from './permissions'
import { CODEX_PROXY_META_HEADER_NAME, encodeCodexProxyMeta, ensureCodexProxyServer } from './proxy'

export type CodexApprovalPolicy = 'never' | 'unlessTrusted' | 'onRequest'
export type CodexOutboundApprovalPolicy = 'never' | 'untrusted' | 'on-request'
export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

/**
 * Map a single oneworks `AdapterMessageContent` item to zero or one Codex input items.
 */
function mapSingleContentToCodexInput(
  item: { type: string; text?: string; url?: string; path?: string; [k: string]: unknown }
): CodexInputItem | null {
  if (item.type === 'text' && typeof item.text === 'string') {
    return { type: 'text', text: item.text }
  }
  if (item.type === 'image' && typeof item.url === 'string') {
    if (typeof item.path === 'string' && item.path.trim() !== '') {
      return { type: 'localImage', path: item.path }
    }
    return { type: 'image', url: item.url }
  }
  if (item.type === 'file' && typeof item.path === 'string' && item.path.trim() !== '') {
    return { type: 'text', text: `Context file: ${item.path}` }
  }
  return null
}

function buildSpawnEnv(ctx: Pick<AdapterCtx, 'cwd' | 'env'>): NodeJS.ProcessEnv {
  const env = mergeProcessEnvWithProjectEnv(ctx.env, { workspaceFolder: ctx.cwd })
  delete env.__IS_LOADER_CLI__
  delete env.NODE_OPTIONS
  return env
}

const PROJECT_LOG_PATH_ENV_KEYS = [
  'HOME',
  '__ONEWORKS_PROJECT_BASE_DIR__',
  '__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__',
  '__ONEWORKS_PROJECT_HOME_PROJECT_DIR__',
  '__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__',
  '__ONEWORKS_PROJECT_CONFIG_DIR__',
  '__ONEWORKS_PROJECT_CONFIG_DIR_RESOLVE_CWD__',
  '__ONEWORKS_PROJECT_LAUNCH_CWD__',
  '__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__',
  '__ONEWORKS_PROJECT_REAL_HOME__',
  '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__',
  '__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__'
] as const

const pickProjectLogPathEnv = (env: AdapterCtx['env']) =>
  Object.fromEntries(
    PROJECT_LOG_PATH_ENV_KEYS.flatMap((key) => {
      const value = env[key]
      return value == null ? [] : [[key, value]]
    })
  )

function resolveApprovalPolicy(permissionMode: AdapterQueryOptions['permissionMode']): CodexApprovalPolicy {
  if (permissionMode === 'bypassPermissions' || permissionMode === 'dontAsk') return 'never'
  if (permissionMode === 'plan') return 'onRequest'
  return 'unlessTrusted'
}

function shouldUseYolo(permissionMode: AdapterQueryOptions['permissionMode']) {
  return permissionMode === 'bypassPermissions'
}

const isChannelRuntimeEnv = (env: AdapterCtx['env']) =>
  readOptionalString(env.__ONEWORKS_PROJECT_CHANNEL_TYPE__) != null ||
  readOptionalString(env.__ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__) != null

const appendWritableRoot = (
  sandboxPolicy: Extract<CodexSandboxPolicy, { type: 'workspaceWrite' }>,
  root: string | undefined
) => {
  const normalizedRoot = root == null ? undefined : resolve(root)
  if (normalizedRoot == null || normalizedRoot === '') return sandboxPolicy

  const writableRoots = sandboxPolicy.writableRoots ?? []
  if (writableRoots.some(item => resolve(item) === normalizedRoot)) {
    return sandboxPolicy
  }
  return { ...sandboxPolicy, writableRoots: [...writableRoots, normalizedRoot] }
}

function withChannelRuntimeSandboxAccess(
  sandboxPolicy: CodexSandboxPolicy,
  env: AdapterCtx['env']
): CodexSandboxPolicy {
  if (!isChannelRuntimeEnv(env)) return sandboxPolicy
  if (sandboxPolicy.type === 'workspaceWrite') {
    return appendWritableRoot(
      { ...sandboxPolicy, networkAccess: true },
      readOptionalString(env.__ONEWORKS_PROJECT_CHANNEL_MEMORY_ROOT__)
    )
  }
  if (sandboxPolicy.type === 'externalSandbox') {
    return { ...sandboxPolicy, networkAccess: 'enabled' }
  }
  return sandboxPolicy
}

const buildSandboxConfigOverrideArgs = (sandboxPolicy: CodexSandboxPolicy) => {
  const args: string[] = []
  if (sandboxPolicy.type === 'workspaceWrite' && sandboxPolicy.networkAccess === true) {
    args.push('-c', 'sandbox_workspace_write.network_access=true')
  }
  if (
    sandboxPolicy.type === 'workspaceWrite' &&
    Array.isArray(sandboxPolicy.writableRoots) &&
    sandboxPolicy.writableRoots.length > 0
  ) {
    args.push('-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(sandboxPolicy.writableRoots)}`)
  }
  return args
}

export function toCodexOutboundApprovalPolicy(
  approvalPolicy: CodexApprovalPolicy
): CodexOutboundApprovalPolicy {
  return approvalPolicy === 'unlessTrusted'
    ? 'untrusted'
    : approvalPolicy === 'onRequest'
    ? 'on-request'
    : 'never'
}

/**
 * Encode a string value as a TOML inline string (JSON encoding is a valid subset).
 */
const toToml = (value: string) => JSON.stringify(value)

interface CodexModelProviderExtra {
  wireApi?: string
  queryParams?: Record<string, string>
  headers?: Record<string, string>
}

const resolveConfiguredModelService = (service: ModelServiceConfig | undefined) => (
  service == null ? undefined : resolveModelServiceConfig(service).service
)

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const readOptionalString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined
)

interface CodexStoredAuthTokens {
  account_id?: unknown
  id_token?: unknown
}

interface CodexStoredAuthFile {
  auth_mode?: unknown
  tokens?: unknown
}

interface CodexJwtOrganizationClaim {
  id?: unknown
  is_default?: unknown
}

interface CodexThreadCacheAuthIdentity {
  accountType?: string
  accountId?: string
  organizationId?: string
  email?: string
}

const hasStableThreadCacheAuthIdentity = (identity: CodexThreadCacheAuthIdentity) => (
  identity.accountId != null ||
  identity.organizationId != null ||
  identity.email != null
)

const decodeJwtPayload = (token: string | undefined) => {
  const payload = token?.split('.')[1]
  if (payload == null || payload === '') {
    return undefined
  }

  try {
    const decoded = Buffer.from(payload, 'base64url').toString('utf8')
    const parsed = JSON.parse(decoded)
    return isPlainObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

const pickPrimaryOrganization = (value: unknown) => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const organizations = value
    .filter(isPlainObject)
    .map(entry => entry as CodexJwtOrganizationClaim)

  return organizations.find(entry => entry.is_default === true) ?? organizations[0]
}

const readThreadCacheAuthIdentityFromContent = (authContent: string): CodexThreadCacheAuthIdentity | undefined => {
  try {
    const parsed = JSON.parse(authContent) as CodexStoredAuthFile
    const tokens = isPlainObject(parsed.tokens) ? parsed.tokens as CodexStoredAuthTokens : undefined
    const idTokenPayload = decodeJwtPayload(readOptionalString(tokens?.id_token))
    const authClaims = isPlainObject(idTokenPayload?.['https://api.openai.com/auth'])
      ? idTokenPayload['https://api.openai.com/auth']
      : undefined
    const organization = pickPrimaryOrganization(authClaims?.organizations)
    const identity: CodexThreadCacheAuthIdentity = {
      accountType: readOptionalString(parsed.auth_mode),
      accountId: readOptionalString(authClaims?.chatgpt_account_id) ?? readOptionalString(tokens?.account_id),
      organizationId: readOptionalString(organization?.id),
      email: readOptionalString(idTokenPayload?.email)?.toLowerCase()
    }

    return hasStableThreadCacheAuthIdentity(identity)
      ? identity
      : undefined
  } catch {
    return undefined
  }
}

const normalizeStringRecord = (value: unknown): Record<string, string> => {
  if (!isPlainObject(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

const normalizePositiveInteger = (value: unknown): number | undefined => (
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
)

const normalizeCodexReasoningEffort = (value: unknown): CodexReasoningEffort | undefined => (
  value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
    ? value
    : undefined
)

const mapPublicEffortToCodex = (value: AdapterQueryOptions['effort']): CodexReasoningEffort | undefined => (
  value === 'max'
    ? 'xhigh'
    : value === 'low' || value === 'medium' || value === 'high'
    ? value
    : undefined
)

const mapCodexEffortToPublic = (value: CodexReasoningEffort | undefined): AdapterQueryOptions['effort'] => (
  value === 'xhigh' ? 'max' : value
)

const resolveRoutedServiceKey = (rawModel: string | undefined) => {
  const normalizedRawModel = rawModel?.trim()
  if (normalizedRawModel == null || !normalizedRawModel.includes(',')) return undefined
  const commaIdx = normalizedRawModel.indexOf(',')
  return normalizedRawModel.slice(0, commaIdx).trim() || undefined
}

const normalizeProviderBaseUrl = (apiBaseUrl: string | undefined, wireApi: string | undefined) => {
  if (typeof apiBaseUrl !== 'string' || apiBaseUrl.trim() === '') return undefined
  return (wireApi ?? 'responses') === 'responses' && apiBaseUrl.endsWith('/responses')
    ? apiBaseUrl.slice(0, -'/responses'.length)
    : apiBaseUrl
}

/**
 * Encode a flat string→string record as a TOML inline table: `{key = "value", …}`.
 */
const toTomlInlineTable = (obj: Record<string, string>) =>
  `{${Object.entries(obj).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')}}`

const MCP_INHERITED_ENV_KEYS = [
  '__ONEWORKS_PROJECT_LAUNCH_CWD__',
  '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__',
  '__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__',
  '__ONEWORKS_PROJECT_CONFIG_DIR__',
  '__ONEWORKS_PROJECT_CONFIG_DIR_RESOLVE_CWD__',
  '__ONEWORKS_PROJECT_BASE_DIR__',
  '__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__',
  '__ONEWORKS_PROJECT_ENTITIES_DIR__',
  '__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__',
  '__ONEWORKS_PROJECT_PACKAGE_DIR__',
  '__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__',
  '__ONEWORKS_PROJECT_REAL_HOME__',
  '__ONEWORKS_PROJECT_DOTENV_FILES__',
  '__ONEWORKS_PROJECT_SESSION_ID__',
  '__ONEWORKS_PROJECT_CTX_ID__',
  '__ONEWORKS_PROJECT_RUN_TYPE__',
  '__ONEWORKS_PROJECT_PERMISSION_MODE__',
  '__ONEWORKS_PROJECT_SERVER_HOST__',
  '__ONEWORKS_PROJECT_SERVER_PORT__',
  '__ONEWORKS_PROJECT_LOG_PREFIX__'
] as const

const pickInheritedMcpEnv = (env: Record<string, string | null | undefined>) => (
  Object.fromEntries(
    MCP_INHERITED_ENV_KEYS
      .map(key => [key, env[key]])
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
  )
)

const pickSoleCachedThreadId = (cachedThreads: Record<string, string> | undefined) => {
  const cachedThreadIds = Object.values(cachedThreads ?? {})
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
  return cachedThreadIds.length === 1 ? cachedThreadIds[0] : undefined
}

/**
 * Derive the `-c key=value` overrides and API-key env injections needed to map
 * oneworks `systemPrompt` and `modelServices` onto codex configuration.
 *
 * model format: plain `"gpt-4o"` — used as-is;
 *               `"service,model"` — routes through the named model service.
 */
function buildCodexConfigOverrides(params: {
  systemPrompt: string | undefined
  rawModel: string | undefined
  modelServices: Record<string, ModelServiceConfig>
  proxyBaseUrl?: string
  proxyLogContext?: {
    cwd: string
    ctxId: string
    env?: Record<string, string | null | undefined>
    sessionId: string
  }
  proxyDiagnostics?: {
    requestedModel?: string
    runtime?: string
    sessionType?: string
    permissionMode?: string
    approvalPolicy?: string
    sandboxPolicy?: string
    useYolo?: boolean
    requestedEffort?: string
    effectiveEffort?: string
  }
}): {
  args: string[]
  fingerprintArgs: string[]
  resolvedModel: string | undefined
  resolvedMaxOutputTokens: number | null | undefined
} {
  const {
    systemPrompt,
    rawModel,
    modelServices,
    proxyBaseUrl,
    proxyLogContext,
    proxyDiagnostics
  } = params
  const args: string[] = []
  const fingerprintArgs: string[] = []
  const normalizedRawModel = rawModel?.trim()
  const pushArgs = (value: string) => {
    args.push('-c', value)
  }
  const pushFingerprintArgs = (value: string) => {
    fingerprintArgs.push('-c', value)
  }
  const pushBoth = (value: string) => {
    pushArgs(value)
    pushFingerprintArgs(value)
  }

  if (systemPrompt) {
    pushBoth(`developer_instructions=${toToml(systemPrompt)}`)
  }

  let resolvedModel: string | undefined
  let resolvedMaxOutputTokens: number | null | undefined

  if (normalizedRawModel?.toLowerCase() === 'default') {
    resolvedModel = undefined
  } else if (normalizedRawModel?.includes(',')) {
    const commaIdx = normalizedRawModel.indexOf(',')
    const serviceKey = normalizedRawModel.slice(0, commaIdx).trim()
    const modelId = normalizedRawModel.slice(commaIdx + 1).trim()
    const service = modelServices[serviceKey]

    if (service) {
      const resolvedService = resolveConfiguredModelService(service)
      if (resolvedService) {
        const { title, apiBaseUrl, apiKey, extra, timeoutMs, maxOutputTokens } = resolvedService
        const { wireApi, queryParams, headers } = (extra?.codex as CodexModelProviderExtra | undefined) ?? {}
        const prefix = `model_providers.${serviceKey}`
        const normalizedBaseUrl = normalizeProviderBaseUrl(apiBaseUrl, wireApi)
        const normalizedHeaders = normalizeStringRecord(headers)
        const normalizedQueryParams = normalizeStringRecord(queryParams)
        const normalizedTimeoutMs = normalizePositiveInteger(timeoutMs)
        const normalizedMaxOutputTokens = normalizePositiveInteger(maxOutputTokens)
        const shouldProxyProvider = proxyBaseUrl != null && normalizedBaseUrl != null

        pushBoth(`model_provider=${toToml(serviceKey)}`)
        pushBoth(`${prefix}.name=${toToml(title ?? serviceKey)}`)
        if (shouldProxyProvider) {
          const proxyMeta = encodeCodexProxyMeta({
            upstreamBaseUrl: normalizedBaseUrl,
            ...(Object.keys(normalizedHeaders).length > 0 ? { headers: normalizedHeaders } : {}),
            ...(Object.keys(normalizedQueryParams).length > 0 ? { queryParams: normalizedQueryParams } : {}),
            ...(normalizedMaxOutputTokens != null ? { maxOutputTokens: normalizedMaxOutputTokens } : {}),
            ...(proxyLogContext != null ? { logContext: proxyLogContext } : {}),
            diagnostics: {
              ...proxyDiagnostics,
              routedServiceKey: serviceKey,
              resolvedModel: modelId || undefined,
              wireApi: wireApi ?? 'responses'
            }
          })
          const fingerprintProxyMeta = encodeCodexProxyMeta({
            upstreamBaseUrl: normalizedBaseUrl,
            ...(Object.keys(normalizedHeaders).length > 0 ? { headers: normalizedHeaders } : {}),
            ...(Object.keys(normalizedQueryParams).length > 0 ? { queryParams: normalizedQueryParams } : {}),
            ...(normalizedMaxOutputTokens != null ? { maxOutputTokens: normalizedMaxOutputTokens } : {}),
            diagnostics: {
              routedServiceKey: serviceKey,
              resolvedModel: modelId || undefined,
              wireApi: wireApi ?? 'responses'
            }
          })
          pushArgs(`${prefix}.base_url=${toToml(proxyBaseUrl)}`)
          pushFingerprintArgs(`${prefix}.base_url=${toToml(normalizedBaseUrl)}`)
          pushArgs(
            `${prefix}.http_headers=${toTomlInlineTable({ [CODEX_PROXY_META_HEADER_NAME]: proxyMeta })}`
          )
          pushFingerprintArgs(
            `${prefix}.http_headers=${toTomlInlineTable({ [CODEX_PROXY_META_HEADER_NAME]: fingerprintProxyMeta })}`
          )
        } else if (normalizedBaseUrl != null) {
          pushBoth(`${prefix}.base_url=${toToml(normalizedBaseUrl)}`)
        }
        if (apiKey) {
          pushBoth(`${prefix}.experimental_bearer_token=${toToml(apiKey)}`)
        }
        if (wireApi) {
          pushBoth(`${prefix}.wire_api=${toToml(wireApi)}`)
        }
        if (!shouldProxyProvider && Object.keys(normalizedHeaders).length > 0) {
          pushBoth(`${prefix}.http_headers=${toTomlInlineTable(normalizedHeaders)}`)
        }
        if (normalizedTimeoutMs != null) {
          pushBoth(`${prefix}.stream_idle_timeout_ms=${normalizedTimeoutMs}`)
        }
        resolvedMaxOutputTokens = shouldProxyProvider && normalizedMaxOutputTokens != null
          ? null
          : normalizedMaxOutputTokens
        if (!shouldProxyProvider && Object.keys(normalizedQueryParams).length > 0) {
          pushBoth(`${prefix}.query_params=${toTomlInlineTable(normalizedQueryParams)}`)
        }
      }
    }

    resolvedModel = modelId || undefined
  } else {
    resolvedModel = normalizedRawModel || undefined
  }

  return { args, fingerprintArgs, resolvedModel, resolvedMaxOutputTokens }
}

/**
 * Build `-c mcp_servers.<name>.*` overrides for each filtered MCP server.
 */
function buildMcpConfigArgs(
  servers: Record<string, unknown>,
  inheritedEnv: Record<string, string | null | undefined> = {}
): string[] {
  const toTomlKey = (name: string) => /^[\w-]+$/.test(name) ? name : JSON.stringify(name)
  const args: string[] = []
  const inheritedMcpEnv = pickInheritedMcpEnv(inheritedEnv)
  for (const [name, server] of Object.entries(servers)) {
    const {
      command,
      args: cmdArgs,
      env,
      url,
      headers,
      enabled,
      default_tools_approval_mode
    } = server as {
      command?: string
      args?: unknown[]
      env?: Record<string, string>
      url?: string
      headers?: Record<string, string>
      enabled?: boolean
      default_tools_approval_mode?: string
    }
    const prefix = `mcp_servers.${toTomlKey(name)}`

    if (enabled === false) {
      args.push('-c', `${prefix}.enabled=false`)
    }
    if (typeof command === 'string') {
      args.push('-c', `${prefix}.command=${toToml(command)}`)
      if (Array.isArray(cmdArgs) && cmdArgs.length > 0) {
        args.push('-c', `${prefix}.args=${JSON.stringify(cmdArgs)}`)
      }
      const mergedEnv = {
        ...inheritedMcpEnv,
        ...(env ?? {})
      }
      if (Object.keys(mergedEnv).length > 0) {
        args.push('-c', `${prefix}.env=${toTomlInlineTable(mergedEnv)}`)
      }
    } else if (typeof url === 'string') {
      args.push('-c', `${prefix}.url=${toToml(url)}`)
      if (headers != null && Object.keys(headers).length > 0) {
        args.push('-c', `${prefix}.http_headers=${toTomlInlineTable(headers)}`)
      }
    }
    if (
      default_tools_approval_mode === 'auto' ||
      default_tools_approval_mode === 'prompt' ||
      default_tools_approval_mode === 'approve'
    ) {
      args.push('-c', `${prefix}.default_tools_approval_mode=${toToml(default_tools_approval_mode)}`)
    }
  }
  return args
}

const withManagedMcpServerApprovalModes = (
  servers: Record<string, unknown>,
  permissions: Config['permissions'] | undefined
) =>
  Object.fromEntries(
    Object.entries(servers).map(([name, server]) => {
      const decision = resolveManagedPermissionDecision({
        permissions,
        subjectKeys: buildMcpServerPermissionSubjectKeys(name)
      })
      if (decision === 'inherit') return [name, server]

      const serverConfig = {
        ...(server != null && typeof server === 'object' && !Array.isArray(server)
          ? server as Record<string, unknown>
          : {})
      }
      if (decision === 'allow') {
        serverConfig.default_tools_approval_mode ??= 'approve'
      } else if (decision === 'ask') {
        serverConfig.default_tools_approval_mode ??= 'prompt'
      } else if (decision === 'deny') {
        serverConfig.enabled = false
      }

      return [name, serverConfig]
    })
  )

/**
 * Build `--enable <name>` / `--disable <name>` args from a features map.
 */
export function buildFeatureArgs(features: Record<string, boolean>): string[] {
  const args: string[] = []
  for (const [name, enabled] of Object.entries(features)) {
    args.push(enabled ? '--enable' : '--disable', name)
  }
  return args
}

/**
 * Map an array of oneworks `AdapterMessageContent` to Codex `turn/start` input items.
 */
export function mapContentToCodexInput(
  content: Array<{ type: string; text?: string; url?: string; path?: string; [k: string]: unknown }>
): CodexInputItem[] {
  return content
    .map(mapSingleContentToCodexInput)
    .filter((x): x is CodexInputItem => x != null)
}

export interface CodexSessionBase {
  logger: AdapterCtx['logger']
  cwd: string
  binaryPath: string
  spawnEnv: NodeJS.ProcessEnv
  resolvedAccount: string | undefined
  useYolo: boolean
  approvalPolicy: CodexApprovalPolicy
  sandboxPolicy: CodexSandboxPolicy
  features: Record<string, boolean>
  configOverrideArgs: string[]
  resolvedModel: string | undefined
  resolvedMaxOutputTokens: number | null | undefined
  effectiveEffort: AdapterQueryOptions['effort']
  turnEffort?: CodexReasoningEffort
  threadCacheKey: string
  cachedThreadId: string | undefined
}

export const getErrorSummary = (err: unknown) => (
  err instanceof Error ? err.message : String(err)
)

export const getErrorDetails = (err: unknown): unknown => (
  err instanceof CodexRpcError ? err.data : undefined
)

const formatErrorDetails = (value: unknown): string | undefined => {
  if (value == null) return undefined
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const getErrorMessage = (err: unknown) => {
  const summary = getErrorSummary(err)
  const details = formatErrorDetails(getErrorDetails(err))
  return details ? `${summary}\nDetails: ${details}` : summary
}

export const toAdapterErrorData = (
  err: unknown,
  overrides: Partial<{ message: string; code: string; details: unknown; fatal: boolean }> = {}
) => ({
  message: overrides.message ?? getErrorSummary(err),
  ...(overrides.code != null
    ? { code: overrides.code }
    : err instanceof CodexRpcError
    ? { code: String(err.code) }
    : {}),
  ...(overrides.details !== undefined
    ? { details: overrides.details }
    : getErrorDetails(err) !== undefined
    ? { details: getErrorDetails(err) }
    : {}),
  fatal: overrides.fatal ?? true
})

export const isInvalidEncryptedContentError = (err: unknown) => {
  const message = getErrorMessage(err)
  return message.includes('invalid_encrypted_content') || message.includes('organization_id did not match')
}

export const isStaleCachedThreadError = (err: unknown) => {
  const message = getErrorMessage(err).toLowerCase()
  return message.includes('no rollout found for thread id') ||
    message.includes('rollout not found') ||
    message.includes('thread not found')
}

// Keep this cache key stable across token refreshes for the same Codex account.
// If you change any field here, rerun a real resume smoke instead of trusting unit tests alone:
// run a session-scoped Codex tool call to completion, then send a follow-up tool call
// to the same session, then confirm the child task log shows `resuming thread` rather than
// starting a fresh thread and that the resumed turn still remembers prior context.
export async function buildThreadCacheKey(params: {
  cwd: string
  useYolo: boolean
  approvalPolicy: CodexApprovalPolicy
  sandboxPolicy: CodexSandboxPolicy
  resolvedModel: string | undefined
  authPath: string | undefined
  configFingerprintArgs: string[]
  features: Record<string, boolean>
}) {
  let authIdentity: CodexThreadCacheAuthIdentity | undefined
  let authDigest: string | undefined

  try {
    const authContent = await readFile(params.authPath ?? resolve(process.env.HOME!, '.codex', 'auth.json'), 'utf8')
    authIdentity = readThreadCacheAuthIdentityFromContent(authContent)
    authDigest = authIdentity == null
      ? createHash('sha256').update(authContent).digest('hex')
      : undefined
  } catch {
    authIdentity = undefined
    authDigest = undefined
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      cwd: params.cwd,
      useYolo: params.useYolo,
      approvalPolicy: params.approvalPolicy,
      sandboxPolicy: params.sandboxPolicy,
      model: params.resolvedModel ?? null,
      configOverrideArgs: params.configFingerprintArgs,
      features: params.features,
      authIdentity: authIdentity ?? null,
      authDigest: authDigest ?? null
    }))
    .digest('hex')

  return `context:${fingerprint}`
}

export async function resolveSessionBase(
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<CodexSessionBase> {
  const { logger, cwd, env, cache } = ctx
  const startupProfiler = createStartupProfiler({
    config: ctx.configState?.mergedConfig,
    cwd,
    ctxId: ctx.ctxId,
    env,
    sessionId: options.sessionId
  })
  const { mergedConfig } = resolveConfigState({
    configState: ctx.configState,
    configs: ctx.configs
  })
  const { common: commonConfig, native: nativeConfig } = resolveCodexAdapterConfig(ctx)

  const {
    sandboxPolicy: configSandboxPolicy,
    features: configFeatures,
    configOverrides: configOverridesValue
  } = nativeConfig
  const configuredEffort = commonConfig.effort as AdapterQueryOptions['effort'] | undefined

  const useYolo = shouldUseYolo(options.permissionMode)
  const approvalPolicy = resolveApprovalPolicy(options.permissionMode)
  const sandboxPolicy: CodexSandboxPolicy = withChannelRuntimeSandboxAccess(
    useYolo
      ? { type: 'dangerFullAccess' }
      : (configSandboxPolicy ?? { type: 'workspaceWrite' }),
    env
  )
  const features: Record<string, boolean> = { ...(configFeatures ?? {}) }

  const mergedModelServices: Record<string, ModelServiceConfig> = mergedConfig.modelServices ?? {}

  const configOverrides = mergeCodexConfigOverrides(
    isPlainObject(configOverridesValue) ? configOverridesValue : {}
  )
  const nativeReasoningEffort = normalizeCodexReasoningEffort(configOverrides.model_reasoning_effort)
  const requestedEffort = options.effort ?? configuredEffort
  const requestedReasoningEffort = mapPublicEffortToCodex(requestedEffort)
  const effectiveEffort = nativeReasoningEffort != null
    ? mapCodexEffortToPublic(nativeReasoningEffort)
    : requestedEffort

  const routedServiceKey = resolveRoutedServiceKey(options.model)
  const routedService = routedServiceKey != null ? mergedModelServices[routedServiceKey] : undefined
  const resolvedRoutedService = resolveConfiguredModelService(routedService)
  const shouldUseProxy = typeof resolvedRoutedService?.apiBaseUrl === 'string' &&
    resolvedRoutedService.apiBaseUrl.trim() !== ''
  const proxyLogger = shouldUseProxy
    ? createLogger(
      cwd,
      `${ctx.ctxId}/${options.sessionId ?? 'default'}/adapter-codex`,
      'proxy',
      '',
      'info',
      ctx.env as NodeJS.ProcessEnv
    )
    : undefined
  const proxyStartedAt = startupProfiler.now()
  const proxyBaseUrl = shouldUseProxy
    ? (await ensureCodexProxyServer(proxyLogger)).baseUrl
    : undefined
  startupProfiler.mark('codex.session.ensureProxyServer', proxyStartedAt)
  if (proxyBaseUrl != null && routedServiceKey != null && proxyLogger != null) {
    proxyLogger.info('[codex session] using local proxy for routed model service', {
      serviceKey: routedServiceKey,
      proxyBaseUrl,
      upstreamBaseUrl: normalizeProviderBaseUrl(
        resolvedRoutedService?.apiBaseUrl,
        ((resolvedRoutedService?.extra?.codex as CodexModelProviderExtra | undefined) ?? {}).wireApi
      ) ?? resolvedRoutedService?.apiBaseUrl
    })
  }

  const configOverridesStartedAt = startupProfiler.now()
  const {
    args: configOverrideArgs,
    fingerprintArgs: configFingerprintArgs,
    resolvedModel,
    resolvedMaxOutputTokens
  } = buildCodexConfigOverrides({
    systemPrompt: options.systemPrompt,
    rawModel: options.model,
    modelServices: mergedModelServices,
    proxyBaseUrl,
    proxyLogContext: proxyBaseUrl != null
      ? {
        cwd,
        ctxId: ctx.ctxId,
        env: pickProjectLogPathEnv(ctx.env),
        sessionId: options.sessionId ?? 'default'
      }
      : undefined,
    proxyDiagnostics: proxyBaseUrl != null
      ? {
        runtime: options.runtime,
        sessionType: options.type,
        permissionMode: options.permissionMode,
        approvalPolicy,
        sandboxPolicy: sandboxPolicy.type,
        useYolo,
        requestedModel: options.model,
        requestedEffort,
        effectiveEffort
      }
      : undefined
  })
  startupProfiler.mark('codex.session.buildConfigOverrides', configOverridesStartedAt)

  const nativeConfigOverrideArgs = buildNativeConfigOverrideArgs(configOverrides)
  configOverrideArgs.push(...nativeConfigOverrideArgs)
  configFingerprintArgs.push(...nativeConfigOverrideArgs)
  const sandboxConfigOverrideArgs = buildSandboxConfigOverrideArgs(sandboxPolicy)
  configOverrideArgs.push(...sandboxConfigOverrideArgs)
  configFingerprintArgs.push(...sandboxConfigOverrideArgs)
  if (nativeReasoningEffort == null && requestedReasoningEffort != null) {
    configOverrideArgs.push('-c', `model_reasoning_effort=${toToml(requestedReasoningEffort)}`)
    configFingerprintArgs.push('-c', `model_reasoning_effort=${toToml(requestedReasoningEffort)}`)
  }

  const filteredMcpServers: Record<string, unknown> = options.assetPlan?.mcpServers ?? (() => {
    const mergedMcpServers = mergedConfig.mcpServers ?? {}
    const defaultInclude = mergedConfig.defaultIncludeMcpServers ?? []
    const defaultExclude = mergedConfig.defaultExcludeMcpServers ?? []
    const includeMcpServers = options.mcpServers?.include ?? (defaultInclude.length > 0 ? defaultInclude : undefined)
    const excludeMcpServers = options.mcpServers?.exclude ?? (defaultExclude.length > 0 ? defaultExclude : undefined)

    const nextServers: Record<string, unknown> = {}
    for (const [key, server] of Object.entries(mergedMcpServers)) {
      if ((server as { enabled?: boolean }).enabled === false) continue
      if (includeMcpServers && !includeMcpServers.includes(key)) continue
      if (excludeMcpServers?.includes(key)) continue
      const { enabled: _enabled, ...serverConfig } = server as { enabled?: boolean; [k: string]: unknown }
      nextServers[key] = serverConfig
    }
    return nextServers
  })()

  const mcpArgsStartedAt = startupProfiler.now()
  const mcpConfigArgs = buildMcpConfigArgs(
    withManagedMcpServerApprovalModes(filteredMcpServers, mergedConfig.permissions),
    env
  )
  startupProfiler.mark('codex.session.buildMcpConfigArgs', mcpArgsStartedAt)
  configOverrideArgs.push(...mcpConfigArgs)
  configFingerprintArgs.push(...mcpConfigArgs)

  const binaryPath = resolveCodexBinaryPath(env, cwd)
  const spawnEnv = buildSpawnEnv(ctx)
  const sessionHomeStartedAt = startupProfiler.now()
  const runtimeHome = await prepareCodexSessionHome({
    ctx,
    sessionId: options.sessionId,
    account: options.account
  })
  startupProfiler.mark('codex.session.prepareSessionHome', sessionHomeStartedAt)
  spawnEnv.HOME = runtimeHome.homeDir
  await mkdir(resolve(spawnEnv.HOME ?? process.env.HOME!, '.codex'), { recursive: true })

  if (env.__ONEWORKS_PROJECT_CODEX_NATIVE_HOOKS_AVAILABLE__ === '1') {
    features.hooks = true
    spawnEnv.__ONEWORKS_CODEX_HOOKS_ACTIVE__ = '1'
    spawnEnv[NATIVE_HOOK_BRIDGE_ADAPTER_ENV] = 'codex'
    spawnEnv.__ONEWORKS_CODEX_HOOK_RUNTIME__ = options.runtime
    spawnEnv.__ONEWORKS_CODEX_TASK_SESSION_ID__ = options.sessionId
  }

  const threadCacheKeyStartedAt = startupProfiler.now()
  const threadCacheKey = await buildThreadCacheKey({
    cwd,
    useYolo,
    approvalPolicy,
    sandboxPolicy,
    resolvedModel,
    authPath: runtimeHome.authFilePath ?? resolve(spawnEnv.HOME, '.codex', 'auth.json'),
    configFingerprintArgs,
    features
  })
  startupProfiler.mark('codex.session.buildThreadCacheKey', threadCacheKeyStartedAt)
  let cachedThreadId: string | undefined
  if (options.type === 'resume') {
    const resumeCacheStartedAt = startupProfiler.now()
    const cachedThreads = await cache.get('adapter.codex.threads')
    startupProfiler.mark('codex.session.resumeCacheGet', resumeCacheStartedAt)
    cachedThreadId = cachedThreads?.[threadCacheKey]
    if (cachedThreadId == null) {
      cachedThreadId = pickSoleCachedThreadId(cachedThreads)
      if (cachedThreadId != null) {
        logger.warn('[codex session] using sole cached thread after cache key miss', {
          sessionId: options.sessionId,
          threadCacheKey
        })
      }
    }
  }

  return {
    logger,
    cwd,
    binaryPath,
    spawnEnv,
    resolvedAccount: runtimeHome.accountKey,
    useYolo,
    approvalPolicy,
    sandboxPolicy,
    features,
    configOverrideArgs,
    resolvedModel,
    resolvedMaxOutputTokens,
    effectiveEffort,
    turnEffort: nativeReasoningEffort == null ? requestedReasoningEffort : undefined,
    threadCacheKey,
    cachedThreadId
  }
}
