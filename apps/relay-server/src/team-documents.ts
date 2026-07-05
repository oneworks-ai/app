import { normalizeRelayPersonalDocumentSnapshot } from './personal-config.js'
import type { RelayPersonalDocumentSnapshot, RelayStore, RelayTeamDocumentSnapshot } from './types.js'
import { isRecord, now } from './utils.js'

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const normalizeRelayTeamDocumentSnapshot = (value: unknown): RelayTeamDocumentSnapshot | undefined => {
  if (!isRecord(value)) return undefined
  const teamId = normalizeText(value.teamId)
  if (teamId == null) return undefined
  const snapshot = normalizeRelayPersonalDocumentSnapshot(value)
  if (snapshot == null) return undefined
  return {
    ...snapshot,
    teamId,
    updatedByUserId: normalizeText(value.updatedByUserId)
  }
}

export const upsertRelayTeamDocumentSnapshot = (
  store: RelayStore,
  input: {
    documents: RelayPersonalDocumentSnapshot
    teamId: string
    updatedByUserId?: string
  }
): RelayTeamDocumentSnapshot => {
  const normalized = normalizeRelayTeamDocumentSnapshot({
    ...input.documents,
    teamId: input.teamId,
    updatedAt: input.documents.updatedAt ?? now(),
    updatedByUserId: input.updatedByUserId
  })
  if (normalized == null) {
    throw new Error('Relay team document sync requires a valid encrypted document snapshot.')
  }

  store.teamDocumentSnapshots ??= []
  const index = store.teamDocumentSnapshots.findIndex(item => item.teamId === normalized.teamId)
  if (index === -1) {
    store.teamDocumentSnapshots.push(normalized)
  } else {
    store.teamDocumentSnapshots[index] = normalized
  }
  return normalized
}
