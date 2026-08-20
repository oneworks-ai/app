/* eslint-disable max-lines -- Claude account lifecycle, credential codecs, and cached usage parsing stay colocated. */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

import { updateGlobalAdapterAccounts } from '@oneworks/config'
import type {
  AdapterAccountDetail,
  AdapterAccountDetailQueryOptions,
  AdapterAccountDetailResult,
  AdapterAccountInfo,
  AdapterAccountQuotaInfo,
  AdapterAccountsQueryOptions,
  AdapterAccountsResult,
  AdapterCtx,
  AdapterManageAccountOptions,
  AdapterManageAccountResult
} from '@oneworks/types'
import {
  addAdapterAccountTombstone,
  createAdapterAccountGeneration,
  createAdapterCredentialRevision,
  filterActiveAdapterAccounts,
  isAdapterAccountGenerationDeleted,
  mergeAdapterConfigs,
  normalizeAdapterAccountTombstones,
  resolveGlobalAdapterAccountDir,
  resolveGlobalOoConfigPath
} from '@oneworks/utils'
import { withDirectoryInstallLock } from '@oneworks/utils/install-lock'

import type { ClaudeCodeAdapterConfig } from '../config-schema'
import { resolveClaudeCodeAdapterConfig } from '../runtime-config'
import { ensureClaudeCliPath } from './cli'
import { resolveClaudeAccountQuota } from './usage'

type ClaudeConfiguredAccount = NonNullable<ClaudeCodeAdapterConfig['accounts']>[string]
type ClaudeCredentialEnvelope = NonNullable<ClaudeConfiguredAccount['auth']>
type ClaudeInlineCredentialEnvelope = Extract<ClaudeCredentialEnvelope, { token: string }>
type ClaudeDeviceCredentialEnvelope = Extract<ClaudeCredentialEnvelope, { storage: 'device' }>

interface ClaudeAuthStatus {
  apiProvider?: string
  authMethod?: string
  email?: string
  loggedIn: boolean
  orgId?: string
  orgName?: string
  subscriptionType?: string
}

interface ClaudeAccountProbe {
  status: ClaudeAuthStatus
  state?: Record<string, unknown>
  quota?: AdapterAccountQuotaInfo
}

class ClaudeCredentialUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeCredentialUnavailableError'
  }
}

class ClaudeDuplicateIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeDuplicateIdentityError'
  }
}

class ClaudeCredentialIsolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeCredentialIsolationError'
  }
}

const CLAUDE_SYSTEM_ACCOUNT_KEY = 'system'
const CLAUDE_CREDENTIAL_TYPE = 'claude-credentials-json'
const CLAUDE_DEVICE_CREDENTIAL_TYPE = 'claude-native-credential-store'
const CLAUDE_STATE_TYPE = 'claude-account-state-json'
const CLAUDE_CONFIG_SUBDIR = 'config'
const CLAUDE_MATERIALIZED_CREDENTIAL_REVISION_FILE = '.oneworks-credential-revision'
const CLAUDE_DEVICE_AUTH_BINDING_FILE = '.oneworks-device-auth-binding.json'
const CLAUDE_DEVICE_AUTH_OPERATION_LOCK = '.oneworks-device-auth-operation-lock'
const CLAUDE_DEVICE_AUTH_SESSION_LEASES = '.oneworks-device-auth-session-leases'
const CLAUDE_AUTH_TERMINATION_GRACE_MS = 100
const CLAUDE_AUTH_OVERRIDE_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_OAUTH_SCOPES',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_VERTEX'
] as const
const CLAUDE_OAUTH_ACCOUNT_STATE_KEYS = [
  'accountCreatedAt',
  'accountUuid',
  'billingType',
  'claudeCodeTrialDurationDays',
  'claudeCodeTrialEndsAt',
  'displayName',
  'emailAddress',
  'hasExtraUsageEnabled',
  'organizationName',
  'organizationRateLimitTier',
  'organizationRole',
  'organizationType',
  'organizationUuid',
  'profileFetchedAt',
  'seatTier',
  'subscriptionCreatedAt',
  'userRateLimitTier',
  'workspaceRole'
] as const

const CLAUDE_LIST_ACTIONS = [{
  key: 'add' as const,
  label: 'Add account',
  description: 'Sign in through the official `claude auth login` flow.',
  scope: 'adapter' as const
}]

const CLAUDE_ACCOUNT_ACTIONS = [
  {
    key: 'refresh' as const,
    label: 'Refresh',
    description: 'Refresh official auth status and identity-matched usage.',
    scope: 'account' as const
  },
  {
    key: 'reauthenticate' as const,
    label: 'Sign in again',
    description: 'Run the official login flow again in this account directory.',
    scope: 'account' as const
  },
  {
    key: 'remove' as const,
    label: 'Remove',
    description: 'Run official logout, then remove the One Works account snapshot.',
    scope: 'account' as const
  }
]

const CLAUDE_DEVICE_ACCOUNT_ACTIONS = [
  CLAUDE_ACCOUNT_ACTIONS[0],
  {
    ...CLAUDE_ACCOUNT_ACTIONS[1],
    description: 'Replace the machine-wide native Claude login through the official login flow.'
  },
  {
    ...CLAUDE_ACCOUNT_ACTIONS[2],
    description: 'Remove the One Works account record without logging out the shared native credential store.'
  }
]

const CLAUDE_SYSTEM_ACCOUNT_ACTIONS = [CLAUDE_ACCOUNT_ACTIONS[0]]

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
)

const slugifyAccountKey = (value: string) => (
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
)

const resolveClaudeAccountConfigDir = (
  ctx: Pick<AdapterCtx, 'env'>,
  accountKey: string
) => join(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', accountKey), CLAUDE_CONFIG_SUBDIR)

const withClaudeAccountOperationLock = async <T>(
  ctx: Pick<AdapterCtx, 'env'>,
  accountKey: string,
  callback: () => Promise<T>
) =>
  withDirectoryInstallLock({
    lockDir: `${resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', accountKey)}.oneworks-operation-lock`
  }, callback)

const resolveClaudeDeviceAuthResourceRoot = (
  ctx: Pick<AdapterCtx, 'env'>
) => dirname(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', 'device-auth-resource'))

const withClaudeDeviceAuthOperationLock = async <T>(
  ctx: Pick<AdapterCtx, 'env'>,
  callback: () => Promise<T>
) =>
  withDirectoryInstallLock({
    lockDir: join(resolveClaudeDeviceAuthResourceRoot(ctx), CLAUDE_DEVICE_AUTH_OPERATION_LOCK)
  }, callback)

const resolveClaudeAccountSessionLeasesDir = (
  ctx: Pick<AdapterCtx, 'env'>,
  accountKey: string
) => `${resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', accountKey)}.oneworks-session-leases`

const resolveClaudeDeviceAuthSessionLeasesDir = (
  ctx: Pick<AdapterCtx, 'env'>
) => join(resolveClaudeDeviceAuthResourceRoot(ctx), CLAUDE_DEVICE_AUTH_SESSION_LEASES)

const resolveClaudeDeviceAuthBindingPath = (
  ctx: Pick<AdapterCtx, 'env'>
) => join(resolveClaudeDeviceAuthResourceRoot(ctx), CLAUDE_DEVICE_AUTH_BINDING_FILE)

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const listActiveClaudeSessionLeases = async (leasesDir: string) => {
  const entries = await readdir(leasesDir, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
  const active: string[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const leasePath = join(leasesDir, entry.name)
    const lease = await readJsonRecord(leasePath)
    const pid = normalizeNumber(lease?.pid)
    if (pid != null && Number.isInteger(pid) && isProcessAlive(pid)) {
      active.push(leasePath)
      continue
    }
    await rm(leasePath, { force: true })
  }
  return active
}

const listActiveClaudeAccountSessionLeases = async (
  ctx: Pick<AdapterCtx, 'env'>,
  accountKey: string
) => listActiveClaudeSessionLeases(resolveClaudeAccountSessionLeasesDir(ctx, accountKey))

const assertNoActiveClaudeAccountSessions = async (
  ctx: Pick<AdapterCtx, 'env'>,
  accountKey: string
) => {
  if ((await listActiveClaudeAccountSessionLeases(ctx, accountKey)).length > 0) {
    throw new Error(
      `Claude account "${accountKey}" has active sessions. Stop them before reauthenticating or removing it.`
    )
  }
}

const assertNoActiveClaudeDeviceAuthSessions = async (
  ctx: Pick<AdapterCtx, 'env'>
) => {
  if ((await listActiveClaudeSessionLeases(resolveClaudeDeviceAuthSessionLeasesDir(ctx))).length > 0) {
    throw new Error(
      'Claude native device authentication has active sessions. Stop them before changing a device-bound login.'
    )
  }
}

const isDeviceBoundClaudeAccount = (account: ClaudeConfiguredAccount | undefined) => (
  isRecord(account?.auth) && account.auth.storage === 'device'
)

const usesMachineWideClaudeAuth = (
  ctx: Pick<AdapterCtx, 'env'>,
  account: ClaudeConfiguredAccount | undefined
) => usesSystemClaudeDeviceAuth(ctx, account)

const withClaudeAccountResourceLock = async <T>(params: {
  ctx: Pick<AdapterCtx, 'env'>
  key: string
  account: ClaudeConfiguredAccount
  callback: () => Promise<T>
}) => {
  const runAccountOperation = () => withClaudeAccountOperationLock(params.ctx, params.key, params.callback)
  return usesMachineWideClaudeAuth(params.ctx, params.account)
    ? await withClaudeDeviceAuthOperationLock(params.ctx, runAccountOperation)
    : await runAccountOperation()
}

const createClaudeSessionLease = async (leasesDir: string) => {
  await mkdir(leasesDir, { recursive: true })
  const leasePath = join(leasesDir, `${randomUUID()}.json`)
  await writeFile(leasePath, JSON.stringify({ createdAt: Date.now(), pid: process.pid }), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  })
  let released = false
  return async () => {
    if (released) return
    released = true
    await rm(leasePath, { force: true })
  }
}

const resolveRealHome = (ctx: Pick<AdapterCtx, 'env'>) => (
  normalizeString(ctx.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    normalizeString(process.env.__ONEWORKS_PROJECT_REAL_HOME__) ??
    normalizeString(ctx.env.HOME) ??
    normalizeString(process.env.HOME) ??
    homedir()
)

const resolveClaudeStatePath = (
  ctx: Pick<AdapterCtx, 'env'>,
  configDir?: string
) =>
  configDir == null
    ? resolve(resolveRealHome(ctx), '.claude.json')
    : join(configDir, '.claude.json')

const readJsonRecord = async (filePath: string) => {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const readOptionalTextFile = async (filePath: string) => {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

const assertClaudeAccountGenerationIsCurrent = async (
  ctx: Pick<AdapterCtx, 'env'>,
  key: string,
  account: ClaudeConfiguredAccount
) => {
  const globalConfig = await readJsonRecord(resolveGlobalOoConfigPath(ctx.env))
  const adapters = isRecord(globalConfig?.adapters) ? globalConfig.adapters : undefined
  const claudeConfig = isRecord(adapters?.['claude-code']) ? adapters['claude-code'] : undefined
  const tombstones = normalizeAdapterAccountTombstones(claudeConfig?.accountTombstones)
  if (isAdapterAccountGenerationDeleted(tombstones, key, account.generation)) {
    throw new Error(`Claude account "${key}" was deleted before this operation started.`)
  }
  const accounts = isRecord(claudeConfig?.accounts) ? claudeConfig.accounts : undefined
  const canonicalAccount = isRecord(accounts?.[key]) ? accounts[key] : undefined
  if (
    canonicalAccount == null ||
    normalizeString(canonicalAccount.generation) !== normalizeString(account.generation) ||
    normalizeString(canonicalAccount.credentialRevision) !== normalizeString(account.credentialRevision)
  ) {
    throw new Error(`Claude account "${key}" changed before this operation started.`)
  }
}

const assertClaudeAccountKeyIsAvailable = async (
  ctx: Pick<AdapterCtx, 'env'>,
  key: string
) => {
  const globalConfig = await readJsonRecord(resolveGlobalOoConfigPath(ctx.env))
  const adapters = isRecord(globalConfig?.adapters) ? globalConfig.adapters : undefined
  const claudeConfig = isRecord(adapters?.['claude-code']) ? adapters['claude-code'] : undefined
  const accounts = isRecord(claudeConfig?.accounts) ? claudeConfig.accounts : undefined
  const canonicalAccount = isRecord(accounts?.[key]) ? accounts[key] : undefined
  const tombstones = normalizeAdapterAccountTombstones(claudeConfig?.accountTombstones)
  if (
    canonicalAccount != null &&
    !isAdapterAccountGenerationDeleted(tombstones, key, canonicalAccount.generation)
  ) {
    throw new Error(`Claude account "${key}" already exists. Reauthenticate it instead.`)
  }
}

export const acquireClaudeAccountSessionLease = async (
  ctx: Pick<AdapterCtx, 'env' | 'configs' | 'configState'>,
  accountKey: string | undefined
) => {
  const isSystemSession = accountKey == null || accountKey === CLAUDE_SYSTEM_ACCOUNT_KEY
  const account = isSystemSession ? undefined : resolveExistingConfiguredAccount(ctx, accountKey)
  const usesDeviceAuthResource = isSystemSession || usesMachineWideClaudeAuth(ctx, account)
  if (usesDeviceAuthResource) {
    return await withClaudeDeviceAuthOperationLock(ctx, async () => {
      if (accountKey != null && account != null) {
        return await withClaudeAccountOperationLock(ctx, accountKey, async () => {
          await assertClaudeAccountGenerationIsCurrent(ctx, accountKey, account)
          await assertClaudeDeviceAuthBinding(ctx, accountKey, account)
          return await createClaudeSessionLease(resolveClaudeDeviceAuthSessionLeasesDir(ctx))
        })
      }
      return await createClaudeSessionLease(resolveClaudeDeviceAuthSessionLeasesDir(ctx))
    })
  }
  if (accountKey == null || account == null) {
    throw new Error('Claude account session lease requires a resolved managed account.')
  }
  return await withClaudeAccountOperationLock(ctx, accountKey, async () => {
    await assertClaudeAccountGenerationIsCurrent(ctx, accountKey, account)
    return await createClaudeSessionLease(resolveClaudeAccountSessionLeasesDir(ctx, accountKey))
  })
}

const writeFileAtomically = async (filePath: string, content: string, mode?: number) => {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(tempPath, content, { encoding: 'utf8', ...(mode == null ? {} : { mode }) })
    await rename(tempPath, filePath)
    if (mode != null) await chmod(filePath, mode)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}

const buildClaudeDeviceAuthBinding = (key: string, account: ClaudeConfiguredAccount) => {
  const authDigest = normalizeString(account.authDigest)
  const credentialRevision = normalizeString(account.credentialRevision)
  const email = normalizeString(account.email)?.toLowerCase()
  const generation = normalizeString(account.generation)
  const organizationId = normalizeString(account.organizationId)
  if (
    authDigest == null ||
    credentialRevision == null ||
    email == null ||
    generation == null ||
    organizationId == null
  ) {
    return undefined
  }
  return { accountKey: key, authDigest, credentialRevision, email, generation, organizationId }
}

const claudeDeviceAuthBindingMatches = (
  binding: Record<string, unknown> | undefined,
  key: string,
  account: ClaudeConfiguredAccount
) => {
  const expected = buildClaudeDeviceAuthBinding(key, account)
  return binding != null && expected != null &&
    normalizeString(binding.accountKey) === key &&
    normalizeString(binding.generation) === expected.generation &&
    normalizeString(binding.credentialRevision) === expected.credentialRevision &&
    normalizeString(binding.authDigest) === expected.authDigest &&
    normalizeString(binding.email)?.toLowerCase() === expected.email &&
    normalizeString(binding.organizationId) === expected.organizationId
}

const assertClaudeDeviceAuthBinding = async (
  ctx: Pick<AdapterCtx, 'env'>,
  key: string,
  account: ClaudeConfiguredAccount
) => {
  const binding = await readJsonRecord(resolveClaudeDeviceAuthBindingPath(ctx))
  if (!claudeDeviceAuthBindingMatches(binding, key, account)) {
    throw new ClaudeCredentialUnavailableError(
      `Claude account "${key}" is not authenticated on this device because another or unknown machine-wide ` +
        'native Claude login is active. Sign in again to use it.'
    )
  }
}

const writeClaudeDeviceAuthBinding = async (
  ctx: Pick<AdapterCtx, 'env'>,
  key: string,
  account: ClaudeConfiguredAccount
) => {
  const binding = buildClaudeDeviceAuthBinding(key, account)
  if (binding == null) {
    throw new ClaudeCredentialUnavailableError(
      `Claude account "${key}" cannot be bound to this device without complete credential and identity metadata.`
    )
  }
  await writeFileAtomically(
    resolveClaudeDeviceAuthBindingPath(ctx),
    `${JSON.stringify(binding, null, 2)}\n`,
    0o600
  )
}

const clearClaudeDeviceAuthBinding = async (
  ctx: Pick<AdapterCtx, 'env'>,
  key: string,
  account: ClaudeConfiguredAccount
) => {
  const bindingPath = resolveClaudeDeviceAuthBindingPath(ctx)
  const binding = await readJsonRecord(bindingPath)
  if (claudeDeviceAuthBindingMatches(binding, key, account)) {
    await rm(bindingPath, { force: true })
  }
}

const clearMaterializedClaudeCredential = async (configDir: string) => {
  await rm(join(configDir, '.credentials.json'), { force: true })
  await rm(join(configDir, CLAUDE_MATERIALIZED_CREDENTIAL_REVISION_FILE), { force: true })
}

const isCanonicalBase64 = (value: string) => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length % 4 !== 0) return false
  return Buffer.from(value, 'base64').toString('base64') === value
}

const isClaudeInlineCredentialEnvelope = (value: unknown): value is ClaudeInlineCredentialEnvelope => {
  if (!isRecord(value)) return false
  const token = normalizeString(value.token)
  return (value.storage == null || value.storage === 'inline') &&
    normalizeString(value.type) === CLAUDE_CREDENTIAL_TYPE &&
    (value.version == null || value.version === 1) &&
    (value.portability == null || value.portability === 'portable') &&
    value.encoding === 'base64' &&
    token != null &&
    isCanonicalBase64(token)
}

const isClaudeDeviceCredentialEnvelope = (value: unknown): value is ClaudeDeviceCredentialEnvelope => (
  isRecord(value) &&
  value.storage === 'device' &&
  normalizeString(value.type) === CLAUDE_DEVICE_CREDENTIAL_TYPE &&
  (value.version == null || value.version === 1) &&
  value.portability === 'device-bound' &&
  normalizeString(value.binding) != null
)

const resolveMaterializedCredentialRevision = (
  account: ClaudeConfiguredAccount,
  credentialContent: string
) =>
  [
    normalizeString(account.generation) ?? 'legacy',
    normalizeString(account.credentialRevision) ?? createHash('sha256').update(credentialContent).digest('hex')
  ].join(':')

const decodeInlinePayload = (value: unknown, expectedType: string) => {
  if (!isRecord(value)) return undefined
  const storage = normalizeString(value.storage)
  if (storage != null && storage !== 'inline') return undefined
  if (normalizeString(value.type) !== expectedType || value.encoding !== 'base64') return undefined
  const token = normalizeString(value.token)
  if (token == null) return undefined
  return Buffer.from(token, 'base64').toString('utf8')
}

const encodeInlineCredential = (content: string) => ({
  storage: 'inline' as const,
  type: CLAUDE_CREDENTIAL_TYPE,
  version: 1 as const,
  portability: 'portable' as const,
  encoding: 'base64' as const,
  token: Buffer.from(content, 'utf8').toString('base64')
})

const encodeDeviceCredential = (bindingSource: string) => ({
  storage: 'device' as const,
  type: CLAUDE_DEVICE_CREDENTIAL_TYPE,
  version: 1 as const,
  portability: 'device-bound' as const,
  binding: createHash('sha256').update(bindingSource).digest('hex')
})

const resolveClaudeSystemDeviceBindingSource = (ctx: Pick<AdapterCtx, 'env'>) => (
  `system-home:${resolveRealHome(ctx)}`
)

const usesSystemClaudeDeviceAuth = (
  ctx: Pick<AdapterCtx, 'env'>,
  account: ClaudeConfiguredAccount | undefined
) => {
  const auth = account?.auth
  return isClaudeDeviceCredentialEnvelope(auth) &&
    auth.binding === encodeDeviceCredential(resolveClaudeSystemDeviceBindingSource(ctx)).binding
}

const pickScalarFields = (
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const picked = Object.fromEntries(keys.flatMap((key) => {
    const item = value[key]
    return item == null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
      ? item === undefined ? [] : [[key, item]]
      : []
  }))
  return Object.keys(picked).length === 0 ? undefined : picked
}

const sanitizeUsageWindow = (value: unknown) => pickScalarFields(value, ['percent', 'resets_at', 'utilization'])

const sanitizeUsageLimit = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const limit = pickScalarFields(value, ['group', 'is_active', 'kind', 'percent', 'resets_at', 'severity']) ?? {}
  const scope = isRecord(value.scope) ? value.scope : undefined
  const model = pickScalarFields(scope?.model, ['display_name', 'id'])
  const surface = normalizeString(scope?.surface)
  if (model != null || surface != null) {
    limit.scope = {
      ...(model == null ? {} : { model }),
      ...(surface == null ? {} : { surface })
    }
  }
  return Object.keys(limit).length === 0 ? undefined : limit
}

const sanitizeCachedUsage = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const rawUtilization = isRecord(value.utilization) ? value.utilization : undefined
  if (rawUtilization == null) return undefined
  const utilization: Record<string, unknown> = {}
  for (const key of ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'] as const) {
    const window = sanitizeUsageWindow(rawUtilization[key])
    if (window != null) utilization[key] = window
  }
  if (Array.isArray(rawUtilization.limits)) {
    const limits = rawUtilization.limits.map(sanitizeUsageLimit).filter((limit): limit is Record<string, unknown> => (
      limit != null
    ))
    if (limits.length > 0) utilization.limits = limits
  }
  const spend = pickScalarFields(
    rawUtilization.spend,
    ['balance', 'cap', 'enabled', 'limit', 'percent', 'severity', 'used']
  )
  if (spend != null) utilization.spend = spend
  const extraUsage = pickScalarFields(
    rawUtilization.extra_usage,
    [
      'credits_ever_enabled',
      'currency',
      'decimal_places',
      'disabled_reason',
      'is_enabled',
      'monthly_limit',
      'spend_limit_reached',
      'used_credits',
      'user_disabled',
      'utilization'
    ]
  )
  if (extraUsage != null) utilization.extra_usage = extraUsage
  if (Object.keys(utilization).length === 0) return undefined
  return {
    ...(normalizeString(value.accountUuid) == null ? {} : { accountUuid: normalizeString(value.accountUuid) }),
    ...(normalizeNumber(value.fetchedAtMs) == null ? {} : { fetchedAtMs: normalizeNumber(value.fetchedAtMs) }),
    utilization
  }
}

const cachedUsageMatchesOauthAccount = (
  oauthAccount: Record<string, unknown> | undefined,
  cachedUsage: Record<string, unknown> | undefined
) => {
  const oauthAccountUuid = normalizeString(oauthAccount?.accountUuid)
  const cachedAccountUuid = normalizeString(cachedUsage?.accountUuid)
  return oauthAccountUuid != null && cachedAccountUuid != null && oauthAccountUuid === cachedAccountUuid
}

const sanitizeClaudeState = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const state: Record<string, unknown> = {}
  const oauthAccount = pickScalarFields(value.oauthAccount, CLAUDE_OAUTH_ACCOUNT_STATE_KEYS)
  const cachedUsageUtilization = sanitizeCachedUsage(value.cachedUsageUtilization)
  if (oauthAccount != null) state.oauthAccount = oauthAccount
  if (
    cachedUsageUtilization != null &&
    cachedUsageMatchesOauthAccount(oauthAccount, cachedUsageUtilization)
  ) {
    state.cachedUsageUtilization = cachedUsageUtilization
  }
  if (typeof value.hasCompletedOnboarding === 'boolean') {
    state.hasCompletedOnboarding = value.hasCompletedOnboarding
  }
  return Object.keys(state).length === 0 ? undefined : state
}

const encodeClaudeState = (state: Record<string, unknown> | undefined) =>
  state == null
    ? undefined
    : {
      storage: 'inline' as const,
      type: CLAUDE_STATE_TYPE as typeof CLAUDE_STATE_TYPE,
      version: 1 as const,
      portability: 'portable' as const,
      encoding: 'base64' as const,
      token: Buffer.from(JSON.stringify(state), 'utf8').toString('base64')
    }

const decodeClaudeState = (account: ClaudeConfiguredAccount) => {
  const content = decodeInlinePayload(account.state, CLAUDE_STATE_TYPE)
  if (content == null) return undefined
  try {
    return sanitizeClaudeState(JSON.parse(content) as unknown)
  } catch {
    return undefined
  }
}

const ensureWorkspaceTrust = (
  state: Record<string, unknown>,
  cwd: string
) => {
  const projects = isRecord(state.projects) ? { ...state.projects } : {}
  const workspacePath = resolve(cwd)
  const current = isRecord(projects[workspacePath]) ? projects[workspacePath] : {}
  const seenCount = normalizeNumber(current.projectOnboardingSeenCount) ?? 0
  projects[workspacePath] = {
    ...current,
    hasTrustDialogAccepted: true,
    projectOnboardingSeenCount: Math.max(1, seenCount),
    hasCompletedProjectOnboarding: true
  }
  return { ...state, projects }
}

export const materializeClaudeAccount = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  accountKey: string
  account: ClaudeConfiguredAccount
  ensureTrust?: boolean
  forceCredentialSnapshot?: boolean
}) => {
  const configDir = resolveClaudeAccountConfigDir(params.ctx, params.accountKey)
  await mkdir(configDir, { recursive: true, mode: 0o700 })
  await chmod(configDir, 0o700)

  const auth = isRecord(params.account.auth) ? params.account.auth : undefined
  const authStorage = auth == null ? undefined : normalizeString(auth.storage) ?? 'inline'
  const rejectUnavailableCredential = async (reason: string): Promise<never> => {
    await clearMaterializedClaudeCredential(configDir)
    throw new ClaudeCredentialUnavailableError(`Claude account "${params.accountKey}" ${reason}`)
  }
  if (auth == null) {
    return await rejectUnavailableCredential('does not contain a supported credential envelope.')
  }
  if (authStorage === 'secret') {
    return await rejectUnavailableCredential('references a credential secret that is not available on this device.')
  }

  if (authStorage === 'inline') {
    if (!isClaudeInlineCredentialEnvelope(auth)) {
      return await rejectUnavailableCredential('contains an invalid or unsupported credential envelope.')
    }
    const credentialContent = Buffer.from(auth.token.trim(), 'base64').toString('utf8')
    let parsedCredential: unknown
    try {
      parsedCredential = JSON.parse(credentialContent) as unknown
    } catch {
      return await rejectUnavailableCredential('contains an invalid credential payload.')
    }
    if (!isRecord(parsedCredential)) return await rejectUnavailableCredential('contains an invalid credential payload.')
    const credentialPath = join(configDir, '.credentials.json')
    const revisionPath = join(configDir, CLAUDE_MATERIALIZED_CREDENTIAL_REVISION_FILE)
    const materializationRevision = resolveMaterializedCredentialRevision(params.account, credentialContent)
    const currentCredential = await readOptionalTextFile(credentialPath)
    const currentRevision = normalizeString(await readOptionalTextFile(revisionPath))
    const materializationIsCurrent = params.forceCredentialSnapshot !== true &&
      currentCredential != null &&
      currentRevision === materializationRevision
    if (!materializationIsCurrent) {
      await writeFileAtomically(credentialPath, credentialContent, 0o600)
    }
    await writeFileAtomically(revisionPath, materializationRevision, 0o600)
  } else if (authStorage === 'device') {
    if (!isClaudeDeviceCredentialEnvelope(auth)) {
      return await rejectUnavailableCredential('contains an invalid or unsupported device credential envelope.')
    }
    // A synchronized device-bound account must never inherit an old portable snapshot
    // that happened to occupy the same stable account directory on this machine.
    await clearMaterializedClaudeCredential(configDir)
  } else {
    return await rejectUnavailableCredential('contains an unknown credential storage mode.')
  }

  const statePath = resolveClaudeStatePath(params.ctx, configDir)
  const initialState = await readJsonRecord(statePath)
  if (initialState == null || params.ensureTrust === true) {
    await withDirectoryInstallLock({
      lockDir: join(configDir, '.oneworks-state-write-lock')
    }, async () => {
      const persistedState = await readJsonRecord(statePath)
      if (persistedState != null && params.ensureTrust !== true) return
      const portableState = decodeClaudeState(params.account) ?? {}
      const baseState = { ...portableState, ...(persistedState ?? {}) }
      const nextState = params.ensureTrust === true
        ? ensureWorkspaceTrust(baseState, params.ctx.cwd)
        : baseState
      if (persistedState != null && JSON.stringify(persistedState) === JSON.stringify(nextState)) return
      await writeFileAtomically(
        statePath,
        `${JSON.stringify(nextState, null, 2)}\n`,
        0o600
      )
    })
  }

  return configDir
}

const buildAuthEnv = (
  ctx: Pick<AdapterCtx, 'env'>,
  configDir?: string
): Record<string, string | undefined> => {
  const useRealHome = configDir == null || process.platform === 'darwin'
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...ctx.env,
      ...(useRealHome ? { HOME: resolveRealHome(ctx) } : {}),
      ...(configDir == null ? {} : { CLAUDE_CONFIG_DIR: configDir })
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
  if (configDir == null) delete env.CLAUDE_CONFIG_DIR
  return configDir == null ? env : scrubClaudeAuthEnvironment(env)
}

export const scrubClaudeAuthEnvironment = <T extends Record<string, string | null | undefined>>(env: T): T => {
  const scrubbed = { ...env }
  for (const key of CLAUDE_AUTH_OVERRIDE_ENV_KEYS) delete scrubbed[key]
  return scrubbed
}

const createAbortError = () =>
  Object.assign(new Error('Claude account operation was aborted.'), {
    name: 'AbortError'
  })

const throwIfAborted = (signal: AbortSignal | undefined) => {
  if (signal?.aborted === true) throw createAbortError()
}

const runClaudeAuthCommand = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'configs' | 'configState'>
  args: string[]
  configDir?: string
  onProgress?: AdapterManageAccountOptions['onProgress']
  onSpawn?: () => void
  signal?: AbortSignal
  allowFailure?: boolean
}) => {
  throwIfAborted(params.signal)
  const { native } = resolveClaudeCodeAdapterConfig(params.ctx)
  const cliPath = await ensureClaudeCliPath({
    ctx: params.ctx,
    env: params.ctx.env,
    cliConfig: native.cli
  })
  throwIfAborted(params.signal)
  let stdout = ''
  let stderr = ''

  const exitCode = await new Promise<number | null>((resolvePromise, rejectPromise) => {
    const proc = spawn(cliPath, params.args, {
      cwd: params.ctx.cwd,
      env: buildAuthEnv(params.ctx, params.configDir),
      stdio: ['ignore', 'pipe', 'pipe']
    })
    params.onSpawn?.()
    let settled = false
    let abortRequested = false
    let processError: Error | undefined
    let forceKillTimer: NodeJS.Timeout | undefined
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      if (forceKillTimer != null) clearTimeout(forceKillTimer)
      params.signal?.removeEventListener('abort', abort)
      if (abortRequested) {
        rejectPromise(createAbortError())
      } else if (processError != null) {
        rejectPromise(processError)
      } else {
        resolvePromise(code)
      }
    }
    const abort = () => {
      if (settled || abortRequested) return
      abortRequested = true
      proc.kill('SIGTERM')
      forceKillTimer = setTimeout(() => {
        if (!settled) proc.kill('SIGKILL')
      }, CLAUDE_AUTH_TERMINATION_GRACE_MS)
      forceKillTimer.unref()
    }

    proc.stdout.on('data', (chunk) => {
      const text = String(chunk)
      stdout += text
      params.onProgress?.({ stream: 'stdout', message: text })
    })
    proc.stderr.on('data', (chunk) => {
      const text = String(chunk)
      stderr += text
      params.onProgress?.({ stream: 'stderr', message: text })
    })
    proc.once('error', (error) => {
      processError = error
    })
    proc.once('close', code => finish(code))
    params.signal?.addEventListener('abort', abort, { once: true })
    if (params.signal?.aborted === true) abort()
  })

  if (exitCode !== 0 && params.allowFailure !== true) {
    const message = `${stdout}\n${stderr}`.trim()
    throw new Error(
      message === ''
        ? `\`claude ${params.args.join(' ')}\` exited with code ${exitCode ?? 'unknown'}.`
        : message
    )
  }

  return { exitCode, stdout, stderr }
}

const parseClaudeAuthStatus = (value: unknown): ClaudeAuthStatus | undefined => {
  if (!isRecord(value) || typeof value.loggedIn !== 'boolean') return undefined
  return {
    loggedIn: value.loggedIn,
    apiProvider: normalizeString(value.apiProvider),
    authMethod: normalizeString(value.authMethod),
    email: normalizeString(value.email),
    orgId: normalizeString(value.orgId),
    orgName: normalizeString(value.orgName),
    subscriptionType: normalizeString(value.subscriptionType)
  }
}

const getClaudeAuthStatus = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'configs' | 'configState'>
  configDir?: string
}) => {
  const result = await runClaudeAuthCommand({
    ctx: params.ctx,
    args: ['auth', 'status', '--json'],
    configDir: params.configDir,
    allowFailure: true
  })
  try {
    const status = parseClaudeAuthStatus(JSON.parse(result.stdout) as unknown)
    if (status != null) return status
  } catch {}
  throw new Error(
    result.stderr.trim() || `Claude auth status returned invalid JSON (exit ${result.exitCode ?? 'unknown'}).`
  )
}

const assertManagedClaudeAuthStatus = (
  status: ClaudeAuthStatus,
  expectedEmail?: string,
  expectedOrganizationId?: string
) => {
  if (
    !status.loggedIn ||
    status.authMethod !== 'claude.ai' ||
    status.apiProvider !== 'firstParty'
  ) {
    throw new Error('The isolated Claude account is not authenticated through the official Claude.ai login flow.')
  }
  if (
    expectedEmail != null &&
    (status.email == null || expectedEmail.toLowerCase() !== status.email.toLowerCase())
  ) {
    throw new Error(
      `Claude authenticated as "${status.email ?? 'unknown email'}", but account "${expectedEmail}" was selected.`
    )
  }
  if (
    expectedOrganizationId != null &&
    (status.orgId == null || expectedOrganizationId !== status.orgId)
  ) {
    throw new Error(
      `Claude authenticated for organization "${status.orgId ?? 'unknown organization'}", ` +
        `but organization "${expectedOrganizationId}" was selected.`
    )
  }
  return status
}

const assertCompleteClaudeDeviceIdentity = (status: ClaudeAuthStatus) => {
  if (status.email == null || status.orgId == null) {
    throw new Error(
      'Claude auth status did not provide the email and organization required for a device-bound account.'
    )
  }
}

const formatPercent = (value: number) =>
  `${
    Math.max(0, Math.min(100, value)).toFixed(
      Number.isInteger(value) ? 0 : 1
    )
  }%`

const formatResetDescription = (value: unknown) => {
  const resetAt = normalizeString(value)
  if (resetAt == null) return undefined
  const timestamp = Date.parse(resetAt)
  return Number.isFinite(timestamp) ? `Resets ${new Date(timestamp).toISOString()}` : `Resets ${resetAt}`
}

const parseCachedUsage = (state: Record<string, unknown> | undefined): AdapterAccountQuotaInfo | undefined => {
  const cached = isRecord(state?.cachedUsageUtilization) ? state.cachedUsageUtilization : undefined
  const utilization = isRecord(cached?.utilization) ? cached.utilization : undefined
  if (utilization == null) return undefined

  const metrics: NonNullable<AdapterAccountQuotaInfo['metrics']> = []
  const addWindow = (id: string, label: string, value: unknown, primary = false) => {
    if (!isRecord(value)) return
    const resetAt = normalizeString(value.resets_at)
    const resetTimestamp = resetAt == null ? undefined : Date.parse(resetAt)
    if (resetTimestamp != null && Number.isFinite(resetTimestamp) && resetTimestamp <= Date.now()) return
    const percent = normalizeNumber(value.utilization) ?? normalizeNumber(value.percent)
    if (percent == null) return
    metrics.push({
      id,
      label,
      value: formatPercent(percent),
      description: formatResetDescription(value.resets_at),
      primary
    })
  }

  addWindow('five-hour', '5-hour usage', utilization.five_hour, true)
  addWindow('seven-day', '7-day usage', utilization.seven_day, true)
  addWindow('seven-day-opus', '7-day Opus usage', utilization.seven_day_opus)
  addWindow('seven-day-sonnet', '7-day Sonnet usage', utilization.seven_day_sonnet)

  if (Array.isArray(utilization.limits)) {
    utilization.limits.forEach((entry, index) => {
      if (!isRecord(entry) || entry.is_active === false) return
      const scope = isRecord(entry.scope) ? entry.scope : undefined
      const model = isRecord(scope?.model) ? scope.model : undefined
      const label = normalizeString(model?.display_name) ??
        normalizeString(entry.group) ??
        normalizeString(entry.kind) ??
        `Limit ${index + 1}`
      addWindow(`limit-${slugifyAccountKey(label) || index}`, label, entry)
    })
  }

  const extraUsage = isRecord(utilization.extra_usage) ? utilization.extra_usage : undefined
  if (extraUsage?.is_enabled === true) addWindow('extra-usage', 'Extra usage', extraUsage)
  if (!metrics.some(metric => metric.id === 'extra-usage')) {
    const spend = isRecord(utilization.spend) ? utilization.spend : undefined
    if (spend?.enabled === true) addWindow('extra-usage', 'Extra usage', spend)
  }
  if (metrics.length === 0) return undefined

  return {
    summary: metrics.filter(metric => metric.primary).map(metric => `${metric.label}: ${metric.value}`).join(' · ') ||
      metrics.map(metric => `${metric.label}: ${metric.value}`).join(' · '),
    metrics,
    updatedAt: normalizeNumber(cached?.fetchedAtMs)
  }
}

const readClaudeAccountProbe = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'configs' | 'configState'>
  configDir?: string
  expectedEmail?: string
  expectedOrganizationId?: string
  forceUsageRefresh?: boolean
}) => {
  const status = await getClaudeAuthStatus(params)
  if (status.loggedIn && (params.expectedEmail != null || params.expectedOrganizationId != null)) {
    assertManagedClaudeAuthStatus(status, params.expectedEmail, params.expectedOrganizationId)
  }
  const state = sanitizeClaudeState(await readJsonRecord(resolveClaudeStatePath(params.ctx, params.configDir)))
  const cachedQuota = parseCachedUsage(state)
  const quota = await resolveClaudeAccountQuota({
    cachedQuota,
    configDir: params.configDir,
    expectedEmail: status.email,
    expectedOrganizationId: status.orgId,
    forceNetwork: params.forceUsageRefresh,
    realHome: resolveRealHome(params.ctx)
  })
  return {
    status,
    state,
    quota
  } satisfies ClaudeAccountProbe
}

const readSystemClaudeAccountProbe = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'configs' | 'configState'>,
  forceUsageRefresh = false
) =>
  process.platform === 'darwin'
    ? await withClaudeDeviceAuthOperationLock(
      ctx,
      async () => readClaudeAccountProbe({ ctx, forceUsageRefresh })
    )
    : await readClaudeAccountProbe({ ctx, forceUsageRefresh })

const resolveConfiguredAccounts = (ctx: Pick<AdapterCtx, 'configs' | 'configState'>) => {
  const adapters = mergeAdapterConfigs(
    ctx.configs[0]?.adapters as Record<string, unknown> | undefined,
    ctx.configs[1]?.adapters as Record<string, unknown> | undefined
  ) as Record<string, unknown> | undefined
  const rawConfig = isRecord(adapters?.['claude-code']) ? adapters['claude-code'] : {}
  const rawAccounts: Record<string, ClaudeConfiguredAccount> = isRecord(rawConfig.accounts)
    ? Object.fromEntries(
      Object.entries(rawConfig.accounts)
        .filter((entry): entry is [string, ClaudeConfiguredAccount] => isRecord(entry[1]))
    )
    : {}
  const accountTombstones = normalizeAdapterAccountTombstones(rawConfig.accountTombstones)
  return {
    defaultAccount: normalizeString(rawConfig.defaultAccount),
    accounts: filterActiveAdapterAccounts(rawAccounts, accountTombstones),
    accountTombstones
  }
}

const resolveAccountTitle = (
  key: string,
  account: ClaudeConfiguredAccount | undefined,
  probe?: ClaudeAccountProbe
) =>
  normalizeString(account?.title) ??
    normalizeString(account?.displayName) ??
    normalizeString(probe?.status.email) ??
    normalizeString(probe?.status.orgName) ??
    key

const resolveManagedSystemAccountKey = (
  ctx: Pick<AdapterCtx, 'env'>,
  configured: ReturnType<typeof resolveConfiguredAccounts>
) => Object.entries(configured.accounts).find(([, account]) => usesSystemClaudeDeviceAuth(ctx, account))?.[0]

const resolveConfiguredDefaultAccount = (
  ctx: Pick<AdapterCtx, 'env'>,
  configured: ReturnType<typeof resolveConfiguredAccounts>
) => {
  const explicit = configured.defaultAccount
  if (explicit === CLAUDE_SYSTEM_ACCOUNT_KEY) {
    return resolveManagedSystemAccountKey(ctx, configured) ?? explicit
  }
  if (explicit != null && configured.accounts[explicit] != null) {
    return explicit
  }
  return Object.keys(configured.accounts)[0]
}

const buildAccountDetail = (params: {
  ctx: Pick<AdapterCtx, 'env'>
  key: string
  account?: ClaudeConfiguredAccount
  defaultAccount?: string
  probe?: ClaudeAccountProbe
  error?: string
  missing?: boolean
  system?: boolean
}): AdapterAccountDetail => {
  const { account, probe } = params
  const loggedIn = probe?.status.loggedIn === true
  const description = params.error ?? normalizeString(account?.description) ?? (
    params.system
      ? 'Read-only view of the default Claude configuration and its machine-wide native credential store.'
      : isRecord(account?.auth) && account.auth.storage === 'device'
      ? 'Credential is bound to this device; identity and cached usage are synchronized separately.'
      : 'Signed in through the official Claude CLI.'
  )

  return {
    key: params.key,
    title: resolveAccountTitle(params.key, account, probe),
    description,
    displayName: isRecord(probe?.state?.oauthAccount)
      ? normalizeString(probe.state.oauthAccount.displayName) ?? normalizeString(account?.displayName)
      : normalizeString(account?.displayName),
    email: normalizeString(probe?.status.email) ?? normalizeString(account?.email),
    status: params.error != null && params.missing !== true ? 'error' : loggedIn ? 'ready' : 'missing',
    isDefault: params.key === params.defaultAccount,
    quota: probe == null && account != null ? parseCachedUsage(decodeClaudeState(account)) : probe?.quota,
    planType: normalizeString(probe?.status.subscriptionType) ?? normalizeString(account?.planType),
    accountType: normalizeString(probe?.status.authMethod) ?? normalizeString(account?.accountType),
    source: params.system
      ? {
        id: 'claude-home',
        label: 'Claude Home',
        description: 'Read-only access to the default configuration and machine-wide native credential store.'
      }
      : {
        id: normalizeString(account?.source) ?? 'global-config',
        label: 'Global Config',
        description: 'Account snapshot stored in the global One Works configuration.'
      },
    actions: params.system
      ? [...CLAUDE_SYSTEM_ACCOUNT_ACTIONS]
      : usesMachineWideClaudeAuth(params.ctx, account)
      ? [...CLAUDE_DEVICE_ACCOUNT_ACTIONS]
      : [...CLAUDE_ACCOUNT_ACTIONS]
  }
}

const probeConfiguredAccountUnlocked = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'configs' | 'configState'>,
  key: string,
  account: ClaudeConfiguredAccount,
  forceUsageRefresh = false
) => {
  await assertClaudeAccountGenerationIsCurrent(ctx, key, account)
  const configDir = await materializeClaudeAccount({ ctx, accountKey: key, account })
  if (usesMachineWideClaudeAuth(ctx, account)) await assertClaudeDeviceAuthBinding(ctx, key, account)
  const probe = await readClaudeAccountProbe({
    ctx,
    configDir: usesSystemClaudeDeviceAuth(ctx, account) ? undefined : configDir,
    expectedEmail: normalizeString(account.email),
    expectedOrganizationId: normalizeString(account.organizationId),
    forceUsageRefresh
  })
  if (probe.status.loggedIn) {
    assertManagedClaudeAuthStatus(
      probe.status,
      normalizeString(account.email),
      normalizeString(account.organizationId)
    )
  }
  return probe
}

const probeConfiguredAccount = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'configs' | 'configState'>,
  key: string,
  account: ClaudeConfiguredAccount
) =>
  withClaudeAccountResourceLock({
    ctx,
    key,
    account,
    callback: async () => probeConfiguredAccountUnlocked(ctx, key, account)
  })

const assertClaudeStoredIdentityIsUnique = (
  key: string,
  identity: Pick<ClaudeConfiguredAccount, 'email' | 'organizationId'>,
  accounts: Record<string, unknown>
) => {
  const email = normalizeString(identity.email)?.toLowerCase()
  const organizationId = normalizeString(identity.organizationId)
  if (email == null || organizationId == null) return
  for (const [otherKey, value] of Object.entries(accounts)) {
    if (otherKey === key || !isRecord(value)) continue
    if (
      normalizeString(value.email)?.toLowerCase() === email &&
      normalizeString(value.organizationId) === organizationId
    ) {
      throw new ClaudeDuplicateIdentityError(
        `Claude identity "${identity.email}" is already connected as account "${otherKey}".`
      )
    }
  }
}

const persistClaudeAccount = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  key: string
  account: ClaudeConfiguredAccount
  expectedAccount: ClaudeConfiguredAccount | null
}) => {
  await updateGlobalAdapterAccounts({
    adapter: 'claude-code',
    cwd: params.ctx.cwd,
    env: params.ctx.env,
    update: (adapterConfig, accounts) => {
      const accountTombstones = normalizeAdapterAccountTombstones(adapterConfig.accountTombstones)
      if (isAdapterAccountGenerationDeleted(accountTombstones, params.key, params.account.generation)) {
        throw new Error(`Claude account "${params.key}" was deleted while this operation was in progress.`)
      }
      const current = accounts[params.key]
      const existing = isRecord(current) ? current : undefined
      const expected = params.expectedAccount
      const accountChanged = expected == null
        ? existing != null
        : existing == null ||
          normalizeString(existing.generation) !== normalizeString(expected.generation) ||
          normalizeString(existing.credentialRevision) !== normalizeString(expected.credentialRevision) ||
          normalizeString(existing.authDigest) !== normalizeString(expected.authDigest)
      if (accountChanged) {
        throw new Error(`Claude account "${params.key}" changed while this operation was in progress.`)
      }
      assertClaudeStoredIdentityIsUnique(params.key, params.account, accounts)
      accounts[params.key] = {
        ...existing,
        ...params.account,
        title: normalizeString(params.account.title) ?? normalizeString(existing?.title) ?? params.key,
        description: normalizeString(params.account.description) ?? normalizeString(existing?.description),
        createdAt: normalizeNumber(params.account.createdAt) ?? normalizeNumber(existing?.createdAt) ?? Date.now(),
        updatedAt: Date.now()
      }
      return {
        ...adapterConfig,
        defaultAccount: normalizeString(adapterConfig.defaultAccount) ?? params.key,
        accounts,
        ...(Object.keys(accountTombstones).length === 0 ? { accountTombstones: undefined } : { accountTombstones })
      }
    }
  })
  await materializeClaudeAccount({
    ctx: params.ctx,
    accountKey: params.key,
    account: params.account
  })
}

const removeClaudeAccountConfig = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>,
  key: string,
  expectedAccount: ClaudeConfiguredAccount,
  beforeRemove?: () => Promise<void>
) => {
  await updateGlobalAdapterAccounts({
    adapter: 'claude-code',
    cwd: ctx.cwd,
    env: ctx.env,
    update: async (adapterConfig, accounts) => {
      const current = isRecord(accounts[key]) ? accounts[key] : undefined
      if (
        current == null ||
        normalizeString(current.generation) !== normalizeString(expectedAccount.generation) ||
        normalizeString(current.credentialRevision) !== normalizeString(expectedAccount.credentialRevision) ||
        normalizeString(current.authDigest) !== normalizeString(expectedAccount.authDigest)
      ) {
        throw new Error(`Claude account "${key}" changed while removal was waiting for the configuration lock.`)
      }
      await beforeRemove?.()
      delete accounts[key]
      const accountTombstones = addAdapterAccountTombstone(
        normalizeAdapterAccountTombstones(adapterConfig.accountTombstones),
        key,
        normalizeString(expectedAccount.generation) ?? `legacy:${key}`
      )
      const nextConfig: Record<string, unknown> = { ...adapterConfig, accounts, accountTombstones }
      if (normalizeString(adapterConfig.defaultAccount) === key) {
        const nextDefault = Object.keys(accounts)[0]
        if (nextDefault == null) delete nextConfig.defaultAccount
        else nextConfig.defaultAccount = nextDefault
      }
      return nextConfig
    }
  })
}

const buildStoredAccount = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  key: string
  configDir: string
  probe: ClaudeAccountProbe
  existing?: ClaudeConfiguredAccount
  credentialChanged?: boolean
  deviceBindingSource?: string
  source?: 'claude-auth-login' | 'claude-system-login'
}) => {
  const credentialPath = join(params.configDir, '.credentials.json')
  const credentialContent = await readOptionalTextFile(credentialPath)
  if (credentialContent != null && !isRecord(JSON.parse(credentialContent) as unknown)) {
    throw new Error('Claude wrote an invalid .credentials.json payload.')
  }
  const existingDeviceAuth = isClaudeDeviceCredentialEnvelope(params.existing?.auth)
    ? params.existing.auth
    : undefined
  const preserveExistingDeviceAuth = params.credentialChanged !== true && existingDeviceAuth != null
  const deviceBindingSource = params.deviceBindingSource ?? params.configDir
  const storedCredential = process.platform === 'darwin' || credentialContent == null
    ? preserveExistingDeviceAuth
      ? { auth: existingDeviceAuth, authDigest: normalizeString(params.existing?.authDigest) }
      : {
        auth: encodeDeviceCredential(deviceBindingSource),
        authDigest: createHash('sha256')
          .update(`${CLAUDE_DEVICE_CREDENTIAL_TYPE}:${deviceBindingSource}`)
          .digest('hex')
      }
    : {
      auth: encodeInlineCredential(credentialContent),
      authDigest: createHash('sha256').update(credentialContent).digest('hex')
    }
  const { auth } = storedCredential
  const authDigest = storedCredential.authDigest ?? createHash('sha256')
    .update(`${CLAUDE_DEVICE_CREDENTIAL_TYPE}:${deviceBindingSource}`)
    .digest('hex')
  const credentialChanged = params.credentialChanged === true || params.existing?.authDigest !== authDigest
  const oauthAccount = isRecord(params.probe.state?.oauthAccount) ? params.probe.state.oauthAccount : undefined
  const source = params.source ?? normalizeString(params.existing?.source) ?? 'claude-auth-login'

  return {
    ...params.existing,
    title: resolveAccountTitle(params.key, params.existing, params.probe),
    description: source === 'claude-system-login'
      ? 'References the existing machine-wide Claude login shared with Claude Desktop and the default CLI.'
      : process.platform === 'darwin' || credentialContent == null
      ? 'Logged in via `claude auth login` with an isolated Claude configuration and device-bound credential.'
      : 'Logged in via `claude auth login`; portable credential snapshot stored by One Works.',
    auth,
    state: encodeClaudeState(params.probe.state),
    displayName: normalizeString(oauthAccount?.displayName) ?? normalizeString(params.existing?.displayName),
    email: normalizeString(params.probe.status.email) ?? normalizeString(params.existing?.email),
    planType: normalizeString(params.probe.status.subscriptionType) ?? normalizeString(params.existing?.planType),
    accountType: normalizeString(params.probe.status.authMethod) ?? normalizeString(params.existing?.accountType),
    organizationId: normalizeString(params.probe.status.orgId) ?? normalizeString(params.existing?.organizationId),
    organizationTitle: normalizeString(params.probe.status.orgName) ??
      normalizeString(params.existing?.organizationTitle),
    quota: params.probe.quota,
    source,
    generation: params.existing?.generation ?? (
      params.existing == null ? createAdapterAccountGeneration() : undefined
    ),
    credentialRevision: credentialChanged
      ? createAdapterCredentialRevision(params.existing?.credentialRevision)
      : params.existing?.credentialRevision,
    credentialUpdatedAt: credentialChanged
      ? Date.now()
      : params.existing?.credentialUpdatedAt,
    createdAt: params.existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
    authDigest
  } satisfies ClaudeConfiguredAccount
}

const resolveExistingConfiguredAccount = (
  ctx: Pick<AdapterCtx, 'configs' | 'configState'>,
  key: string
) => {
  const account = resolveConfiguredAccounts(ctx).accounts[key]
  if (account == null) throw new Error(`Claude account "${key}" was not found.`)
  return account
}

const readCanonicalClaudeAccounts = async (ctx: Pick<AdapterCtx, 'env'>) => {
  const globalConfig = await readJsonRecord(resolveGlobalOoConfigPath(ctx.env))
  const adapters = isRecord(globalConfig?.adapters) ? globalConfig.adapters : undefined
  const claudeConfig = isRecord(adapters?.['claude-code']) ? adapters['claude-code'] : undefined
  const tombstones = normalizeAdapterAccountTombstones(claudeConfig?.accountTombstones)
  const accounts = isRecord(claudeConfig?.accounts)
    ? Object.fromEntries(
      Object.entries(claudeConfig.accounts)
        .filter((entry): entry is [string, ClaudeConfiguredAccount] => isRecord(entry[1]))
    )
    : {}
  return filterActiveAdapterAccounts(accounts, tombstones)
}

const readCanonicalClaudeAccount = async (
  ctx: Pick<AdapterCtx, 'env'>,
  key: string
) => (await readCanonicalClaudeAccounts(ctx))[key]

const assertClaudeAuthStatusCanProveIsolation = (status: ClaudeAuthStatus | undefined) => {
  if (status?.loggedIn !== true) return
  assertManagedClaudeAuthStatus(status)
  assertCompleteClaudeDeviceIdentity(status)
}

const claudeAuthStatusIdentityMatches = (
  left: ClaudeAuthStatus | undefined,
  right: ClaudeAuthStatus | undefined
) => {
  assertClaudeAuthStatusCanProveIsolation(left)
  assertClaudeAuthStatusCanProveIsolation(right)
  const leftEmail = normalizeString(left?.email)?.toLowerCase()
  const rightEmail = normalizeString(right?.email)?.toLowerCase()
  const leftOrganizationId = normalizeString(left?.orgId)
  const rightOrganizationId = normalizeString(right?.orgId)
  return left?.loggedIn === true && right?.loggedIn === true &&
    leftEmail != null && rightEmail != null && leftEmail === rightEmail &&
    leftOrganizationId != null && rightOrganizationId != null && leftOrganizationId === rightOrganizationId
}

const assertClaudeCredentialProfileIsIsolated = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'configs' | 'configState'>
  key: string
  configDir: string
  expectedAccount?: ClaudeConfiguredAccount
  rejectPreexistingCredential?: boolean
  targetStatus?: ClaudeAuthStatus
}) => {
  const targetStatus = params.targetStatus ?? await getClaudeAuthStatus({
    ctx: params.ctx,
    configDir: params.configDir
  })
  if (!targetStatus.loggedIn) return targetStatus
  if (params.rejectPreexistingCredential === true) {
    throw new ClaudeCredentialIsolationError(
      `Claude config profile for "${params.key}" already resolves a native login before its isolated login starts. ` +
        'This Claude CLI cannot safely prove that the profile is independent.'
    )
  }
  if (params.expectedAccount != null) {
    assertManagedClaudeAuthStatus(
      targetStatus,
      normalizeString(params.expectedAccount.email),
      normalizeString(params.expectedAccount.organizationId)
    )
  }
  const defaultStatus = await getClaudeAuthStatus({ ctx: params.ctx })
  if (claudeAuthStatusIdentityMatches(targetStatus, defaultStatus)) {
    throw new ClaudeCredentialIsolationError(
      `Claude config profile for "${params.key}" shares the default Claude home credential. ` +
        'One Works will not mutate or logout it as an isolated account.'
    )
  }
  for (const [otherKey, account] of Object.entries(await readCanonicalClaudeAccounts(params.ctx))) {
    if (otherKey === params.key || usesSystemClaudeDeviceAuth(params.ctx, account)) continue
    const otherStatus = await getClaudeAuthStatus({
      ctx: params.ctx,
      configDir: resolveClaudeAccountConfigDir(params.ctx, otherKey)
    })
    if (claudeAuthStatusIdentityMatches(targetStatus, otherStatus)) {
      throw new ClaudeCredentialIsolationError(
        `Claude config profiles "${params.key}" and "${otherKey}" resolve the same native credential. ` +
          'This Claude CLI cannot safely run them concurrently.'
      )
    }
  }
  return targetStatus
}

const buildClaudeAuthStatusFingerprint = (status: ClaudeAuthStatus) => {
  assertClaudeAuthStatusCanProveIsolation(status)
  return JSON.stringify({
    apiProvider: normalizeString(status.apiProvider),
    authMethod: normalizeString(status.authMethod),
    email: normalizeString(status.email)?.toLowerCase(),
    loggedIn: status.loggedIn,
    orgId: normalizeString(status.orgId)
  })
}

const readClaudeCredentialPeerSnapshot = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'configs' | 'configState'>,
  key: string
) => {
  const snapshot: Record<string, string> = {
    default: buildClaudeAuthStatusFingerprint(await getClaudeAuthStatus({ ctx }))
  }
  for (const [otherKey, account] of Object.entries(await readCanonicalClaudeAccounts(ctx))) {
    if (otherKey === key || usesSystemClaudeDeviceAuth(ctx, account)) continue
    snapshot[`account:${otherKey}`] = buildClaudeAuthStatusFingerprint(
      await getClaudeAuthStatus({
        ctx,
        configDir: resolveClaudeAccountConfigDir(ctx, otherKey)
      })
    )
  }
  return snapshot
}

const assertClaudeCredentialPeersUnchanged = (
  before: Record<string, string>,
  after: Record<string, string>
) => {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new ClaudeCredentialIsolationError(
      'Claude authentication changed the default or another account profile. ' +
        'This CLI cannot safely treat the selected profile as an isolated credential.'
    )
  }
}

const assertClaudeIdentityIsUnique = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'configs' | 'configState'>
  key: string
  status: ClaudeAuthStatus
  compareSystemLogin: boolean
}) => {
  const email = normalizeString(params.status.email)?.toLowerCase()
  const organizationId = normalizeString(params.status.orgId)
  if (email == null || organizationId == null) return
  assertClaudeStoredIdentityIsUnique(
    params.key,
    { email: params.status.email, organizationId: params.status.orgId },
    await readCanonicalClaudeAccounts(params.ctx)
  )
  if (!params.compareSystemLogin) return
  const systemStatus = await getClaudeAuthStatus({ ctx: params.ctx })
  if (
    systemStatus?.loggedIn === true &&
    normalizeString(systemStatus.email)?.toLowerCase() === email &&
    normalizeString(systemStatus.orgId) === organizationId
  ) {
    throw new ClaudeDuplicateIdentityError(
      `Claude identity "${params.status.email}" is already available through the default Claude Desktop login.`
    )
  }
}

const recoverClaudeAccountAfterFailedLogin = async (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'configs' | 'configState'>,
  key: string
) => {
  const canonicalAccount = await readCanonicalClaudeAccount(ctx, key)
  const configDir = resolveClaudeAccountConfigDir(ctx, key)
  if (canonicalAccount == null) {
    await runClaudeAuthCommand({
      ctx,
      args: ['auth', 'logout'],
      configDir,
      allowFailure: true
    }).catch(() => undefined)
    await rm(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', key), { recursive: true, force: true })
    return 'device-credential-may-have-changed' as const
  }
  if (usesMachineWideClaudeAuth(ctx, canonicalAccount)) {
    // A failed mutation of the default Claude home cannot be rolled back per account.
    await clearClaudeDeviceAuthBinding(ctx, key, canonicalAccount)
  }

  const storage = isRecord(canonicalAccount.auth)
    ? normalizeString(canonicalAccount.auth.storage) ?? 'inline'
    : undefined
  if (storage === 'inline') {
    if (process.platform === 'darwin') {
      await runClaudeAuthCommand({
        ctx,
        args: ['auth', 'logout'],
        configDir,
        allowFailure: true
      }).catch(() => undefined)
    }
    await materializeClaudeAccount({
      ctx,
      accountKey: key,
      account: canonicalAccount,
      forceCredentialSnapshot: true
    })
    const credentialContent = decodeInlinePayload(canonicalAccount.auth, CLAUDE_CREDENTIAL_TYPE)
    if (credentialContent == null) {
      throw new Error(`Claude account "${key}" no longer has a restorable portable credential snapshot.`)
    }
    const restoredCredential = await readOptionalTextFile(join(configDir, '.credentials.json'))
    const restoredRevision = normalizeString(
      await readOptionalTextFile(join(configDir, CLAUDE_MATERIALIZED_CREDENTIAL_REVISION_FILE))
    )
    if (
      restoredCredential !== credentialContent ||
      restoredRevision !== resolveMaterializedCredentialRevision(canonicalAccount, credentialContent)
    ) {
      throw new Error(`Claude account "${key}" portable credential recovery could not be verified.`)
    }
    if (process.platform === 'darwin') return 'device-credential-missing' as const
    return 'portable-restored' as const
  }

  if (storage === 'device') {
    if (!usesMachineWideClaudeAuth(ctx, canonicalAccount)) {
      await runClaudeAuthCommand({
        ctx,
        args: ['auth', 'logout'],
        configDir,
        allowFailure: true
      }).catch(() => undefined)
    }
    await materializeClaudeAccount({ ctx, accountKey: key, account: canonicalAccount })
    return 'device-credential-missing' as const
  }

  await clearMaterializedClaudeCredential(configDir)
  await rm(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', key), { recursive: true, force: true })
  return 'unavailable' as const
}

const withClaudeAuthMutationLock = async <T>(params: {
  ctx: Pick<AdapterCtx, 'env'>
  key: string
  account?: ClaudeConfiguredAccount
  deviceAuthPossible?: boolean
  callback: () => Promise<T>
}) => {
  const runAccountMutation = () => withClaudeAccountOperationLock(params.ctx, params.key, params.callback)
  const machineWideMutation = usesMachineWideClaudeAuth(params.ctx, params.account)
  const serializeAcrossProfiles = process.platform === 'darwin' ||
    params.deviceAuthPossible === true ||
    machineWideMutation
  if (
    !serializeAcrossProfiles
  ) {
    return await runAccountMutation()
  }
  return await withClaudeDeviceAuthOperationLock(params.ctx, async () => {
    if (machineWideMutation) await assertNoActiveClaudeDeviceAuthSessions(params.ctx)
    return await runAccountMutation()
  })
}

export const resolveClaudeRuntimeAccount = async (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'configs' | 'configState'>
  requestedAccount?: string
}): Promise<{
  accountKey?: string
  configDir?: string
  credentialHome?: 'default' | 'isolated'
  managed?: boolean
}> => {
  const configured = resolveConfiguredAccounts(params.ctx)
  const requested = normalizeString(params.requestedAccount)
  const selectedKey = requested ?? resolveConfiguredDefaultAccount(params.ctx, configured)
  if (selectedKey == null) return {}
  if (selectedKey === CLAUDE_SYSTEM_ACCOUNT_KEY) {
    return { accountKey: selectedKey, credentialHome: 'default' }
  }
  const account = configured.accounts[selectedKey]
  if (account == null) throw new Error(`Claude account "${selectedKey}" is not available.`)
  return await withClaudeAccountResourceLock({
    ctx: params.ctx,
    key: selectedKey,
    account,
    callback: async () => {
      await assertClaudeAccountGenerationIsCurrent(params.ctx, selectedKey, account)
      const configDir = await materializeClaudeAccount({
        ctx: params.ctx,
        accountKey: selectedKey,
        account,
        ensureTrust: true
      })
      if (usesMachineWideClaudeAuth(params.ctx, account)) {
        await assertClaudeDeviceAuthBinding(params.ctx, selectedKey, account)
      }
      const useSystemAuth = usesSystemClaudeDeviceAuth(params.ctx, account)
      const status = await getClaudeAuthStatus({
        ctx: params.ctx,
        configDir: useSystemAuth ? undefined : configDir
      })
      try {
        assertManagedClaudeAuthStatus(
          status,
          normalizeString(account.email),
          normalizeString(account.organizationId)
        )
      } catch {
        throw new Error(
          `Claude account "${selectedKey}" is not authenticated on this device. Sign in again before using it.`
        )
      }
      return {
        accountKey: selectedKey,
        ...(useSystemAuth ? {} : { configDir }),
        credentialHome: useSystemAuth ? 'default' : 'isolated',
        managed: true
      }
    }
  })
}

export const getClaudeAccounts = async (
  ctx: AdapterCtx,
  _options: AdapterAccountsQueryOptions
): Promise<AdapterAccountsResult> => {
  const configured = resolveConfiguredAccounts(ctx)
  const systemProbe = await readSystemClaudeAccountProbe(ctx).catch(() => undefined)
  const requestedDefaultAccount = resolveConfiguredDefaultAccount(ctx, configured) ?? (
    systemProbe?.status.loggedIn === true ? CLAUDE_SYSTEM_ACCOUNT_KEY : undefined
  )
  const buildIdentityKey = (email: unknown, organizationId: unknown) => {
    const normalizedEmail = normalizeString(email)?.toLowerCase()
    const normalizedOrganizationId = normalizeString(organizationId)
    return normalizedEmail == null || normalizedOrganizationId == null
      ? undefined
      : JSON.stringify([normalizedEmail, normalizedOrganizationId])
  }
  const configuredCandidates = await Promise.all(
    Object.entries(configured.accounts).map(async ([key, account]) => {
      let detail: AdapterAccountDetail
      try {
        const probe = await probeConfiguredAccount(ctx, key, account)
        detail = buildAccountDetail({
          ctx,
          key,
          account,
          defaultAccount: requestedDefaultAccount,
          probe
        })
      } catch (error) {
        detail = buildAccountDetail({
          ctx,
          key,
          account,
          defaultAccount: requestedDefaultAccount,
          error: error instanceof Error ? error.message : String(error),
          missing: error instanceof ClaudeCredentialUnavailableError
        })
      }
      return {
        detail,
        identityKey: buildIdentityKey(account.email, account.organizationId)
      }
    })
  )
  const candidates = [
    ...configuredCandidates,
    ...(systemProbe?.status.loggedIn === true
      ? [{
        detail: buildAccountDetail({
          ctx,
          key: CLAUDE_SYSTEM_ACCOUNT_KEY,
          defaultAccount: requestedDefaultAccount,
          probe: systemProbe,
          system: true
        }),
        identityKey: buildIdentityKey(systemProbe.status.email, systemProbe.status.orgId)
      }]
      : [])
  ]
  const ungrouped = candidates.filter(candidate => candidate.identityKey == null)
  const identityGroups = Map.groupBy(
    candidates.filter((candidate): candidate is typeof candidate & { identityKey: string } => (
      candidate.identityKey != null
    )),
    candidate => candidate.identityKey
  )
  const selectedAccountKeyByCandidate = new Map<string, string>()
  const selectedCandidates = [...identityGroups.values()].map(group => {
    const selected = group.toSorted((left, right) => {
      const readyDifference = Number(right.detail.status === 'ready') - Number(left.detail.status === 'ready')
      if (readyDifference !== 0) return readyDifference
      const defaultDifference = Number(right.detail.key === requestedDefaultAccount) -
        Number(left.detail.key === requestedDefaultAccount)
      if (defaultDifference !== 0) return defaultDifference
      return left.detail.key.localeCompare(right.detail.key)
    })[0]
    for (const candidate of group) selectedAccountKeyByCandidate.set(candidate.detail.key, selected.detail.key)
    return selected
  })
  const defaultAccount = requestedDefaultAccount == null
    ? undefined
    : selectedAccountKeyByCandidate.get(requestedDefaultAccount) ?? requestedDefaultAccount
  const details = [
    ...ungrouped,
    ...selectedCandidates
  ].map(candidate => ({
    ...candidate.detail,
    isDefault: candidate.detail.key === defaultAccount
  })).sort((left, right) =>
    left.isDefault === right.isDefault ? left.title.localeCompare(right.title) : left.isDefault ? -1 : 1
  )

  return {
    defaultAccount,
    accounts: details.map((detail): AdapterAccountInfo => ({
      key: detail.key,
      title: detail.title,
      description: detail.description,
      displayName: detail.displayName,
      email: detail.email,
      status: detail.status,
      isDefault: detail.isDefault,
      quota: detail.quota
    })),
    actions: [...CLAUDE_LIST_ACTIONS]
  }
}

export const getClaudeAccountDetail = async (
  ctx: AdapterCtx,
  options: AdapterAccountDetailQueryOptions
): Promise<AdapterAccountDetailResult> => {
  const key = normalizeString(options.account)
  if (key == null) throw new Error('Claude account key is required.')
  const configured = resolveConfiguredAccounts(ctx)
  const defaultAccount = resolveConfiguredDefaultAccount(ctx, configured)

  if (key === CLAUDE_SYSTEM_ACCOUNT_KEY) {
    const probe = await readSystemClaudeAccountProbe(ctx, options.refresh === true)
    return {
      account: buildAccountDetail({
        ctx,
        key,
        defaultAccount: defaultAccount ?? CLAUDE_SYSTEM_ACCOUNT_KEY,
        probe,
        system: true
      })
    }
  }

  const account = resolveExistingConfiguredAccount(ctx, key)
  try {
    const probe = options.refresh === true
      ? await withClaudeAccountResourceLock({
        ctx,
        key,
        account,
        callback: async () => {
          const refreshedProbe = await probeConfiguredAccountUnlocked(ctx, key, account, true)
          if (refreshedProbe.status.loggedIn) {
            await persistClaudeAccount({
              ctx,
              key,
              expectedAccount: account,
              account: await buildStoredAccount({
                ctx,
                key,
                configDir: resolveClaudeAccountConfigDir(ctx, key),
                probe: refreshedProbe,
                existing: account,
                credentialChanged: false
              })
            })
          }
          return refreshedProbe
        }
      })
      : await probeConfiguredAccount(ctx, key, account)
    return {
      account: buildAccountDetail({ ctx, key, account, defaultAccount, probe })
    }
  } catch (error) {
    return {
      account: buildAccountDetail({
        ctx,
        key,
        account,
        defaultAccount,
        error: error instanceof Error ? error.message : String(error),
        missing: error instanceof ClaudeCredentialUnavailableError
      })
    }
  }
}

const loginClaudeAccount = async (
  ctx: AdapterCtx,
  options: AdapterManageAccountOptions,
  existingKey?: string
) => {
  const requestedKey = normalizeString(options.account)
  const key = existingKey ?? (
    requestedKey == null
      ? `claude-${randomUUID().slice(0, 8)}`
      : slugifyAccountKey(requestedKey)
  )
  if (key === '' || key === CLAUDE_SYSTEM_ACCOUNT_KEY) {
    throw new Error(`Claude account key "${requestedKey ?? key}" is reserved or invalid.`)
  }
  const configured = resolveConfiguredAccounts(ctx)
  if (existingKey == null && configured.accounts[key] != null) {
    throw new Error(`Claude account "${key}" already exists. Reauthenticate it instead.`)
  }
  const existing = existingKey == null ? undefined : resolveExistingConfiguredAccount(ctx, existingKey)
  return await withClaudeAuthMutationLock({
    ctx,
    key,
    account: existing,
    deviceAuthPossible: process.platform === 'darwin' &&
      existing == null &&
      Object.keys(configured.accounts).length === 0,
    callback: async () => {
      if (existing == null) await assertClaudeAccountKeyIsAvailable(ctx, key)
      else await assertClaudeAccountGenerationIsCurrent(ctx, key, existing)
      if (existing != null) await assertNoActiveClaudeAccountSessions(ctx, key)
      const configDir = existing == null
        ? resolveClaudeAccountConfigDir(ctx, key)
        : await materializeClaudeAccount({ ctx, accountKey: key, account: existing })
      const useSystemAuth = existing != null && usesSystemClaudeDeviceAuth(ctx, existing)
      const authConfigDir = useSystemAuth ? undefined : configDir
      const persistConnectedAccount = async (
        probe: ClaudeAccountProbe,
        message: string,
        source: 'claude-auth-login' | 'claude-system-login'
      ) => {
        assertManagedClaudeAuthStatus(probe.status)
        const storedAccount = await buildStoredAccount({
          ctx,
          key,
          configDir,
          probe,
          existing,
          credentialChanged: true,
          source,
          ...(source === 'claude-system-login'
            ? { deviceBindingSource: resolveClaudeSystemDeviceBindingSource(ctx) }
            : {})
        })
        if (isDeviceBoundClaudeAccount(storedAccount)) assertCompleteClaudeDeviceIdentity(probe.status)
        await assertClaudeIdentityIsUnique({
          ctx,
          key,
          status: probe.status,
          compareSystemLogin: source !== 'claude-system-login'
        })
        await persistClaudeAccount({ ctx, key, account: storedAccount, expectedAccount: existing ?? null })
        if (usesMachineWideClaudeAuth(ctx, storedAccount)) {
          await writeClaudeDeviceAuthBinding(ctx, key, storedAccount)
        }
        return {
          accountKey: key,
          account: buildAccountDetail({
            ctx,
            key,
            account: storedAccount,
            defaultAccount: configured.defaultAccount ?? key,
            probe
          }),
          message
        } satisfies AdapterManageAccountResult
      }

      if (
        existing == null &&
        process.platform === 'darwin' &&
        Object.keys(await readCanonicalClaudeAccounts(ctx)).length === 0
      ) {
        throwIfAborted(options.signal)
        const nativeProbe = await readClaudeAccountProbe({ ctx }).catch(() => undefined)
        let reusableNativeProbe: ClaudeAccountProbe | undefined
        if (nativeProbe != null) {
          try {
            assertManagedClaudeAuthStatus(nativeProbe.status)
            assertCompleteClaudeDeviceIdentity(nativeProbe.status)
            reusableNativeProbe = nativeProbe
          } catch {}
        }
        if (reusableNativeProbe != null) {
          options.onProgress?.({
            stream: 'status',
            message: `Using the existing machine-wide Claude login for account "${key}".`
          })
          return await persistConnectedAccount(
            reusableNativeProbe,
            `Connected existing machine-wide Claude login as account "${key}".`,
            'claude-system-login'
          )
        }
      }

      await mkdir(configDir, { recursive: true })
      let credentialPeerSnapshot: Record<string, string> | undefined
      if (authConfigDir != null) {
        await assertClaudeCredentialProfileIsIsolated({
          ctx,
          key,
          configDir: authConfigDir,
          rejectPreexistingCredential: existing == null
        })
        if (process.platform === 'darwin') {
          credentialPeerSnapshot = await readClaudeCredentialPeerSnapshot(ctx, key)
        }
      }
      options.onProgress?.({
        stream: 'status',
        message: `Starting official Claude login for isolated account "${key}".`
      })
      let loginSpawned = false
      try {
        await runClaudeAuthCommand({
          ctx,
          args: ['auth', 'login', '--claudeai'],
          configDir: authConfigDir,
          onProgress: options.onProgress,
          onSpawn: () => {
            loginSpawned = true
          },
          signal: options.signal
        })
        const probe = await readClaudeAccountProbe({ ctx, configDir: authConfigDir })
        if (credentialPeerSnapshot != null) {
          try {
            assertClaudeCredentialPeersUnchanged(
              credentialPeerSnapshot,
              await readClaudeCredentialPeerSnapshot(ctx, key)
            )
          } catch (peerError) {
            if (peerError instanceof ClaudeCredentialIsolationError) throw peerError
            throw new ClaudeCredentialIsolationError(
              `Claude login completed but One Works could not verify that profile "${key}" stayed isolated.`
            )
          }
        }
        return await persistConnectedAccount(
          probe,
          `Connected Claude account "${key}" through the official CLI.`,
          useSystemAuth ? 'claude-system-login' : 'claude-auth-login'
        )
      } catch (error) {
        if (
          loginSpawned &&
          credentialPeerSnapshot != null &&
          !(error instanceof ClaudeCredentialIsolationError)
        ) {
          try {
            assertClaudeCredentialPeersUnchanged(
              credentialPeerSnapshot,
              await readClaudeCredentialPeerSnapshot(ctx, key)
            )
          } catch (peerError) {
            if (peerError instanceof ClaudeCredentialIsolationError) throw peerError
            throw new ClaudeCredentialIsolationError(
              `Claude login failed and One Works could not verify that profile "${key}" remained isolated.`
            )
          }
        }
        if (error instanceof ClaudeCredentialIsolationError) {
          if (existing == null) {
            await rm(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', key), {
              recursive: true,
              force: true
            })
          }
          throw error
        }
        if (error instanceof ClaudeDuplicateIdentityError && authConfigDir != null) {
          if (existing == null) {
            await runClaudeAuthCommand({
              ctx,
              args: ['auth', 'logout'],
              configDir: authConfigDir,
              allowFailure: true
            }).catch(() => undefined)
            await rm(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', key), {
              recursive: true,
              force: true
            })
          } else {
            await recoverClaudeAccountAfterFailedLogin(ctx, key)
          }
          throw error
        }
        if (loginSpawned) {
          let recovery: Awaited<ReturnType<typeof recoverClaudeAccountAfterFailedLogin>>
          try {
            recovery = await recoverClaudeAccountAfterFailedLogin(ctx, key)
          } catch (recoveryError) {
            ctx.logger.warn('[claude account] failed to restore the canonical credential after login failed', {
              accountKey: key,
              error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
            })
            throw new Error(
              `Claude login failed and the previous portable credential could not be restored for "${key}". ` +
                'The account is unavailable until it is authenticated again.',
              { cause: error }
            )
          }
          if (recovery === 'device-credential-missing' || recovery === 'device-credential-may-have-changed') {
            const machineWide = existing != null && usesMachineWideClaudeAuth(ctx, existing)
            const recoveryMessage = machineWide
              ? 'The machine-wide Claude login cannot be rolled back per account; authenticate the account again.'
              : 'The isolated device credential cannot be rolled back; authenticate the account again.'
            throw new ClaudeCredentialUnavailableError(
              `Claude login did not complete after the device credential may have changed for "${key}". ${recoveryMessage}`
            )
          }
        }
        throw error
      }
    }
  })
}

export const manageClaudeAccount = async (
  ctx: AdapterCtx,
  options: AdapterManageAccountOptions
): Promise<AdapterManageAccountResult> => {
  if (options.action === 'consume-reset-credit') {
    throw new Error('Claude accounts do not support reset-credit consumption.')
  }
  if (options.action === 'add') return await loginClaudeAccount(ctx, options)

  const key = normalizeString(options.account)
  if (key == null) throw new Error(`Claude ${options.action} requires an account key.`)

  if (options.action === 'refresh') {
    const detail = await getClaudeAccountDetail(ctx, { account: key, refresh: true })
    return {
      accountKey: key,
      account: detail.account,
      message: `Refreshed Claude account "${key}" from official auth status and identity-matched usage.`
    }
  }

  if (key === CLAUDE_SYSTEM_ACCOUNT_KEY) {
    throw new Error('The default Claude home is read-only in One Works account management.')
  }
  const existing = resolveExistingConfiguredAccount(ctx, key)
  if (options.action === 'reauthenticate') return await loginClaudeAccount(ctx, options, key)

  if (options.action === 'remove') {
    return await withClaudeAuthMutationLock({
      ctx,
      key,
      account: existing,
      callback: async () => {
        await assertClaudeAccountGenerationIsCurrent(ctx, key, existing)
        await assertNoActiveClaudeAccountSessions(ctx, key)
        if (usesMachineWideClaudeAuth(ctx, existing)) {
          await removeClaudeAccountConfig(ctx, key, existing)
          await clearClaudeDeviceAuthBinding(ctx, key, existing)
          await rm(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', key), {
            recursive: true,
            force: true
          })
          return {
            accountKey: key,
            message: `Removed Claude account "${key}" from One Works. ` +
              'The shared native credential store was left signed in because it cannot be logged out per account.'
          }
        }
        const configDir = await materializeClaudeAccount({ ctx, accountKey: key, account: existing })
        await removeClaudeAccountConfig(ctx, key, existing, async () => {
          const credentialPeerSnapshot = process.platform === 'darwin'
            ? await readClaudeCredentialPeerSnapshot(ctx, key)
            : undefined
          const status = await assertClaudeCredentialProfileIsIsolated({
            ctx,
            key,
            configDir,
            expectedAccount: existing
          })
          if (status.loggedIn) {
            options.onProgress?.({ stream: 'status', message: `Running official Claude logout for "${key}".` })
            await runClaudeAuthCommand({
              ctx,
              args: ['auth', 'logout'],
              configDir,
              onProgress: options.onProgress,
              signal: options.signal
            })
          }
          if (credentialPeerSnapshot != null) {
            assertClaudeCredentialPeersUnchanged(
              credentialPeerSnapshot,
              await readClaudeCredentialPeerSnapshot(ctx, key)
            )
          }
        })
        await rm(resolveGlobalAdapterAccountDir(ctx.env, 'claude-code', key), {
          recursive: true,
          force: true
        })
        return {
          accountKey: key,
          message: `Logged out and removed Claude account "${key}".`
        }
      }
    })
  }

  throw new Error(`Unsupported Claude account action "${options.action}".`)
}
