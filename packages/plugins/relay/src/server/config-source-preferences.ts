import type {
  RelayConfigAssignment,
  RelayConfigSnapshot,
  RelayConfigSnapshotProvenance
} from '../shared/config-assignment.js'

import type { RelayStore, RelayStoredServer } from './types.js'
import { isRecord, toString } from './utils.js'

export type RelayConfigSourceKind = 'assignment' | 'profile' | 'team'

export interface RelayConfigSourcePreferences {
  assignmentIds: string[]
  profileIds: string[]
  teamIds: string[]
}

const emptyPreferences = (): RelayConfigSourcePreferences => ({
  assignmentIds: [],
  profileIds: [],
  teamIds: []
})

const unique = (values: string[]) => [...new Set(values.map(item => item.trim()).filter(item => item !== ''))]

const readIdList = (value: unknown) => (
  Array.isArray(value)
    ? unique(value.map(item => toString(item)))
    : []
)

const hasPreferences = (preferences: RelayConfigSourcePreferences) =>
  preferences.assignmentIds.length > 0 || preferences.profileIds.length > 0 || preferences.teamIds.length > 0

export const normalizeRelayConfigSourcePreferences = (value: unknown): RelayConfigSourcePreferences | undefined => {
  if (!isRecord(value)) return undefined
  const preferences = {
    assignmentIds: readIdList(value.assignmentIds),
    profileIds: readIdList(value.profileIds),
    teamIds: readIdList(value.teamIds)
  }
  return hasPreferences(preferences) ? preferences : undefined
}

export const serializeRelayConfigSourcePreferences = (
  preferences: RelayConfigSourcePreferences
): RelayConfigSourcePreferences | undefined => (
  hasPreferences(preferences)
    ? {
      assignmentIds: unique(preferences.assignmentIds),
      profileIds: unique(preferences.profileIds),
      teamIds: unique(preferences.teamIds)
    }
    : undefined
)

export const readRelayConfigSourcePreferences = (
  storedServer: RelayStoredServer | undefined
): RelayConfigSourcePreferences => (
  normalizeRelayConfigSourcePreferences(storedServer?.configDisabledSources) ?? emptyPreferences()
)

const listForKind = (
  preferences: RelayConfigSourcePreferences,
  kind: RelayConfigSourceKind
) => {
  if (kind === 'assignment') return preferences.assignmentIds
  if (kind === 'profile') return preferences.profileIds
  return preferences.teamIds
}

const updateList = (values: string[], id: string, enabled: boolean) => (
  enabled
    ? unique(values).filter(item => item !== id)
    : unique([...values, id])
)

export const updateRelayConfigSourcePreference = (
  preferences: RelayConfigSourcePreferences,
  kind: RelayConfigSourceKind,
  id: string,
  enabled: boolean
): RelayConfigSourcePreferences => {
  const cleanId = id.trim()
  if (cleanId === '') return preferences
  return {
    assignmentIds: kind === 'assignment'
      ? updateList(preferences.assignmentIds, cleanId, enabled)
      : unique(preferences.assignmentIds),
    profileIds: kind === 'profile'
      ? updateList(preferences.profileIds, cleanId, enabled)
      : unique(preferences.profileIds),
    teamIds: kind === 'team'
      ? updateList(preferences.teamIds, cleanId, enabled)
      : unique(preferences.teamIds)
  }
}

export const readRelayConfigSourceKind = (value: unknown): RelayConfigSourceKind | undefined => {
  const kind = toString(value)
  if (kind === 'assignment' || kind === 'profile' || kind === 'team') return kind
  return undefined
}

export const relayConfigSourceDisabledByPreferences = (
  provenance: RelayConfigSnapshotProvenance | undefined,
  preferences: RelayConfigSourcePreferences
) => {
  if (provenance == null) return []
  const disabledBy: RelayConfigSourceKind[] = []
  if (listForKind(preferences, 'team').includes(provenance.teamId)) disabledBy.push('team')
  if (listForKind(preferences, 'profile').includes(provenance.profileId)) disabledBy.push('profile')
  if (listForKind(preferences, 'assignment').includes(provenance.assignmentId)) disabledBy.push('assignment')
  return disabledBy
}

export const relayConfigAssignmentDisabledByPreferences = (
  assignment: RelayConfigAssignment,
  preferences: RelayConfigSourcePreferences
) => relayConfigSourceDisabledByPreferences(assignment.provenance, preferences).length > 0

const sourceServerMatches = (storedServer: RelayStoredServer, sourceServerId: string) =>
  storedServer.id === sourceServerId || storedServer.remoteBaseUrl === sourceServerId

export const findStoredServerForConfigSnapshot = (
  store: RelayStore,
  snapshot: Pick<RelayConfigSnapshot, 'sourceServerId'> | undefined
) => {
  const sourceServerId = toString(snapshot?.sourceServerId)
  if (sourceServerId !== '') {
    return store.servers[sourceServerId] ??
      Object.values(store.servers).find(storedServer => sourceServerMatches(storedServer, sourceServerId))
  }
  const servers = Object.values(store.servers)
  return servers.length === 1 ? servers[0] : undefined
}

export const readRelayConfigSourcePreferencesForSnapshot = (
  store: RelayStore,
  snapshot: Pick<RelayConfigSnapshot, 'sourceServerId'> | undefined
) => readRelayConfigSourcePreferences(findStoredServerForConfigSnapshot(store, snapshot))

export const filterRelayConfigSnapshotByPreferences = (
  snapshot: RelayConfigSnapshot,
  preferences: RelayConfigSourcePreferences
): RelayConfigSnapshot => ({
  ...snapshot,
  assignments: (snapshot.assignments ?? []).filter(assignment =>
    !relayConfigAssignmentDisabledByPreferences(assignment, preferences)
  )
})
