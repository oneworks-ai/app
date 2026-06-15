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

export const filterRelayConfigPatch = (
  patch: RelayConfigPatch | undefined,
  allowedFields?: RelayConfigSafeField[]
): RelayConfigPatch | undefined => {
  if (!isRecord(patch)) return undefined

  const allowed = new Set(allowedFields ?? RELAY_CONFIG_SAFE_FIELDS)
  const filtered: RelayConfigPatch = {}
  if (allowed.has('defaultModelService') && typeof patch.defaultModelService === 'string') {
    filtered.defaultModelService = patch.defaultModelService
  }
  if (allowed.has('modelServices') && isRecord(patch.modelServices)) {
    filtered.modelServices = patch.modelServices
  }
  if (allowed.has('recommendedModels') && Array.isArray(patch.recommendedModels)) {
    filtered.recommendedModels = patch.recommendedModels
  }
  if (allowed.has('plugins') && isRecord(patch.plugins)) {
    filtered.plugins = patch.plugins
  }
  if (allowed.has('marketplaces') && isRecord(patch.marketplaces)) {
    filtered.marketplaces = patch.marketplaces
  }
  if (allowed.has('skills') && (Array.isArray(patch.skills) || isRecord(patch.skills))) {
    filtered.skills = patch.skills
  }
  if (allowed.has('skillsMeta') && isRecord(patch.skillsMeta)) {
    filtered.skillsMeta = patch.skillsMeta
  }
  if (allowed.has('skillRegistries') && (Array.isArray(patch.skillRegistries) || isRecord(patch.skillRegistries))) {
    filtered.skillRegistries = patch.skillRegistries
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
