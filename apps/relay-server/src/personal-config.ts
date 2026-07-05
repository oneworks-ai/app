/* eslint-disable max-lines -- personal config sync keeps request normalization and persisted config state together. */
import { createHash } from 'node:crypto'

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

const mergeCodexAdapters = (
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
) => {
  const leftCodex = isRecord(left?.codex) ? left.codex : undefined
  const rightCodex = isRecord(right?.codex) ? right.codex : undefined
  const leftAccounts = isRecord(leftCodex?.accounts) ? leftCodex.accounts : undefined
  const rightAccounts = isRecord(rightCodex?.accounts) ? rightCodex.accounts : undefined

  if (leftCodex == null && rightCodex == null) return mergeRecord(left, right)
  return {
    ...mergeRecord(left, right),
    codex: {
      ...(leftCodex ?? {}),
      ...(rightCodex ?? {}),
      ...(leftAccounts == null && rightAccounts == null
        ? {}
        : { accounts: { ...(leftAccounts ?? {}), ...(rightAccounts ?? {}) } })
    }
  }
}

export const mergeRelayPersonalConfigPatches = (
  left: RelayConfigPatch | undefined,
  right: RelayConfigPatch | undefined
): RelayConfigPatch | undefined => {
  if (left == null) return right
  if (right == null) return left

  const merged: RelayConfigPatch = { ...left, ...right }
  if (left.adapters != null || right.adapters != null) {
    merged.adapters = mergeCodexAdapters(
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
    agents: normalizeNonNegativeInteger(counts.agents) ?? 0
  }
}

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
    countsByKind.agents
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
