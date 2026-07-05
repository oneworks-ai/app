/* eslint-disable max-lines -- Relay config patch normalization and merging share one contract module. */
import { RELAY_CONFIG_SAFE_FIELDS, RELAY_TEAM_CONFIG_SAFE_FIELDS } from './config-assignment-types.js'
import type { RelayConfigPatch, RelayConfigSafeField } from './config-assignment-types.js'

const SAFE_FIELD_SET = new Set<string>(RELAY_CONFIG_SAFE_FIELDS)
const TEAM_SAFE_FIELD_SET = new Set<string>(RELAY_TEAM_CONFIG_SAFE_FIELDS)

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const unique = <T>(values: T[]) => [...new Set(values)]

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

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
  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

const normalizeSanitizedProperties = (value: unknown): Record<string, unknown> | undefined => {
  const sanitized = sanitizeRelayConfigValue(value)
  return isRecord(sanitized) && Object.keys(sanitized).length > 0 ? sanitized : undefined
}

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

export const normalizeRelayTeamConfigSafeFields = (
  value: unknown
): RelayConfigSafeField[] => {
  const fields = normalizeRelayConfigStringList(value)
    ?.filter((field): field is RelayConfigSafeField => TEAM_SAFE_FIELD_SET.has(field)) ??
    [...RELAY_TEAM_CONFIG_SAFE_FIELDS]
  return unique(fields)
}

const normalizeModelService = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const apiBaseUrl = normalizeText(value.apiBaseUrl)
  if (apiBaseUrl == null) return undefined
  const extra = normalizeSanitizedProperties(value.extra)

  return {
    ...(normalizeText(value.title) == null ? {} : { title: normalizeText(value.title) }),
    ...(normalizeText(value.description) == null ? {} : { description: normalizeText(value.description) }),
    apiBaseUrl,
    ...(Array.isArray(value.models)
      ? { models: value.models.map(item => normalizeText(item)).filter((item): item is string => item != null) }
      : {}),
    ...(typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)
      ? { timeoutMs: value.timeoutMs }
      : {}),
    ...(typeof value.maxOutputTokens === 'number' && Number.isFinite(value.maxOutputTokens)
      ? { maxOutputTokens: value.maxOutputTokens }
      : {}),
    ...(extra == null ? {} : { extra })
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

const normalizeRecordField = normalizeSanitizedRecord

const normalizeArrayOrRecordField = (value: unknown): unknown[] | Record<string, unknown> | undefined => {
  if (isRecord(value)) return normalizeRecordField(value)
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
  const accounts = normalizeCodexAccounts(value.accounts)
  const adapter = {
    ...(accounts == null ? {} : { accounts })
  }
  return Object.keys(adapter).length > 0 ? adapter : undefined
}

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
  const modelServices = normalizeModelServices(patch.modelServices)
  if (allowed.has('modelServices') && modelServices != null) {
    filtered.modelServices = modelServices
  }
  const recommendedModels = normalizeRecommendedModels(patch.recommendedModels)
  if (allowed.has('recommendedModels') && recommendedModels != null) {
    filtered.recommendedModels = recommendedModels
  }
  const plugins = normalizeArrayOrRecordField(patch.plugins)
  if (allowed.has('plugins') && plugins != null) {
    filtered.plugins = plugins
  }
  const marketplaces = normalizeRecordField(patch.marketplaces)
  if (allowed.has('marketplaces') && marketplaces != null) {
    filtered.marketplaces = marketplaces
  }
  const skills = normalizeArrayOrRecordField(patch.skills)
  if (allowed.has('skills') && skills != null) {
    filtered.skills = skills
  }
  const skillsMeta = normalizeRecordField(patch.skillsMeta)
  if (allowed.has('skillsMeta') && skillsMeta != null) {
    filtered.skillsMeta = skillsMeta
  }
  const skillRegistries = normalizeArrayOrRecordField(patch.skillRegistries)
  if (allowed.has('skillRegistries') && skillRegistries != null) {
    filtered.skillRegistries = skillRegistries
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined
}

const mergeRecordField = (
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
) => ({ ...(left ?? {}), ...(right ?? {}) })

const mergeArrayOrRecordField = (
  left: RelayConfigPatch['plugins'] | RelayConfigPatch['skills'],
  right: RelayConfigPatch['plugins'] | RelayConfigPatch['skills']
) => {
  if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right]
  if (isRecord(left) || isRecord(right)) {
    return mergeRecordField(isRecord(left) ? left : undefined, isRecord(right) ? right : undefined)
  }
  return right ?? left
}

const mergeAdaptersField = (
  left: RelayConfigPatch['adapters'],
  right: RelayConfigPatch['adapters']
) => {
  const leftCodex = isRecord(left?.codex) ? left.codex : undefined
  const rightCodex = isRecord(right?.codex) ? right.codex : undefined
  if (leftCodex == null && rightCodex == null) return right ?? left
  const leftAccounts = isRecord(leftCodex?.accounts) ? leftCodex.accounts : undefined
  const rightAccounts = isRecord(rightCodex?.accounts) ? rightCodex.accounts : undefined
  return {
    codex: {
      ...(
        leftAccounts == null && rightAccounts == null
          ? {}
          : { accounts: { ...(leftAccounts ?? {}), ...(rightAccounts ?? {}) } }
      )
    }
  }
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
  if (left.adapters != null || right.adapters != null) {
    merged.adapters = mergeAdaptersField(left.adapters, right.adapters)
  }
  if (left.recommendedModels != null || right.recommendedModels != null) {
    merged.recommendedModels = [...(left.recommendedModels ?? []), ...(right.recommendedModels ?? [])]
  }
  if (left.plugins != null || right.plugins != null) {
    merged.plugins = mergeArrayOrRecordField(left.plugins, right.plugins)
  }
  if (left.marketplaces != null || right.marketplaces != null) {
    merged.marketplaces = mergeRecordField(left.marketplaces, right.marketplaces)
  }
  if (left.skills != null || right.skills != null) {
    merged.skills = mergeArrayOrRecordField(left.skills, right.skills)
  }
  if (left.skillsMeta != null || right.skillsMeta != null) {
    merged.skillsMeta = mergeRecordField(left.skillsMeta, right.skillsMeta)
  }
  if (left.skillRegistries != null || right.skillRegistries != null) {
    merged.skillRegistries = mergeArrayOrRecordField(left.skillRegistries, right.skillRegistries)
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}
