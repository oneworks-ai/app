/* eslint-disable max-lines -- Relay config normalization keeps safe fields, sanitization, and project rules together. */
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

const normalizeStringList = (value: unknown): string[] | undefined => {
  if (typeof value === 'string') {
    const text = normalizeText(value)
    return text == null ? undefined : [text]
  }
  if (!Array.isArray(value)) return undefined
  const list = value.map(normalizeText).filter((item): item is string => item != null)
  return list.length > 0 ? unique(list) : undefined
}

export const normalizeRelayConfigSafeFields = (value: unknown): RelayConfigSafeField[] => {
  const fields = normalizeStringList(value)
    ?.filter((field): field is RelayConfigSafeField => SAFE_FIELD_SET.has(field)) ?? [...RELAY_CONFIG_SAFE_FIELDS]
  return unique(fields)
}

export const normalizeRelayConfigProjectRule = (value: unknown): RelayConfigProjectRule | undefined => {
  if (!isRecord(value)) return undefined
  const allow = normalizeStringList(value.allow)
  const deny = normalizeStringList(value.deny)
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

const normalizeCodexInlineAuth = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const type = normalizeText(value.type)
  const encoding = normalizeText(value.encoding)
  const token = normalizeText(value.token)
  if (
    token == null ||
    (type != null && type !== 'codex-auth-json') ||
    encoding !== 'base64'
  ) {
    return undefined
  }
  return {
    ...(type == null ? {} : { type }),
    encoding,
    token
  }
}

const normalizeCodexAccount = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const auth = normalizeCodexInlineAuth(value.auth)
  const quota = sanitizeRelayConfigValue(value.quota)
  const account: Record<string, unknown> = {
    ...(normalizeText(value.title) == null ? {} : { title: normalizeText(value.title) }),
    ...(normalizeText(value.description) == null ? {} : { description: normalizeText(value.description) }),
    ...(normalizeText(value.email) == null ? {} : { email: normalizeText(value.email) }),
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
    ...(isRecord(quota) || Array.isArray(quota) ? { quota } : {}),
    ...(auth == null ? {} : { auth })
  }
  return Object.keys(account).length > 0 ? account : undefined
}

const normalizeCodexAccounts = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const accounts = Object.fromEntries(
    Object.entries(value)
      .map(([key, account]) => [normalizeText(key), normalizeCodexAccount(account)] as const)
      .filter((entry): entry is [string, Record<string, unknown>] => entry[0] != null && entry[1] != null)
  )
  return Object.keys(accounts).length > 0 ? accounts : undefined
}

const normalizeCodexAdapter = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const defaultAccount = normalizeText(value.defaultAccount)
  const accounts = normalizeCodexAccounts(value.accounts)
  const adapter = {
    ...(defaultAccount == null ? {} : { defaultAccount }),
    ...(accounts == null ? {} : { accounts })
  }
  return Object.keys(adapter).length > 0 ? adapter : undefined
}

// Keep this explicit allowlist in sync with packages/plugins/relay/src/shared/config-assignment-patch.ts.
// Generic token sanitization must not strip Codex auth-json payloads that are intentionally base64 encoded.
const normalizeAdapters = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const codex = normalizeCodexAdapter(value.codex)
  return codex == null ? undefined : { codex }
}

export const filterRelayConfigPatch = (
  patch: RelayConfigPatch | undefined,
  allowedFields?: RelayConfigSafeField[]
): RelayConfigPatch | undefined => {
  if (!isRecord(patch)) return undefined

  const allowed = new Set(allowedFields ?? RELAY_CONFIG_SAFE_FIELDS)
  const filtered: RelayConfigPatch = {}
  const adapters = normalizeAdapters(patch.adapters)
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

const normalizePath = (value: string) => value.replace(/\\/gu, '/').replace(/\/+$/u, '')

const getPathName = (value: string | undefined) => {
  if (value == null) return undefined
  const normalized = normalizePath(value)
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1]
}

const getProjectCandidates = (context: RelayConfigProjectContext) => (
  unique([
    normalizeText(context.projectId),
    normalizeText(context.projectName),
    normalizeText(context.cwd),
    normalizeText(context.workspaceFolder),
    getPathName(normalizeText(context.cwd)),
    getPathName(normalizeText(context.workspaceFolder)),
    ...(normalizeText(context.cwd) == null ? [] : [normalizePath(normalizeText(context.cwd) ?? '')]),
    ...(normalizeText(context.workspaceFolder) == null
      ? []
      : [normalizePath(normalizeText(context.workspaceFolder) ?? '')])
  ].filter((value): value is string => value != null && value !== ''))
)

const matchesAnyPattern = (patterns: string[] | undefined, candidates: string[]) => (
  patterns == null || patterns.length === 0
    ? false
    : patterns.some(pattern => candidates.some(candidate => matchPattern(pattern, candidate)))
)

export const matchesRelayConfigProject = (
  assignment: Pick<RelayConfigAssignment, 'project'>,
  context: RelayConfigProjectContext
) => {
  const candidates = getProjectCandidates(context)
  const allow = normalizeStringList(assignment.project?.allow)
  const deny = normalizeStringList(assignment.project?.deny)

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
