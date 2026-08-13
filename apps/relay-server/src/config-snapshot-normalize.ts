/* eslint-disable max-lines -- Relay config normalization keeps safe fields, sanitization, and project rules together. */
import { normalizeCredentialRevision } from '@oneworks/types/credential-revision'

import { RELAY_CONFIG_SAFE_FIELDS } from './config-safe-fields.js'
import type {
  RelayConfigAssignment,
  RelayConfigPatch,
  RelayConfigProjectContext,
  RelayConfigProjectRule,
  RelayConfigSafeField,
  RelayStore,
  RelayUser
} from './types.js'
import { isRecord, now } from './utils.js'

const SAFE_FIELD_SET = new Set<string>(RELAY_CONFIG_SAFE_FIELDS)

const unique = <T>(values: T[]) => [...new Set(values)]

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizePathText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

const normalizeStringList = (value: unknown): string[] | undefined => {
  if (typeof value === 'string') {
    const text = normalizeText(value)
    return text == null ? undefined : [text]
  }
  if (!Array.isArray(value)) return undefined
  const list = value.map(normalizeText).filter((item): item is string => item != null)
  return list.length > 0 ? unique(list) : undefined
}

const normalizeFilesystemPatternList = (value: unknown): string[] | undefined => {
  const readPattern = (item: unknown) => typeof item === 'string' && item.trim() !== '' ? item : undefined
  if (typeof value === 'string') {
    const pattern = readPattern(value)
    return pattern == null ? undefined : [pattern]
  }
  if (!Array.isArray(value)) return undefined
  const list = value.map(readPattern).filter((item): item is string => item != null)
  return list.length > 0 ? unique(list) : undefined
}

export const normalizeRelayConfigSafeFields = (value: unknown): RelayConfigSafeField[] => {
  const fields = normalizeStringList(value)
    ?.filter((field): field is RelayConfigSafeField => SAFE_FIELD_SET.has(field)) ?? [...RELAY_CONFIG_SAFE_FIELDS]
  return unique(fields)
}

export const normalizeRelayConfigProjectRule = (value: unknown): RelayConfigProjectRule | undefined => {
  if (!isRecord(value)) return undefined
  const allow = normalizeFilesystemPatternList(value.allow)
  const deny = normalizeFilesystemPatternList(value.deny)
  return allow == null && deny == null ? undefined : { allow, deny }
}

export const normalizeRelayConfigTarget = (value: unknown): RelayConfigAssignment['target'] => {
  if (!isRecord(value)) return undefined
  const teamIds = normalizeStringList(value.teamIds)
  const userIds = normalizeStringList(value.userIds)
  return teamIds == null && userIds == null ? undefined : { teamIds, userIds }
}

const secretLikeKeyPattern =
  /(?:^|[_-])(?:api[_-]?key|secret|token|password|credential|private[_-]?key)(?:$|[_-])|apiKey|accessToken|refreshToken/iu

const isSecretLikeConfigKey = (key: string) => secretLikeKeyPattern.test(key)

const sanitizeRelayConfigValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sanitizeRelayConfigValue).filter(item => item !== undefined)
  }
  if (!isRecord(value)) return value

  const sanitized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (isSecretLikeConfigKey(key)) continue
    const nextValue = sanitizeRelayConfigValue(item)
    if (nextValue !== undefined) {
      sanitized[key] = nextValue
    }
  }
  return sanitized
}

const normalizeSanitizedRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const sanitized = Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, sanitizeRelayConfigValue(item)] as const)
      .filter((entry): entry is [string, unknown] => entry[1] !== undefined)
  )
  return isRecord(sanitized) && Object.keys(sanitized).length > 0 ? sanitized : undefined
}

const normalizeSanitizedArrayOrRecord = (value: unknown): unknown[] | Record<string, unknown> | undefined => {
  if (isRecord(value)) return normalizeSanitizedRecord(value)
  const sanitized = sanitizeRelayConfigValue(value)
  if (Array.isArray(sanitized)) return sanitized.length > 0 ? sanitized : undefined
  return undefined
}

const normalizeNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
)

const normalizeCredentialEnvelope = (
  value: unknown,
  adapterKey: string,
  field: 'auth' | 'state'
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const explicitStorage = normalizeText(value.storage)
  const storage = explicitStorage ?? 'inline'
  const type = normalizeText(value.type) ?? (
    adapterKey === 'codex' && field === 'auth' ? 'codex-auth-json' : undefined
  )
  const version = Number.isInteger(value.version) && (value.version as number) > 0
    ? value.version as number
    : undefined
  const portability = value.portability === 'portable' || value.portability === 'device-bound'
    ? value.portability
    : undefined
  if (storage === 'inline') {
    if (portability === 'device-bound') return undefined
    const encoding = normalizeText(value.encoding)
    const token = normalizeText(value.token)
    if (type == null || token == null || encoding !== 'base64') return undefined
    return {
      ...(explicitStorage == null ? {} : { storage }),
      ...(type == null ? {} : { type }),
      ...(version == null ? {} : { version }),
      ...(portability == null ? {} : { portability }),
      encoding,
      token
    }
  }
  if (field === 'state') return undefined
  if (storage === 'secret') {
    if (portability === 'device-bound') return undefined
    const ref = normalizeText(value.ref)
    if (type == null || ref == null) return undefined
    return {
      storage,
      type,
      ...(version == null ? {} : { version }),
      ...(portability == null ? {} : { portability }),
      ref
    }
  }
  if (storage !== 'device' || type == null || portability !== 'device-bound') return undefined
  const binding = normalizeText(value.binding)
  return {
    storage,
    type,
    ...(version == null ? {} : { version }),
    portability,
    ...(binding == null ? {} : { binding })
  }
}

const normalizeAdapterAccount = (
  value: unknown,
  adapterKey: string
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const auth = normalizeCredentialEnvelope(value.auth, adapterKey, 'auth')
  const state = normalizeCredentialEnvelope(value.state, adapterKey, 'state')
  const quota = sanitizeRelayConfigValue(value.quota)
  const account: Record<string, unknown> = {
    ...(normalizeText(value.title) == null ? {} : { title: normalizeText(value.title) }),
    ...(normalizeText(value.description) == null ? {} : { description: normalizeText(value.description) }),
    ...(normalizeText(value.displayName) == null ? {} : { displayName: normalizeText(value.displayName) }),
    ...(normalizeText(value.email) == null ? {} : { email: normalizeText(value.email) }),
    ...(normalizeText(value.avatarUrl) == null ? {} : { avatarUrl: normalizeText(value.avatarUrl) }),
    ...(normalizeText(value.planType) == null ? {} : { planType: normalizeText(value.planType) }),
    ...(normalizeText(value.accountType) == null ? {} : { accountType: normalizeText(value.accountType) }),
    ...(normalizeText(value.accountId) == null ? {} : { accountId: normalizeText(value.accountId) }),
    ...(normalizeText(value.organizationId) == null ? {} : { organizationId: normalizeText(value.organizationId) }),
    ...(normalizeText(value.organizationTitle) == null
      ? {}
      : { organizationTitle: normalizeText(value.organizationTitle) }),
    ...(normalizeText(value.organizationRole) == null
      ? {}
      : { organizationRole: normalizeText(value.organizationRole) }),
    ...(normalizeText(value.source) == null ? {} : { source: normalizeText(value.source) }),
    ...(normalizeNumber(value.createdAt) == null ? {} : { createdAt: normalizeNumber(value.createdAt) }),
    ...(normalizeNumber(value.updatedAt) == null ? {} : { updatedAt: normalizeNumber(value.updatedAt) }),
    ...(normalizeText(value.authDigest) == null ? {} : { authDigest: normalizeText(value.authDigest) }),
    ...(normalizeText(value.generation) == null ? {} : { generation: normalizeText(value.generation) }),
    ...(normalizeCredentialRevision(value.credentialRevision) == null
      ? {}
      : { credentialRevision: normalizeCredentialRevision(value.credentialRevision) }),
    ...(normalizeNumber(value.credentialUpdatedAt) == null
      ? {}
      : { credentialUpdatedAt: normalizeNumber(value.credentialUpdatedAt) }),
    ...(normalizeNumber(value.priority) == null ? {} : { priority: normalizeNumber(value.priority) }),
    ...(typeof value.disabled === 'boolean' ? { disabled: value.disabled } : {}),
    ...(isRecord(quota) || Array.isArray(quota) ? { quota } : {}),
    ...(auth == null ? {} : { auth }),
    ...(state == null ? {} : { state })
  }
  return Object.keys(account).length > 0 ? account : undefined
}

const normalizeAdapterAccounts = (
  value: unknown,
  adapterKey: string
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const accounts = Object.fromEntries(
    Object.entries(value)
      .map(([key, account]) => [normalizeText(key), normalizeAdapterAccount(account, adapterKey)] as const)
      .filter((entry): entry is [string, Record<string, unknown>] => entry[0] != null && entry[1] != null)
  )
  return Object.keys(accounts).length > 0 ? accounts : undefined
}

const normalizeDeletedGenerations = (value: unknown) => {
  const candidates = Array.isArray(value) ? value : [value]
  return [
    ...new Set(candidates.flatMap(generation => {
      const normalized = normalizeText(generation)
      return normalized == null ? [] : [normalized]
    }))
  ]
}

const normalizeAccountTombstones = (value: unknown): Record<string, string[]> | undefined => {
  if (!isRecord(value)) return undefined
  const tombstones = Object.fromEntries(
    Object.entries(value)
      .flatMap(([key, generations]) => {
        const normalizedKey = normalizeText(key)
        const normalizedGenerations = normalizeDeletedGenerations(generations)
        return normalizedKey == null || normalizedGenerations.length === 0
          ? []
          : [[normalizedKey, normalizedGenerations] as const]
      })
  )
  return Object.keys(tombstones).length > 0 ? tombstones : undefined
}

const normalizeAccountAdapter = (
  value: unknown,
  adapterKey: string,
  options?: { allowDanglingDefaultAccount?: boolean }
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  let defaultAccount = normalizeText(value.defaultAccount)
  const accounts = { ...(normalizeAdapterAccounts(value.accounts, adapterKey) ?? {}) }
  const accountTombstones = { ...(normalizeAccountTombstones(value.accountTombstones) ?? {}) }
  const rawPool = isRecord(value.accountPool) ? value.accountPool : undefined
  const accountPool = rawPool == null
    ? undefined
    : {
      ...(typeof rawPool.enabled === 'boolean' ? { enabled: rawPool.enabled } : {}),
      ...(rawPool.strategy === 'sticky-priority' ? { strategy: rawPool.strategy } : {}),
      ...(normalizeNumber(rawPool.cooldownMs) == null ? {} : { cooldownMs: normalizeNumber(rawPool.cooldownMs) })
    }
  for (const [key, deletedGenerations] of Object.entries(accountTombstones)) {
    const account = isRecord(accounts[key]) ? accounts[key] : undefined
    const generation = normalizeText(account?.generation) ?? `legacy:${key}`
    if (deletedGenerations.includes(generation)) delete accounts[key]
  }
  if (
    options?.allowDanglingDefaultAccount !== true &&
    defaultAccount != null &&
    accounts[defaultAccount] == null
  ) {
    defaultAccount = undefined
  }
  const adapter = {
    ...(defaultAccount == null ? {} : { defaultAccount }),
    ...(Object.keys(accounts).length === 0 ? {} : { accounts }),
    ...(accountPool == null || Object.keys(accountPool).length === 0 ? {} : { accountPool }),
    ...(Object.keys(accountTombstones).length === 0 ? {} : { accountTombstones })
  }
  return Object.keys(adapter).length > 0 ? adapter : undefined
}

// Keep this account-envelope allowlist in sync with the Relay plugin normalizer.
// Generic token sanitization must not strip adapter-owned portable account payloads.
const normalizeAdapters = (
  value: unknown,
  options?: { allowDanglingDefaultAccount?: boolean }
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const adapters = Object.fromEntries(
    Object.entries(value)
      .map(([key, adapter]) => {
        const adapterKey = normalizeText(key)
        return [
          adapterKey,
          adapterKey == null ? undefined : normalizeAccountAdapter(adapter, adapterKey, options)
        ] as const
      })
      .filter((entry): entry is [string, Record<string, unknown>] => entry[0] != null && entry[1] != null)
  )
  return Object.keys(adapters).length > 0 ? adapters : undefined
}

export const filterRelayConfigPatch = (
  patch: RelayConfigPatch | undefined,
  allowedFields?: RelayConfigSafeField[],
  options?: { allowDanglingDefaultAccount?: boolean }
): RelayConfigPatch | undefined => {
  if (!isRecord(patch)) return undefined

  const allowed = new Set(allowedFields ?? RELAY_CONFIG_SAFE_FIELDS)
  const filtered: RelayConfigPatch = {}
  const adapters = normalizeAdapters(patch.adapters, options)
  if (allowed.has('adapters') && adapters != null) {
    filtered.adapters = adapters
  }
  if (allowed.has('defaultModelService') && typeof patch.defaultModelService === 'string') {
    filtered.defaultModelService = patch.defaultModelService
  }
  const modelServices = normalizeSanitizedRecord(patch.modelServices)
  if (allowed.has('modelServices') && modelServices != null) {
    filtered.modelServices = modelServices
  }
  const recommendedModels = sanitizeRelayConfigValue(patch.recommendedModels)
  if (allowed.has('recommendedModels') && Array.isArray(recommendedModels) && recommendedModels.length > 0) {
    filtered.recommendedModels = recommendedModels
  }
  const plugins = normalizeSanitizedArrayOrRecord(patch.plugins)
  if (allowed.has('plugins') && plugins != null) {
    filtered.plugins = plugins
  }
  const marketplaces = normalizeSanitizedRecord(patch.marketplaces)
  if (allowed.has('marketplaces') && marketplaces != null) {
    filtered.marketplaces = marketplaces
  }
  const skills = normalizeSanitizedArrayOrRecord(patch.skills)
  if (allowed.has('skills') && skills != null) {
    filtered.skills = skills
  }
  const skillsMeta = normalizeSanitizedRecord(patch.skillsMeta)
  if (allowed.has('skillsMeta') && skillsMeta != null) {
    filtered.skillsMeta = skillsMeta
  }
  const skillRegistries = normalizeSanitizedArrayOrRecord(patch.skillRegistries)
  if (allowed.has('skillRegistries') && skillRegistries != null) {
    filtered.skillRegistries = skillRegistries
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined
}

export const normalizeRelayConfigAssignment = (value: unknown): RelayConfigAssignment | undefined => {
  if (!isRecord(value)) return undefined
  const id = normalizeText(value.id)
  if (id == null) return undefined

  const allowedFields = normalizeRelayConfigSafeFields(value.allowedFields)
  const configPatch = filterRelayConfigPatch(value.configPatch as RelayConfigPatch | undefined, allowedFields)
  const project = normalizeRelayConfigProjectRule(value.project)
  const target = normalizeRelayConfigTarget(value.target)
  return {
    id,
    allowedFields,
    ...(configPatch == null ? {} : { configPatch }),
    ...(value.enabled === false ? { enabled: false } : {}),
    ...(project == null ? {} : { project }),
    ...(target == null ? {} : { target }),
    updatedAt: typeof value.updatedAt === 'string' && value.updatedAt.trim() !== '' ? value.updatedAt : now(),
    version: typeof value.version === 'string' && value.version.trim() !== '' ? value.version : undefined
  }
}

export const upsertRelayConfigAssignment = (
  store: RelayStore,
  assignment: RelayConfigAssignment
): RelayConfigAssignment => {
  const normalized = normalizeRelayConfigAssignment({
    ...assignment,
    updatedAt: assignment.updatedAt ?? now()
  })
  if (normalized == null) {
    throw new Error('Relay config assignment requires a non-empty id.')
  }

  const index = store.configAssignments.findIndex(item => item.id === normalized.id)
  if (index === -1) {
    store.configAssignments.push(normalized)
  } else {
    store.configAssignments[index] = normalized
  }
  return normalized
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const matchPattern = (pattern: string, value: string) => {
  if (pattern === value) return true
  if (!pattern.includes('*')) return false
  const expression = `^${pattern.split('*').map(escapeRegExp).join('.*')}$`
  return new RegExp(expression, 'u').test(value)
}

type RelayFilesystemPathFamily =
  | 'posix-absolute'
  | 'posix-relative'
  | 'windows-drive-rooted'
  | 'windows-drive-relative'
  | 'windows-rooted'
  | 'windows-unc'

const relayFilesystemPathFamily = (value: string): RelayFilesystemPathFamily => {
  if (/^[\\/]{2}/u.test(value)) return 'windows-unc'
  if (/^[a-z]:[\\/]/iu.test(value)) return 'windows-drive-rooted'
  if (/^[a-z]:/iu.test(value)) return 'windows-drive-relative'
  if (value.startsWith('\\')) return 'windows-rooted'
  return value.startsWith('/') ? 'posix-absolute' : 'posix-relative'
}

const stripTrailingPathSeparators = (value: string, floor: number, windowsFamily: boolean) => {
  const isSeparator = windowsFamily
    ? (character: string) => character === '/' || character === '\\'
    : (character: string) => character === '/'
  let end = value.length
  while (end > floor && isSeparator(value[end - 1])) end -= 1
  return value.slice(0, end)
}

const usesWindowsPathSeparators = (value: string) => relayFilesystemPathFamily(value).startsWith('windows-')

const normalizePath = (value: string, family = relayFilesystemPathFamily(value)) => {
  const windowsFamily = family.startsWith('windows-')
  const floor = family === 'windows-unc'
    ? (/^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/u.exec(value)?.[0].length ?? 2)
    : family === 'windows-drive-rooted'
    ? 3
    : family === 'windows-drive-relative'
    ? 2
    : family === 'windows-rooted' || family === 'posix-absolute'
    ? 1
    : 0
  const driveRoot = /^([a-z]:)[\\/]/iu.exec(value)
  if (driveRoot != null) {
    const root = `${driveRoot[1]}/`
    const rest = stripTrailingPathSeparators(value.slice(driveRoot[0].length).replace(/[\\/]+/gu, '/'), 0, true)
    return rest === '' ? root : `${root}${rest}`
  }
  const uncRoot = family === 'windows-unc' ? /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)/u.exec(value) : undefined
  if (uncRoot != null) {
    const root = `\\\\${uncRoot[1]}/${uncRoot[2]}`
    const rest = stripTrailingPathSeparators(value.slice(uncRoot[0].length).replace(/[\\/]+/gu, '/'), 0, true)
      .replace(/^\/+|\/+$/gu, '')
    return rest === '' ? root : `${root}/${rest}`
  }
  if (family === 'windows-rooted') {
    const rest = stripTrailingPathSeparators(value.slice(1).replace(/[\\/]+/gu, '/'), 0, true).replace(
      /^\/+|\/+$/gu,
      ''
    )
    return rest === '' ? '\\' : `\\${rest}`
  }
  if (family === 'posix-absolute') {
    const rest = value.slice(1).replace(/^\/+|\/+$/gu, '')
    return rest === '' ? '/' : `/${rest}`
  }
  return windowsFamily
    ? stripTrailingPathSeparators(value.replace(/[\\/]+/gu, '/'), floor, true)
    : value.replace(/\/+$/gu, '')
}

const relayFilesystemPathComparisonKey = (
  value: string,
  family = relayFilesystemPathFamily(value),
  isBasename = false
) => {
  const normalized = isBasename
    ? (family.startsWith('windows-') ? value.replace(/[\\/]+/gu, '/') : value)
    : normalizePath(value, family)
  return `${family}:${family.startsWith('windows-') ? normalized.toLowerCase() : normalized}`
}

const getPathName = (value: string | undefined) => {
  if (
    value == null || /^[a-z]:[\\/]*$/iu.test(value) || /^[\\/]$/u.test(value) ||
    /^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]*$/u.test(value)
  ) return undefined
  const normalized = normalizePath(value)
  const segments = usesWindowsPathSeparators(normalized)
    ? normalized.split(/[\\/]+/u).filter(Boolean)
    : normalized.split(/\/+/u).filter(Boolean)
  const name = segments[segments.length - 1]
  return name == null ? undefined : { family: relayFilesystemPathFamily(value), value: name }
}

interface RelayProjectCandidate {
  family?: RelayFilesystemPathFamily
  isBasename?: boolean
  value: string
}

const getProjectCandidates = (context: RelayConfigProjectContext) => {
  const cwd = normalizePathText(context.cwd)
  const workspaceFolder = normalizePathText(context.workspaceFolder)
  const candidates: RelayProjectCandidate[] = [
    ...[normalizeText(context.projectId), normalizeText(context.projectName)]
      .filter((value): value is string => value != null && value !== '')
      .map(value => ({ value })),
    ...[cwd, workspaceFolder].filter((value): value is string => value != null)
      .map(value => ({ family: relayFilesystemPathFamily(value), value })),
    ...[getPathName(cwd), getPathName(workspaceFolder)]
      .filter((value): value is NonNullable<typeof value> => value != null)
      .map(value => ({ ...value, isBasename: true }))
  ]
  return [...new Map(candidates.map(candidate => [
    `${candidate.family ?? 'text'}:${candidate.isBasename === true ? 'basename' : 'value'}:${candidate.value}`,
    candidate
  ])).values()]
}

const matchesAnyPattern = (patterns: string[] | undefined, candidates: RelayProjectCandidate[]) => (
  patterns != null && patterns.length > 0 && patterns.some(pattern =>
    candidates.some(candidate => {
      const patternFamily = candidate.isBasename === true && !/[\\/]/u.test(pattern) ? candidate.family : undefined
      return matchPattern(
        relayFilesystemPathComparisonKey(pattern, patternFamily, candidate.isBasename === true),
        relayFilesystemPathComparisonKey(candidate.value, candidate.family, candidate.isBasename === true)
      )
    })
  )
)

export const matchesRelayConfigProject = (
  assignment: Pick<RelayConfigAssignment, 'project'>,
  context: RelayConfigProjectContext
) => {
  const candidates = getProjectCandidates(context)
  const allow = normalizeFilesystemPatternList(assignment.project?.allow)
  const deny = normalizeFilesystemPatternList(assignment.project?.deny)

  if (matchesAnyPattern(deny, candidates)) return false
  if (allow == null || allow.length === 0) return true

  return matchesAnyPattern(allow, candidates)
}

export const hasProjectContext = (context: RelayConfigProjectContext | undefined) => (
  context != null && getProjectCandidates(context).length > 0
)

export const assignmentTargetsUser = (
  assignment: Pick<RelayConfigAssignment, 'target'>,
  user: RelayUser,
  teamIdsForUser: string[] = user.teamIds ?? []
) => {
  const userIds = assignment.target?.userIds ?? []
  const teamIds = assignment.target?.teamIds ?? []
  if (userIds.length === 0 && teamIds.length === 0) return true

  return userIds.includes(user.id) || teamIds.some(teamId => teamIdsForUser.includes(teamId))
}
