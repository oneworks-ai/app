import { RELAY_CONFIG_SAFE_FIELDS } from './config-assignment-types.js'
import type {
  RelayConfigAssignment,
  RelayConfigPatch,
  RelayConfigProjectContext,
  RelayConfigSafeField
} from './config-assignment-types.js'

const SAFE_FIELD_SET = new Set<string>(RELAY_CONFIG_SAFE_FIELDS)

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const unique = <T>(values: T[]) => [...new Set(values)]

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const normalizeRelayConfigStringList = (value: unknown): string[] | undefined => {
  if (typeof value === 'string') return [value].map(item => item.trim()).filter(Boolean)
  if (!Array.isArray(value)) return undefined

  const list = value
    .map(item => normalizeText(item))
    .filter((item): item is string => item != null)
  return list.length > 0 ? list : undefined
}

export const normalizeRelayConfigSafeFields = (
  value: unknown
): RelayConfigSafeField[] => {
  const fields = normalizeRelayConfigStringList(value)
    ?.filter((field): field is RelayConfigSafeField => SAFE_FIELD_SET.has(field)) ?? [...RELAY_CONFIG_SAFE_FIELDS]
  return unique(fields)
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

const getProjectCandidates = (context: RelayConfigProjectContext) => {
  const cwd = normalizeText(context.cwd)
  const workspaceFolder = normalizeText(context.workspaceFolder)
  return unique([
    normalizeText(context.projectId),
    normalizeText(context.projectName),
    cwd,
    workspaceFolder,
    getPathName(cwd),
    getPathName(workspaceFolder),
    ...(cwd == null ? [] : [normalizePath(cwd)]),
    ...(workspaceFolder == null ? [] : [normalizePath(workspaceFolder)])
  ].filter((value): value is string => value != null && value !== ''))
}

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
  const allow = normalizeRelayConfigStringList(assignment.project?.allow)
  const deny = normalizeRelayConfigStringList(assignment.project?.deny)

  if (matchesAnyPattern(deny, candidates)) return false
  if (allow == null || allow.length === 0) return true

  return matchesAnyPattern(allow, candidates)
}

const normalizeModelService = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const apiBaseUrl = normalizeText(value.apiBaseUrl)
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey : undefined
  if (apiBaseUrl == null || apiKey == null) return undefined

  return {
    ...(normalizeText(value.title) == null ? {} : { title: normalizeText(value.title) }),
    ...(normalizeText(value.description) == null ? {} : { description: normalizeText(value.description) }),
    apiBaseUrl,
    apiKey,
    ...(Array.isArray(value.models)
      ? { models: value.models.map(item => normalizeText(item)).filter((item): item is string => item != null) }
      : {}),
    ...(typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)
      ? { timeoutMs: value.timeoutMs }
      : {}),
    ...(typeof value.maxOutputTokens === 'number' && Number.isFinite(value.maxOutputTokens)
      ? { maxOutputTokens: value.maxOutputTokens }
      : {}),
    ...(isRecord(value.extra) ? { extra: value.extra } : {})
  }
}

const normalizeModelServices = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined

  const services = Object.fromEntries(
    Object.entries(value)
      .map(([key, service]) => [normalizeText(key), normalizeModelService(service)] as const)
      .filter((entry): entry is [string, Record<string, unknown>] => entry[0] != null && entry[1] != null)
  )
  return Object.keys(services).length > 0 ? services : undefined
}

const normalizeRecommendedModel = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const model = normalizeText(value.model)
  if (model == null) return undefined

  const placement = value.placement === 'modelSelector' ? value.placement : undefined
  return {
    ...(normalizeText(value.service) == null ? {} : { service: normalizeText(value.service) }),
    model,
    ...(normalizeText(value.title) == null ? {} : { title: normalizeText(value.title) }),
    ...(normalizeText(value.description) == null ? {} : { description: normalizeText(value.description) }),
    ...(placement == null ? {} : { placement })
  }
}

const normalizeRecommendedModels = (value: unknown): unknown[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const models = value
    .map(normalizeRecommendedModel)
    .filter((model): model is Record<string, unknown> => model != null)
  return models.length > 0 ? models : undefined
}

export const filterRelayConfigPatch = (
  patch: RelayConfigPatch | undefined,
  allowedFields?: RelayConfigSafeField[]
): RelayConfigPatch | undefined => {
  if (!isRecord(patch)) return undefined

  const allowed = new Set(allowedFields ?? RELAY_CONFIG_SAFE_FIELDS)
  const filtered: RelayConfigPatch = {}
  const defaultModelService = normalizeText(patch.defaultModelService)
  if (allowed.has('defaultModelService') && defaultModelService != null) {
    filtered.defaultModelService = defaultModelService
  }
  const modelServices = normalizeModelServices(patch.modelServices)
  if (allowed.has('modelServices') && modelServices != null) {
    filtered.modelServices = modelServices
  }
  const recommendedModels = normalizeRecommendedModels(patch.recommendedModels)
  if (allowed.has('recommendedModels') && recommendedModels != null) {
    filtered.recommendedModels = recommendedModels
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined
}

export const mergeRelayConfigPatches = (
  left: RelayConfigPatch | undefined,
  right: RelayConfigPatch | undefined
): RelayConfigPatch | undefined => {
  if (left == null) return right
  if (right == null) return left

  const merged: RelayConfigPatch = { ...left, ...right }
  if (left.modelServices != null || right.modelServices != null) {
    merged.modelServices = { ...(left.modelServices ?? {}), ...(right.modelServices ?? {}) }
  }
  if (left.recommendedModels != null || right.recommendedModels != null) {
    merged.recommendedModels = [...(left.recommendedModels ?? []), ...(right.recommendedModels ?? [])]
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}
