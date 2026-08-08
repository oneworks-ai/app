/* eslint-disable max-lines -- personal config sync keeps request normalization and persisted config state together. */
import { createHash } from 'node:crypto'

import { compareCredentialRevisions } from '@oneworks/types/credential-revision'

import { filterRelayConfigPatch, normalizeRelayConfigSafeFields } from './config-snapshot-normalize.js'
import type {
  RelayConfigPatch,
  RelayConfigSafeField,
  RelayEncryptedPayload,
  RelayPersonalConfigSnapshot,
  RelayPersonalDocumentCounts,
  RelayPersonalDocumentSnapshot,
  RelayStore
} from './types.js'
import { isRecord, now } from './utils.js'

const stableJsonStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(',')}]`
  }
  if (!isRecord(value)) {
    return JSON.stringify(value)
  }

  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`).join(',')}}`
}

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const mergeRecord = (
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
) => ({ ...(left ?? {}), ...(right ?? {}) })

const normalizeAccountTombstones = (value: unknown): Record<string, string[]> => {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, rawGenerations]) => {
      const normalizedKey = normalizeText(key)
      const candidates = Array.isArray(rawGenerations) ? rawGenerations : [rawGenerations]
      const generations = [
        ...new Set(candidates.flatMap((generation) => {
          const normalized = normalizeText(generation)
          return normalized == null ? [] : [normalized]
        }))
      ]
      return normalizedKey == null || generations.length === 0
        ? []
        : [[normalizedKey, generations] as const]
    })
  )
}

const mergeAccountTombstones = (
  left: Record<string, string[]>,
  right: Record<string, string[]>
) =>
  Object.fromEntries(
    [...new Set([...Object.keys(left), ...Object.keys(right)])].map(key => [
      key,
      [...new Set([...(left[key] ?? []), ...(right[key] ?? [])])]
    ])
  )

const accountSurvivesTombstone = (
  accountKey: string,
  account: Record<string, unknown> | undefined,
  deletedGenerations: string[] | undefined
) => {
  const generation = normalizeText(account?.generation) ?? `legacy:${accountKey}`
  return account != null && deletedGenerations?.includes(generation) !== true
}

const mergeAccountRecords = (
  left: Record<string, unknown>,
  right: Record<string, unknown>
) => {
  const leftGeneration = normalizeText(left.generation)
  const rightGeneration = normalizeText(right.generation)
  if (leftGeneration !== rightGeneration) {
    if (leftGeneration == null) return { ...right }
    if (rightGeneration == null) return { ...left }
    return leftGeneration.localeCompare(rightGeneration) > 0 ? { ...left } : { ...right }
  }
  const leftUpdatedAt = typeof left.updatedAt === 'number' && Number.isFinite(left.updatedAt) ? left.updatedAt : -1
  const rightUpdatedAt = typeof right.updatedAt === 'number' && Number.isFinite(right.updatedAt) ? right.updatedAt : -1
  const metadataWinner = leftUpdatedAt > rightUpdatedAt ? left : right
  const metadataLoser = metadataWinner === left ? right : left
  const merged: Record<string, unknown> = { ...metadataLoser, ...metadataWinner }

  const credentialComparison = compareCredentialRevisions(left.credentialRevision, right.credentialRevision)
  const leftAuth = isRecord(left.auth) ? left.auth : undefined
  const rightAuth = isRecord(right.auth) ? right.auth : undefined
  let credentialWinner = credentialComparison >= 0 ? left : right
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

const mergeAccountAdapters = (
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
) =>
  Object.fromEntries(
    [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].map((adapterKey) => {
      const leftAdapter = isRecord(left?.[adapterKey]) ? left[adapterKey] : undefined
      const rightAdapter = isRecord(right?.[adapterKey]) ? right[adapterKey] : undefined
      const leftAccounts = isRecord(leftAdapter?.accounts) ? leftAdapter.accounts : undefined
      const rightAccounts = isRecord(rightAdapter?.accounts) ? rightAdapter.accounts : undefined
      const leftTombstones = normalizeAccountTombstones(leftAdapter?.accountTombstones)
      const rightTombstones = normalizeAccountTombstones(rightAdapter?.accountTombstones)
      const accountTombstones = mergeAccountTombstones(leftTombstones, rightTombstones)
      const accountKeys = [
        ...new Set([
          ...Object.keys(leftAccounts ?? {}),
          ...Object.keys(rightAccounts ?? {}),
          ...Object.keys(accountTombstones)
        ])
      ]
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
          : mergeAccountRecords(activeLeft, activeRight)
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

export const mergeRelayPersonalConfigPatches = (
  left: RelayConfigPatch | undefined,
  right: RelayConfigPatch | undefined
): RelayConfigPatch | undefined => {
  if (left == null) return right
  if (right == null) return left

  const merged: RelayConfigPatch = { ...left, ...right }
  if (left.adapters != null || right.adapters != null) {
    merged.adapters = mergeAccountAdapters(
      isRecord(left.adapters) ? left.adapters : undefined,
      isRecord(right.adapters) ? right.adapters : undefined
    )
  }
  if (left.modelServices != null || right.modelServices != null) {
    merged.modelServices = mergeRecord(left.modelServices, right.modelServices)
  }
  if (left.marketplaces != null || right.marketplaces != null) {
    merged.marketplaces = mergeRecord(left.marketplaces, right.marketplaces)
  }
  if (left.skillsMeta != null || right.skillsMeta != null) {
    merged.skillsMeta = mergeRecord(left.skillsMeta, right.skillsMeta)
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

export const hashRelayPersonalConfigSnapshot = (value: {
  allowedFields: RelayConfigSafeField[]
  configPatch?: RelayConfigPatch
  documents?: RelayPersonalDocumentSnapshot
  userId: string
}) => (
  `sha256:${createHash('sha256').update(stableJsonStringify(value)).digest('hex')}`
)

const normalizeNonNegativeInteger = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
)

const normalizeEncryptedPayload = (value: unknown): RelayEncryptedPayload | undefined => {
  if (!isRecord(value)) return undefined
  const algorithm = normalizeText(value.algorithm)
  const ciphertext = normalizeText(value.ciphertext)
  const iv = normalizeText(value.iv)
  const tag = normalizeText(value.tag)
  const version = value.version === 1 || value.version === '1' ? 1 as const : undefined
  if (algorithm !== 'aes-256-gcm' || ciphertext == null || iv == null || tag == null || version !== 1) {
    return undefined
  }
  return {
    algorithm,
    ciphertext,
    iv,
    tag,
    version
  }
}

const normalizeRelayPersonalDocumentCounts = (value: unknown): RelayPersonalDocumentCounts => {
  const counts = isRecord(value) ? value : {}
  return {
    agents: normalizeNonNegativeInteger(counts.agents) ?? 0,
    ooAgents: normalizeNonNegativeInteger(counts.ooAgents) ?? 0,
    ooRules: normalizeNonNegativeInteger(counts.ooRules) ?? 0
  }
}

const countRelayPersonalDocuments = (counts: RelayPersonalDocumentCounts) =>
  counts.agents + counts.ooAgents + counts.ooRules

const hashRelayPersonalDocumentSnapshot = (value: Omit<RelayPersonalDocumentSnapshot, 'hash' | 'updatedAt'>) => (
  `sha256:${createHash('sha256').update(stableJsonStringify(value)).digest('hex')}`
)

export const normalizeRelayPersonalDocumentSnapshot = (
  value: unknown
): RelayPersonalDocumentSnapshot | undefined => {
  if (!isRecord(value)) return undefined
  const encryptedPayload = normalizeEncryptedPayload(value.encryptedPayload)
  if (encryptedPayload == null) return undefined
  const countsByKind = normalizeRelayPersonalDocumentCounts(value.countsByKind)
  const documentCount = normalizeNonNegativeInteger(value.documentCount) ??
    countRelayPersonalDocuments(countsByKind)
  const totalSizeBytes = normalizeNonNegativeInteger(value.totalSizeBytes) ?? 0
  const version = value.version === 1 || value.version === '1' ? 1 : undefined
  if (version !== 1) return undefined
  const hashInput: Omit<RelayPersonalDocumentSnapshot, 'hash' | 'updatedAt'> = {
    countsByKind,
    documentCount,
    encryptedPayload,
    totalSizeBytes,
    version
  }
  return {
    ...hashInput,
    hash: hashRelayPersonalDocumentSnapshot(hashInput),
    updatedAt: normalizeText(value.updatedAt) ?? now()
  }
}

export const normalizeRelayPersonalConfigSnapshot = (
  value: unknown
): RelayPersonalConfigSnapshot | undefined => {
  if (!isRecord(value)) return undefined
  const userId = normalizeText(value.userId)
  if (userId == null) return undefined
  const allowedFields = normalizeRelayConfigSafeFields(value.allowedFields)
  const configPatch = filterRelayConfigPatch(value.configPatch as RelayConfigPatch | undefined, allowedFields)
  const documents = normalizeRelayPersonalDocumentSnapshot(value.documents)
  if (configPatch == null && documents == null) return undefined
  const hash = hashRelayPersonalConfigSnapshot({ allowedFields, configPatch, documents, userId })
  const updatedAt = normalizeText(value.updatedAt) ?? now()
  return {
    allowedFields,
    ...(configPatch == null ? {} : { configPatch }),
    ...(documents == null ? {} : { documents }),
    hash,
    ...(normalizeText(value.sourceDeviceId) == null ? {} : { sourceDeviceId: normalizeText(value.sourceDeviceId) }),
    updatedAt,
    userId,
    version: normalizeText(value.version) ?? hash
  }
}

export const upsertRelayPersonalConfigSnapshot = (
  store: RelayStore,
  input: {
    allowedFields?: RelayConfigSafeField[]
    configPatch?: RelayConfigPatch
    documents?: RelayPersonalDocumentSnapshot
    sourceDeviceId?: string
    updatedAt?: string
    userId: string
  }
): RelayPersonalConfigSnapshot => {
  const allowedFields = normalizeRelayConfigSafeFields(input.allowedFields)
  const normalized = normalizeRelayPersonalConfigSnapshot({
    allowedFields,
    configPatch: input.configPatch,
    documents: input.documents,
    sourceDeviceId: input.sourceDeviceId,
    updatedAt: input.updatedAt ?? now(),
    userId: input.userId
  })
  if (normalized == null) {
    throw new Error('Relay personal config requires a safe config patch or encrypted document snapshot.')
  }

  store.personalConfigSnapshots ??= []
  const index = store.personalConfigSnapshots.findIndex(item => item.userId === normalized.userId)
  if (index === -1) {
    store.personalConfigSnapshots.push(normalized)
  } else {
    store.personalConfigSnapshots[index] = normalized
  }
  return normalized
}
