/* eslint-disable max-lines -- codex account runtime intentionally centralizes the account management flow. */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'

import { updateGlobalAdapterAccounts, withCanonicalConfigWriteLock } from '@oneworks/config'
import { resolveMockHome } from '@oneworks/hooks'
import { bridgeRealHomeToMockHome } from '@oneworks/register/mock-home-bridge'
import type {
  AdapterAccountActionDescriptor,
  AdapterAccountDetail,
  AdapterAccountDetailQueryOptions,
  AdapterAccountDetailResult,
  AdapterAccountInfo,
  AdapterAccountsQueryOptions,
  AdapterAccountsResult,
  AdapterCtx,
  AdapterManageAccountOptions,
  AdapterManageAccountResult
} from '@oneworks/types'
import {
  DEFAULT_GLOBAL_OO_CONFIG_FILE,
  addAdapterAccountTombstone,
  createAdapterAccountGeneration,
  createAdapterCredentialRevision,
  createStartupProfiler,
  filterActiveAdapterAccounts,
  getAdapterConfiguredDefaultAccount,
  isAdapterAccountGenerationDeleted,
  mergeAdapterConfigs,
  mergeProcessEnvWithProjectEnv,
  normalizeAdapterAccountTombstones,
  normalizeNonEmptyString,
  resolveGlobalAdapterAccountDir,
  resolveGlobalOneWorksDir,
  resolveProjectOoPath,
  sanitizeOneWorksLoaderEnv,
  syncSymlinkTarget,
  unlinkMockHomeBridgePaths
} from '@oneworks/utils'
import { createLogger } from '@oneworks/utils/create-logger'

import { ensureCodexCli } from '#~/ensure-cli.js'
import { resolveCodexBinaryPath } from '#~/paths.js'
import { CodexRpcClient } from '#~/protocol/rpc.js'
import { fetchCodexProfileFromFile } from '#~/runtime/account-profile.js'
import { writeCodexPrivateFileAtomically } from '#~/runtime/atomic-file.js'
import { ensureCodexConfigCliCompatibility } from '#~/runtime/config.js'
import { ensureCodexNativeHookTrustState, ensureCodexSharedNativeHooksInstalled } from '#~/runtime/native-hooks.js'

interface CodexConfiguredAccount {
  title?: string
  description?: string
  authFile?: string
  auth?: CodexInlineAuthConfig
  displayName?: string
  email?: string
  avatarUrl?: string
  planType?: string
  accountType?: string
  accountId?: string
  organizationId?: string
  organizationTitle?: string
  organizationRole?: string
  quota?: AdapterAccountInfo['quota']
  resetCreditDetailsCapturedAt?: number
  source?: string
  createdAt?: number
  updatedAt?: number
  authDigest?: string
  generation?: string
  credentialRevision?: string
  credentialUpdatedAt?: number
  priority?: number
  disabled?: boolean
}

interface CodexAccountPoolConfig {
  enabled: boolean
  strategy: 'sticky-priority'
  cooldownMs: number
}

interface CodexAccountPoolHealthEntry {
  credentialFingerprint?: string
  retryAt: number
  reason: 'auth' | 'plan' | 'rate_limit' | 'transient'
}

// Runtime health belongs to the workspace/account/model, not to one task or
// session cache. Keeping it process-local also lets the accounts API and new
// sessions observe the same cooldown without syncing ephemeral health data.
const codexAccountPoolHealth = new Map<string, CodexAccountPoolHealthEntry>()
const MAX_CODEX_ACCOUNT_POOL_HEALTH_ENTRIES = 512

const accountPoolHealthKey = (
  cwd: string,
  accountKey: string,
  model: string | undefined
) => `${resolve(cwd)}\u0000${accountKey}\u0000${model ?? ''}`

const getActiveAccountPoolHealth = (
  cwd: string,
  descriptor: CodexAccountDescriptor,
  model: string | undefined,
  now = Date.now()
) => {
  const key = accountPoolHealthKey(cwd, descriptor.key, model)
  const entry = codexAccountPoolHealth.get(key)
  if (
    entry == null ||
    entry.retryAt <= now ||
    entry.credentialFingerprint !== descriptor.credentialFingerprint
  ) {
    if (entry != null) codexAccountPoolHealth.delete(key)
    return undefined
  }
  return entry
}

interface CodexInlineAuthConfig {
  storage?: string
  type?: string
  version?: number
  portability?: string
  encoding?: string
  token?: string
  value?: string
  ref?: string
  binding?: string
}

interface CodexGlobalAccountCredentialRevision {
  authFile?: string
  authFileDigest?: string
  inlineAuthDigest?: string
  generation?: string
  credentialRevision?: string
}

interface CodexGlobalAccountCredentialState extends CodexGlobalAccountCredentialRevision {
  accountKey: string
  tombstones: string[]
}

interface CodexResetCreditEffectiveSourceState {
  contentDigest?: string
  exists: boolean
  inlineDigest?: string
  resolvedPath?: string
  stableIdentity?: CodexStableCredentialIdentity
  sourceKind: 'global-config' | 'configured-auth-file' | 'real-home'
}

interface CodexStableCredentialIdentity {
  accountId?: string
  organizationId?: string
}

interface CodexResetCreditCredentialState {
  accountKey: string
  canonicalAccount?: CodexGlobalAccountCredentialRevision
  canonicalConfigBacked: boolean
  canonicalConfigExists: boolean
  effectiveSource: CodexResetCreditEffectiveSourceState
  tombstones: string[]
}

interface CodexInlineCredentialSnapshot {
  credentialRevision: string | null
  generation: string | null
  sourceDigest: string
}

interface CodexInlineCredentialOwnerState {
  acceptedSnapshots: CodexInlineCredentialSnapshot[]
  accountKey: string
  initialized: boolean
  ownerId: string
  pendingSnapshot?: {
    from: CodexInlineCredentialSnapshot
    to: CodexInlineCredentialSnapshot
  }
  version: 1
}

interface CodexAccountIdentity {
  displayName?: string
  email?: string
  planType?: string
  accountType?: string
  accountId?: string
  organizationId?: string
  organizationTitle?: string
  organizationRole?: string
}

interface CodexStoredAccountMetadata extends CodexAccountIdentity {
  title?: string
  description?: string
  avatarUrl?: string
  quota?: AdapterAccountInfo['quota']
  resetCreditDetailsCapturedAt?: number
  source?: string
  createdAt?: number
  updatedAt?: number
  authDigest?: string
}

interface CodexAccountDescriptor {
  key: string
  title?: string
  description?: string
  authFilePath?: string
  authContent?: string
  sourceKind?: 'global-config' | 'configured-auth-file' | 'real-home'
  credentialSourceKind?: 'global-config' | 'configured-auth-file' | 'real-home'
  credentialSourceDigest?: string
  credentialSourceIdentity?: CodexAccountIdentity
  canonicalConfigBacked?: boolean
  status: NonNullable<AdapterAccountInfo['status']>
  metadata?: CodexStoredAccountMetadata
  identity?: CodexAccountIdentity
  priority: number
  disabled: boolean
  credentialFingerprint?: string
  inlineCredentialSnapshot?: CodexInlineCredentialSnapshot
}

interface CodexAccountProbe extends CodexAccountIdentity {
  avatarUrl?: string
  quota?: AdapterAccountInfo['quota']
  resetCreditDetailsCapturedAt?: number
  resetCreditOutcome?: CodexRateLimitResetCreditOutcome
}

interface CodexAccountProbeResult {
  probe: CodexAccountProbe
  authContent: string
  credentialsValidated: boolean
}

type CodexRateLimitResetCreditOutcome = 'reset' | 'alreadyRedeemed' | 'nothingToReset' | 'noCredit'

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
  title?: unknown
  role?: unknown
  is_default?: unknown
}

const CODEX_ACCOUNT_LIST_ACTIONS: AdapterAccountActionDescriptor[] = [
  {
    key: 'add',
    label: 'Add account',
    description:
      'Run `codex login` in an isolated home and save the resulting auth.json into the global OneWorks config.',
    scope: 'adapter'
  }
]

const CODEX_ACCOUNT_DETAIL_ACTIONS: AdapterAccountActionDescriptor[] = [
  {
    key: 'reauthenticate',
    label: 'Sign in again',
    description: 'Run `codex login` again and replace the stored credentials for this account.',
    scope: 'account'
  },
  {
    key: 'refresh',
    label: 'Refresh quota',
    description: 'Refresh the latest Codex plan and quota snapshot for this account.',
    scope: 'account'
  },
  {
    key: 'remove',
    label: 'Remove account',
    description: 'Remove the global Codex account entry for this account.',
    scope: 'account'
  }
]

const CODEX_QUOTA_CACHE_TTL_MS = 5 * 60 * 1000
const CODEX_RESET_CREDIT_OPERATION_TIMEOUT_MS = 20_000
const CODEX_RESET_CREDIT_OPERATION_TIMEOUT_ENV = '__ONEWORKS_PROJECT_ADAPTER_CODEX_RESET_CREDIT_OPERATION_TIMEOUT_MS__'
const CODEX_INLINE_AUTH_TYPE = 'codex-auth-json'
const CODEX_INLINE_AUTH_ENCODING = 'base64'
const CODEX_INLINE_CREDENTIAL_OWNER_STATE_FILE = 'credential-owner.json'
const codexAccountQuotaCacheTails = new Map<string, Promise<void>>()

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const pathExists = async (targetPath: string) => {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

const readDirSafe = async (targetPath: string) => {
  try {
    return await readdir(targetPath, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

const createAbortError = () => {
  const error = new Error('Codex login canceled.')
  error.name = 'AbortError'
  return error
}

const throwIfAborted = (signal: AbortSignal | undefined) => {
  if (signal?.aborted === true) {
    throw createAbortError()
  }
}

const buildSpawnEnv = (ctx: Pick<AdapterCtx, 'cwd' | 'env'>): NodeJS.ProcessEnv => {
  const env = sanitizeOneWorksLoaderEnv(
    mergeProcessEnvWithProjectEnv(ctx.env, { workspaceFolder: ctx.cwd })
  )
  delete env.NODE_OPTIONS
  return env
}

const resolveCodexGlobalConfigPath = (ctx: Pick<AdapterCtx, 'env'>) => (
  resolve(resolveGlobalOneWorksDir(ctx.env), DEFAULT_GLOBAL_OO_CONFIG_FILE)
)

const resolveCodexSessionHomeDir = (ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId'>, sessionId: string) => (
  resolveProjectOoPath(ctx.cwd, ctx.env, 'caches', ctx.ctxId, sessionId, 'adapter-codex-home')
)

const resolveCodexAppServerHomeDir = (
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>,
  profileKey: string,
  shared: boolean
) =>
  shared
    ? resolve(resolveGlobalOneWorksDir(ctx.env), 'caches', 'adapter-codex-app-server', profileKey)
    : resolveProjectOoPath(ctx.cwd, ctx.env, 'caches', 'adapter-codex-app-server', profileKey)

const resolveCodexProbeHomeDir = (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId'>,
  suffix: string
) => resolveProjectOoPath(ctx.cwd, ctx.env, 'caches', ctx.ctxId, 'adapter-codex-accounts', suffix)

const resolveCodexInlineCredentialOwnerPath = (
  ctx: Pick<AdapterCtx, 'env'>,
  ownerId: string
) =>
  resolve(
    resolveGlobalOneWorksDir(ctx.env),
    'caches',
    'adapter-codex-credentials',
    ownerId,
    'auth.json'
  )

const resolveCodexInlineCredentialOwnerStatePath = (
  ctx: Pick<AdapterCtx, 'env'>,
  accountKey: string
) =>
  resolve(
    resolveGlobalAdapterAccountDir(ctx.env, 'codex', accountKey),
    CODEX_INLINE_CREDENTIAL_OWNER_STATE_FILE
  )

const MISSING_AUTH_SENTINEL_FILE = '.oneworks-missing-auth.json'
const CODEX_RUNTIME_STATE_BRIDGE_PATHS = [
  '.codex/archived_sessions',
  '.codex/history.jsonl',
  '.codex/log',
  '.codex/session_index.jsonl',
  '.codex/state',
  '.codex/sqlite',
  '.codex/transcription-history.jsonl'
] as const
const CODEX_SESSION_HOME_BRIDGE_EXCLUDED_ENTRIES = [
  '.oneworks',
  '.codex'
] as const
const isCodexRuntimeStateBridgeEntry = (entryName: string) => (
  entryName.startsWith('goals_') ||
  entryName.startsWith('state') ||
  entryName.startsWith('memories_') ||
  entryName.startsWith('logs_')
)

const slugifyAccountKey = (value: string) => (
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
)

const compactIdentityFragment = (value: string | undefined) => {
  const normalized = normalizeNonEmptyString(value)
  if (normalized == null) {
    return undefined
  }

  const compact = normalized
    .replace(/^[a-z]+-/i, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase()

  return compact === ''
    ? undefined
    : compact.slice(-8)
}

const formatPlanType = (value: string | undefined) => {
  switch (value) {
    case 'free':
      return 'Free'
    case 'go':
      return 'Go'
    case 'plus':
      return 'Plus'
    case 'pro':
      return 'Pro'
    case 'team':
      return 'Team'
    case 'business':
      return 'Business'
    case 'enterprise':
      return 'Enterprise'
    case 'edu':
      return 'Edu'
    case 'unknown':
      return 'Unknown'
    default:
      return undefined
  }
}

const CODEX_GENERATED_CONTEXT_LABELS = new Set([
  'personal',
  'free',
  'go',
  'plus',
  'pro',
  'team',
  'business',
  'enterprise',
  'edu',
  'unknown'
])
const CODEX_GENERIC_ACCOUNT_TITLES = new Set([
  'codex',
  'codex cli'
])

const isGenericCodexOrganizationTitle = (value: string | undefined) => {
  const normalized = normalizeNonEmptyString(value)
  if (normalized == null) {
    return false
  }

  return normalized.toLowerCase() === 'personal'
}

const shouldPreferPlanLabelForTitle = (planType: string | undefined) => {
  switch (planType) {
    case 'team':
    case 'business':
    case 'enterprise':
    case 'edu':
      return true
    default:
      return false
  }
}

const resolveCodexAccountContextTitle = (probe: CodexAccountProbe | undefined) => {
  const organizationTitle = normalizeNonEmptyString(probe?.organizationTitle)
  const normalizedPlanType = normalizeNonEmptyString(probe?.planType)
  const planLabel = formatPlanType(normalizedPlanType)

  if (
    organizationTitle != null &&
    !(
      isGenericCodexOrganizationTitle(organizationTitle) &&
      shouldPreferPlanLabelForTitle(normalizedPlanType)
    )
  ) {
    return organizationTitle
  }

  return planLabel ?? organizationTitle
}

const buildLegacyImportedAccountTitle = (params: {
  key: string
  probe?: CodexAccountProbe
}) => {
  const normalizedEmail = normalizeNonEmptyString(params.probe?.email)
  const normalizedOrganizationTitle = normalizeNonEmptyString(params.probe?.organizationTitle)
  if (normalizedEmail != null) {
    return normalizedOrganizationTitle != null
      ? `${normalizedEmail} · ${normalizedOrganizationTitle}`
      : normalizedEmail
  }

  if (params.probe?.accountType === 'apiKey') {
    return `API Key ${params.key.slice(-8)}`
  }

  return params.key
}

const formatCreditsValue = (value: number) => `${value.toLocaleString('en-US')} credits`

const parseFiniteNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim()
    if (normalized !== '') {
      const parsed = Number(normalized)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return undefined
}

const resolveCodexResetCreditOperationTimeoutMs = (env: AdapterCtx['env']) => {
  const configuredTimeout = parseFiniteNumber(env[CODEX_RESET_CREDIT_OPERATION_TIMEOUT_ENV])
  return configuredTimeout != null && configuredTimeout > 0
    ? Math.floor(configuredTimeout)
    : CODEX_RESET_CREDIT_OPERATION_TIMEOUT_MS
}

const formatRateLimitWindow = (minutes: number | undefined) => {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) {
    return undefined
  }

  if (minutes % (60 * 24) === 0) {
    return `${minutes / (60 * 24)}d`
  }

  if (minutes % 60 === 0) {
    return `${minutes / 60}h`
  }

  return `${minutes}m`
}

const formatRateLimitResetAt = (epochSeconds: number | undefined) => {
  if (epochSeconds == null || !Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return undefined
  }

  const date = new Date(epochSeconds * 1000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

const cloneQuotaInfo = (quota: AdapterAccountInfo['quota']) => (
  quota == null
    ? undefined
    : {
      ...quota,
      metrics: quota.metrics?.map(metric => ({ ...metric })),
      rateLimitResetCredits: quota.rateLimitResetCredits == null
        ? undefined
        : {
          ...quota.rateLimitResetCredits,
          credits: quota.rateLimitResetCredits.credits?.map(credit => ({ ...credit }))
        }
    }
)

const getReusableResetCreditDetails = (
  resetCredits: NonNullable<AdapterAccountInfo['quota']>['rateLimitResetCredits']
) =>
  (resetCredits?.credits ?? []).filter((credit) => {
    const status = normalizeNonEmptyString(credit.status)?.toLowerCase()
    if (status === 'expired' || status === 'redeemed' || status === 'used') return false
    return credit.expiresAt == null || credit.expiresAt > Date.now() / 1000
  })

const mergeRateLimitResetCredits = (
  previous: NonNullable<AdapterAccountInfo['quota']>['rateLimitResetCredits'],
  incoming: NonNullable<AdapterAccountInfo['quota']>['rateLimitResetCredits']
) => {
  if (incoming == null) return undefined
  if (previous == null || previous.availableCount !== incoming.availableCount) {
    return {
      ...incoming,
      credits: incoming.credits?.map(credit => ({ ...credit }))
    }
  }

  const incomingCredits = incoming.credits ?? []
  const reusablePreviousCredits = getReusableResetCreditDetails(previous)
  if (
    reusablePreviousCredits.length === 0 ||
    incomingCredits.length >= incoming.availableCount
  ) {
    return {
      ...incoming,
      credits: incoming.credits?.map(credit => ({ ...credit }))
    }
  }

  const incomingIds = new Set(incomingCredits.map(credit => credit.id))
  const mergedCredits = [
    ...incomingCredits,
    ...reusablePreviousCredits.filter(credit => !incomingIds.has(credit.id))
  ].slice(0, incoming.availableCount)

  return {
    ...incoming,
    credits: mergedCredits.map(credit => ({ ...credit }))
  }
}

const mergeQuotaInfo = (
  previous: AdapterAccountInfo['quota'],
  incoming: NonNullable<AdapterAccountInfo['quota']>
): NonNullable<AdapterAccountInfo['quota']> => ({
  ...incoming,
  metrics: incoming.metrics?.map(metric => ({ ...metric })),
  rateLimitResetCredits: mergeRateLimitResetCredits(
    previous?.rateLimitResetCredits,
    incoming.rateLimitResetCredits
  )
})

const normalizeCodexIdentity = (
  identity: CodexAccountIdentity | undefined
): CodexAccountIdentity | undefined => {
  if (identity == null) {
    return undefined
  }

  const normalized: CodexAccountIdentity = {
    displayName: normalizeNonEmptyString(identity.displayName),
    email: normalizeNonEmptyString(identity.email),
    planType: normalizeNonEmptyString(identity.planType),
    accountType: normalizeNonEmptyString(identity.accountType),
    accountId: normalizeNonEmptyString(identity.accountId),
    organizationId: normalizeNonEmptyString(identity.organizationId),
    organizationTitle: normalizeNonEmptyString(identity.organizationTitle),
    organizationRole: normalizeNonEmptyString(identity.organizationRole)
  }

  return Object.values(normalized).some(value => value != null) ? normalized : undefined
}

const toCodexStableCredentialIdentity = (
  identity: CodexAccountIdentity | undefined
): CodexStableCredentialIdentity | undefined => {
  const normalized = normalizeCodexIdentity(identity)
  if (normalized?.accountId == null && normalized?.organizationId == null) return undefined
  return {
    accountId: normalized.accountId,
    organizationId: normalized.organizationId
  }
}

const mergeCodexProbeWithCredentialIdentityAuthority = (
  authIdentity: CodexAccountProbe | undefined,
  metadata: CodexAccountProbe | CodexAccountIdentity | undefined
) => {
  const merged = mergeCodexAccountProbes(authIdentity, metadata)
  const stableAuthIdentity = toCodexStableCredentialIdentity(authIdentity)
  if (stableAuthIdentity?.accountId == null) return merged

  return {
    ...merged,
    accountId: stableAuthIdentity.accountId,
    organizationId: stableAuthIdentity.organizationId
  }
}

const codexStableCredentialIdentitiesMatch = (
  left: CodexStableCredentialIdentity | undefined,
  right: CodexStableCredentialIdentity | undefined
) => left?.accountId === right?.accountId && left?.organizationId === right?.organizationId

const mergeCodexAccountProbes = (
  ...sources: Array<CodexAccountProbe | CodexAccountIdentity | undefined>
): CodexAccountProbe | undefined => {
  const merged: CodexAccountProbe = {}

  for (const source of sources) {
    if (source == null) {
      continue
    }

    const normalizedIdentity = normalizeCodexIdentity(source)
    if (normalizedIdentity != null) {
      for (const [key, value] of Object.entries(normalizedIdentity)) {
        if (value != null) {
          merged[key as keyof CodexAccountIdentity] = value
        }
      }
    }

    if ('quota' in source && source.quota != null) {
      merged.quota = mergeQuotaInfo(merged.quota, source.quota)
    }
    const avatarUrl = 'avatarUrl' in source
      ? normalizeNonEmptyString(source.avatarUrl)
      : undefined
    if (avatarUrl != null) {
      merged.avatarUrl = avatarUrl
    }
    if (
      'resetCreditDetailsCapturedAt' in source &&
      source.resetCreditDetailsCapturedAt != null
    ) {
      merged.resetCreditDetailsCapturedAt = source.resetCreditDetailsCapturedAt
    }
    if ('resetCreditOutcome' in source && source.resetCreditOutcome != null) {
      merged.resetCreditOutcome = source.resetCreditOutcome
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

const decodeJwtPayload = (token: string | undefined) => {
  const normalized = normalizeNonEmptyString(token)
  if (normalized == null) {
    return undefined
  }

  const payload = normalized.split('.')[1]
  if (payload == null || payload === '') {
    return undefined
  }

  try {
    const decoded = Buffer.from(payload, 'base64url').toString('utf8')
    const parsed = JSON.parse(decoded)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

const parseStoredAuthTokens = (value: unknown): CodexStoredAuthTokens | undefined => (
  isRecord(value) ? value as CodexStoredAuthTokens : undefined
)

const pickPrimaryOrganization = (value: unknown) => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const organizations = value
    .filter(isRecord)
    .map(entry => entry as CodexJwtOrganizationClaim)

  return organizations.find(entry => entry.is_default === true) ?? organizations[0]
}

const readCodexAuthIdentityFromContent = (authContent: string): CodexAccountProbe | undefined => {
  try {
    const parsed = JSON.parse(authContent) as CodexStoredAuthFile
    const tokens = parseStoredAuthTokens(parsed.tokens)
    const idTokenPayload = decodeJwtPayload(
      typeof tokens?.id_token === 'string' ? tokens.id_token : undefined
    )
    const authClaims = isRecord(idTokenPayload?.['https://api.openai.com/auth'])
      ? idTokenPayload['https://api.openai.com/auth']
      : undefined
    const organization = pickPrimaryOrganization(authClaims?.organizations)
    const accountType = typeof parsed.auth_mode === 'string'
      ? parsed.auth_mode === 'api_key'
        ? 'apiKey'
        : parsed.auth_mode
      : undefined

    return mergeCodexAccountProbes({
      accountType,
      displayName: typeof idTokenPayload?.name === 'string'
        ? idTokenPayload.name
        : undefined,
      email: typeof idTokenPayload?.email === 'string' ? idTokenPayload.email : undefined,
      planType: typeof authClaims?.chatgpt_plan_type === 'string'
        ? authClaims.chatgpt_plan_type
        : undefined,
      accountId: typeof authClaims?.chatgpt_account_id === 'string'
        ? authClaims.chatgpt_account_id
        : typeof tokens?.account_id === 'string'
        ? tokens.account_id
        : undefined,
      organizationId: typeof organization?.id === 'string' ? organization.id : undefined,
      organizationTitle: typeof organization?.title === 'string' ? organization.title : undefined,
      organizationRole: typeof organization?.role === 'string' ? organization.role : undefined
    })
  } catch {
    return undefined
  }
}

const readCodexAuthIdentityFromFile = async (authFilePath: string | undefined) => {
  if (authFilePath == null) {
    return undefined
  }

  try {
    return readCodexAuthIdentityFromContent(await readFile(authFilePath, 'utf8'))
  } catch {
    return undefined
  }
}

const readCodexAuthSourceFingerprintFromFile = async (authFilePath: string | undefined) => {
  if (authFilePath == null) {
    return undefined
  }

  try {
    const authContent = await readFile(authFilePath, 'utf8')
    return {
      authDigest: createHash('sha256').update(authContent).digest('hex'),
      identity: readCodexAuthIdentityFromContent(authContent)
    }
  } catch {
    return undefined
  }
}

const isSameCodexAccountIdentity = (
  left: CodexAccountIdentity | undefined,
  right: CodexAccountIdentity | undefined
) => {
  const normalizedLeft = normalizeCodexIdentity(left)
  const normalizedRight = normalizeCodexIdentity(right)
  if (normalizedLeft == null || normalizedRight == null) {
    return false
  }

  if (
    normalizedLeft.accountId == null ||
    normalizedRight.accountId == null ||
    normalizedLeft.accountId !== normalizedRight.accountId
  ) {
    return false
  }

  if (
    normalizedLeft.organizationId != null &&
    normalizedRight.organizationId != null &&
    normalizedLeft.organizationId !== normalizedRight.organizationId
  ) {
    return false
  }

  return true
}

const buildProbeFromMetadata = (metadata: CodexStoredAccountMetadata | undefined): CodexAccountProbe | undefined => {
  return mergeCodexAccountProbes(
    metadata == null ? undefined : {
      displayName: metadata.displayName,
      email: metadata.email,
      planType: metadata.planType,
      accountType: metadata.accountType,
      accountId: metadata.accountId,
      organizationId: metadata.organizationId,
      organizationTitle: metadata.organizationTitle,
      organizationRole: metadata.organizationRole,
      avatarUrl: metadata.avatarUrl,
      quota: metadata.quota,
      resetCreditDetailsCapturedAt: metadata.resetCreditDetailsCapturedAt
    }
  )
}

const getCachedProbe = (
  metadata: CodexStoredAccountMetadata | undefined,
  refresh?: boolean
): CodexAccountProbe | undefined => {
  if (refresh === true) {
    return undefined
  }

  const updatedAt = parseFiniteNumber(metadata?.quota?.updatedAt)
  if (updatedAt == null || Date.now() - updatedAt > CODEX_QUOTA_CACHE_TTL_MS) {
    return undefined
  }

  return buildProbeFromMetadata(metadata)
}

const buildAccountQuotaCacheAddress = (
  ctx: Pick<AdapterCtx, 'cwd'>,
  descriptor: CodexAccountDescriptor
) => {
  const workspace = resolve(ctx.cwd)
  const identity = normalizeCodexIdentity({
    ...descriptor.metadata,
    ...descriptor.identity
  })
  const authDigest = normalizeNonEmptyString(descriptor.metadata?.authDigest) ??
    (
      descriptor.authContent == null
        ? undefined
        : createHash('sha256').update(descriptor.authContent).digest('hex')
    )
  const hasStableRealHomeIdentity = descriptor.sourceKind === 'real-home' && (
    identity?.accountId != null ||
    identity?.email != null ||
    identity?.organizationId != null
  )
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      identity: {
        accountId: identity?.accountId ?? null,
        accountType: identity?.accountType ?? null,
        email: identity?.email?.toLowerCase() ?? null,
        organizationId: identity?.organizationId ?? null,
        organizationRole: identity?.organizationRole ?? null,
        organizationTitle: identity?.organizationTitle?.toLowerCase() ?? null,
        planType: identity?.planType ?? null
      },
      source: {
        // A signed-in Codex home rotates access/refresh tokens during ordinary reads.
        // Once it exposes stable account identity, let that identity isolate the cache
        // instead of treating routine token rotation as an account replacement.
        authDigest: hasStableRealHomeIdentity ? null : authDigest ?? null,
        authFilePath: descriptor.authFilePath == null ? null : resolve(descriptor.authFilePath),
        kind: descriptor.sourceKind ?? null,
        metadataSource: normalizeNonEmptyString(descriptor.metadata?.source) ?? null
      }
    }))
    .digest('hex')

  return {
    workspace,
    accountKey: descriptor.key,
    fingerprint,
    cacheKey: JSON.stringify([2, workspace, descriptor.key, fingerprint])
  }
}

interface CodexAccountQuotaCacheEntry {
  workspace?: string
  accountKey?: string
  fingerprint?: string
  quota: NonNullable<AdapterAccountInfo['quota']>
  resetCreditDetailsCapturedAt?: number
}

const normalizeAccountQuotaCacheEntry = (
  value: unknown
): CodexAccountQuotaCacheEntry | undefined => {
  if (!isRecord(value)) return undefined

  const rawQuota = isRecord(value.quota) ? value.quota : value
  const quota = cloneQuotaInfo(rawQuota as NonNullable<AdapterAccountInfo['quota']>)
  if (quota == null) return undefined

  const resetCreditDetailsCapturedAt = parseFiniteNumber(value.resetCreditDetailsCapturedAt) ??
    (
      getReusableResetCreditDetails(quota.rateLimitResetCredits).length > 0
        ? parseFiniteNumber(quota.updatedAt)
        : undefined
    )

  return {
    workspace: normalizeNonEmptyString(value.workspace),
    accountKey: normalizeNonEmptyString(value.accountKey),
    fingerprint: normalizeNonEmptyString(value.fingerprint),
    quota,
    resetCreditDetailsCapturedAt
  }
}

const parseAccountQuotaCacheKey = (cacheKey: string) => {
  try {
    const parts = JSON.parse(cacheKey)
    if (!Array.isArray(parts)) return undefined

    if (parts[0] === 2) {
      return {
        workspace: normalizeNonEmptyString(parts[1]),
        accountKey: normalizeNonEmptyString(parts[2])
      }
    }

    return {
      workspace: normalizeNonEmptyString(parts[0]),
      accountKey: normalizeNonEmptyString(parts[1])
    }
  } catch {
    return undefined
  }
}

const isAccountQuotaCacheEntryForAccount = (params: {
  cacheKey: string
  value: unknown
  workspace: string
  accountKey: string
}) => {
  const entry = normalizeAccountQuotaCacheEntry(params.value)
  const parsedKey = parseAccountQuotaCacheKey(params.cacheKey)
  return (entry?.workspace ?? parsedKey?.workspace) === params.workspace &&
    (entry?.accountKey ?? parsedKey?.accountKey) === params.accountKey
}

const isQuotaSnapshotFresh = (timestamp: number | undefined) => (
  timestamp != null &&
  timestamp > 0 &&
  Date.now() - timestamp <= CODEX_QUOTA_CACHE_TTL_MS
)

const stripStaleResetCreditDetails = (
  quota: AdapterAccountInfo['quota'],
  resetCreditDetailsCapturedAt: number | undefined
) => {
  const clonedQuota = cloneQuotaInfo(quota)
  const resetCredits = clonedQuota?.rateLimitResetCredits
  if (
    resetCredits == null ||
    resetCredits.credits == null ||
    isQuotaSnapshotFresh(resetCreditDetailsCapturedAt)
  ) {
    return clonedQuota
  }

  return {
    ...clonedQuota,
    rateLimitResetCredits: {
      ...resetCredits,
      credits: undefined
    }
  }
}

const mergeLiveQuotaSnapshot = (params: {
  previous?: NonNullable<AdapterAccountInfo['quota']>
  incoming?: NonNullable<AdapterAccountInfo['quota']>
  previousResetCreditDetailsCapturedAt?: number
  preservePreviousResetCreditDetails: boolean
}) => {
  const {
    previous,
    incoming,
    previousResetCreditDetailsCapturedAt,
    preservePreviousResetCreditDetails
  } = params
  const previousResetCredits = previous?.rateLimitResetCredits
  const incomingResetCredits = incoming?.rateLimitResetCredits
  const previousHasReusableDetails = getReusableResetCreditDetails(previousResetCredits).length > 0
  const previousDetailsAreFresh = previousHasReusableDetails &&
    isQuotaSnapshotFresh(previousResetCreditDetailsCapturedAt)
  const canReusePreviousResetCreditDetails = preservePreviousResetCreditDetails && previousDetailsAreFresh

  if (incoming == null) {
    if (
      !canReusePreviousResetCreditDetails ||
      previous == null ||
      !isQuotaSnapshotFresh(parseFiniteNumber(previous.updatedAt))
    ) {
      return {
        quota: undefined,
        resetCreditDetailsCapturedAt: undefined
      }
    }

    return {
      quota: cloneQuotaInfo(previous),
      resetCreditDetailsCapturedAt: previousResetCreditDetailsCapturedAt
    }
  }

  const countChanged = previousResetCredits != null &&
    incomingResetCredits != null &&
    previousResetCredits.availableCount !== incomingResetCredits.availableCount
  const incomingWithResetCredits: NonNullable<AdapterAccountInfo['quota']> = incomingResetCredits == null &&
      previousResetCredits != null &&
      canReusePreviousResetCreditDetails
    ? {
      ...incoming,
      rateLimitResetCredits: {
        ...previousResetCredits,
        credits: getReusableResetCreditDetails(previousResetCredits).map(credit => ({ ...credit }))
      }
    }
    : incoming
  const previousForMerge = canReusePreviousResetCreditDetails
    ? previous
    : previous == null
    ? undefined
    : {
      ...previous,
      rateLimitResetCredits: previousResetCredits == null
        ? undefined
        : {
          ...previousResetCredits,
          credits: undefined
        }
    }
  const quota = preservePreviousResetCreditDetails
    ? mergeQuotaInfo(previousForMerge, incomingWithResetCredits)
    : mergeQuotaInfo(undefined, incomingWithResetCredits)
  const incomingReusableDetails = getReusableResetCreditDetails(incomingResetCredits)
  const reusableMergedDetails = getReusableResetCreditDetails(quota.rateLimitResetCredits)
  const resetCreditDetailsCapturedAt = incomingReusableDetails.length > 0
    ? Date.now()
    : countChanged || reusableMergedDetails.length === 0
    ? undefined
    : previousResetCreditDetailsCapturedAt

  return {
    quota,
    resetCreditDetailsCapturedAt
  }
}

const withCodexAccountQuotaCacheLock = async <T>(
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>,
  task: () => Promise<T>
): Promise<T> => {
  const lockKey = resolveCodexGlobalConfigPath(ctx)
  const previousTail = codexAccountQuotaCacheTails.get(lockKey) ?? Promise.resolve()
  let releaseCurrent: () => void = () => {}
  const currentGate = new Promise<void>((resolvePromise) => {
    releaseCurrent = resolvePromise
  })
  const currentTail = previousTail.catch(() => {}).then(() => currentGate)
  codexAccountQuotaCacheTails.set(lockKey, currentTail)

  await previousTail.catch(() => {})
  try {
    return await task()
  } finally {
    releaseCurrent()
    if (codexAccountQuotaCacheTails.get(lockKey) === currentTail) {
      codexAccountQuotaCacheTails.delete(lockKey)
    }
  }
}

const mergeProbeWithCachedQuotaUnlocked = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'cache'>
  descriptor: CodexAccountDescriptor
  probe?: CodexAccountProbe
  live?: boolean
}) => {
  const address = buildAccountQuotaCacheAddress(params.ctx, params.descriptor)
  const rawCachedQuotas = await params.ctx.cache.get('adapter.codex.account-quotas')
  const cachedQuotas = isRecord(rawCachedQuotas) ? rawCachedQuotas : {}
  const cachedEntry = normalizeAccountQuotaCacheEntry(cachedQuotas[address.cacheKey])
  const nextCachedQuotas = { ...cachedQuotas }
  let cacheChanged = false

  for (const [cacheKey, value] of Object.entries(cachedQuotas)) {
    if (
      cacheKey !== address.cacheKey &&
      isAccountQuotaCacheEntryForAccount({
        cacheKey,
        value,
        workspace: address.workspace,
        accountKey: address.accountKey
      })
    ) {
      delete nextCachedQuotas[cacheKey]
      cacheChanged = true
    }
  }

  const metadataProbe = buildProbeFromMetadata(params.descriptor.metadata)
  const metadataQuota = cloneQuotaInfo(metadataProbe?.quota)
  const metadataResetCreditDetailsCapturedAt = parseFiniteNumber(metadataProbe?.resetCreditDetailsCapturedAt) ??
    (
      getReusableResetCreditDetails(metadataQuota?.rateLimitResetCredits).length > 0
        ? parseFiniteNumber(metadataQuota?.updatedAt)
        : undefined
    )
  const previousQuota = cachedEntry?.quota ?? metadataQuota
  const previousResetCreditDetailsCapturedAt = cachedEntry?.resetCreditDetailsCapturedAt ??
    metadataResetCreditDetailsCapturedAt
  const mergedProbe = mergeCodexAccountProbes(
    metadataProbe == null ? undefined : { ...metadataProbe, quota: undefined },
    params.probe == null ? undefined : { ...params.probe, quota: undefined }
  ) ?? {}
  const liveQuota = params.probe?.quota
  const mergedQuotaResult = params.live === true
    ? mergeLiveQuotaSnapshot({
      previous: previousQuota,
      incoming: liveQuota,
      previousResetCreditDetailsCapturedAt,
      preservePreviousResetCreditDetails: params.probe?.resetCreditOutcome == null
    })
    : {
      quota: stripStaleResetCreditDetails(
        cachedEntry?.quota ?? liveQuota ?? metadataQuota,
        cachedEntry?.resetCreditDetailsCapturedAt ?? metadataResetCreditDetailsCapturedAt
      ),
      resetCreditDetailsCapturedAt: isQuotaSnapshotFresh(previousResetCreditDetailsCapturedAt)
        ? previousResetCreditDetailsCapturedAt
        : undefined
    }

  mergedProbe.resetCreditDetailsCapturedAt = mergedQuotaResult.resetCreditDetailsCapturedAt
  if (mergedQuotaResult.quota != null) {
    mergedProbe.quota = mergedQuotaResult.quota
    nextCachedQuotas[address.cacheKey] = {
      workspace: address.workspace,
      accountKey: address.accountKey,
      fingerprint: address.fingerprint,
      quota: mergedQuotaResult.quota,
      resetCreditDetailsCapturedAt: mergedQuotaResult.resetCreditDetailsCapturedAt
    }
    cacheChanged = true
  } else if (address.cacheKey in nextCachedQuotas) {
    delete nextCachedQuotas[address.cacheKey]
    cacheChanged = true
  }

  if (cacheChanged) {
    await params.ctx.cache.set('adapter.codex.account-quotas', nextCachedQuotas)
  }

  return Object.keys(mergedProbe).length > 0 ? mergedProbe : undefined
}

const clearCodexAccountQuotaCacheUnlocked = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'cache'>,
  accountKey: string
) => {
  const workspace = resolve(ctx.cwd)
  const rawCachedQuotas = await ctx.cache.get('adapter.codex.account-quotas')
  if (!isRecord(rawCachedQuotas)) return

  const nextCachedQuotas = { ...rawCachedQuotas }
  let cacheChanged = false
  for (const [cacheKey, value] of Object.entries(rawCachedQuotas)) {
    if (
      isAccountQuotaCacheEntryForAccount({
        cacheKey,
        value,
        workspace,
        accountKey
      })
    ) {
      delete nextCachedQuotas[cacheKey]
      cacheChanged = true
    }
  }

  if (cacheChanged) {
    await ctx.cache.set('adapter.codex.account-quotas', nextCachedQuotas)
  }
}

type CodexAccountFileCtx = Pick<AdapterCtx, 'cwd' | 'env'> & Partial<Pick<AdapterCtx, 'ctxId' | 'logger'>>

const resolveConfiguredAuthFilePath = (ctx: Pick<AdapterCtx, 'cwd'>, authFile: string | undefined) => {
  const normalized = normalizeNonEmptyString(authFile)
  if (normalized == null) {
    return undefined
  }

  return isAbsolute(normalized)
    ? resolve(normalized)
    : resolve(ctx.cwd, normalized)
}

const encodeCodexInlineAuthContent = (authContent: string): CodexInlineAuthConfig => ({
  storage: 'inline',
  type: CODEX_INLINE_AUTH_TYPE,
  version: 1,
  portability: 'portable',
  encoding: CODEX_INLINE_AUTH_ENCODING,
  token: Buffer.from(authContent, 'utf8').toString('base64')
})

const decodeCodexInlineAuthContent = (auth: CodexInlineAuthConfig | undefined) => {
  if (auth == null) {
    return undefined
  }

  const type = normalizeNonEmptyString(auth.type)
  const encoding = normalizeNonEmptyString(auth.encoding)
  const token = normalizeNonEmptyString(auth.token) ?? normalizeNonEmptyString(auth.value)
  if (
    token == null ||
    (type != null && type !== CODEX_INLINE_AUTH_TYPE) ||
    encoding !== CODEX_INLINE_AUTH_ENCODING
  ) {
    return undefined
  }

  return Buffer.from(token, CODEX_INLINE_AUTH_ENCODING).toString('utf8')
}

const buildCodexInlineCredentialSnapshot = (
  configuredAccount: CodexConfiguredAccount,
  authContent: string
): CodexInlineCredentialSnapshot => ({
  credentialRevision: normalizeNonEmptyString(configuredAccount.credentialRevision) ?? null,
  generation: normalizeNonEmptyString(configuredAccount.generation) ?? null,
  sourceDigest: createHash('sha256').update(authContent).digest('hex')
})

const createCodexAuthContentDigest = (authContent: string) => createHash('sha256').update(authContent).digest('hex')

const codexInlineCredentialSnapshotsMatch = (
  left: CodexInlineCredentialSnapshot,
  right: CodexInlineCredentialSnapshot
) => (
  left.credentialRevision === right.credentialRevision &&
  left.generation === right.generation &&
  left.sourceDigest === right.sourceDigest
)

const appendCodexInlineCredentialSnapshot = (
  snapshots: CodexInlineCredentialSnapshot[],
  snapshot: CodexInlineCredentialSnapshot
) => (
  snapshots.some(candidate => codexInlineCredentialSnapshotsMatch(candidate, snapshot))
    ? snapshots
    : [...snapshots, snapshot].slice(-16)
)

const buildCodexInlineCredentialOwnerId = (
  accountKey: string,
  snapshot: CodexInlineCredentialSnapshot
) =>
  createHash('sha256')
    .update(JSON.stringify({ accountKey, snapshot, version: 2 }))
    .digest('hex')

const isCodexInlineCredentialSnapshot = (
  value: unknown
): value is CodexInlineCredentialSnapshot => (
  isRecord(value) &&
  (value.credentialRevision === null || normalizeNonEmptyString(value.credentialRevision) != null) &&
  (value.generation === null || normalizeNonEmptyString(value.generation) != null) &&
  typeof value.sourceDigest === 'string' &&
  /^[a-f0-9]{64}$/u.test(value.sourceDigest)
)

const readCodexInlineCredentialOwnerState = async (
  targetPath: string,
  accountKey: string
): Promise<CodexInlineCredentialOwnerState | undefined> => {
  let targetStat
  try {
    targetStat = await lstat(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (!targetStat.isFile()) {
    throw new Error(`Codex account "${accountKey}" has an invalid local credential owner state.`)
  }

  const parsed = JSON.parse(await readFile(targetPath, 'utf8')) as unknown
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    parsed.accountKey !== accountKey ||
    typeof parsed.initialized !== 'boolean' ||
    typeof parsed.ownerId !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(parsed.ownerId) ||
    !Array.isArray(parsed.acceptedSnapshots) ||
    parsed.acceptedSnapshots.length === 0 ||
    !parsed.acceptedSnapshots.every(isCodexInlineCredentialSnapshot) ||
    (
      parsed.pendingSnapshot != null &&
      (
        !isRecord(parsed.pendingSnapshot) ||
        !isCodexInlineCredentialSnapshot(parsed.pendingSnapshot.from) ||
        !isCodexInlineCredentialSnapshot(parsed.pendingSnapshot.to)
      )
    )
  ) {
    throw new Error(`Codex account "${accountKey}" has an invalid local credential owner state.`)
  }

  return parsed as unknown as CodexInlineCredentialOwnerState
}

const writeCodexInlineCredentialOwnerState = async (
  targetPath: string,
  state: CodexInlineCredentialOwnerState
) => {
  await writeCodexPrivateFileAtomically(targetPath, `${JSON.stringify(state, null, 2)}\n`)
}

const assertCodexCredentialOwnerContentIsComplete = (
  accountKey: string,
  authContent: string
) => {
  try {
    if (!isRecord(JSON.parse(authContent) as unknown)) throw new Error('not an object')
  } catch {
    throw new Error(
      `Codex account "${accountKey}" credential owner is incomplete or invalid. Retry after the active Codex process finishes updating it.`
    )
  }
}

const isCodexCredentialOwnerContentComplete = (authContent: string) => {
  try {
    return isRecord(JSON.parse(authContent) as unknown)
  } catch {
    return false
  }
}

const assertCodexCredentialLineageIdentity = (params: {
  accountKey: string
  candidateAuthContent: string
  sourceAuthContent: string
}) => {
  const sourceIdentity = normalizeCodexIdentity(
    readCodexAuthIdentityFromContent(params.sourceAuthContent)
  )
  const candidateIdentity = normalizeCodexIdentity(
    readCodexAuthIdentityFromContent(params.candidateAuthContent)
  )
  const sourceAccountId = sourceIdentity?.accountId
  const candidateAccountId = candidateIdentity?.accountId
  const sourceOrganizationId = sourceIdentity?.organizationId
  const candidateOrganizationId = candidateIdentity?.organizationId
  if (
    sourceAccountId == null ||
    candidateAccountId == null ||
    sourceAccountId !== candidateAccountId ||
    (
      sourceOrganizationId != null &&
      candidateOrganizationId != null &&
      sourceOrganizationId !== candidateOrganizationId
    )
  ) {
    throw new Error(
      `Codex account "${params.accountKey}" changed credential identity during its managed lifecycle. Sign in again to select a different account.`
    )
  }
}

const updateCodexGlobalAdapterConfig = async (
  ctx: CodexAccountFileCtx,
  updater: (
    codexConfig: Record<string, unknown>,
    accounts: Record<string, unknown>
  ) => Promise<Record<string, unknown>> | Record<string, unknown>
) => {
  await updateGlobalAdapterAccounts({
    adapter: 'codex',
    cwd: ctx.cwd,
    env: ctx.env,
    update: updater
  })
}

const readCodexGlobalConfiguredAccount = async (targetPath: string, accountKey: string) => {
  try {
    const config = JSON.parse(await readFile(targetPath, 'utf8')) as unknown
    const adapters = isRecord(config) && isRecord(config.adapters) ? config.adapters : undefined
    const codexConfig = isRecord(adapters?.codex) ? adapters.codex : undefined
    const accounts = isRecord(codexConfig?.accounts) ? codexConfig.accounts : undefined
    return isRecord(accounts?.[accountKey])
      ? accounts[accountKey] as CodexConfiguredAccount
      : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

const readCodexGlobalConfiguredAccountState = async (
  targetPath: string,
  accountKey: string
) => {
  try {
    const config = JSON.parse(await readFile(targetPath, 'utf8')) as unknown
    const adapters = isRecord(config) && isRecord(config.adapters) ? config.adapters : undefined
    const codexConfig = isRecord(adapters?.codex) ? adapters.codex : undefined
    const accounts = isRecord(codexConfig?.accounts) ? codexConfig.accounts : undefined
    return {
      account: isRecord(accounts?.[accountKey])
        ? accounts[accountKey] as CodexConfiguredAccount
        : undefined,
      accountTombstones: normalizeAdapterAccountTombstones(codexConfig?.accountTombstones),
      configExists: true
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        account: undefined,
        accountTombstones: {},
        configExists: false
      }
    }
    throw error
  }
}

const buildCodexGlobalAccountCredentialRevision = async (
  ctx: Pick<AdapterCtx, 'cwd'>,
  configuredAccount: CodexConfiguredAccount
): Promise<CodexGlobalAccountCredentialRevision> => {
  const authFile = normalizeNonEmptyString(configuredAccount.authFile)
  const authFilePath = resolveConfiguredAuthFilePath(ctx, authFile)
  const authFileContent = authFilePath == null
    ? undefined
    : await readFile(authFilePath, 'utf8').catch(() => undefined)
  const inlineAuthContent = decodeCodexInlineAuthContent(configuredAccount.auth)

  return {
    authFile,
    authFileDigest: authFileContent == null
      ? undefined
      : createHash('sha256').update(authFileContent).digest('hex'),
    inlineAuthDigest: inlineAuthContent == null
      ? undefined
      : createHash('sha256').update(inlineAuthContent).digest('hex'),
    generation: normalizeNonEmptyString(configuredAccount.generation),
    credentialRevision: normalizeNonEmptyString(configuredAccount.credentialRevision)
  }
}

const codexGlobalAccountCredentialRevisionsMatch = (
  left: CodexGlobalAccountCredentialRevision,
  right: CodexGlobalAccountCredentialRevision
) => (
  left.authFile === right.authFile &&
  left.authFileDigest === right.authFileDigest &&
  left.inlineAuthDigest === right.inlineAuthDigest &&
  left.generation === right.generation &&
  left.credentialRevision === right.credentialRevision
)

const normalizeCodexAccountTombstones = (
  accountTombstones: Record<string, string[]>,
  accountKey: string
) => [...(accountTombstones[accountKey] ?? [])].sort()

const buildCodexGlobalAccountCredentialState = async (params: {
  account: CodexConfiguredAccount
  accountKey: string
  accountTombstones: Record<string, string[]>
  ctx: Pick<AdapterCtx, 'cwd'>
}): Promise<CodexGlobalAccountCredentialState> => ({
  accountKey: params.accountKey,
  ...await buildCodexGlobalAccountCredentialRevision(params.ctx, params.account),
  tombstones: normalizeCodexAccountTombstones(params.accountTombstones, params.accountKey)
})

const codexGlobalAccountCredentialStatesMatch = (
  left: CodexGlobalAccountCredentialState,
  right: CodexGlobalAccountCredentialState
) => (
  left.accountKey === right.accountKey &&
  codexGlobalAccountCredentialRevisionsMatch(left, right) &&
  left.tombstones.length === right.tombstones.length &&
  left.tombstones.every((value, index) => value === right.tombstones[index])
)

const readCodexGlobalAccountCredentialRevision = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>,
  accountKey: string
) =>
  withCanonicalConfigWriteLock(
    resolveCodexGlobalConfigPath(ctx),
    async (targetPath) => {
      const configuredAccount = await readCodexGlobalConfiguredAccount(targetPath, accountKey)
      if (configuredAccount == null) {
        throw new Error(
          `Codex account "${accountKey}" changed or was removed before sign-in started. Refresh and try again.`
        )
      }

      return buildCodexGlobalAccountCredentialRevision(ctx, configuredAccount)
    }
  )

const buildCodexResetCreditCanonicalState = async (params: {
  accountKey: string
  ctx: Pick<AdapterCtx, 'cwd'>
  state: Awaited<ReturnType<typeof readCodexGlobalConfiguredAccountState>>
}) => {
  return {
    accountKey: params.accountKey,
    canonicalAccount: params.state.account == null
      ? undefined
      : await buildCodexGlobalAccountCredentialRevision(params.ctx, params.state.account),
    canonicalConfigExists: params.state.configExists,
    tombstones: normalizeCodexAccountTombstones(params.state.accountTombstones, params.accountKey)
  }
}

const readCodexCredentialSourceDigest = async (targetPath: string | undefined) => {
  if (targetPath == null) {
    return { exists: false, contentDigest: undefined, stableIdentity: undefined }
  }
  try {
    const content = await readFile(targetPath, 'utf8')
    return {
      exists: true,
      contentDigest: createHash('sha256').update(content).digest('hex'),
      stableIdentity: toCodexStableCredentialIdentity(readCodexAuthIdentityFromContent(content))
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, contentDigest: undefined, stableIdentity: undefined }
    }
    throw error
  }
}

const buildCodexResetCreditEffectiveSourceState = async (params: {
  descriptor: CodexAccountDescriptor
}) => {
  const sourceKind = params.descriptor.credentialSourceKind ?? params.descriptor.sourceKind
  if (sourceKind == null) {
    throw new Error(`Codex account "${params.descriptor.key}" has no usable authentication source.`)
  }
  if (params.descriptor.authFilePath != null) {
    const resolvedPath = resolve(params.descriptor.authFilePath)
    return {
      contentDigest: normalizeNonEmptyString(params.descriptor.credentialSourceDigest) ??
        normalizeNonEmptyString(params.descriptor.metadata?.authDigest),
      exists: true,
      inlineDigest: undefined,
      resolvedPath,
      stableIdentity: toCodexStableCredentialIdentity(params.descriptor.credentialSourceIdentity),
      sourceKind
    } satisfies CodexResetCreditEffectiveSourceState
  }
  const contentDigest = params.descriptor.authContent == null
    ? undefined
    : createHash('sha256').update(params.descriptor.authContent).digest('hex')
  return {
    contentDigest,
    exists: params.descriptor.authContent != null,
    inlineDigest: contentDigest,
    resolvedPath: undefined,
    stableIdentity: toCodexStableCredentialIdentity(
      params.descriptor.authContent == null
        ? undefined
        : readCodexAuthIdentityFromContent(params.descriptor.authContent)
    ),
    sourceKind
  } satisfies CodexResetCreditEffectiveSourceState
}

const readCurrentCodexResetCreditEffectiveSourceState = async (params: {
  accountKey: string
  allowConfiguredFallback: boolean
  canonicalAccount?: CodexConfiguredAccount
  ctx: Pick<AdapterCtx, 'configs' | 'cwd' | 'env'>
  expected: CodexResetCreditEffectiveSourceState
}) => {
  if (params.expected.sourceKind === 'real-home') {
    const resolvedPath = resolveRealHomeAuthPath(params.ctx)
    return {
      ...await readCodexCredentialSourceDigest(resolvedPath),
      inlineDigest: undefined,
      resolvedPath,
      sourceKind: 'real-home'
    } satisfies CodexResetCreditEffectiveSourceState
  }

  const configuredAccount = params.canonicalAccount ?? (
    params.allowConfiguredFallback
      ? resolveCodexAdapterConfig(params.ctx).accounts[params.accountKey]
      : undefined
  )
  if (params.expected.sourceKind === 'configured-auth-file') {
    const resolvedPath = resolveConfiguredAuthFilePath(params.ctx, configuredAccount?.authFile)
    return {
      ...await readCodexCredentialSourceDigest(resolvedPath),
      inlineDigest: undefined,
      resolvedPath,
      sourceKind: 'configured-auth-file'
    } satisfies CodexResetCreditEffectiveSourceState
  }

  const authContent = decodeCodexInlineAuthContent(configuredAccount?.auth)
  const contentDigest = authContent == null
    ? undefined
    : createHash('sha256').update(authContent).digest('hex')
  return {
    contentDigest,
    exists: authContent != null,
    inlineDigest: contentDigest,
    resolvedPath: undefined,
    stableIdentity: toCodexStableCredentialIdentity(
      authContent == null ? undefined : readCodexAuthIdentityFromContent(authContent)
    ),
    sourceKind: 'global-config'
  } satisfies CodexResetCreditEffectiveSourceState
}

const codexResetCreditEffectiveSourcesMatch = (
  left: CodexResetCreditEffectiveSourceState,
  right: CodexResetCreditEffectiveSourceState
) => (
  left.sourceKind === right.sourceKind &&
  left.resolvedPath === right.resolvedPath &&
  left.exists === right.exists &&
  left.contentDigest === right.contentDigest &&
  left.inlineDigest === right.inlineDigest &&
  codexStableCredentialIdentitiesMatch(left.stableIdentity, right.stableIdentity)
)

const assertCodexResetCreditCredentialIsCurrent = async (params: {
  expected: CodexResetCreditCredentialState
  ctx: Pick<AdapterCtx, 'configs' | 'cwd' | 'env'>
  targetPath: string
}) => {
  const canonicalState = await readCodexGlobalConfiguredAccountState(
    params.targetPath,
    params.expected.accountKey
  )
  const currentCanonical = await buildCodexResetCreditCanonicalState({
    accountKey: params.expected.accountKey,
    ctx: params.ctx,
    state: canonicalState
  })
  const canonicalMatches = params.expected.canonicalConfigExists === currentCanonical.canonicalConfigExists &&
    params.expected.tombstones.length === currentCanonical.tombstones.length &&
    params.expected.tombstones.every((value, index) => value === currentCanonical.tombstones[index]) &&
    (
      params.expected.canonicalAccount == null
        ? currentCanonical.canonicalAccount == null
        : currentCanonical.canonicalAccount != null &&
          codexGlobalAccountCredentialRevisionsMatch(
            params.expected.canonicalAccount,
            currentCanonical.canonicalAccount
          )
    )
  const currentEffectiveSource = await readCurrentCodexResetCreditEffectiveSourceState({
    accountKey: params.expected.accountKey,
    allowConfiguredFallback: !params.expected.canonicalConfigBacked,
    canonicalAccount: canonicalState.account,
    ctx: params.ctx,
    expected: params.expected.effectiveSource
  })
  if (
    !canonicalMatches ||
    !codexResetCreditEffectiveSourcesMatch(params.expected.effectiveSource, currentEffectiveSource)
  ) {
    throw new Error(
      `Codex account "${params.expected.accountKey}" changed while this reset-credit request was waiting. Retry with the current account.`
    )
  }
}

const captureCodexResetCreditCredentialState = async (params: {
  account?: CodexConfiguredAccount
  descriptor: CodexAccountDescriptor
  accountKey: string
  ctx: Pick<AdapterCtx, 'configs' | 'cwd' | 'env'>
  descriptorTombstones: Record<string, string[]>
  required: boolean
}) => {
  return withCanonicalConfigWriteLock(
    resolveCodexGlobalConfigPath(params.ctx),
    async (targetPath) => {
      const canonicalAccountState = await readCodexGlobalConfiguredAccountState(
        targetPath,
        params.accountKey
      )
      const canonicalConfigBacked = params.descriptor.canonicalConfigBacked === true ||
        canonicalAccountState.account != null
      if (params.account == null && canonicalAccountState.account != null) {
        throw new Error(
          `Codex account "${params.accountKey}" changed while this reset-credit request was waiting. Retry with the current account.`
        )
      }
      if (
        params.account != null &&
        canonicalAccountState.account == null &&
        (params.required || canonicalConfigBacked)
      ) {
        throw new Error(
          `Codex account "${params.accountKey}" changed or was removed while this reset-credit request was waiting. Retry with the current account.`
        )
      }
      if (params.account != null && canonicalAccountState.account != null) {
        const descriptorState = await buildCodexGlobalAccountCredentialState({
          account: params.account,
          accountKey: params.accountKey,
          accountTombstones: params.descriptorTombstones,
          ctx: params.ctx
        })
        const canonicalState = await buildCodexGlobalAccountCredentialState({
          account: canonicalAccountState.account,
          accountKey: params.accountKey,
          accountTombstones: canonicalAccountState.accountTombstones,
          ctx: params.ctx
        })
        if (!codexGlobalAccountCredentialStatesMatch(descriptorState, canonicalState)) {
          throw new Error(
            `Codex account "${params.accountKey}" changed while this reset-credit request was waiting. Retry with the current account.`
          )
        }
      }
      const canonicalState = await buildCodexResetCreditCanonicalState({
        accountKey: params.accountKey,
        ctx: params.ctx,
        state: canonicalAccountState
      })
      const effectiveSource = await buildCodexResetCreditEffectiveSourceState({
        descriptor: params.descriptor
      })
      const currentEffectiveSource = await readCurrentCodexResetCreditEffectiveSourceState({
        accountKey: params.accountKey,
        allowConfiguredFallback: !canonicalConfigBacked,
        canonicalAccount: canonicalAccountState.account,
        ctx: params.ctx,
        expected: effectiveSource
      })
      if (!codexResetCreditEffectiveSourcesMatch(effectiveSource, currentEffectiveSource)) {
        throw new Error(
          `Codex account "${params.accountKey}" changed while this reset-credit request was waiting. Retry with the current account.`
        )
      }
      return {
        accountKey: params.accountKey,
        canonicalAccount: canonicalState.canonicalAccount,
        canonicalConfigBacked,
        canonicalConfigExists: canonicalState.canonicalConfigExists,
        effectiveSource,
        tombstones: canonicalState.tombstones
      } satisfies CodexResetCreditCredentialState
    }
  )
}

const buildMetadataFromConfiguredAccount = (
  key: string,
  configuredAccount: CodexConfiguredAccount,
  authContent?: string
): CodexStoredAccountMetadata => {
  const authDigest = authContent == null
    ? normalizeNonEmptyString(configuredAccount.authDigest)
    : createHash('sha256').update(authContent).digest('hex')
  const authIdentity = authContent == null ? undefined : readCodexAuthIdentityFromContent(authContent)
  const configuredProbe = buildProbeFromMetadata({
    displayName: configuredAccount.displayName,
    email: configuredAccount.email,
    planType: configuredAccount.planType,
    accountType: configuredAccount.accountType,
    accountId: configuredAccount.accountId,
    organizationId: configuredAccount.organizationId,
    organizationTitle: configuredAccount.organizationTitle,
    organizationRole: configuredAccount.organizationRole,
    quota: configuredAccount.quota
  })
  const probe = mergeCodexAccountProbes(configuredProbe, authIdentity)

  return {
    title: normalizeNonEmptyString(configuredAccount.title),
    description: normalizeNonEmptyString(configuredAccount.description),
    avatarUrl: normalizeNonEmptyString(configuredAccount.avatarUrl),
    displayName: probe?.displayName,
    email: probe?.email,
    planType: probe?.planType,
    accountType: probe?.accountType,
    accountId: probe?.accountId,
    organizationId: probe?.organizationId,
    organizationTitle: probe?.organizationTitle,
    organizationRole: probe?.organizationRole,
    quota: cloneQuotaInfo(probe?.quota),
    resetCreditDetailsCapturedAt: parseFiniteNumber(configuredAccount.resetCreditDetailsCapturedAt),
    source: normalizeNonEmptyString(configuredAccount.source),
    createdAt: parseFiniteNumber(configuredAccount.createdAt),
    updatedAt: parseFiniteNumber(configuredAccount.updatedAt),
    authDigest: authDigest ?? undefined
  }
}

const buildCodexGlobalAccountConfig = (params: {
  key: string
  authContent: string
  metadata: CodexStoredAccountMetadata
  existing?: CodexConfiguredAccount
  accountCreated?: boolean
  credentialChanged?: boolean
  nextCredentialRevision?: string
}): CodexConfiguredAccount => ({
  ...params.existing,
  authFile: undefined,
  title: resolvePersistedCodexAccountTitle({
    key: params.key,
    existing: params.existing,
    metadata: params.metadata
  }),
  description: params.metadata.description ?? params.existing?.description,
  avatarUrl: params.metadata.avatarUrl ?? params.existing?.avatarUrl,
  displayName: params.metadata.displayName,
  email: params.metadata.email,
  planType: params.metadata.planType,
  accountType: params.metadata.accountType,
  accountId: params.metadata.accountId,
  organizationId: params.metadata.organizationId,
  organizationTitle: params.metadata.organizationTitle,
  organizationRole: params.metadata.organizationRole,
  quota: cloneQuotaInfo(params.metadata.quota),
  resetCreditDetailsCapturedAt: params.metadata.resetCreditDetailsCapturedAt,
  source: params.metadata.source,
  createdAt: params.metadata.createdAt,
  updatedAt: params.metadata.updatedAt,
  authDigest: params.metadata.authDigest,
  generation: params.existing?.generation ?? (
    params.accountCreated === true ? createAdapterAccountGeneration() : undefined
  ),
  credentialRevision: params.credentialChanged === true
    ? params.nextCredentialRevision ?? createAdapterCredentialRevision(params.existing?.credentialRevision)
    : params.existing?.credentialRevision,
  credentialUpdatedAt: params.credentialChanged === true
    ? Date.now()
    : params.existing?.credentialUpdatedAt,
  auth: encodeCodexInlineAuthContent(params.authContent)
})

const upsertCodexGlobalAccountConfig = async (
  ctx: CodexAccountFileCtx,
  params: {
    key: string
    authContent: string
    allocateCollisionSafeKey?: boolean
    metadata?: CodexStoredAccountMetadata
    expectedCredentialRevision?: CodexGlobalAccountCredentialRevision
    nextCredentialRevision?: string
  }
) => {
  let resolvedKey = params.key
  await updateCodexGlobalAdapterConfig(ctx, async (codexConfig, accounts) => {
    const accountTombstones = normalizeAdapterAccountTombstones(codexConfig.accountTombstones)
    const incomingAuthDigest = createHash('sha256').update(params.authContent).digest('hex')
    const incomingIdentity = mergeCodexProbeWithCredentialIdentityAuthority(
      readCodexAuthIdentityFromContent(params.authContent),
      params.metadata
    )
    const matchesIncomingCredential = async (account: CodexConfiguredAccount) => {
      const configuredAuthFilePath = resolveConfiguredAuthFilePath(ctx, account.authFile)
      let currentAuthContent: string | undefined
      if (configuredAuthFilePath != null) {
        currentAuthContent = await readFile(configuredAuthFilePath, 'utf8').catch(() => undefined)
      } else {
        currentAuthContent = decodeCodexInlineAuthContent(account.auth)
      }
      if (currentAuthContent != null) {
        const currentAuthDigest = createHash('sha256').update(currentAuthContent).digest('hex')
        return currentAuthDigest === incomingAuthDigest || isSameCodexAccountIdentity(
          incomingIdentity,
          readCodexAuthIdentityFromContent(currentAuthContent)
        )
      }
      return normalizeNonEmptyString(account.authDigest) === incomingAuthDigest ||
        isSameCodexAccountIdentity(
          incomingIdentity,
          buildProbeFromMetadata(buildMetadataFromConfiguredAccount(params.key, account))
        )
    }

    if (params.allocateCollisionSafeKey === true && isRecord(accounts[resolvedKey])) {
      const occupied = accounts[resolvedKey] as CodexConfiguredAccount
      if (!await matchesIncomingCredential(occupied)) {
        const digestKey = `${params.key}-${incomingAuthDigest.slice(0, 12)}`
        resolvedKey = digestKey
        for (let suffix = 2; isRecord(accounts[resolvedKey]); suffix += 1) {
          const candidate = accounts[resolvedKey] as CodexConfiguredAccount
          if (await matchesIncomingCredential(candidate)) break
          resolvedKey = `${digestKey}-${suffix}`
        }
      }
    }

    const existing = isRecord(accounts[resolvedKey])
      ? accounts[resolvedKey] as CodexConfiguredAccount
      : undefined
    if (params.expectedCredentialRevision != null) {
      const currentCredentialRevision = existing == null
        ? undefined
        : await buildCodexGlobalAccountCredentialRevision(ctx, existing)
      if (
        currentCredentialRevision == null ||
        !codexGlobalAccountCredentialRevisionsMatch(
          currentCredentialRevision,
          params.expectedCredentialRevision
        )
      ) {
        throw new Error(
          `Codex account "${resolvedKey}" changed while sign-in was in progress. Refresh and try again.`
        )
      }
    }
    const nextAccount = buildCodexGlobalAccountConfig({
      key: resolvedKey,
      authContent: params.authContent,
      metadata: {
        ...(params.metadata ?? (
          existing == null
            ? {}
            : buildMetadataFromConfiguredAccount(resolvedKey, existing, params.authContent)
        )),
        createdAt: params.metadata?.createdAt ?? existing?.createdAt ?? Date.now(),
        updatedAt: params.metadata?.updatedAt ?? Date.now()
      },
      existing,
      accountCreated: existing == null,
      credentialChanged: true,
      nextCredentialRevision: params.nextCredentialRevision
    })
    if (isAdapterAccountGenerationDeleted(accountTombstones, resolvedKey, nextAccount.generation)) {
      throw new Error(`Codex account "${resolvedKey}" was deleted while sign-in was in progress.`)
    }
    accounts[resolvedKey] = nextAccount

    return {
      ...codexConfig,
      defaultAccount: normalizeNonEmptyString(codexConfig.defaultAccount) ?? resolvedKey,
      accounts,
      ...(Object.keys(accountTombstones).length === 0 ? { accountTombstones: undefined } : { accountTombstones })
    }
  })
  return resolvedKey
}

const removeCodexGlobalAccountConfig = async (
  ctx: CodexAccountFileCtx,
  accountKey: string
) => {
  await updateCodexGlobalAdapterConfig(ctx, (codexConfig, accounts) => {
    const current = isRecord(accounts[accountKey]) ? accounts[accountKey] : undefined
    delete accounts[accountKey]
    const accountTombstones = addAdapterAccountTombstone(
      normalizeAdapterAccountTombstones(codexConfig.accountTombstones),
      accountKey,
      normalizeNonEmptyString(current?.generation) ?? `legacy:${accountKey}`
    )
    const nextCodexConfig: Record<string, unknown> = {
      ...codexConfig,
      accounts,
      accountTombstones
    }

    if (normalizeNonEmptyString(codexConfig.defaultAccount) === accountKey) {
      delete nextCodexConfig.defaultAccount
    }

    return nextCodexConfig
  })
}

const updateCodexGlobalAccountMetadata = async (
  ctx: CodexAccountFileCtx,
  params: {
    descriptor: CodexAccountDescriptor
    probe: CodexAccountProbe
  }
) => {
  await updateCodexGlobalAdapterConfig(ctx, (codexConfig, accounts) => {
    const existing = isRecord(accounts[params.descriptor.key])
      ? accounts[params.descriptor.key] as CodexConfiguredAccount
      : undefined
    if (existing == null) {
      return codexConfig
    }

    const descriptorAuthDigest = normalizeNonEmptyString(params.descriptor.metadata?.authDigest) ??
      (
        params.descriptor.authContent == null
          ? undefined
          : createHash('sha256').update(params.descriptor.authContent).digest('hex')
      )
    const existingAuthContent = decodeCodexInlineAuthContent(existing.auth)
    const existingAuthDigest = existingAuthContent == null
      ? undefined
      : createHash('sha256').update(existingAuthContent).digest('hex')
    if (
      params.descriptor.sourceKind === 'global-config' &&
      (
        normalizeNonEmptyString(existing.authFile) != null ||
        descriptorAuthDigest == null ||
        existingAuthDigest == null ||
        descriptorAuthDigest !== existingAuthDigest
      )
    ) {
      ctx.logger?.warn('[codex account] skipped stale account metadata update after credential replacement', {
        account: params.descriptor.key
      })
      return codexConfig
    }

    const existingProbe = buildProbeFromMetadata({
      displayName: existing.displayName,
      email: existing.email,
      planType: existing.planType,
      accountType: existing.accountType,
      accountId: existing.accountId,
      organizationId: existing.organizationId,
      organizationTitle: existing.organizationTitle,
      organizationRole: existing.organizationRole,
      avatarUrl: existing.avatarUrl,
      quota: existing.quota,
      resetCreditDetailsCapturedAt: existing.resetCreditDetailsCapturedAt
    })
    const persistedProbe = mergeCodexAccountProbes(
      existingProbe == null
        ? undefined
        : {
          ...existingProbe,
          quota: undefined,
          resetCreditDetailsCapturedAt: undefined
        },
      params.probe
    ) ?? params.probe
    const nextMetadata: CodexStoredAccountMetadata = {
      ...params.descriptor.metadata,
      quota: cloneQuotaInfo(persistedProbe.quota),
      resetCreditDetailsCapturedAt: parseFiniteNumber(params.probe.resetCreditDetailsCapturedAt),
      ...(persistedProbe.displayName != null ? { displayName: persistedProbe.displayName } : {}),
      ...(persistedProbe.email != null ? { email: persistedProbe.email } : {}),
      ...(persistedProbe.planType != null ? { planType: persistedProbe.planType } : {}),
      ...(persistedProbe.accountType != null ? { accountType: persistedProbe.accountType } : {}),
      ...(persistedProbe.accountId != null ? { accountId: persistedProbe.accountId } : {}),
      ...(persistedProbe.organizationId != null ? { organizationId: persistedProbe.organizationId } : {}),
      ...(persistedProbe.organizationTitle != null ? { organizationTitle: persistedProbe.organizationTitle } : {}),
      ...(persistedProbe.organizationRole != null ? { organizationRole: persistedProbe.organizationRole } : {}),
      avatarUrl: normalizeNonEmptyString(params.descriptor.metadata?.avatarUrl) ??
        normalizeNonEmptyString(existing.avatarUrl) ??
        normalizeNonEmptyString(persistedProbe.avatarUrl),
      title: resolveCodexAccountTitle({
        key: params.descriptor.key,
        title: params.descriptor.title ?? params.descriptor.metadata?.title,
        probe: mergeCodexAccountProbes(params.descriptor.identity, params.descriptor.metadata, persistedProbe)
      }),
      description: params.descriptor.description ?? params.descriptor.metadata?.description,
      source: params.descriptor.metadata?.source,
      authDigest: params.descriptor.metadata?.authDigest,
      createdAt: params.descriptor.metadata?.createdAt ?? existing.createdAt ?? Date.now(),
      updatedAt: Date.now()
    }
    const authContent = params.descriptor.authContent ?? existingAuthContent

    accounts[params.descriptor.key] = authContent == null
      ? {
        ...existing,
        ...nextMetadata,
        title: resolvePersistedCodexAccountTitle({
          key: params.descriptor.key,
          existing,
          metadata: nextMetadata
        })
      }
      : buildCodexGlobalAccountConfig({
        key: params.descriptor.key,
        authContent,
        metadata: nextMetadata,
        existing
      })

    const accountTombstones = normalizeAdapterAccountTombstones(codexConfig.accountTombstones)
    if (
      isAdapterAccountGenerationDeleted(
        accountTombstones,
        params.descriptor.key,
        existing.generation
      )
    ) {
      return codexConfig
    }

    params.descriptor.metadata = nextMetadata
    params.descriptor.identity = normalizeCodexIdentity({
      ...params.descriptor.identity,
      ...nextMetadata
    })
    params.descriptor.title = resolveCodexAccountTitle({
      key: params.descriptor.key,
      title: params.descriptor.title,
      probe: params.descriptor.identity
    })

    return {
      ...codexConfig,
      accounts,
      ...(Object.keys(accountTombstones).length === 0 ? { accountTombstones: undefined } : { accountTombstones })
    }
  })
}

interface CodexInlineCredentialSource {
  authContent: string
  canonical: boolean
  snapshot: CodexInlineCredentialSnapshot
}

const resolveCodexInlineCredentialSource = async (params: {
  accountKey: string
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  fallbackAuthContent?: string
  fallbackSnapshot?: CodexInlineCredentialSnapshot
}): Promise<CodexInlineCredentialSource> => {
  return withCanonicalConfigWriteLock(
    resolveCodexGlobalConfigPath(params.ctx),
    async (targetPath) => {
      const state = await readCodexGlobalConfiguredAccountState(targetPath, params.accountKey)
      if (!state.configExists) {
        if (params.fallbackAuthContent == null || params.fallbackSnapshot == null) {
          throw new Error(`Codex account "${params.accountKey}" has no canonical credential source.`)
        }
        return {
          authContent: params.fallbackAuthContent,
          canonical: false,
          snapshot: params.fallbackSnapshot
        }
      }

      const configuredAccount = state.account
      if (configuredAccount == null) {
        throw new Error(
          `Codex account "${params.accountKey}" changed or was removed before its credential owner was reconciled.`
        )
      }
      if (
        isAdapterAccountGenerationDeleted(
          state.accountTombstones,
          params.accountKey,
          configuredAccount.generation
        )
      ) {
        throw new Error(`Codex account "${params.accountKey}" was deleted before its credential owner was reconciled.`)
      }
      if (normalizeNonEmptyString(configuredAccount.authFile) != null) {
        throw new Error(
          `Codex account "${params.accountKey}" changed to an explicit authFile before its credential owner was reconciled.`
        )
      }

      const authContent = decodeCodexInlineAuthContent(configuredAccount.auth)
      if (authContent == null) {
        throw new Error(
          `Codex account "${params.accountKey}" no longer has a portable inline credential.`
        )
      }
      return {
        authContent,
        canonical: true,
        snapshot: buildCodexInlineCredentialSnapshot(configuredAccount, authContent)
      }
    }
  )
}

const toCodexGlobalAccountCredentialRevision = (
  snapshot: CodexInlineCredentialSnapshot
): CodexGlobalAccountCredentialRevision => ({
  credentialRevision: snapshot.credentialRevision ?? undefined,
  generation: snapshot.generation ?? undefined,
  inlineAuthDigest: snapshot.sourceDigest
})

const codexInlineCredentialOwnerStateAcceptsSnapshot = (
  state: CodexInlineCredentialOwnerState,
  snapshot: CodexInlineCredentialSnapshot
) =>
  state.acceptedSnapshots.some(candidate => (
    codexInlineCredentialSnapshotsMatch(candidate, snapshot)
  )) || (
    state.pendingSnapshot != null &&
    (
      codexInlineCredentialSnapshotsMatch(state.pendingSnapshot.from, snapshot) ||
      codexInlineCredentialSnapshotsMatch(state.pendingSnapshot.to, snapshot)
    )
  )

const canReuseCodexInlineCredentialOwner = async (params: {
  accountKey: string
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  currentCredentialRevision: CodexGlobalAccountCredentialRevision
  descriptorSnapshot: CodexInlineCredentialSnapshot
}) => {
  const currentSourceDigest = normalizeNonEmptyString(
    params.currentCredentialRevision.inlineAuthDigest
  )
  if (currentSourceDigest == null) return false
  const currentSnapshot: CodexInlineCredentialSnapshot = {
    credentialRevision: normalizeNonEmptyString(
      params.currentCredentialRevision.credentialRevision
    ) ?? null,
    generation: normalizeNonEmptyString(params.currentCredentialRevision.generation) ?? null,
    sourceDigest: currentSourceDigest
  }
  const statePath = resolveCodexInlineCredentialOwnerStatePath(params.ctx, params.accountKey)
  return withCanonicalConfigWriteLock(statePath, async (targetPath) => {
    const state = await readCodexInlineCredentialOwnerState(targetPath, params.accountKey)
    return state?.initialized === true &&
      codexInlineCredentialOwnerStateAcceptsSnapshot(state, params.descriptorSnapshot) &&
      codexInlineCredentialOwnerStateAcceptsSnapshot(state, currentSnapshot)
  })
}

const reconcileCodexInlineCredentialOwnerLocked = async (params: {
  accountKey: string
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  source: CodexInlineCredentialSource
  state: CodexInlineCredentialOwnerState
  statePath: string
}) => {
  let { source, state } = params
  if (
    state.pendingSnapshot != null &&
    codexInlineCredentialSnapshotsMatch(state.pendingSnapshot.to, source.snapshot)
  ) {
    state = {
      ...state,
      acceptedSnapshots: appendCodexInlineCredentialSnapshot(
        state.acceptedSnapshots,
        state.pendingSnapshot.to
      ),
      pendingSnapshot: undefined
    }
    await writeCodexInlineCredentialOwnerState(params.statePath, state)
  } else if (
    state.pendingSnapshot != null &&
    !codexInlineCredentialSnapshotsMatch(state.pendingSnapshot.from, source.snapshot)
  ) {
    state = { ...state, pendingSnapshot: undefined }
    await writeCodexInlineCredentialOwnerState(params.statePath, state)
  }

  const sourceBelongsToLineage = codexInlineCredentialOwnerStateAcceptsSnapshot(
    state,
    source.snapshot
  )
  const ownerPath = resolveCodexInlineCredentialOwnerPath(params.ctx, state.ownerId)
  const ownerStat = await lstat(ownerPath).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  if (ownerStat == null && state.initialized) {
    throw new Error(
      `Codex account "${params.accountKey}" lost its local credential owner. Sign in again before starting another session.`
    )
  }
  if (ownerStat != null && !ownerStat.isFile()) {
    throw new Error(`Codex account "${params.accountKey}" has an invalid local credential owner.`)
  }
  if (ownerStat == null) {
    await writeCodexPrivateFileAtomically(ownerPath, source.authContent)
  }
  if (!state.initialized) {
    state = { ...state, initialized: true }
    await writeCodexInlineCredentialOwnerState(params.statePath, state)
  }

  const ownerContent = await readFile(ownerPath, 'utf8')
  assertCodexCredentialOwnerContentIsComplete(params.accountKey, ownerContent)
  const ownerDigest = createHash('sha256').update(ownerContent).digest('hex')
  if (!sourceBelongsToLineage) {
    const sameGeneration = state.acceptedSnapshots.some(snapshot => (
      snapshot.generation === source.snapshot.generation
    ))
    if (source.canonical && sameGeneration && ownerDigest === source.snapshot.sourceDigest) {
      state = {
        ...state,
        acceptedSnapshots: appendCodexInlineCredentialSnapshot(
          state.acceptedSnapshots,
          source.snapshot
        )
      }
      await writeCodexInlineCredentialOwnerState(params.statePath, state)
    }
    return { source, state }
  }
  if (ownerDigest === source.snapshot.sourceDigest || !source.canonical) {
    return { source, state }
  }

  assertCodexCredentialLineageIdentity({
    accountKey: params.accountKey,
    candidateAuthContent: ownerContent,
    sourceAuthContent: source.authContent
  })

  const nextSnapshot = state.pendingSnapshot != null &&
      codexInlineCredentialSnapshotsMatch(state.pendingSnapshot.from, source.snapshot) &&
      state.pendingSnapshot.to.sourceDigest === ownerDigest
    ? state.pendingSnapshot.to
    : {
      credentialRevision: createAdapterCredentialRevision(source.snapshot.credentialRevision),
      generation: source.snapshot.generation,
      sourceDigest: ownerDigest
    }
  state = {
    ...state,
    pendingSnapshot: {
      from: source.snapshot,
      to: nextSnapshot
    }
  }
  await writeCodexInlineCredentialOwnerState(params.statePath, state)
  await upsertCodexGlobalAccountConfig(params.ctx, {
    key: params.accountKey,
    authContent: ownerContent,
    expectedCredentialRevision: toCodexGlobalAccountCredentialRevision(source.snapshot),
    nextCredentialRevision: nextSnapshot.credentialRevision ?? undefined
  })
  state = {
    ...state,
    acceptedSnapshots: appendCodexInlineCredentialSnapshot(
      state.acceptedSnapshots,
      nextSnapshot
    ),
    pendingSnapshot: undefined
  }
  await writeCodexInlineCredentialOwnerState(params.statePath, state)
  source = {
    authContent: ownerContent,
    canonical: true,
    snapshot: nextSnapshot
  }
  return { source, state }
}

const readCodexFileStat = async (targetPath: string) =>
  lstat(targetPath).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })

const codexFileStatsReferToSameNode = (
  left: Pick<Awaited<ReturnType<typeof lstat>>, 'dev' | 'ino'>,
  right: Pick<Awaited<ReturnType<typeof lstat>>, 'dev' | 'ino'>
) => left.dev === right.dev && left.ino === right.ino

const removeClaimedCodexCredentialCandidate = async (
  candidatePath: string,
  claimedStat: Pick<Awaited<ReturnType<typeof lstat>>, 'dev' | 'ino'>
) => {
  const currentStat = await readCodexFileStat(candidatePath)
  if (currentStat != null && codexFileStatsReferToSameNode(currentStat, claimedStat)) {
    await rm(candidatePath, { force: true })
  }
}

const restoreClaimedCodexCredentialCandidate = async (
  candidatePath: string,
  authPath: string
) => {
  const claimedStat = await readCodexFileStat(candidatePath)
  if (claimedStat == null) return
  try {
    if (claimedStat.isFile()) {
      await link(candidatePath, authPath)
    } else if (claimedStat.isSymbolicLink()) {
      await symlink(await readlink(candidatePath), authPath, 'file')
    } else {
      return
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return
    throw error
  }
  await removeClaimedCodexCredentialCandidate(candidatePath, claimedStat)
}

const readClaimedCodexCredentialCandidate = async (candidatePath: string) => {
  const claimedPathStat = await readCodexFileStat(candidatePath)
  if (claimedPathStat?.isFile() !== true) return undefined

  let handle
  try {
    handle = await open(candidatePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  } catch (error) {
    if (['ELOOP', 'ENOENT', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      return undefined
    }
    throw error
  }
  try {
    const openedStat = await handle.stat()
    if (
      !openedStat.isFile() ||
      !codexFileStatsReferToSameNode(claimedPathStat, openedStat)
    ) {
      return undefined
    }
    return {
      authContent: await handle.readFile({ encoding: 'utf8' }),
      stat: openedStat
    }
  } finally {
    await handle.close()
  }
}

const readCodexInstalledOwnerDigest = async (params: {
  accountKey: string
  authPath: string
  ownerPath: string
}) => {
  const firstStat = await readCodexFileStat(params.authPath)
  if (firstStat?.isSymbolicLink() !== true) return undefined
  let firstTarget: string
  try {
    firstTarget = await readlink(params.authPath)
  } catch (error) {
    if (['ENOENT', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) return undefined
    throw error
  }
  if (resolve(dirname(params.authPath), firstTarget) !== params.ownerPath) return undefined

  const ownerContent = await readFile(params.ownerPath, 'utf8')
  assertCodexCredentialOwnerContentIsComplete(params.accountKey, ownerContent)
  const ownerDigest = createCodexAuthContentDigest(ownerContent)

  const finalStat = await readCodexFileStat(params.authPath)
  if (
    finalStat?.isSymbolicLink() !== true ||
    !codexFileStatsReferToSameNode(firstStat, finalStat)
  ) {
    return undefined
  }
  let finalTarget: string
  try {
    finalTarget = await readlink(params.authPath)
  } catch (error) {
    if (['ENOENT', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) return undefined
    throw error
  }
  return resolve(dirname(params.authPath), finalTarget) === params.ownerPath
    ? ownerDigest
    : undefined
}

const replaceCodexCredentialSymlink = async (params: {
  accountKey: string
  authPath: string
  observedStat: Pick<Awaited<ReturnType<typeof lstat>>, 'dev' | 'ino'>
  ownerPath: string
}) => {
  let observedTarget: string
  try {
    observedTarget = await readlink(params.authPath)
  } catch (error) {
    if (['ENOENT', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) return undefined
    throw error
  }
  const revalidatedStat = await readCodexFileStat(params.authPath)
  if (
    revalidatedStat?.isSymbolicLink() !== true ||
    !codexFileStatsReferToSameNode(params.observedStat, revalidatedStat)
  ) {
    return undefined
  }

  const candidatePath = `${params.authPath}.oneworks-candidate-${process.pid}-${randomUUID()}`
  try {
    await rename(params.authPath, candidatePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }

  const claimedStat = await readCodexFileStat(candidatePath)
  if (
    claimedStat?.isSymbolicLink() !== true ||
    !codexFileStatsReferToSameNode(params.observedStat, claimedStat)
  ) {
    await restoreClaimedCodexCredentialCandidate(candidatePath, params.authPath)
    return undefined
  }
  let claimedTarget: string
  try {
    claimedTarget = await readlink(candidatePath)
  } catch (error) {
    if (!['ENOENT', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    await restoreClaimedCodexCredentialCandidate(candidatePath, params.authPath)
    return undefined
  }
  if (claimedTarget !== observedTarget) {
    await restoreClaimedCodexCredentialCandidate(candidatePath, params.authPath)
    return undefined
  }

  try {
    await symlink(params.ownerPath, params.authPath, 'file')
  } catch (error) {
    await restoreClaimedCodexCredentialCandidate(candidatePath, params.authPath)
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined
    throw error
  }

  const installedStat = await readCodexFileStat(params.authPath)
  const installedOwnerDigest = await readCodexInstalledOwnerDigest(params)
  if (installedOwnerDigest == null) {
    if (installedStat?.isSymbolicLink() === true) {
      const failedInstallPath = `${params.authPath}.oneworks-candidate-${process.pid}-${randomUUID()}`
      try {
        await rename(params.authPath, failedInstallPath)
        const failedInstallStat = await readCodexFileStat(failedInstallPath)
        if (
          failedInstallStat != null &&
          codexFileStatsReferToSameNode(installedStat, failedInstallStat)
        ) {
          await removeClaimedCodexCredentialCandidate(failedInstallPath, failedInstallStat)
        } else {
          await restoreClaimedCodexCredentialCandidate(failedInstallPath, params.authPath)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await restoreClaimedCodexCredentialCandidate(candidatePath, params.authPath)
    return undefined
  }
  await removeClaimedCodexCredentialCandidate(candidatePath, claimedStat)
  return installedOwnerDigest
}

const bindCodexInlineCredentialOwnerPath = async (params: {
  accountKey: string
  authPath: string
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  ownerId: string
  startingDigest?: string
}): Promise<string> => {
  const statePath = resolveCodexInlineCredentialOwnerStatePath(params.ctx, params.accountKey)
  return withCanonicalConfigWriteLock(statePath, async (targetPath) => {
    let state = await readCodexInlineCredentialOwnerState(targetPath, params.accountKey)
    if (state == null || state.ownerId !== params.ownerId) {
      throw new Error(`Codex account "${params.accountKey}" changed its lifecycle credential owner.`)
    }
    let source = await resolveCodexInlineCredentialSource(params)
    if (!codexInlineCredentialOwnerStateAcceptsSnapshot(state, source.snapshot)) {
      throw new Error(`Codex account "${params.accountKey}" changed its credential lineage.`)
    }
    const ownerPath = resolveCodexInlineCredentialOwnerPath(params.ctx, state.ownerId)
    let expectedOwnerDigest = params.startingDigest ?? source.snapshot.sourceDigest

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const authStat = await readCodexFileStat(params.authPath)
      if (authStat?.isSymbolicLink()) {
        let installedOwnerDigest = await readCodexInstalledOwnerDigest({
          accountKey: params.accountKey,
          authPath: params.authPath,
          ownerPath
        })
        installedOwnerDigest ??= await replaceCodexCredentialSymlink({
          accountKey: params.accountKey,
          authPath: params.authPath,
          observedStat: authStat,
          ownerPath
        })
        if (installedOwnerDigest == null) continue
        if (installedOwnerDigest !== source.snapshot.sourceDigest) {
          const reconciled = await reconcileCodexInlineCredentialOwnerLocked({
            ...params,
            source,
            state,
            statePath: targetPath
          })
          source = reconciled.source
          state = reconciled.state
        }
        return installedOwnerDigest
      }
      if (authStat != null && !authStat.isFile()) {
        throw new Error(`Codex account "${params.accountKey}" has an invalid lifecycle credential path.`)
      }

      if (authStat?.isFile()) {
        const candidatePath = `${params.authPath}.oneworks-candidate-${process.pid}-${randomUUID()}`
        try {
          await rename(params.authPath, candidatePath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw error
        }

        try {
          const claimedCandidate = await readClaimedCodexCredentialCandidate(candidatePath)
          if (claimedCandidate == null) {
            await restoreClaimedCodexCredentialCandidate(candidatePath, params.authPath)
            continue
          }
          const candidateContent = claimedCandidate.authContent
          assertCodexCredentialOwnerContentIsComplete(params.accountKey, candidateContent)
          assertCodexCredentialLineageIdentity({
            accountKey: params.accountKey,
            candidateAuthContent: candidateContent,
            sourceAuthContent: source.authContent
          })
          const candidateDigest = createCodexAuthContentDigest(candidateContent)
          const ownerContent = await readFile(ownerPath, 'utf8')
          assertCodexCredentialOwnerContentIsComplete(params.accountKey, ownerContent)
          const ownerDigest = createCodexAuthContentDigest(ownerContent)
          if (ownerDigest !== expectedOwnerDigest && ownerDigest !== candidateDigest) {
            throw new Error(
              `Codex account "${params.accountKey}" changed concurrently while its lifecycle credential was reconciled.`
            )
          }
          if (ownerDigest !== candidateDigest) {
            await writeCodexPrivateFileAtomically(ownerPath, candidateContent)
          }
          expectedOwnerDigest = candidateDigest
          const reconciled = await reconcileCodexInlineCredentialOwnerLocked({
            ...params,
            source,
            state,
            statePath: targetPath
          })
          source = reconciled.source
          state = reconciled.state
          await removeClaimedCodexCredentialCandidate(
            candidatePath,
            claimedCandidate.stat
          )
        } catch (error) {
          if (await readCodexFileStat(candidatePath) != null) {
            await restoreClaimedCodexCredentialCandidate(candidatePath, params.authPath)
          }
          throw error
        }
        continue
      }

      try {
        await symlink(ownerPath, params.authPath, 'file')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      }
      const installedOwnerDigest = await readCodexInstalledOwnerDigest({
        accountKey: params.accountKey,
        authPath: params.authPath,
        ownerPath
      })
      if (installedOwnerDigest == null) continue
      if (installedOwnerDigest !== source.snapshot.sourceDigest) {
        const reconciled = await reconcileCodexInlineCredentialOwnerLocked({
          ...params,
          source,
          state,
          statePath: targetPath
        })
        source = reconciled.source
        state = reconciled.state
      }
      return installedOwnerDigest
    }

    throw new Error(
      `Codex account "${params.accountKey}" changed its lifecycle credential path repeatedly while it was reconciled.`
    )
  })
}

const commitCodexInlineCredentialCandidate = async (params: {
  accountKey: string
  authContent: string
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  ownerId: string
  startingDigest: string
}) => {
  const statePath = resolveCodexInlineCredentialOwnerStatePath(params.ctx, params.accountKey)
  return withCanonicalConfigWriteLock(statePath, async (targetPath) => {
    const state = await readCodexInlineCredentialOwnerState(targetPath, params.accountKey)
    if (state == null || state.ownerId !== params.ownerId) {
      throw new Error(`Codex account "${params.accountKey}" changed its credential owner.`)
    }
    const source = await resolveCodexInlineCredentialSource(params)
    if (!codexInlineCredentialOwnerStateAcceptsSnapshot(state, source.snapshot)) {
      throw new Error(`Codex account "${params.accountKey}" changed its credential lineage.`)
    }
    assertCodexCredentialOwnerContentIsComplete(params.accountKey, params.authContent)
    assertCodexCredentialLineageIdentity({
      accountKey: params.accountKey,
      candidateAuthContent: params.authContent,
      sourceAuthContent: source.authContent
    })
    const candidateDigest = createCodexAuthContentDigest(params.authContent)
    const ownerPath = resolveCodexInlineCredentialOwnerPath(params.ctx, state.ownerId)
    const ownerContent = await readFile(ownerPath, 'utf8')
    assertCodexCredentialOwnerContentIsComplete(params.accountKey, ownerContent)
    const ownerDigest = createCodexAuthContentDigest(ownerContent)
    if (ownerDigest !== params.startingDigest && ownerDigest !== candidateDigest) {
      throw new Error(
        `Codex account "${params.accountKey}" changed concurrently while its probe credential was reconciled.`
      )
    }
    if (ownerDigest !== candidateDigest) {
      await writeCodexPrivateFileAtomically(ownerPath, params.authContent)
    }
    return reconcileCodexInlineCredentialOwnerLocked({
      ...params,
      source,
      state,
      statePath: targetPath
    })
  })
}

const ensureCodexInlineCredentialOwner = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  descriptor: CodexAccountDescriptor
}) => {
  const { ctx, descriptor } = params
  if (
    descriptor.sourceKind !== 'global-config' ||
    descriptor.authFilePath != null ||
    descriptor.authContent == null ||
    descriptor.inlineCredentialSnapshot == null
  ) {
    return undefined
  }

  const statePath = resolveCodexInlineCredentialOwnerStatePath(ctx, descriptor.key)
  return withCanonicalConfigWriteLock(statePath, async (targetPath) => {
    const source = await resolveCodexInlineCredentialSource({
      accountKey: descriptor.key,
      ctx,
      fallbackAuthContent: descriptor.authContent,
      fallbackSnapshot: descriptor.inlineCredentialSnapshot
    })
    let state = await readCodexInlineCredentialOwnerState(targetPath, descriptor.key)
    const pendingMatchesCurrent = state?.pendingSnapshot != null && (
      codexInlineCredentialSnapshotsMatch(state.pendingSnapshot.from, source.snapshot) ||
      codexInlineCredentialSnapshotsMatch(state.pendingSnapshot.to, source.snapshot)
    )
    let acceptedMatchesCurrent = state?.acceptedSnapshots.some(snapshot => (
      codexInlineCredentialSnapshotsMatch(snapshot, source.snapshot)
    )) === true

    if (state != null && !acceptedMatchesCurrent && !pendingMatchesCurrent && source.canonical) {
      const previousOwnerPath = resolveCodexInlineCredentialOwnerPath(ctx, state.ownerId)
      const previousOwnerContent = await readFile(previousOwnerPath, 'utf8').catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      })
      if (
        previousOwnerContent != null &&
        isCodexCredentialOwnerContentComplete(previousOwnerContent)
      ) {
        const previousOwnerDigest = createCodexAuthContentDigest(previousOwnerContent)
        const sameGeneration = state.acceptedSnapshots.some(snapshot => (
          snapshot.generation === source.snapshot.generation
        ))
        if (sameGeneration && previousOwnerDigest === source.snapshot.sourceDigest) {
          state = {
            ...state,
            acceptedSnapshots: appendCodexInlineCredentialSnapshot(
              state.acceptedSnapshots,
              source.snapshot
            )
          }
          await writeCodexInlineCredentialOwnerState(targetPath, state)
          acceptedMatchesCurrent = true
        }
      }
    }

    if (state == null || (!acceptedMatchesCurrent && !pendingMatchesCurrent)) {
      state = {
        acceptedSnapshots: [source.snapshot],
        accountKey: descriptor.key,
        initialized: false,
        ownerId: buildCodexInlineCredentialOwnerId(descriptor.key, source.snapshot),
        version: 1
      }
      await writeCodexInlineCredentialOwnerState(targetPath, state)
    }

    if (
      state.pendingSnapshot != null &&
      codexInlineCredentialSnapshotsMatch(state.pendingSnapshot.to, source.snapshot)
    ) {
      state = {
        ...state,
        acceptedSnapshots: appendCodexInlineCredentialSnapshot(
          state.acceptedSnapshots,
          state.pendingSnapshot.to
        ),
        pendingSnapshot: undefined
      }
      await writeCodexInlineCredentialOwnerState(targetPath, state)
    } else if (
      state.pendingSnapshot != null &&
      !codexInlineCredentialSnapshotsMatch(state.pendingSnapshot.from, source.snapshot)
    ) {
      state = { ...state, pendingSnapshot: undefined }
      await writeCodexInlineCredentialOwnerState(targetPath, state)
    }

    const ownerPath = resolveCodexInlineCredentialOwnerPath(ctx, state.ownerId)
    const ownerStat = await lstat(ownerPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (ownerStat == null && state.initialized) {
      throw new Error(
        `Codex account "${descriptor.key}" lost its local credential owner. Sign in again before starting another session.`
      )
    }
    if (ownerStat != null && !ownerStat.isFile()) {
      throw new Error(`Codex account "${descriptor.key}" has an invalid local credential owner.`)
    }
    if (ownerStat == null) {
      await writeCodexPrivateFileAtomically(ownerPath, source.authContent)
    }
    if (!state.initialized) {
      state = { ...state, initialized: true }
      await writeCodexInlineCredentialOwnerState(targetPath, state)
    }
    const startingAuthContent = await readFile(ownerPath, 'utf8')
    assertCodexCredentialOwnerContentIsComplete(descriptor.key, startingAuthContent)

    if (source.canonical) {
      const confirmedSource = await resolveCodexInlineCredentialSource({
        accountKey: descriptor.key,
        ctx
      })
      if (!codexInlineCredentialSnapshotsMatch(confirmedSource.snapshot, source.snapshot)) {
        throw new Error(
          `Codex account "${descriptor.key}" changed while its credential owner was being prepared.`
        )
      }
    }

    descriptor.authContent = source.authContent
    descriptor.inlineCredentialSnapshot = source.snapshot
    descriptor.credentialFingerprint = source.snapshot.credentialRevision ?? source.snapshot.sourceDigest
    if (descriptor.metadata != null) descriptor.metadata.authDigest = source.snapshot.sourceDigest

    const ownerId = state.ownerId
    const startingDigest = createCodexAuthContentDigest(startingAuthContent)
    return {
      ownerId,
      ownerPath,
      ownerAuthContent: startingAuthContent,
      startingDigest,
      bindCredentialOwner: source.canonical
        ? async (authPath: string, lifecycleStartingDigest?: string) =>
          bindCodexInlineCredentialOwnerPath({
            accountKey: descriptor.key,
            authPath,
            ctx,
            ownerId,
            startingDigest: lifecycleStartingDigest
          })
        : undefined,
      commitValidatedCredential: source.canonical
        ? async (authContent: string) =>
          commitCodexInlineCredentialCandidate({
            accountKey: descriptor.key,
            authContent,
            ctx,
            ownerId,
            startingDigest
          })
        : undefined
    }
  })
}

const writeDescriptorAuthSourceFile = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId'>
  descriptor: CodexAccountDescriptor
  scope: string
}) => {
  const homeDir = resolveCodexProbeHomeDir(
    params.ctx,
    `${params.scope}-${params.descriptor.key}-${randomUUID()}`
  )
  const lifecycleAuthPath = join(homeDir, '.codex', 'auth.json')
  await mkdir(dirname(lifecycleAuthPath), { recursive: true })

  try {
    const descriptorCredentialRevision = params.descriptor.inlineCredentialSnapshot == null
      ? undefined
      : toCodexGlobalAccountCredentialRevision(params.descriptor.inlineCredentialSnapshot)
    const currentCredentialRevision = descriptorCredentialRevision == null
      ? undefined
      : await readCodexGlobalAccountCredentialRevision(params.ctx, params.descriptor.key)
    const descriptorMatchesCurrent = descriptorCredentialRevision != null &&
      currentCredentialRevision != null &&
      codexGlobalAccountCredentialRevisionsMatch(
        descriptorCredentialRevision,
        currentCredentialRevision
      )
    const canReuseCredentialOwner = descriptorMatchesCurrent ||
      (
        params.descriptor.inlineCredentialSnapshot != null &&
        currentCredentialRevision != null &&
        await canReuseCodexInlineCredentialOwner({
          accountKey: params.descriptor.key,
          ctx: params.ctx,
          currentCredentialRevision,
          descriptorSnapshot: params.descriptor.inlineCredentialSnapshot
        })
      )
    const credentialOwner = params.descriptor.authFilePath == null && canReuseCredentialOwner
      ? await ensureCodexInlineCredentialOwner(params)
      : undefined
    const sourceAuthContent = credentialOwner?.ownerAuthContent ?? (
      params.descriptor.authFilePath == null
        ? params.descriptor.authContent
        : await readFile(params.descriptor.authFilePath, 'utf8')
    )
    if (sourceAuthContent == null) {
      await rm(homeDir, { recursive: true, force: true })
      return undefined
    }
    assertCodexCredentialOwnerContentIsComplete(params.descriptor.key, sourceAuthContent)
    await writeCodexPrivateFileAtomically(lifecycleAuthPath, sourceAuthContent)
    const commitValidatedCredential = credentialOwner?.commitValidatedCredential
    const materializedCredentialDigest = createHash('sha256').update(sourceAuthContent).digest('hex')
    const materializedCredentialIdentity = toCodexStableCredentialIdentity(
      readCodexAuthIdentityFromContent(sourceAuthContent)
    )

    return {
      homeDir,
      authFilePath: lifecycleAuthPath,
      materializedCredentialDigest,
      materializedCredentialIdentity,
      cleanup: () => rm(homeDir, { recursive: true, force: true }),
      commitValidatedCredential: commitValidatedCredential == null
        ? undefined
        : async (authContent: string) => {
          const reconciled = await commitValidatedCredential(authContent)
          params.descriptor.authContent = reconciled.source.authContent
          params.descriptor.inlineCredentialSnapshot = reconciled.source.snapshot
          params.descriptor.credentialFingerprint = reconciled.source.snapshot.credentialRevision ??
            reconciled.source.snapshot.sourceDigest
          if (params.descriptor.metadata != null) {
            params.descriptor.metadata.authDigest = reconciled.source.snapshot.sourceDigest
          }
        }
    }
  } catch (error) {
    await rm(homeDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

const hasCodexAccountAuth = (descriptor: CodexAccountDescriptor | undefined) => (
  descriptor?.authFilePath != null || descriptor?.authContent != null
)

const collectRateLimitEntries = (value: unknown) => {
  const uniqueEntries = new Map<string, Record<string, unknown>>()

  const appendEntry = (entry: unknown, fallbackKey: string) => {
    if (!isRecord(entry)) {
      return
    }

    const entryKey = typeof entry.limitId === 'string' && entry.limitId.trim() !== ''
      ? entry.limitId
      : fallbackKey
    if (!uniqueEntries.has(entryKey)) {
      uniqueEntries.set(entryKey, entry)
    }
  }

  if (isRecord(value)) {
    if (Array.isArray(value.rateLimits)) {
      value.rateLimits.forEach((entry, index) => appendEntry(entry, `array-${index}`))
    } else {
      appendEntry(value.rateLimits, 'primary')
    }

    if (isRecord(value.rateLimitsByLimitId)) {
      Object.entries(value.rateLimitsByLimitId).forEach(([key, entry]) => appendEntry(entry, key))
    }
  }

  return Array.from(uniqueEntries.values())
}

const normalizeQuotaMetricId = (value: string) => (
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'limit'
)

const parseRateLimitResetCredits = (
  value: unknown
): NonNullable<AdapterAccountInfo['quota']>['rateLimitResetCredits'] => {
  if (!isRecord(value)) {
    return undefined
  }

  const parsedCredits = Array.isArray(value.credits)
    ? value.credits.flatMap((entry) => {
      if (!isRecord(entry)) {
        return []
      }

      const id = normalizeNonEmptyString(entry.id)
      if (id == null) {
        return []
      }

      return [{
        id,
        resetType: normalizeNonEmptyString(entry.resetType),
        status: normalizeNonEmptyString(entry.status),
        title: normalizeNonEmptyString(entry.title),
        description: normalizeNonEmptyString(entry.description),
        grantedAt: parseFiniteNumber(entry.grantedAt),
        expiresAt: parseFiniteNumber(entry.expiresAt)
      }]
    })
    : undefined
  const availableCount = parseFiniteNumber(value.availableCount) ?? parsedCredits?.length
  if (availableCount == null) {
    return undefined
  }

  return {
    availableCount: Math.max(0, Math.trunc(availableCount)),
    canConsume: true,
    ...(parsedCredits != null ? { credits: parsedCredits } : {})
  }
}

const parseResetCreditOutcome = (value: unknown): CodexRateLimitResetCreditOutcome | undefined => {
  if (!isRecord(value) || typeof value.outcome !== 'string') {
    return undefined
  }

  switch (value.outcome) {
    case 'reset':
    case 'alreadyRedeemed':
    case 'nothingToReset':
    case 'noCredit':
      return value.outcome
    default:
      return undefined
  }
}

const resolveRealHomeAuthPath = (ctx: Pick<AdapterCtx, 'env'>) => {
  const realHome = normalizeNonEmptyString(ctx.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    normalizeNonEmptyString(process.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    normalizeNonEmptyString(process.env.HOME) ??
    homedir()
  return realHome != null && realHome !== ''
    ? resolve(realHome, '.codex', 'auth.json')
    : undefined
}

const resolveCodexAdapterConfig = (ctx: Pick<AdapterCtx, 'configs'>) => {
  const mergedAdapters = mergeAdapterConfigs(
    ctx.configs[0]?.adapters as Record<string, unknown> | undefined,
    ctx.configs[1]?.adapters as Record<string, unknown> | undefined
  ) as Record<string, unknown> | undefined

  const rawConfig = isRecord(mergedAdapters?.codex) ? mergedAdapters?.codex : {}
  const rawAccounts: Record<string, CodexConfiguredAccount> = isRecord(rawConfig.accounts)
    ? Object.fromEntries(
      Object.entries(rawConfig.accounts)
        .filter((entry): entry is [string, CodexConfiguredAccount] => isRecord(entry[1]))
    )
    : {}
  const accountTombstones = normalizeAdapterAccountTombstones(rawConfig.accountTombstones)
  const rawPool = isRecord(rawConfig.accountPool) ? rawConfig.accountPool : {}

  return {
    defaultAccount: getAdapterConfiguredDefaultAccount(rawConfig),
    accounts: filterActiveAdapterAccounts(rawAccounts, accountTombstones),
    accountTombstones,
    accountPool: {
      enabled: rawPool.enabled === true,
      strategy: 'sticky-priority' as const,
      cooldownMs: parseFiniteNumber(rawPool.cooldownMs) ?? 5 * 60_000
    } satisfies CodexAccountPoolConfig
  }
}

const resolveProbeLogger = (ctx: Pick<AdapterCtx, 'cwd' | 'ctxId' | 'env'>, key: string) => (
  createLogger(ctx.cwd, `${ctx.ctxId}/adapter-codex-accounts`, key, '', 'info', ctx.env as NodeJS.ProcessEnv)
)

const CODEX_CHILD_SHUTDOWN_GRACE_MS = 500

const terminateCodexChildProcess = async (proc: ChildProcess) => {
  if (proc.pid == null || proc.exitCode != null || proc.signalCode != null) return

  await new Promise<void>((resolvePromise) => {
    let settled = false
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (settled) return
      settled = true
      if (forceKillTimer != null) clearTimeout(forceKillTimer)
      proc.removeListener('exit', finish)
      proc.removeListener('close', finish)
      resolvePromise()
    }
    proc.once('exit', finish)
    proc.once('close', finish)
    if (proc.exitCode != null || proc.signalCode != null) {
      finish()
      return
    }

    proc.kill('SIGTERM')
    forceKillTimer = setTimeout(() => {
      if (!settled) proc.kill('SIGKILL')
    }, CODEX_CHILD_SHUTDOWN_GRACE_MS)
    forceKillTimer.unref?.()
  })
}

const readCodexProbeAuthContent = async (authFilePath: string) => {
  const authFileStat = await lstat(authFilePath)
  if (!authFileStat.isSymbolicLink()) {
    await chmod(authFilePath, 0o600)
  }
  return readFile(authFilePath, 'utf8')
}

const isCodexAccessTokenExpiredError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /\btoken_expired\b/iu.test(message) ||
    /provided authentication token is expired/iu.test(message)
}

const probeCodexAccountOnce = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId'>
  homeDir: string
  authFilePath: string
  binaryPath?: string
  refresh?: boolean
  fetchProfile?: boolean
  logKey: string
  signal?: AbortSignal
  consumeResetCredit?: {
    creditId?: string
    idempotencyKey: string
  }
  timeoutMs?: number
}): Promise<CodexAccountProbeResult> => {
  const { ctx, homeDir, authFilePath, refresh, fetchProfile, logKey, consumeResetCredit, signal, timeoutMs } = params
  const logger = resolveProbeLogger(ctx, logKey)
  const binaryPath = params.binaryPath ?? resolveCodexBinaryPath(ctx.env, ctx.cwd)
  const spawnEnv = buildSpawnEnv(ctx)
  spawnEnv.HOME = homeDir
  spawnEnv.CODEX_HOME = join(homeDir, '.codex')

  await mkdir(join(homeDir, '.codex'), { recursive: true })
  const probeAuthFilePath = join(homeDir, '.codex', 'auth.json')
  if (resolve(authFilePath) !== resolve(probeAuthFilePath)) {
    const sourceAuthContent = await readFile(authFilePath, 'utf8')
    assertCodexCredentialOwnerContentIsComplete(logKey, sourceAuthContent)
    await writeCodexPrivateFileAtomically(probeAuthFilePath, sourceAuthContent)
  }
  const authIdentity = await readCodexAuthIdentityFromFile(probeAuthFilePath)

  const proc = spawn(String(binaryPath), ['app-server'], {
    cwd: ctx.cwd,
    env: spawnEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const rpc = new CodexRpcClient(proc, logger)
  const timeout = timeoutMs == null
    ? undefined
    : setTimeout(() => {
      rpc.destroy(`codex account probe timed out after ${timeoutMs}ms`)
    }, timeoutMs)
  timeout?.unref()
  const abortProbe = () => {
    rpc.destroy(
      signal?.reason instanceof Error
        ? signal.reason.message
        : 'Codex account probe was aborted.'
    )
  }

  proc.stderr?.on('data', (chunk) => {
    logger.debug('[codex account] stderr', { chunk: String(chunk) })
  })
  proc.once('error', (error) => {
    rpc.destroy(error instanceof Error ? error.message : String(error))
  })
  proc.once('exit', () => {
    rpc.destroy('codex account probe exited')
  })
  rpc.onRequest((id) => {
    rpc.respond(id, {})
  })

  if (signal?.aborted === true) abortProbe()
  else signal?.addEventListener('abort', abortProbe, { once: true })

  try {
    await rpc.request('initialize', {
      clientInfo: {
        name: 'oneworks',
        title: 'One Works',
        version: 'dev'
      },
      capabilities: {
        experimentalApi: false,
        optOutNotificationMethods: []
      }
    })
    rpc.notify('initialized', {})

    const consumeResult = consumeResetCredit == null
      ? undefined
      : await rpc.request('account/rateLimitResetCredit/consume', {
        idempotencyKey: consumeResetCredit.idempotencyKey,
        ...(normalizeNonEmptyString(consumeResetCredit.creditId) != null
          ? { creditId: consumeResetCredit.creditId }
          : {})
      })
    let accountResult: unknown
    let rateLimitsResult: unknown
    let accountReadSucceeded = false
    let rateLimitsReadSucceeded = false
    let profile: Awaited<ReturnType<typeof fetchCodexProfileFromFile>>
    if (consumeResetCredit == null) {
      const readAccountSnapshot = async (refreshToken: boolean) => {
        accountResult = await rpc.request('account/read', {
          ...(refreshToken ? { refreshToken: true } : {})
        })
        await readCodexProbeAuthContent(probeAuthFilePath)
        const snapshotResult = await Promise.all([
          rpc.request('account/rateLimits/read'),
          fetchProfile === false
            ? Promise.resolve(undefined)
            : fetchCodexProfileFromFile(probeAuthFilePath)
        ])
        rateLimitsResult = snapshotResult[0]
        profile = snapshotResult[1]
      }

      await readAccountSnapshot(refresh === true)
      accountReadSucceeded = true
      rateLimitsReadSucceeded = true
    } else {
      try {
        accountResult = await rpc.request('account/read', {
          ...(refresh === true ? { refreshToken: true } : {})
        })
        await readCodexProbeAuthContent(probeAuthFilePath)
        accountReadSucceeded = true
      } catch (error) {
        logger.warn('[codex account] reset credit was consumed, but account refresh failed', {
          error: error instanceof Error ? error.message : String(error)
        })
      }

      try {
        rateLimitsResult = await rpc.request('account/rateLimits/read')
        rateLimitsReadSucceeded = true
      } catch (error) {
        logger.warn('[codex account] reset credit was consumed, but quota refresh failed', {
          error: error instanceof Error ? error.message : String(error)
        })
      }

      if (fetchProfile !== false) {
        profile = await fetchCodexProfileFromFile(probeAuthFilePath)
      }
    }

    const account = isRecord(accountResult) && isRecord(accountResult.account)
      ? accountResult.account
      : undefined
    const accountType = typeof account?.type === 'string' ? account.type : undefined
    const email = typeof account?.email === 'string' ? account.email : undefined
    const planType = typeof account?.planType === 'string' ? account.planType : undefined

    const rateLimits = collectRateLimitEntries(rateLimitsResult)
    const directRateLimit = isRecord(rateLimitsResult) && isRecord(rateLimitsResult.rateLimits)
      ? rateLimitsResult.rateLimits
      : undefined
    const primaryRateLimit = directRateLimit ??
      rateLimits.find(item => item.limitId === 'codex') ??
      rateLimits.find(item => item.primary === true) ??
      rateLimits.find(item => item.secondary !== true) ??
      rateLimits[0]

    const metrics: NonNullable<AdapterAccountInfo['quota']>['metrics'] = []
    const formattedPlan = formatPlanType(
      typeof primaryRateLimit?.planType === 'string' ? primaryRateLimit.planType : planType
    )
    if (formattedPlan != null) {
      metrics.push({
        id: 'plan',
        label: 'Plan',
        value: formattedPlan,
        primary: true
      })
    }

    const credits = isRecord(primaryRateLimit?.credits) ? primaryRateLimit.credits : undefined
    let creditsSummary: string | undefined
    if (credits?.unlimited === true) {
      creditsSummary = 'Unlimited credits'
      metrics.push({
        id: 'credits',
        label: 'Credits',
        value: 'Unlimited'
      })
    } else if (credits?.hasCredits === true) {
      const creditsBalance = parseFiniteNumber(credits.balance)
      if (creditsBalance != null) {
        creditsSummary = formatCreditsValue(creditsBalance)
        metrics.push({
          id: 'credits',
          label: 'Credits',
          value: creditsSummary
        })
      }
    }

    const pushUsageMetric = (params: {
      key: 'primary' | 'secondary'
      label: string
      payload: unknown
      primary?: boolean
      idPrefix?: string
      labelPrefix?: string
    }) => {
      const payload = isRecord(params.payload) ? params.payload : undefined
      const usedPercent = parseFiniteNumber(payload?.usedPercent)
      if (usedPercent == null) {
        return undefined
      }

      const windowMins = parseFiniteNumber(payload?.windowDurationMins)
      const resetAt = parseFiniteNumber(payload?.resetsAt)
      const windowLabel = formatRateLimitWindow(windowMins)
      const value = `${usedPercent}%`
      const resetDescription = formatRateLimitResetAt(resetAt)

      metrics.push({
        id: `${params.idPrefix ?? ''}${params.key}-usage`,
        label: [
          params.labelPrefix,
          windowLabel == null ? params.label : `${windowLabel} ${params.label}`
        ].filter((value): value is string => value != null && value !== '')
          .join(' · '),
        value,
        ...(resetDescription != null ? { description: `Resets ${resetDescription}` } : {}),
        primary: params.primary
      })

      return windowLabel == null ? value : `${windowLabel} ${value}`
    }

    const primaryUsageSummary = pushUsageMetric({
      key: 'primary',
      label: 'used',
      payload: primaryRateLimit?.primary,
      primary: true
    })
    const secondaryUsageSummary = pushUsageMetric({
      key: 'secondary',
      label: 'used',
      payload: primaryRateLimit?.secondary
    })

    const limitName = typeof primaryRateLimit?.limitName === 'string'
      ? primaryRateLimit.limitName
      : undefined
    if (limitName != null && limitName.trim() !== '') {
      metrics.push({
        id: 'limit',
        label: 'Limit',
        value: limitName.trim()
      })
    }

    rateLimits
      .filter(rateLimit => rateLimit !== primaryRateLimit)
      .forEach((rateLimit, index) => {
        const limitId = normalizeNonEmptyString(rateLimit.limitId) ?? `additional-${index + 1}`
        const displayName = normalizeNonEmptyString(rateLimit.limitName) ?? limitId
        const idPrefix = `${normalizeQuotaMetricId(limitId)}-`

        pushUsageMetric({
          key: 'primary',
          label: 'used',
          payload: rateLimit.primary,
          idPrefix,
          labelPrefix: displayName
        })
        pushUsageMetric({
          key: 'secondary',
          label: 'used',
          payload: rateLimit.secondary,
          idPrefix,
          labelPrefix: displayName
        })

        const bucketCredits = isRecord(rateLimit.credits) ? rateLimit.credits : undefined
        if (bucketCredits?.unlimited === true) {
          metrics.push({
            id: `${idPrefix}credits`,
            label: `${displayName} · Credits`,
            value: 'Unlimited'
          })
        } else if (bucketCredits?.hasCredits === true) {
          const balance = parseFiniteNumber(bucketCredits.balance)
          if (balance != null) {
            metrics.push({
              id: `${idPrefix}credits`,
              label: `${displayName} · Credits`,
              value: formatCreditsValue(balance)
            })
          }
        }
      })

    const rateLimitResetCredits = parseRateLimitResetCredits(
      isRecord(rateLimitsResult) ? rateLimitsResult.rateLimitResetCredits : undefined
    )
    const summary = [
      formattedPlan,
      primaryUsageSummary,
      secondaryUsageSummary,
      creditsSummary
    ].filter((value): value is string => value != null && value !== '')
      .join(' · ')

    return {
      probe: {
        ...authIdentity,
        accountType: accountType ?? authIdentity?.accountType,
        displayName: profile?.displayName ?? authIdentity?.displayName,
        email: email ?? authIdentity?.email,
        planType: planType ?? authIdentity?.planType,
        avatarUrl: profile?.avatarUrl,
        resetCreditOutcome: parseResetCreditOutcome(consumeResult),
        quota: summary === '' &&
            metrics.length === 0 &&
            rateLimitResetCredits == null
          ? undefined
          : {
            summary: summary === '' ? undefined : summary,
            metrics,
            rateLimitResetCredits,
            updatedAt: Date.now()
          }
      },
      authContent: await readCodexProbeAuthContent(probeAuthFilePath),
      credentialsValidated: accountReadSucceeded && rateLimitsReadSucceeded
    }
  } catch (error) {
    if (signal?.aborted === true) throw createAbortError()
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortProbe)
    rpc.destroy('codex account probe finished')
    await terminateCodexChildProcess(proc)
  }
}

/**
 * A Codex app-server loads its access token when it starts. When the usage
 * endpoint reports that token as expired, refreshing inside that same process
 * can update auth.json while leaving the in-memory client on the old token.
 * Retry the complete snapshot with a fresh isolated app-server instead.
 */
const probeCodexAccount = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId'>
  homeDir: string
  authFilePath: string
  binaryPath?: string
  refresh?: boolean
  fetchProfile?: boolean
  logKey: string
  signal?: AbortSignal
  consumeResetCredit?: {
    creditId?: string
    idempotencyKey: string
  }
  timeoutMs?: number
}): Promise<CodexAccountProbeResult> => {
  try {
    return await probeCodexAccountOnce(params)
  } catch (error) {
    if (
      params.refresh === true ||
      params.consumeResetCredit != null ||
      !isCodexAccessTokenExpiredError(error)
    ) {
      throw error
    }

    return probeCodexAccountOnce({ ...params, refresh: true })
  }
}

const buildImportedAccountKey = (params: {
  authDigest: string
  probe?: CodexAccountProbe
}) => {
  const normalizedEmail = normalizeNonEmptyString(params.probe?.email)
  const normalizedOrganizationTitle = slugifyAccountKey(params.probe?.organizationTitle ?? '')
  const organizationFragment = compactIdentityFragment(params.probe?.organizationId)
  const accountFragment = compactIdentityFragment(params.probe?.accountId)
  if (normalizedEmail != null) {
    const segments = [`chatgpt-${slugifyAccountKey(normalizedEmail)}`]

    if (normalizedOrganizationTitle !== '') {
      segments.push(normalizedOrganizationTitle)
    }

    if (organizationFragment != null) {
      segments.push(organizationFragment)
    }

    if (accountFragment != null && (organizationFragment == null || accountFragment !== organizationFragment)) {
      segments.push(accountFragment)
    }

    return segments.join('-')
  }

  if (params.probe?.accountType === 'apiKey') {
    return `api-key-${accountFragment ?? params.authDigest.slice(0, 8)}`
  }

  return `account-${organizationFragment ?? accountFragment ?? params.authDigest.slice(0, 8)}`
}

const buildImportedAccountTitle = (params: {
  key: string
  probe?: CodexAccountProbe
}) => {
  const normalizedEmail = normalizeNonEmptyString(params.probe?.email)
  const contextTitle = resolveCodexAccountContextTitle(params.probe)
  if (normalizedEmail != null) {
    return contextTitle != null
      ? `${normalizedEmail} · ${contextTitle}`
      : normalizedEmail
  }

  if (params.probe?.accountType === 'apiKey') {
    return `API Key ${params.key.slice(-8)}`
  }

  return params.key
}

const isGeneratedCodexEmailContextTitle = (params: {
  email?: string
  title?: string
}) => {
  const normalizedEmail = normalizeNonEmptyString(params.email)
  const normalizedTitle = normalizeNonEmptyString(params.title)
  if (normalizedEmail == null || normalizedTitle == null) {
    return false
  }

  const prefix = `${normalizedEmail} · `
  if (!normalizedTitle.startsWith(prefix)) {
    return false
  }

  const suffix = normalizeNonEmptyString(normalizedTitle.slice(prefix.length))
  if (suffix == null) {
    return false
  }

  return CODEX_GENERATED_CONTEXT_LABELS.has(suffix.toLowerCase())
}

const isAutoGeneratedCodexTitle = (params: {
  key: string
  title?: string
  probe?: CodexAccountProbe
}) => {
  const normalizedTitle = normalizeNonEmptyString(params.title)
  if (normalizedTitle == null) {
    return true
  }
  if (CODEX_GENERIC_ACCOUNT_TITLES.has(normalizedTitle.toLowerCase())) {
    return true
  }

  const emailOnlyProbe = params.probe == null
    ? undefined
    : {
      ...params.probe,
      organizationTitle: undefined
    }

  const generatedTitles = new Set([
    params.key,
    buildImportedAccountTitle({
      key: params.key,
      probe: emailOnlyProbe
    }),
    buildImportedAccountTitle(params),
    buildLegacyImportedAccountTitle({
      key: params.key,
      probe: emailOnlyProbe
    }),
    buildLegacyImportedAccountTitle(params)
  ].filter((value): value is string => value != null && value !== ''))

  return generatedTitles.has(normalizedTitle) || isGeneratedCodexEmailContextTitle({
    email: params.probe?.email,
    title: normalizedTitle
  })
}

const resolveCodexAccountTitle = (params: {
  key: string
  title?: string
  probe?: CodexAccountProbe
}) => {
  const normalizedTitle = normalizeNonEmptyString(params.title)
  if (normalizedTitle != null && !isAutoGeneratedCodexTitle(params)) {
    return normalizedTitle
  }

  return buildImportedAccountTitle(params) ?? normalizedTitle ?? params.key
}

function resolvePersistedCodexAccountTitle(params: {
  key: string
  existing?: CodexConfiguredAccount
  metadata: CodexStoredAccountMetadata
}) {
  const probe = buildProbeFromMetadata(params.metadata)
  const existingTitle = normalizeNonEmptyString(params.existing?.title)
  if (
    existingTitle != null && !isAutoGeneratedCodexTitle({
      key: params.key,
      title: existingTitle,
      probe
    })
  ) {
    return existingTitle
  }

  const metadataTitle = normalizeNonEmptyString(params.metadata.title)
  if (
    metadataTitle != null && !isAutoGeneratedCodexTitle({
      key: params.key,
      title: metadataTitle,
      probe
    })
  ) {
    return metadataTitle
  }

  return undefined
}

const buildRealHomeAccountDescriptor = async (
  ctx: Pick<AdapterCtx, 'env'>
) => {
  const realAuthPath = resolveRealHomeAuthPath(ctx)
  if (realAuthPath == null || !await pathExists(realAuthPath)) {
    return undefined
  }

  const authContent = await readFile(realAuthPath, 'utf8')
  const authDigest = createHash('sha256').update(authContent).digest('hex')
  const authIdentity = readCodexAuthIdentityFromContent(authContent)
  const key = buildImportedAccountKey({
    authDigest,
    probe: authIdentity
  })

  const metadata: CodexStoredAccountMetadata = {
    title: resolveCodexAccountTitle({
      key,
      probe: authIdentity
    }),
    description: 'Read from ~/.codex/auth.json',
    displayName: authIdentity?.displayName,
    email: authIdentity?.email,
    planType: authIdentity?.planType,
    accountType: authIdentity?.accountType,
    accountId: authIdentity?.accountId,
    organizationId: authIdentity?.organizationId,
    organizationTitle: authIdentity?.organizationTitle,
    organizationRole: authIdentity?.organizationRole,
    source: 'real-home',
    authDigest,
    updatedAt: Date.now()
  }

  return {
    key,
    title: metadata.title,
    description: metadata.description,
    authFilePath: realAuthPath,
    sourceKind: 'real-home',
    status: 'ready',
    priority: 0,
    disabled: false,
    credentialFingerprint: authDigest,
    credentialSourceDigest: authDigest,
    credentialSourceIdentity: authIdentity,
    metadata,
    identity: authIdentity
  } satisfies CodexAccountDescriptor
}

const collectConfiguredAccountDescriptors = async (
  ctx: Pick<AdapterCtx, 'configs' | 'cwd' | 'env'>,
  configuredAccounts: Record<string, CodexConfiguredAccount>
) => {
  const descriptors: CodexAccountDescriptor[] = []
  const globalAdapters = isRecord(ctx.configs[1]?.adapters) ? ctx.configs[1]?.adapters : undefined
  const globalCodexConfig = isRecord(globalAdapters?.codex) ? globalAdapters.codex : undefined
  const globalAccounts = isRecord(globalCodexConfig?.accounts) ? globalCodexConfig.accounts : undefined

  for (const [key, configuredAccount] of Object.entries(configuredAccounts)) {
    const configuredAuthFilePath = resolveConfiguredAuthFilePath(ctx, configuredAccount.authFile)
    const hasConfiguredAuthFile = configuredAuthFilePath != null && await pathExists(configuredAuthFilePath)
    const authFileFingerprint = hasConfiguredAuthFile
      ? await readCodexAuthSourceFingerprintFromFile(configuredAuthFilePath)
      : undefined
    const authContent = decodeCodexInlineAuthContent(configuredAccount.auth)
    const metadata = buildMetadataFromConfiguredAccount(key, configuredAccount, authContent)
    if (authFileFingerprint?.authDigest != null) {
      metadata.authDigest = authFileFingerprint.authDigest
    }
    const mergedIdentity = mergeCodexAccountProbes(
      buildProbeFromMetadata(metadata),
      authFileFingerprint?.identity
    )
    const hasInlineAuth = authContent != null
    const authStorage = isRecord(configuredAccount.auth)
      ? normalizeNonEmptyString(configuredAccount.auth.storage) ?? 'inline'
      : undefined
    const unavailableCredentialDescription = authStorage === 'secret'
      ? 'Credential secret is not available on this device.'
      : authStorage === 'device'
      ? 'Credential is bound to another device; sign in again on this device.'
      : undefined
    const sourceKind = hasConfiguredAuthFile
      ? 'configured-auth-file'
      : hasInlineAuth
      ? 'global-config'
      : undefined

    descriptors.push({
      key,
      title: resolveCodexAccountTitle({
        key,
        title: configuredAccount.title ?? metadata.title,
        probe: mergedIdentity
      }),
      description: unavailableCredentialDescription ??
        normalizeNonEmptyString(configuredAccount.description) ??
        metadata.description,
      authFilePath: hasConfiguredAuthFile ? configuredAuthFilePath : undefined,
      authContent: hasConfiguredAuthFile ? undefined : authContent,
      sourceKind,
      status: hasConfiguredAuthFile || hasInlineAuth ? 'ready' : 'missing',
      priority: parseFiniteNumber(configuredAccount.priority) ?? 0,
      disabled: configuredAccount.disabled === true,
      credentialFingerprint: normalizeNonEmptyString(configuredAccount.credentialRevision) ??
        metadata.authDigest ?? authFileFingerprint?.authDigest,
      credentialSourceDigest: authFileFingerprint?.authDigest,
      credentialSourceIdentity: authFileFingerprint?.identity,
      canonicalConfigBacked: isRecord(globalAccounts?.[key]),
      inlineCredentialSnapshot: hasConfiguredAuthFile || authContent == null
        ? undefined
        : buildCodexInlineCredentialSnapshot(configuredAccount, authContent),
      metadata,
      identity: mergedIdentity
    })
  }

  return descriptors
}

const findConfiguredAccountByIdentity = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'configs'>,
  params: {
    authDigest?: string
    probe?: CodexAccountProbe
  }
) => {
  const descriptors = await collectConfiguredAccountDescriptors(ctx, resolveCodexAdapterConfig(ctx).accounts)
  const normalizedProbe = mergeCodexAccountProbes(params.probe)

  if (normalizedProbe != null) {
    const preferredKey = buildImportedAccountKey({
      authDigest: params.authDigest ?? '00000000',
      probe: normalizedProbe
    })
    const matchedDescriptors = descriptors.filter(descriptor => (
      isSameCodexAccountIdentity(normalizedProbe, descriptor.identity ?? buildProbeFromMetadata(descriptor.metadata))
    ))
    if (matchedDescriptors.length > 0) {
      return matchedDescriptors.sort((left, right) => {
        if (left.key === preferredKey) return -1
        if (right.key === preferredKey) return 1

        const leftFriendly = left.key.startsWith('chatgpt-') || left.key.startsWith('api-key-')
        const rightFriendly = right.key.startsWith('chatgpt-') || right.key.startsWith('api-key-')
        if (leftFriendly !== rightFriendly) {
          return leftFriendly ? -1 : 1
        }

        const leftUpdatedAt = parseFiniteNumber(left.metadata?.updatedAt) ?? 0
        const rightUpdatedAt = parseFiniteNumber(right.metadata?.updatedAt) ?? 0
        return rightUpdatedAt - leftUpdatedAt
      })[0]
    }
  }

  return params.authDigest == null
    ? undefined
    : descriptors.find(descriptor => descriptor.metadata?.authDigest === params.authDigest)
}

const pickPreferredCodexDescriptor = (
  left: CodexAccountDescriptor,
  right: CodexAccountDescriptor
) => {
  const configuredAccount = left.sourceKind === 'global-config'
    ? left
    : right.sourceKind === 'global-config'
    ? right
    : undefined
  const realHomeAccount = left.sourceKind === 'real-home'
    ? left
    : right.sourceKind === 'real-home'
    ? right
    : undefined
  if (configuredAccount != null && realHomeAccount?.authFilePath != null) {
    return {
      ...configuredAccount,
      authContent: undefined,
      authFilePath: realHomeAccount.authFilePath,
      credentialSourceKind: 'real-home' as const,
      credentialSourceDigest: realHomeAccount.credentialSourceDigest,
      credentialSourceIdentity: realHomeAccount.credentialSourceIdentity,
      credentialFingerprint: realHomeAccount.credentialFingerprint
    }
  }

  if (left.status !== right.status) {
    if (left.status === 'ready') return left
    if (right.status === 'ready') return right
  }

  const sourcePriority = (descriptor: CodexAccountDescriptor) => {
    switch (descriptor.sourceKind) {
      case 'global-config':
        return 3
      case 'configured-auth-file':
        return 2
      case 'real-home':
        return 1
      default:
        return 0
    }
  }
  const leftSourcePriority = sourcePriority(left)
  const rightSourcePriority = sourcePriority(right)
  if (leftSourcePriority !== rightSourcePriority) {
    return leftSourcePriority > rightSourcePriority ? left : right
  }

  const leftFriendly = left.key.startsWith('chatgpt-') || left.key.startsWith('api-key-')
  const rightFriendly = right.key.startsWith('chatgpt-') || right.key.startsWith('api-key-')
  if (leftFriendly !== rightFriendly) {
    return leftFriendly ? left : right
  }

  const leftUpdatedAt = parseFiniteNumber(left.metadata?.updatedAt) ?? 0
  const rightUpdatedAt = parseFiniteNumber(right.metadata?.updatedAt) ?? 0
  if (leftUpdatedAt !== rightUpdatedAt) {
    return leftUpdatedAt > rightUpdatedAt ? left : right
  }

  return compareCodexAccountDescriptors(left, right) <= 0 ? left : right
}

const dedupeCodexAccountDescriptors = (descriptors: CodexAccountDescriptor[]) => {
  const deduped: CodexAccountDescriptor[] = []

  for (const descriptor of descriptors) {
    const descriptorIdentity = descriptor.identity ?? buildProbeFromMetadata(descriptor.metadata)
    const descriptorAuthDigest = normalizeNonEmptyString(descriptor.metadata?.authDigest)
    const existingIndex = deduped.findIndex(existing => (
      isSameCodexAccountIdentity(
        descriptorIdentity,
        existing.identity ?? buildProbeFromMetadata(existing.metadata)
      ) ||
      (
        descriptorAuthDigest != null &&
        descriptorAuthDigest === normalizeNonEmptyString(existing.metadata?.authDigest)
      )
    ))

    if (existingIndex === -1) {
      deduped.push(descriptor)
      continue
    }

    deduped[existingIndex] = pickPreferredCodexDescriptor(deduped[existingIndex], descriptor)
  }

  return deduped
}

const writeProbeMetadata = async (params: {
  ctx: CodexAccountFileCtx
  descriptor: CodexAccountDescriptor
  probe: CodexAccountProbe
  refreshedAuthContent?: string
  expectedCredentialRevision?: CodexGlobalAccountCredentialRevision
}) => {
  const { ctx, descriptor, probe, refreshedAuthContent, expectedCredentialRevision } = params
  const mergedProbe = mergeCodexAccountProbes(
    normalizeCodexIdentity(descriptor.identity),
    descriptor.metadata == null
      ? undefined
      : {
        ...descriptor.metadata,
        quota: undefined,
        resetCreditDetailsCapturedAt: undefined
      },
    probe
  ) ?? probe
  const refreshedAuthDigest = refreshedAuthContent == null
    ? undefined
    : createHash('sha256').update(refreshedAuthContent).digest('hex')
  const nextMetadata: CodexStoredAccountMetadata = {
    ...descriptor.metadata,
    quota: cloneQuotaInfo(mergedProbe.quota),
    resetCreditDetailsCapturedAt: parseFiniteNumber(probe.resetCreditDetailsCapturedAt),
    ...(mergedProbe.displayName != null ? { displayName: mergedProbe.displayName } : {}),
    ...(mergedProbe.email != null ? { email: mergedProbe.email } : {}),
    ...(mergedProbe.planType != null ? { planType: mergedProbe.planType } : {}),
    ...(mergedProbe.accountType != null ? { accountType: mergedProbe.accountType } : {}),
    ...(mergedProbe.accountId != null ? { accountId: mergedProbe.accountId } : {}),
    ...(mergedProbe.organizationId != null ? { organizationId: mergedProbe.organizationId } : {}),
    ...(mergedProbe.organizationTitle != null ? { organizationTitle: mergedProbe.organizationTitle } : {}),
    ...(mergedProbe.organizationRole != null ? { organizationRole: mergedProbe.organizationRole } : {}),
    avatarUrl: normalizeNonEmptyString(descriptor.metadata?.avatarUrl) ??
      normalizeNonEmptyString(mergedProbe.avatarUrl),
    title: resolveCodexAccountTitle({
      key: descriptor.key,
      title: descriptor.title ?? descriptor.metadata?.title,
      probe: mergedProbe
    }),
    description: descriptor.description ?? descriptor.metadata?.description,
    authDigest: refreshedAuthDigest ?? descriptor.metadata?.authDigest,
    createdAt: descriptor.metadata?.createdAt ?? Date.now(),
    updatedAt: Date.now()
  }

  descriptor.metadata = nextMetadata
  descriptor.identity = normalizeCodexIdentity({
    ...descriptor.identity,
    ...nextMetadata
  })
  descriptor.title = resolveCodexAccountTitle({
    key: descriptor.key,
    title: descriptor.title,
    probe: descriptor.identity
  })

  if (descriptor.sourceKind === 'global-config') {
    if (
      refreshedAuthContent != null &&
      refreshedAuthContent !== descriptor.authContent
    ) {
      await upsertCodexGlobalAccountConfig(ctx, {
        key: descriptor.key,
        authContent: refreshedAuthContent,
        metadata: nextMetadata,
        expectedCredentialRevision
      })
      descriptor.authContent = refreshedAuthContent
      descriptor.credentialFingerprint = refreshedAuthDigest
      return
    }

    await updateCodexGlobalAccountMetadata({
      ...ctx,
      logger: ctx.logger
    }, {
      descriptor,
      probe: mergedProbe
    })
  }
}

const getCodexAccountProbeUnlocked = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId' | 'cache'>
  descriptor: CodexAccountDescriptor
  refresh?: boolean
  scope: string
}): Promise<CodexAccountProbe | undefined> => {
  const { ctx, descriptor, refresh, scope } = params
  const cachedProbe = getCachedProbe(descriptor.metadata, refresh)
  if (cachedProbe != null) {
    return mergeProbeWithCachedQuotaUnlocked({ ctx, descriptor, probe: cachedProbe })
  }

  if (!hasCodexAccountAuth(descriptor)) {
    return mergeProbeWithCachedQuotaUnlocked({
      ctx,
      descriptor,
      probe: buildProbeFromMetadata(descriptor.metadata)
    })
  }

  if (refresh !== true) {
    return mergeProbeWithCachedQuotaUnlocked({
      ctx,
      descriptor,
      probe: buildProbeFromMetadata(descriptor.metadata)
    })
  }

  const expectedCredentialRevision = descriptor.sourceKind === 'global-config' &&
      descriptor.authContent != null
    ? await readCodexGlobalAccountCredentialRevision(ctx, descriptor.key)
    : undefined

  const authSource = await writeDescriptorAuthSourceFile({ ctx, descriptor, scope })
  if (authSource == null) {
    return mergeProbeWithCachedQuotaUnlocked({
      ctx,
      descriptor,
      probe: buildProbeFromMetadata(descriptor.metadata)
    })
  }

  try {
    const liveProbeResult = await probeCodexAccount({
      ctx,
      homeDir: authSource.homeDir,
      authFilePath: authSource.authFilePath,
      fetchProfile: normalizeNonEmptyString(descriptor.metadata?.avatarUrl) == null ||
        normalizeNonEmptyString(descriptor.metadata?.displayName) == null,
      logKey: `${scope}-${descriptor.key}`
    })
    const probe = await mergeProbeWithCachedQuotaUnlocked({
      ctx,
      descriptor,
      probe: liveProbeResult.probe,
      live: true
    })
    if (probe == null) return undefined
    if (liveProbeResult.credentialsValidated) {
      await authSource.commitValidatedCredential?.(liveProbeResult.authContent)
    }
    await writeProbeMetadata({
      ctx,
      descriptor,
      probe,
      refreshedAuthContent: undefined,
      expectedCredentialRevision
    })
    return probe
  } finally {
    await authSource.cleanup()
  }
}

const getCodexAccountProbe = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId' | 'cache'>
  descriptor: CodexAccountDescriptor
  refresh?: boolean
  scope: string
}): Promise<CodexAccountProbe | undefined> => {
  return withCodexAccountQuotaCacheLock(params.ctx, async () => {
    return getCodexAccountProbeUnlocked(params)
  })
}

const compareCodexAccountDescriptors = (
  left: Pick<CodexAccountDescriptor, 'key' | 'title' | 'status'>,
  right: Pick<CodexAccountDescriptor, 'key' | 'title' | 'status'>
) => {
  if (left.status !== right.status) {
    if (left.status === 'ready') return -1
    if (right.status === 'ready') return 1
  }

  const leftTitle = normalizeNonEmptyString(left.title)?.toLowerCase() ?? ''
  const rightTitle = normalizeNonEmptyString(right.title)?.toLowerCase() ?? ''
  const titleOrder = leftTitle.localeCompare(rightTitle)
  if (titleOrder !== 0) return titleOrder

  return left.key.localeCompare(right.key)
}

const buildCodexTitleDisambiguationSuffix = (descriptor: CodexAccountDescriptor) => {
  const authDigest = normalizeNonEmptyString(descriptor.metadata?.authDigest)
  if (authDigest != null) {
    return authDigest.slice(0, 8)
  }

  const accountFragment = compactIdentityFragment(
    descriptor.identity?.accountId ?? descriptor.metadata?.accountId
  )
  if (accountFragment != null) {
    return accountFragment
  }

  return descriptor.key.slice(-8)
}

const disambiguateCodexAccountTitles = (descriptors: CodexAccountDescriptor[]) => {
  const groups = new Map<string, CodexAccountDescriptor[]>()

  for (const descriptor of descriptors) {
    const normalizedTitle = normalizeNonEmptyString(descriptor.title)?.toLowerCase()
    if (normalizedTitle == null) {
      continue
    }

    const group = groups.get(normalizedTitle)
    if (group == null) {
      groups.set(normalizedTitle, [descriptor])
      continue
    }

    group.push(descriptor)
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue
    }

    for (const descriptor of group) {
      const baseTitle = normalizeNonEmptyString(descriptor.title) ?? descriptor.key
      descriptor.title = `${baseTitle} · ${buildCodexTitleDisambiguationSuffix(descriptor)}`
    }
  }

  return descriptors
}

const collectCodexAccountDescriptors = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId' | 'configs'>,
  _options: { refresh?: boolean } = {}
) => {
  const { defaultAccount, accounts: configuredAccounts, accountPool } = resolveCodexAdapterConfig(ctx)
  const configuredDescriptors = await collectConfiguredAccountDescriptors(ctx, configuredAccounts)
  const realHomeDescriptor = await buildRealHomeAccountDescriptor(ctx).catch(() => undefined)
  const descriptors = dedupeCodexAccountDescriptors([
    ...configuredDescriptors,
    ...(realHomeDescriptor == null ? [] : [realHomeDescriptor])
  ])
  const sortedDescriptors = disambiguateCodexAccountTitles(
    descriptors
      .map(account => ({
        ...account,
        title: resolveCodexAccountTitle({
          key: account.key,
          title: account.title,
          probe: mergeCodexAccountProbes(account.identity, buildProbeFromMetadata(account.metadata))
        })
      }))
      .sort(compareCodexAccountDescriptors)
  )
  const resolvedDefaultAccount = defaultAccount ??
    sortedDescriptors.find(account => account.status === 'ready')?.key

  return {
    defaultAccount: resolvedDefaultAccount,
    accountPool,
    accounts: sortedDescriptors
      .sort((left, right) => {
        if (left.key === resolvedDefaultAccount) return -1
        if (right.key === resolvedDefaultAccount) return 1
        return compareCodexAccountDescriptors(left, right)
      })
  }
}

export interface CodexAccountPoolCandidate {
  key: string
  priority: number
  credentialFingerprint?: string
}

export const resolveCodexAccountPoolCandidates = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId' | 'configs'>,
  model?: string
) => {
  const catalog = await collectCodexAccountDescriptors(ctx)
  if (!catalog.accountPool.enabled) {
    return { enabled: false, candidates: [] as CodexAccountPoolCandidate[], cooldownMs: catalog.accountPool.cooldownMs }
  }
  const ready = catalog.accounts.filter(descriptor => (
    hasCodexAccountAuth(descriptor) &&
    descriptor.status === 'ready' &&
    !descriptor.disabled
  ))
  const candidates = ready
    .filter(descriptor => getActiveAccountPoolHealth(ctx.cwd, descriptor, model) == null)
    .sort((left, right) => (
      right.priority - left.priority ||
      Number(right.key === catalog.defaultAccount) - Number(left.key === catalog.defaultAccount) ||
      left.key.localeCompare(right.key)
    ))
    .map(descriptor => ({
      key: descriptor.key,
      priority: descriptor.priority,
      credentialFingerprint: descriptor.credentialFingerprint
    }))
  const retryAt = ready
    .map(descriptor => getActiveAccountPoolHealth(ctx.cwd, descriptor, model))
    .filter((entry): entry is CodexAccountPoolHealthEntry => entry != null)
    .reduce<number | undefined>((earliest, entry) => (
      earliest == null ? entry.retryAt : Math.min(earliest, entry.retryAt)
    ), undefined)
  return {
    enabled: true,
    candidates,
    cooldownMs: catalog.accountPool.cooldownMs,
    retryAt
  }
}

export const markCodexAccountPoolFailure = async (params: {
  ctx: Pick<AdapterCtx, 'cwd'>
  candidate: CodexAccountPoolCandidate
  model?: string
  cooldownMs: number
  reason: 'auth' | 'plan' | 'rate_limit' | 'transient'
}) => {
  if (codexAccountPoolHealth.size >= MAX_CODEX_ACCOUNT_POOL_HEALTH_ENTRIES) {
    const oldestKey = codexAccountPoolHealth.keys().next().value
    if (oldestKey != null) codexAccountPoolHealth.delete(oldestKey)
  }
  codexAccountPoolHealth.set(accountPoolHealthKey(params.ctx.cwd, params.candidate.key, params.model), {
    credentialFingerprint: params.candidate.credentialFingerprint,
    retryAt: Date.now() + params.cooldownMs,
    reason: params.reason
  })
}

export const classifyCodexAccountPoolFailure = (
  error: unknown,
  fallbackCooldownMs: number
): { cooldownMs: number; reason: 'auth' | 'plan' | 'rate_limit' | 'transient' } | undefined => {
  const message = error instanceof Error ? error.message : String(error)
  if (/\b401\b|unauthori[sz]ed|invalid[^\n]*(?:token|credential)/iu.test(message)) {
    return { reason: 'auth', cooldownMs: Math.max(fallbackCooldownMs, 15 * 60_000) }
  }
  if (/\b(?:402|403)\b|payment required|forbidden|subscription|plan limit/iu.test(message)) {
    return { reason: 'plan', cooldownMs: Math.max(fallbackCooldownMs, 15 * 60_000) }
  }
  if (/\b429\b|too many requests|rate.?limit|quota/iu.test(message)) {
    return { reason: 'rate_limit', cooldownMs: fallbackCooldownMs }
  }
  if (/\b(?:408|500|502|503|504)\b|timed? ?out|temporar(?:y|ily) unavailable|overloaded/iu.test(message)) {
    return { reason: 'transient', cooldownMs: Math.min(fallbackCooldownMs, 30_000) }
  }
  return undefined
}

export const listCodexAppServerWarmupAccountKeys = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId' | 'configs'>,
  limit = 3
) => {
  const catalog = await collectCodexAccountDescriptors(ctx)
  const orderedKeys = [
    catalog.defaultAccount,
    ...catalog.accounts
      .filter(hasCodexAccountAuth)
      .map(account => account.key)
  ].filter((key): key is string => typeof key === 'string' && key.trim() !== '')
  return [...new Set(orderedKeys)].slice(0, Math.max(0, limit))
}

const resolveCodexAccountSource = (params: {
  descriptor: CodexAccountDescriptor
  configuredAccount?: CodexConfiguredAccount
}): AdapterAccountDetail['source'] => {
  const sourceId = params.descriptor.metadata?.source

  if (params.descriptor.sourceKind === 'real-home' || sourceId === 'real-home') {
    return {
      id: 'real-home',
      label: 'Codex Home',
      description: params.descriptor.metadata?.description ?? 'Read from ~/.codex/auth.json'
    }
  }

  if (params.descriptor.sourceKind === 'global-config' || sourceId === 'codex-login') {
    return {
      id: sourceId ?? 'global-config',
      label: 'Global Config',
      description: params.descriptor.metadata?.description ?? 'Stored in ~/.oneworks/.oo.config.json.'
    }
  }

  if (
    params.descriptor.sourceKind === 'configured-auth-file' ||
    (params.configuredAccount?.authFile != null && params.configuredAccount.authFile.trim() !== '')
  ) {
    return {
      id: 'configured-auth-file',
      label: 'Configured authFile',
      description: params.configuredAccount?.authFile ?? params.descriptor.authFilePath
    }
  }

  return undefined
}

const buildCodexAccountDetail = (params: {
  descriptor: CodexAccountDescriptor
  defaultAccount?: string
  probe?: CodexAccountProbe
  configuredAccount?: CodexConfiguredAccount
  overrideError?: string
}): AdapterAccountDetail => {
  const {
    descriptor,
    defaultAccount,
    probe,
    configuredAccount,
    overrideError
  } = params
  const mergedProbe = mergeCodexAccountProbes(
    normalizeCodexIdentity(descriptor.identity),
    descriptor.metadata == null ? undefined : { ...descriptor.metadata, quota: undefined },
    probe
  )
  const baseTitle = resolveCodexAccountTitle({
    key: descriptor.key,
    title: descriptor.title,
    probe: mergedProbe
  })
  const baseDescription = overrideError ??
    descriptor.description ??
    normalizeNonEmptyString(descriptor.metadata?.description) ??
    (mergedProbe?.accountType === 'apiKey' ? 'API Key account' : undefined)
  const status = overrideError != null ? 'error' : descriptor.status

  return {
    key: descriptor.key,
    title: baseTitle,
    description: baseDescription,
    status,
    isDefault: descriptor.key === defaultAccount,
    priority: descriptor.priority,
    disabled: descriptor.disabled,
    quota: overrideError == null ? mergedProbe?.quota : undefined,
    avatarUrl: normalizeNonEmptyString(configuredAccount?.avatarUrl) ??
      normalizeNonEmptyString(descriptor.metadata?.avatarUrl) ??
      normalizeNonEmptyString(probe?.avatarUrl),
    displayName: normalizeNonEmptyString(mergedProbe?.displayName),
    email: normalizeNonEmptyString(mergedProbe?.email),
    planType: normalizeNonEmptyString(mergedProbe?.planType),
    accountType: normalizeNonEmptyString(mergedProbe?.accountType),
    source: resolveCodexAccountSource({ descriptor, configuredAccount }),
    actions: [...CODEX_ACCOUNT_DETAIL_ACTIONS]
  }
}

const resolveExistingCodexAccount = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId' | 'configs'>,
  accountKey: string,
  options: { refresh?: boolean } = {}
) => {
  const normalizedAccount = normalizeNonEmptyString(accountKey)
  if (normalizedAccount == null) {
    throw new Error('Codex account key is required.')
  }

  const catalog = await collectCodexAccountDescriptors(ctx, options)
  const descriptor = catalog.accounts.find(account => account.key === normalizedAccount)
  if (descriptor == null) {
    throw new Error(`Codex account "${normalizedAccount}" was not found.`)
  }

  return {
    descriptor,
    defaultAccount: catalog.defaultAccount,
    configuredAccount: resolveCodexAdapterConfig(ctx).accounts[normalizedAccount]
  }
}

const runCodexLogin = async (params: {
  ctx: Pick<AdapterCtx, 'configs' | 'cwd' | 'env' | 'ctxId' | 'logger'>
  onProgress?: AdapterManageAccountOptions['onProgress']
  signal?: AbortSignal
}) => {
  const { ctx, onProgress, signal } = params
  onProgress?.({
    phase: 'preparing',
    stream: 'status',
    message: 'Preparing the official Codex CLI runtime.'
  })
  const binaryPath = await ensureCodexCli(ctx)
  const spawnEnv = buildSpawnEnv(ctx)
  const loginKey = `login-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const homeDir = resolveCodexProbeHomeDir(ctx, loginKey)
  const codexHomeDir = join(homeDir, '.codex')
  const authFilePath = join(codexHomeDir, 'auth.json')

  throwIfAborted(signal)
  spawnEnv.HOME = homeDir
  spawnEnv.CODEX_HOME = codexHomeDir
  await mkdir(codexHomeDir, { recursive: true })
  let stdout = ''
  let stderr = ''

  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const proc = spawn(String(binaryPath), [
        'login',
        '-c',
        'cli_auth_credentials_store="file"'
      ], {
        cwd: ctx.cwd,
        env: spawnEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let settled = false
      let requestedFailure: unknown

      proc.once('spawn', () => {
        onProgress?.({
          phase: 'awaiting-authorization',
          stream: 'status',
          message: 'Complete the Codex sign-in flow in your browser.'
        })
      })

      const finishResolve = () => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abortLoginFlow)
        resolvePromise()
      }

      const finishReject = (error: unknown) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abortLoginFlow)
        rejectPromise(error)
      }

      const stopLoginFlow = (error: unknown) => {
        if (settled || requestedFailure != null) return
        requestedFailure = error
        if (proc.pid == null) {
          finishReject(error)
          return
        }
        void terminateCodexChildProcess(proc).then(
          () => finishReject(error),
          finishReject
        )
      }

      const abortLoginFlow = () => stopLoginFlow(createAbortError())

      proc.stdout?.on('data', (chunk) => {
        const text = String(chunk)
        stdout += text
        onProgress?.({ stream: 'stdout', message: text })
      })
      proc.stderr?.on('data', (chunk) => {
        const text = String(chunk)
        stderr += text
        onProgress?.({ stream: 'stderr', message: text })
      })
      proc.once('error', stopLoginFlow)
      proc.once('exit', (code) => {
        if (requestedFailure != null) {
          finishReject(requestedFailure)
          return
        }
        if (signal?.aborted === true) {
          finishReject(createAbortError())
          return
        }

        if (code === 0) {
          finishResolve()
          return
        }

        const failureLog = `${stdout}\n${stderr}`.trim()
        finishReject(
          new Error(
            failureLog === ''
              ? `\`codex login\` exited with code ${code ?? 'unknown'}.`
              : failureLog
          )
        )
      })

      if (signal?.aborted === true) {
        abortLoginFlow()
        return
      }

      signal?.addEventListener('abort', abortLoginFlow, { once: true })
    })

    throwIfAborted(signal)
    onProgress?.({
      phase: 'verifying',
      stream: 'status',
      message: 'Verifying the Codex credentials returned by the official CLI.'
    })
    if (!await pathExists(authFilePath)) {
      throw new Error('Codex login completed but no auth.json was written to the isolated home.')
    }

    return {
      homeDir,
      authFilePath,
      binaryPath
    }
  } catch (error) {
    await rm(homeDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

const resolveCodexRuntimeStateBridgePaths = async (homeDir: string) => {
  const codexDir = join(homeDir, '.codex')
  const entries = await readDirSafe(codexDir)
  const staleBridgePaths = await Promise.all(entries.map(async entry => {
    const relativePath = join('.codex', entry.name)
    try {
      const entryStat = await lstat(join(codexDir, entry.name))
      return entryStat.isSymbolicLink()
        ? relativePath
        : undefined
    } catch {
      return undefined
    }
  }))

  return [
    ...new Set([
      ...CODEX_RUNTIME_STATE_BRIDGE_PATHS,
      ...staleBridgePaths.filter((path): path is string => path != null),
      ...entries
        .filter(entry => isCodexRuntimeStateBridgeEntry(entry.name))
        .map(entry => join('.codex', entry.name))
    ])
  ]
}

const unlinkCodexRuntimeStateBridgePaths = async (homeDir: string) => {
  await unlinkMockHomeBridgePaths({
    mockHome: homeDir,
    paths: await resolveCodexRuntimeStateBridgePaths(homeDir)
  })
}

const CODEX_SESSION_CONFIG_ROOT_KEYS = new Set([
  'model',
  'model_reasoning_effort',
  'model_reasoning_summary',
  'model_verbosity',
  'personality',
  'reasoning_effort'
])

const extractCodexSessionRootConfigLines = (content: string | undefined) => {
  if (content == null) return []

  const lines: string[] = []
  for (const line of content.replaceAll('\r\n', '\n').split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) break
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const key = /^([\w-]+)\s*=/iu.exec(trimmed)?.[1]
    if (key != null && CODEX_SESSION_CONFIG_ROOT_KEYS.has(key)) {
      lines.push(line)
    }
  }
  return lines
}

const buildCodexSessionConfigContent = (params: {
  cwd: string
  nativeProviderConfigOverrides?: string[]
  sharedConfigContent?: string
}) => {
  const rootLines = extractCodexSessionRootConfigLines(params.sharedConfigContent)
  return [
    ...rootLines,
    ...(params.nativeProviderConfigOverrides ?? []),
    'check_for_update_on_startup = false',
    '',
    `[projects.${JSON.stringify(resolve(params.cwd))}]`,
    'trust_level = "trusted"',
    ''
  ].join('\n')
}

const upsertCodexTrustedProject = (content: string, cwd: string) => {
  const normalizedContent = content.replaceAll('\r\n', '\n').trimEnd()
  const header = `[projects.${JSON.stringify(resolve(cwd))}]`
  const lines = normalizedContent.split('\n')
  const headerIndex = lines.findIndex(line => line.trim() === header)
  if (headerIndex === -1) {
    return `${normalizedContent}\n\n${header}\ntrust_level = "trusted"\n`
  }

  const nextHeaderIndex = lines.findIndex((line, index) => index > headerIndex && line.trim().startsWith('['))
  const sectionEnd = nextHeaderIndex === -1 ? lines.length : nextHeaderIndex
  const trustIndex = lines.findIndex((line, index) => (
    index > headerIndex && index < sectionEnd && /^trust_level\s*=/u.test(line.trim())
  ))
  if (trustIndex === -1) lines.splice(headerIndex + 1, 0, 'trust_level = "trusted"')
  else lines[trustIndex] = 'trust_level = "trusted"'
  return `${lines.join('\n').trimEnd()}\n`
}

const writeCodexSessionConfigFile = async (params: {
  configPath: string
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  nativeProviderConfigOverrides?: string[]
  preserveExisting: boolean
  sharedAppServerHome?: boolean
}) => {
  const mockHome = resolveMockHome(params.ctx.cwd, params.ctx.env)
  const configSourceHome = params.sharedAppServerHome
    ? params.ctx.env.__ONEWORKS_PROJECT_REAL_HOME__?.trim() || homedir()
    : mockHome
  const sharedConfigPath = join(configSourceHome, '.codex', 'config.toml')
  let sharedConfigContent: string | undefined
  try {
    sharedConfigContent = await readFile(sharedConfigPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  let existingConfigContent: string | undefined
  if (params.preserveExisting) {
    try {
      existingConfigContent = await readFile(params.configPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  const nextContent = existingConfigContent == null
    ? buildCodexSessionConfigContent({
      cwd: params.ctx.cwd,
      nativeProviderConfigOverrides: params.nativeProviderConfigOverrides,
      sharedConfigContent
    })
    : upsertCodexTrustedProject(existingConfigContent, params.ctx.cwd)

  await writeCodexPrivateFileAtomically(params.configPath, nextContent)
}

const syncSharedCodexSessionHomeFiles = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId'>,
  homeDir: string,
  sessionId: string,
  sharedAppServerHome: boolean
) => {
  await mkdir(join(homeDir, '.codex', 'sessions'), { recursive: true })
  if (sharedAppServerHome) return

  const mockHome = resolveMockHome(ctx.cwd, ctx.env)

  const sharedMappings: Array<{ sourcePath: string; targetPath: string; type: 'dir' | 'file' }> = [
    {
      sourcePath: join(mockHome, '.agents', 'skills'),
      targetPath: join(homeDir, '.agents', 'skills'),
      type: 'dir'
    },
    {
      sourcePath: join(mockHome, '.codex', 'skills'),
      targetPath: join(homeDir, '.codex', 'skills'),
      type: 'dir'
    },
    {
      sourcePath: join(mockHome, '.codex', 'hooks.json'),
      targetPath: join(homeDir, '.codex', 'hooks.json'),
      type: 'file'
    }
  ]

  await Promise.all(sharedMappings.map(mapping =>
    syncSymlinkTarget({
      ...mapping,
      onMissingSource: 'remove'
    })
  ))
}

export const prepareCodexSessionHome = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'ctxId' | 'configs'> & Partial<Pick<AdapterCtx, 'cache'>>
  sessionId: string
  account?: string
  model?: string
  nativeProviderConfigOverrides?: string[]
  appServerProfileKey?: string
  nativeHooksAvailable?: boolean
  sharedAppServerHome?: boolean
  useAccountPool?: boolean
}) => {
  const { ctx, sessionId } = params
  const startupProfiler = createStartupProfiler({
    cwd: ctx.cwd,
    ctxId: ctx.ctxId,
    env: ctx.env,
    sessionId
  })
  const requestedAccount = normalizeNonEmptyString(params.account)
  const collectStartedAt = startupProfiler.now()
  const catalog = await collectCodexAccountDescriptors(ctx)
  startupProfiler.mark('codex.accounts.collectDescriptors', collectStartedAt)
  const poolSelection = requestedAccount == null && params.useAccountPool !== false && catalog.accountPool.enabled
    ? await resolveCodexAccountPoolCandidates(ctx, params.model)
    : undefined
  if (poolSelection?.enabled === true && poolSelection.candidates.length === 0) {
    const retryHint = poolSelection.retryAt == null
      ? ''
      : ` Earliest retry: ${new Date(poolSelection.retryAt).toISOString()}.`
    throw new Error(`No healthy Codex account is available in the automatic account pool.${retryHint}`)
  }
  const selectedAccountKey = requestedAccount ??
    poolSelection?.candidates[0]?.key ??
    catalog.defaultAccount ??
    catalog.accounts.find(account => account.status === 'ready')?.key
  const selectedAccount = selectedAccountKey == null
    ? undefined
    : catalog.accounts.find(account => account.key === selectedAccountKey)

  if (requestedAccount != null && !hasCodexAccountAuth(selectedAccount)) {
    throw new Error(`Codex account "${requestedAccount}" is not available.`)
  }

  const inlineCredentialOwner = selectedAccount?.authFilePath == null && selectedAccount?.authContent != null
    ? await ensureCodexInlineCredentialOwner({ ctx, descriptor: selectedAccount })
    : undefined
  const accountIdentity = inlineCredentialOwner?.ownerId ??
    selectedAccount?.metadata?.authDigest ??
    (selectedAccount?.authContent == null
      ? selectedAccount?.authFilePath ?? selectedAccount?.key ?? selectedAccountKey ?? 'default'
      : createHash('sha256').update(selectedAccount.authContent).digest('hex'))
  const homeDir = params.appServerProfileKey == null
    ? resolveCodexSessionHomeDir(ctx, sessionId)
    : resolveCodexAppServerHomeDir(
      ctx,
      createHash('sha256')
        .update(JSON.stringify({
          account: accountIdentity,
          profile: params.appServerProfileKey
        }))
        .digest('hex')
        .slice(0, 24),
      params.sharedAppServerHome === true
    )
  const mockHome = resolveMockHome(ctx.cwd, ctx.env)
  const bridgeSourceHome = params.sharedAppServerHome
    ? ctx.env.__ONEWORKS_PROJECT_REAL_HOME__?.trim() || homedir()
    : mockHome
  const bridgeStartedAt = startupProfiler.now()
  bridgeRealHomeToMockHome({
    realHome: bridgeSourceHome,
    mockHome: homeDir,
    excludeEntries: [...CODEX_SESSION_HOME_BRIDGE_EXCLUDED_ENTRIES]
  })
  startupProfiler.mark('codex.accounts.bridgeSessionHome', bridgeStartedAt)
  const unlinkStartedAt = startupProfiler.now()
  await unlinkMockHomeBridgePaths({
    mockHome: homeDir,
    paths: [
      '.agents/skills',
      ...(inlineCredentialOwner == null ? ['.codex/auth.json'] : []),
      '.codex/config.toml',
      '.codex/hooks.json',
      '.codex/sessions',
      '.codex/skills'
    ]
  })
  startupProfiler.mark('codex.accounts.unlinkSessionHomeOverrides', unlinkStartedAt)
  const unlinkRuntimeStateStartedAt = startupProfiler.now()
  await unlinkCodexRuntimeStateBridgePaths(homeDir)
  startupProfiler.mark('codex.accounts.unlinkRuntimeStateBridgePaths', unlinkRuntimeStateStartedAt)
  await mkdir(join(homeDir, '.codex'), { recursive: true })
  const sharedFilesStartedAt = startupProfiler.now()
  await syncSharedCodexSessionHomeFiles(ctx, homeDir, sessionId, params.sharedAppServerHome === true)
  startupProfiler.mark('codex.accounts.syncSharedSessionHomeFiles', sharedFilesStartedAt)
  const sessionConfigStartedAt = startupProfiler.now()
  const sessionConfigPath = join(homeDir, '.codex', 'config.toml')
  await withCanonicalConfigWriteLock(sessionConfigPath, async (targetPath) => {
    await writeCodexSessionConfigFile({
      configPath: targetPath,
      ctx,
      nativeProviderConfigOverrides: params.nativeProviderConfigOverrides,
      preserveExisting: params.appServerProfileKey != null,
      sharedAppServerHome: params.sharedAppServerHome
    })
    if (params.sharedAppServerHome === true) {
      await ensureCodexSharedNativeHooksInstalled({
        configPath: targetPath,
        enabled: params.nativeHooksAvailable === true,
        homeDir
      })
    } else {
      await ensureCodexNativeHookTrustState({
        configPath: targetPath,
        hooksPath: join(homeDir, '.codex', 'hooks.json')
      })
    }
    await ensureCodexConfigCliCompatibility(targetPath)
  })
  startupProfiler.mark('codex.accounts.writeSessionConfig', sessionConfigStartedAt)
  const authStartedAt = startupProfiler.now()
  const sessionAuthPath = join(homeDir, '.codex', 'auth.json')
  const authFilePath = inlineCredentialOwner?.ownerPath ?? selectedAccount?.authFilePath
  const bindCredentialOwner = inlineCredentialOwner?.bindCredentialOwner
  const startingDigest = bindCredentialOwner == null
    ? undefined
    : await bindCredentialOwner(sessionAuthPath)
  if (bindCredentialOwner == null) {
    await syncSymlinkTarget({
      sourcePath: authFilePath ?? join(homeDir, MISSING_AUTH_SENTINEL_FILE),
      targetPath: sessionAuthPath,
      type: 'file',
      onMissingSource: 'remove'
    })
  }
  startupProfiler.mark('codex.accounts.syncAuth', authStartedAt)

  return {
    homeDir,
    accountKey: selectedAccount?.key ?? selectedAccountKey,
    authFilePath,
    reconcileCredentialOwner: bindCredentialOwner == null || startingDigest == null
      ? undefined
      : async () => {
        await bindCredentialOwner(sessionAuthPath, startingDigest)
      }
  }
}

export const getCodexAccounts = async (
  ctx: AdapterCtx,
  options: AdapterAccountsQueryOptions
): Promise<AdapterAccountsResult> => {
  const catalog = await collectCodexAccountDescriptors(ctx, {
    refresh: options.refresh
  })
  const accounts: AdapterAccountInfo[] = []
  const configuredAccounts = resolveCodexAdapterConfig(ctx).accounts

  for (const descriptor of catalog.accounts) {
    if (!hasCodexAccountAuth(descriptor)) {
      accounts.push({
        key: descriptor.key,
        title: descriptor.title ?? descriptor.key,
        description: descriptor.description,
        avatarUrl: normalizeNonEmptyString(descriptor.metadata?.avatarUrl),
        displayName: normalizeNonEmptyString(descriptor.identity?.displayName) ??
          normalizeNonEmptyString(descriptor.metadata?.displayName),
        email: normalizeNonEmptyString(descriptor.identity?.email) ??
          normalizeNonEmptyString(descriptor.metadata?.email),
        status: descriptor.status,
        isDefault: descriptor.key === catalog.defaultAccount,
        priority: descriptor.priority,
        disabled: descriptor.disabled,
        ...(getActiveAccountPoolHealth(ctx.cwd, descriptor, options.model) != null
          ? { retryAt: getActiveAccountPoolHealth(ctx.cwd, descriptor, options.model)!.retryAt }
          : {})
      })
      continue
    }

    try {
      const probe = await getCodexAccountProbe({
        ctx,
        descriptor,
        refresh: options.refresh,
        scope: 'list'
      })
      const detail = buildCodexAccountDetail({
        descriptor,
        defaultAccount: catalog.defaultAccount,
        configuredAccount: configuredAccounts[descriptor.key],
        probe
      })
      accounts.push({
        key: detail.key,
        title: detail.title,
        description: detail.description,
        avatarUrl: detail.avatarUrl,
        displayName: detail.displayName,
        email: detail.email,
        status: detail.status,
        isDefault: detail.isDefault,
        priority: detail.priority,
        disabled: detail.disabled,
        ...(getActiveAccountPoolHealth(ctx.cwd, descriptor, options.model) != null
          ? { retryAt: getActiveAccountPoolHealth(ctx.cwd, descriptor, options.model)!.retryAt }
          : {}),
        quota: detail.quota
      })
    } catch (error) {
      const detail = buildCodexAccountDetail({
        descriptor,
        defaultAccount: catalog.defaultAccount,
        configuredAccount: configuredAccounts[descriptor.key],
        overrideError: error instanceof Error ? error.message : String(error)
      })
      accounts.push({
        key: detail.key,
        title: detail.title,
        description: detail.description,
        avatarUrl: detail.avatarUrl,
        displayName: detail.displayName,
        email: detail.email,
        status: detail.status,
        isDefault: detail.isDefault,
        priority: detail.priority,
        disabled: detail.disabled,
        ...(getActiveAccountPoolHealth(ctx.cwd, descriptor, options.model) != null
          ? { retryAt: getActiveAccountPoolHealth(ctx.cwd, descriptor, options.model)!.retryAt }
          : {})
      })
    }
  }

  return {
    defaultAccount: catalog.defaultAccount,
    accounts,
    automaticSelection: {
      enabled: catalog.accountPool.enabled,
      strategy: 'sticky-priority'
    },
    actions: [...CODEX_ACCOUNT_LIST_ACTIONS]
  }
}

export const getCodexAccountDetail = async (
  ctx: AdapterCtx,
  options: AdapterAccountDetailQueryOptions
): Promise<AdapterAccountDetailResult> => {
  return withCodexAccountQuotaCacheLock(ctx, async () => {
    const { descriptor, defaultAccount, configuredAccount } = await resolveExistingCodexAccount(
      ctx,
      options.account,
      {
        refresh: options.refresh
      }
    )

    if (!hasCodexAccountAuth(descriptor)) {
      return {
        account: buildCodexAccountDetail({
          descriptor,
          defaultAccount,
          configuredAccount
        })
      }
    }

    try {
      const probe = await getCodexAccountProbeUnlocked({
        ctx,
        descriptor,
        refresh: options.refresh,
        scope: 'detail'
      })
      return {
        account: buildCodexAccountDetail({
          descriptor,
          defaultAccount,
          configuredAccount,
          probe
        })
      }
    } catch (error) {
      return {
        account: buildCodexAccountDetail({
          descriptor,
          defaultAccount,
          configuredAccount,
          overrideError: error instanceof Error ? error.message : String(error)
        })
      }
    }
  })
}

export const manageCodexAccount = async (
  ctx: AdapterCtx,
  options: AdapterManageAccountOptions
): Promise<AdapterManageAccountResult> => {
  if (options.action === 'consume-reset-credit') {
    const normalizedAccount = normalizeNonEmptyString(options.account)
    if (normalizedAccount == null) {
      throw new Error('Codex reset credit consumption requires an account key.')
    }
    const operationId = normalizeNonEmptyString(options.operationId)
    if (operationId == null) {
      throw new Error('Codex reset credit consumption requires an operation ID.')
    }

    return withCodexAccountQuotaCacheLock(ctx, async () => {
      const { descriptor, defaultAccount, configuredAccount } = await resolveExistingCodexAccount(
        ctx,
        normalizedAccount
      )
      const expectedCredentialState = await captureCodexResetCreditCredentialState({
        account: configuredAccount,
        descriptor,
        accountKey: descriptor.key,
        ctx,
        descriptorTombstones: resolveCodexAdapterConfig(ctx).accountTombstones,
        required: descriptor.sourceKind === 'global-config'
      })
      const authSource = await writeDescriptorAuthSourceFile({
        ctx,
        descriptor,
        scope: 'consume-reset-credit'
      })
      if (authSource == null) {
        throw new Error(`Codex account "${normalizedAccount}" has no usable authentication source.`)
      }
      try {
        const expectedCredentialRevision = expectedCredentialState.canonicalAccount

        const consume = () =>
          probeCodexAccount({
            ctx,
            homeDir: authSource.homeDir,
            authFilePath: authSource.authFilePath,
            refresh: true,
            fetchProfile: false,
            logKey: `consume-reset-credit-${descriptor.key}`,
            consumeResetCredit: {
              creditId: normalizeNonEmptyString(options.creditId),
              idempotencyKey: operationId
            },
            timeoutMs: resolveCodexResetCreditOperationTimeoutMs(ctx.env)
          })
        const liveProbeResult = await withCanonicalConfigWriteLock(
          resolveCodexGlobalConfigPath(ctx),
          async (targetPath) => {
            await assertCodexResetCreditCredentialIsCurrent({
              ctx,
              expected: expectedCredentialState,
              targetPath
            })
            if (
              authSource.materializedCredentialDigest !==
                expectedCredentialState.effectiveSource.contentDigest ||
              !codexStableCredentialIdentitiesMatch(
                authSource.materializedCredentialIdentity,
                expectedCredentialState.effectiveSource.stableIdentity
              )
            ) {
              throw new Error(
                `Codex account "${expectedCredentialState.accountKey}" changed while this reset-credit request was waiting. Retry with the current account.`
              )
            }
            return consume()
          }
        )
        const liveProbe = liveProbeResult.probe
        const outcome = liveProbe.resetCreditOutcome
        if (outcome == null) {
          throw new Error('Codex returned an unknown reset credit outcome.')
        }

        let probe = liveProbe
        try {
          probe = await mergeProbeWithCachedQuotaUnlocked({
            ctx,
            descriptor,
            probe: liveProbe,
            live: true
          }) ?? liveProbe
        } catch (error) {
          ctx.logger.warn('[codex account] reset credit outcome succeeded, but quota cache update failed', {
            account: descriptor.key,
            operationId,
            error: error instanceof Error ? error.message : String(error)
          })
        }

        try {
          if (liveProbeResult.credentialsValidated) {
            await authSource.commitValidatedCredential?.(liveProbeResult.authContent)
          }
          await writeProbeMetadata({
            ctx,
            descriptor,
            probe,
            refreshedAuthContent: undefined,
            expectedCredentialRevision
          })
        } catch (error) {
          ctx.logger.warn('[codex account] reset credit outcome succeeded, but metadata persistence failed', {
            account: descriptor.key,
            operationId,
            error: error instanceof Error ? error.message : String(error)
          })
        }

        const messages: Record<CodexRateLimitResetCreditOutcome, string> = {
          reset: probe.quota == null
            ? 'Used one Codex reset credit. Refresh the quota to load the latest limits.'
            : 'Used one Codex reset credit and refreshed the quota.',
          alreadyRedeemed: 'This Codex reset credit was already redeemed.',
          nothingToReset: 'No eligible Codex rate-limit window needs resetting.',
          noCredit: 'No Codex reset credit is available.'
        }

        return {
          accountKey: normalizedAccount,
          outcome,
          account: buildCodexAccountDetail({
            descriptor,
            defaultAccount,
            configuredAccount,
            probe
          }),
          message: messages[outcome]
        }
      } finally {
        await authSource.cleanup()
      }
    })
  }

  if (options.action === 'refresh') {
    const normalizedAccount = normalizeNonEmptyString(options.account)
    if (normalizedAccount == null) {
      throw new Error('Codex refresh requires an account key.')
    }

    const detail = await getCodexAccountDetail(ctx, {
      account: normalizedAccount,
      model: options.model,
      refresh: true
    })
    if (detail.account.status === 'error') {
      throw new Error(
        detail.account.description ??
          `Codex account "${normalizedAccount}" could not refresh its current credentials.`
      )
    }

    return {
      accountKey: normalizedAccount,
      account: detail.account,
      message: `Refreshed Codex account "${normalizedAccount}".`
    }
  }

  if (options.action === 'remove') {
    const normalizedAccount = normalizeNonEmptyString(options.account)
    if (normalizedAccount == null) {
      throw new Error('Codex remove requires an account key.')
    }

    await withCodexAccountQuotaCacheLock(ctx, async () => {
      const { descriptor, configuredAccount } = await resolveExistingCodexAccount(ctx, normalizedAccount)

      if (descriptor.sourceKind !== 'global-config') {
        if (configuredAccount?.authFile != null && configuredAccount.authFile.trim() !== '') {
          throw new Error(
            `Codex account "${normalizedAccount}" is backed by adapters.codex.accounts.${normalizedAccount}.authFile. Remove that config entry instead.`
          )
        }
        throw new Error(
          `Codex account "${normalizedAccount}" is not stored in the global OneWorks config.`
        )
      }

      await removeCodexGlobalAccountConfig(ctx, normalizedAccount)
      await clearCodexAccountQuotaCacheUnlocked(ctx, normalizedAccount)
    })

    return {
      accountKey: normalizedAccount,
      message: `Removed Codex account "${normalizedAccount}" from the global OneWorks config.`
    }
  }

  const normalizedRequestedKey = normalizeNonEmptyString(options.account)
  if (options.action === 'reauthenticate' && normalizedRequestedKey == null) {
    throw new Error('Codex reauthentication requires an account key.')
  }
  const reauthenticationTarget = options.action === 'reauthenticate' && normalizedRequestedKey != null
    ? await resolveExistingCodexAccount(ctx, normalizedRequestedKey)
    : undefined
  const reauthenticationCredentialRevision = reauthenticationTarget == null
    ? undefined
    : await readCodexGlobalAccountCredentialRevision(ctx, reauthenticationTarget.descriptor.key)
  const loginResult = await runCodexLogin({
    ctx,
    onProgress: options.onProgress,
    signal: options.signal
  })
  const loginProbeHomeDir = resolveCodexProbeHomeDir(
    ctx,
    `login-probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  )

  try {
    throwIfAborted(options.signal)
    const probeResult = await probeCodexAccount({
      ctx,
      homeDir: loginProbeHomeDir,
      authFilePath: loginResult.authFilePath,
      binaryPath: loginResult.binaryPath,
      refresh: true,
      logKey: `login-${normalizedRequestedKey ?? 'new'}`,
      signal: options.signal
    })
    const authContent = probeResult.authContent
    const authDigest = createHash('sha256').update(authContent).digest('hex')
    const authIdentity = readCodexAuthIdentityFromContent(authContent)
    const probe = mergeCodexAccountProbes(
      authIdentity,
      probeResult.probe
    )
    const existingConfiguredAccount = reauthenticationTarget?.descriptor ??
      await findConfiguredAccountByIdentity(ctx, {
        authDigest,
        probe
      })
    let accountKey = reauthenticationTarget?.descriptor.key ??
      (normalizedRequestedKey != null && slugifyAccountKey(normalizedRequestedKey) !== ''
        ? slugifyAccountKey(normalizedRequestedKey)
        : existingConfiguredAccount?.key != null
        ? existingConfiguredAccount.key
        : buildImportedAccountKey({ authDigest, probe }))
    const metadata: CodexStoredAccountMetadata = {
      title: resolveCodexAccountTitle({
        key: accountKey,
        title: existingConfiguredAccount?.metadata?.title,
        probe
      }),
      description: 'Logged in via `codex login`.',
      displayName: probe?.displayName,
      email: probe?.email,
      planType: probe?.planType,
      accountType: probe?.accountType,
      accountId: probe?.accountId,
      organizationId: probe?.organizationId,
      organizationTitle: probe?.organizationTitle,
      organizationRole: probe?.organizationRole,
      avatarUrl: normalizeNonEmptyString(existingConfiguredAccount?.metadata?.avatarUrl) ??
        normalizeNonEmptyString(probe?.avatarUrl),
      quota: cloneQuotaInfo(probe?.quota),
      resetCreditDetailsCapturedAt: parseFiniteNumber(probe?.resetCreditDetailsCapturedAt),
      source: 'codex-login',
      authDigest,
      createdAt: existingConfiguredAccount?.metadata?.createdAt ?? Date.now(),
      updatedAt: Date.now()
    }
    options.onProgress?.({
      phase: 'saving',
      stream: 'status',
      message: 'Saving the connected Codex account.'
    })
    await withCodexAccountQuotaCacheLock(ctx, async () => {
      accountKey = await upsertCodexGlobalAccountConfig(ctx, {
        key: accountKey,
        authContent,
        allocateCollisionSafeKey: options.action === 'add',
        metadata,
        expectedCredentialRevision: reauthenticationCredentialRevision
      })
      await clearCodexAccountQuotaCacheUnlocked(ctx, accountKey)
    })
    const detail = buildCodexAccountDetail({
      descriptor: {
        key: accountKey,
        title: metadata.title,
        description: metadata.description,
        authContent,
        sourceKind: 'global-config',
        status: 'ready',
        priority: existingConfiguredAccount?.priority ?? 0,
        disabled: existingConfiguredAccount?.disabled === true,
        credentialFingerprint: authDigest,
        metadata,
        identity: mergeCodexAccountProbes(existingConfiguredAccount?.identity, metadata)
      },
      probe
    })

    return {
      accountKey,
      account: detail,
      message: options.action === 'reauthenticate'
        ? `Reauthenticated Codex account "${detail.title}".`
        : `Connected Codex account "${detail.title}".`
    }
  } finally {
    await Promise.all([
      rm(loginResult.homeDir, { recursive: true, force: true }).catch(() => {}),
      rm(loginProbeHomeDir, { recursive: true, force: true }).catch(() => {})
    ])
  }
}
