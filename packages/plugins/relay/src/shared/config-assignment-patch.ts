/* eslint-disable max-lines -- Relay config patch normalization and merging share one contract module. */
import { compareCredentialRevisions, normalizeCredentialRevision } from '@oneworks/types/credential-revision'

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
  return unique(candidates.flatMap(generation => {
    const normalized = normalizeText(generation)
    return normalized == null ? [] : [normalized]
  }))
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

const mergeAccountTombstones = (
  left: Record<string, string[]>,
  right: Record<string, string[]>
) =>
  Object.fromEntries(
    unique([...Object.keys(left), ...Object.keys(right)]).map(key => [
      key,
      unique([...(left[key] ?? []), ...(right[key] ?? [])])
    ])
  )

const accountGenerationIsDeleted = (
  accountKey: string,
  account: Record<string, unknown> | undefined,
  deletedGenerations: string[] | undefined
) => {
  const generation = normalizeText(account?.generation) ?? `legacy:${accountKey}`
  return deletedGenerations?.includes(generation) === true
}

const normalizeAccountAdapter = (
  value: unknown,
  adapterKey: string
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  let defaultAccount = normalizeText(value.defaultAccount)
  const accounts = { ...(normalizeAdapterAccounts(value.accounts, adapterKey) ?? {}) }
  const accountTombstones = { ...(normalizeAccountTombstones(value.accountTombstones) ?? {}) }
  for (const [key, deletedGenerations] of Object.entries(accountTombstones)) {
    const account = isRecord(accounts[key]) ? accounts[key] : undefined
    if (accountGenerationIsDeleted(key, account, deletedGenerations)) delete accounts[key]
  }
  if (defaultAccount != null && accounts[defaultAccount] == null) defaultAccount = undefined
  const adapter = {
    ...(defaultAccount == null ? {} : { defaultAccount }),
    ...(Object.keys(accounts).length === 0 ? {} : { accounts }),
    ...(Object.keys(accountTombstones).length === 0 ? {} : { accountTombstones })
  }
  return Object.keys(adapter).length > 0 ? adapter : undefined
}

const normalizeAdapters = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  const adapters = Object.fromEntries(
    Object.entries(value)
      .map(([key, adapter]) => {
        const adapterKey = normalizeText(key)
        return [
          adapterKey,
          adapterKey == null ? undefined : normalizeAccountAdapter(adapter, adapterKey)
        ] as const
      })
      .filter((entry): entry is [string, Record<string, unknown>] => entry[0] != null && entry[1] != null)
  )
  return Object.keys(adapters).length > 0 ? adapters : undefined
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

const accountSurvivesTombstone = (
  accountKey: string,
  account: Record<string, unknown> | undefined,
  deletedGenerations: string[] | undefined
) => account != null && !accountGenerationIsDeleted(accountKey, account, deletedGenerations)

const mergeAccountRecords = (
  left: Record<string, unknown>,
  right: Record<string, unknown>,
  credentialTieWinner: 'left' | 'right'
) => {
  const leftGeneration = normalizeText(left.generation)
  const rightGeneration = normalizeText(right.generation)
  if (leftGeneration !== rightGeneration) {
    if (leftGeneration == null) return { ...right }
    if (rightGeneration == null) return { ...left }
    return leftGeneration.localeCompare(rightGeneration) > 0 ? { ...left } : { ...right }
  }
  const leftUpdatedAt = normalizeNumber(left.updatedAt) ?? -1
  const rightUpdatedAt = normalizeNumber(right.updatedAt) ?? -1
  const metadataWinner = leftUpdatedAt > rightUpdatedAt ? left : right
  const metadataLoser = metadataWinner === left ? right : left
  const merged: Record<string, unknown> = { ...metadataLoser, ...metadataWinner }

  const credentialComparison = compareCredentialRevisions(left.credentialRevision, right.credentialRevision)
  const leftAuth = isRecord(left.auth) ? left.auth : undefined
  const rightAuth = isRecord(right.auth) ? right.auth : undefined
  let credentialWinner = credentialComparison > 0
    ? left
    : credentialComparison < 0
    ? right
    : credentialTieWinner === 'left'
    ? left
    : right
  if (credentialComparison === 0) {
    const leftStorage = normalizeText(leftAuth?.storage) ?? (leftAuth == null ? undefined : 'inline')
    const rightStorage = normalizeText(rightAuth?.storage) ?? (rightAuth == null ? undefined : 'inline')
    if (leftAuth == null && rightAuth != null) credentialWinner = right
    else if (leftAuth != null && rightAuth == null) credentialWinner = left
    else if (leftStorage === 'device' && (rightStorage === 'inline' || rightStorage === 'secret')) {
      credentialWinner = right
    } else if ((leftStorage === 'inline' || leftStorage === 'secret') && rightStorage === 'device') {
      credentialWinner = left
    }
  }
  const credentialAuth = isRecord(credentialWinner.auth) ? credentialWinner.auth : undefined
  if (credentialAuth == null) delete merged.auth
  else merged.auth = credentialAuth
  for (const key of ['credentialRevision', 'credentialUpdatedAt'] as const) {
    if (credentialWinner[key] == null) delete merged[key]
    else merged[key] = credentialWinner[key]
  }
  return merged
}

const mergeAdaptersField = (
  left: RelayConfigPatch['adapters'],
  right: RelayConfigPatch['adapters'],
  credentialTieWinner: 'left' | 'right'
) =>
  Object.fromEntries(
    unique([...Object.keys(left ?? {}), ...Object.keys(right ?? {})]).map((adapterKey) => {
      const leftAdapter = isRecord(left?.[adapterKey]) ? left[adapterKey] : undefined
      const rightAdapter = isRecord(right?.[adapterKey]) ? right[adapterKey] : undefined
      const leftAccounts = isRecord(leftAdapter?.accounts) ? leftAdapter.accounts : undefined
      const rightAccounts = isRecord(rightAdapter?.accounts) ? rightAdapter.accounts : undefined
      const leftTombstones = normalizeAccountTombstones(leftAdapter?.accountTombstones) ?? {}
      const rightTombstones = normalizeAccountTombstones(rightAdapter?.accountTombstones) ?? {}
      const accountTombstones = mergeAccountTombstones(leftTombstones, rightTombstones)
      const accountKeys = unique([
        ...Object.keys(leftAccounts ?? {}),
        ...Object.keys(rightAccounts ?? {}),
        ...Object.keys(accountTombstones)
      ])
      const accountEntries = accountKeys.flatMap((accountKey) => {
        const leftAccount = isRecord(leftAccounts?.[accountKey]) ? leftAccounts[accountKey] : undefined
        const rightAccount = isRecord(rightAccounts?.[accountKey]) ? rightAccounts[accountKey] : undefined
        const deletedGenerations = accountTombstones[accountKey]
        const activeLeft = accountSurvivesTombstone(accountKey, leftAccount, deletedGenerations)
          ? leftAccount
          : undefined
        const activeRight = accountSurvivesTombstone(accountKey, rightAccount, deletedGenerations)
          ? rightAccount
          : undefined
        const account = activeLeft == null
          ? activeRight
          : activeRight == null
          ? activeLeft
          : mergeAccountRecords(activeLeft, activeRight, credentialTieWinner)
        if (account == null) return []
        return [[accountKey, account] as const]
      })
      const accounts = Object.fromEntries(accountEntries)
      const requestedDefault = normalizeText(rightAdapter?.defaultAccount) ??
        normalizeText(leftAdapter?.defaultAccount)
      const defaultAccount = requestedDefault != null && accounts[requestedDefault] != null
        ? requestedDefault
        : undefined
      const mergedAdapter: Record<string, unknown> = {
        ...(leftAdapter ?? {}),
        ...(rightAdapter ?? {}),
        ...(
          accountKeys.length === 0 && Object.keys(accountTombstones).length === 0
            ? {}
            : { accounts }
        )
      }
      if (defaultAccount == null) delete mergedAdapter.defaultAccount
      else mergedAdapter.defaultAccount = defaultAccount
      if (Object.keys(accountTombstones).length === 0) delete mergedAdapter.accountTombstones
      else mergedAdapter.accountTombstones = accountTombstones
      return [adapterKey, mergedAdapter]
    })
  )

export const mergeRelayConfigPatches = (
  left: RelayConfigPatch | undefined,
  right: RelayConfigPatch | undefined,
  options: { credentialTieWinner?: 'left' | 'right' } = {}
): RelayConfigPatch | undefined => {
  if (left == null) return right
  if (right == null) return left

  const merged: RelayConfigPatch = { ...left, ...right }
  if (left.modelServices != null || right.modelServices != null) {
    merged.modelServices = { ...(left.modelServices ?? {}), ...(right.modelServices ?? {}) }
  }
  if (left.adapters != null || right.adapters != null) {
    merged.adapters = mergeAdaptersField(
      left.adapters,
      right.adapters,
      options.credentialTieWinner ?? 'right'
    )
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
