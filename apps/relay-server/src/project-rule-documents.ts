import { normalizeRelayPersonalDocumentSnapshot } from './personal-config.js'
import type { RelayPersonalDocumentSnapshot, RelayProjectRuleDocumentSnapshot, RelayStore } from './types.js'
import { isRecord, now } from './utils.js'

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const normalizeRelayProjectRuleDocumentSnapshot = (
  value: unknown
): RelayProjectRuleDocumentSnapshot | undefined => {
  if (!isRecord(value)) return undefined
  const assignmentId = normalizeText(value.assignmentId)
  const teamId = normalizeText(value.teamId)
  const documents = normalizeRelayPersonalDocumentSnapshot(value)
  if (assignmentId == null || teamId == null || documents == null) return undefined
  return {
    ...documents,
    assignmentId,
    teamId,
    ...(normalizeText(value.updatedByUserId) == null
      ? {}
      : { updatedByUserId: normalizeText(value.updatedByUserId) })
  }
}

export const upsertRelayProjectRuleDocumentSnapshot = (
  store: RelayStore,
  input: {
    assignmentId: string
    documents: RelayPersonalDocumentSnapshot
    teamId: string
    updatedByUserId?: string
  }
): RelayProjectRuleDocumentSnapshot => {
  const snapshot = normalizeRelayProjectRuleDocumentSnapshot({
    ...input.documents,
    assignmentId: input.assignmentId,
    teamId: input.teamId,
    updatedAt: now(),
    updatedByUserId: input.updatedByUserId
  })
  if (snapshot == null) {
    throw new Error('Relay project rule documents require a valid assignment, team, and encrypted snapshot.')
  }

  store.projectRuleDocumentSnapshots ??= []
  const index = store.projectRuleDocumentSnapshots.findIndex(item => item.assignmentId === snapshot.assignmentId)
  if (index === -1) {
    store.projectRuleDocumentSnapshots.push(snapshot)
  } else {
    store.projectRuleDocumentSnapshots[index] = snapshot
  }
  return snapshot
}
