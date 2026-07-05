import type { RelayStoredServer } from './types.js'
import { isRecord, toString } from './utils.js'

export const RELAY_PERSONAL_DOCUMENT_SYNC_KINDS = ['agents'] as const

export type RelayPersonalDocumentSyncKind = typeof RELAY_PERSONAL_DOCUMENT_SYNC_KINDS[number]

export interface RelayPersonalDocumentSyncPreferences {
  agents: boolean
}

export type RelayTeamDocumentSyncPreferences = Record<string, RelayPersonalDocumentSyncPreferences>

const relayPersonalDocumentSyncKindSet = new Set<string>(RELAY_PERSONAL_DOCUMENT_SYNC_KINDS)

export const defaultRelayPersonalDocumentSyncPreferences = (): RelayPersonalDocumentSyncPreferences => ({
  agents: false
})

export const relayPersonalDocumentSyncEnabled = (preferences: RelayPersonalDocumentSyncPreferences) => (
  preferences.agents
)

export const normalizeRelayPersonalDocumentSyncPreferences = (
  value: unknown
): RelayPersonalDocumentSyncPreferences | undefined => {
  if (!isRecord(value)) return undefined
  const preferences = {
    agents: value.agents === true
  }
  return relayPersonalDocumentSyncEnabled(preferences) ? preferences : undefined
}

export const serializeRelayPersonalDocumentSyncPreferences = (
  preferences: RelayPersonalDocumentSyncPreferences
): RelayPersonalDocumentSyncPreferences | undefined => (
  relayPersonalDocumentSyncEnabled(preferences)
    ? {
      agents: preferences.agents
    }
    : undefined
)

export const readRelayPersonalDocumentSyncPreferences = (
  storedServer: RelayStoredServer | undefined
): RelayPersonalDocumentSyncPreferences => (
  normalizeRelayPersonalDocumentSyncPreferences(storedServer?.personalDocumentSync) ??
    defaultRelayPersonalDocumentSyncPreferences()
)

export const normalizeRelayTeamDocumentSyncPreferences = (
  value: unknown
): RelayTeamDocumentSyncPreferences | undefined => {
  if (!isRecord(value)) return undefined
  const preferences = Object.fromEntries(
    Object.entries(value)
      .map(([teamId, raw]) => {
        const normalized = normalizeRelayPersonalDocumentSyncPreferences(raw)
        return normalized == null || teamId.trim() === '' ? undefined : [teamId, normalized]
      })
      .filter((entry): entry is [string, RelayPersonalDocumentSyncPreferences] => entry != null)
  )
  return Object.keys(preferences).length === 0 ? undefined : preferences
}

export const serializeRelayTeamDocumentSyncPreferences = (
  preferences: RelayTeamDocumentSyncPreferences | undefined
): RelayTeamDocumentSyncPreferences | undefined => {
  if (preferences == null) return undefined
  const serialized = Object.fromEntries(
    Object.entries(preferences)
      .map(([teamId, raw]) => {
        const normalized = normalizeRelayPersonalDocumentSyncPreferences(raw)
        return normalized == null || teamId.trim() === '' ? undefined : [teamId, normalized]
      })
      .filter((entry): entry is [string, RelayPersonalDocumentSyncPreferences] => entry != null)
  )
  return Object.keys(serialized).length === 0 ? undefined : serialized
}

export const readRelayTeamDocumentSyncPreferences = (
  storedServer: RelayStoredServer | undefined,
  teamId: string
): RelayPersonalDocumentSyncPreferences => (
  normalizeRelayTeamDocumentSyncPreferences(storedServer?.teamDocumentSync)?.[teamId] ??
    defaultRelayPersonalDocumentSyncPreferences()
)

export const readRelayPersonalDocumentSyncKind = (value: unknown): RelayPersonalDocumentSyncKind | undefined => {
  const kind = toString(value)
  return relayPersonalDocumentSyncKindSet.has(kind) ? kind as RelayPersonalDocumentSyncKind : undefined
}

export const updateRelayPersonalDocumentSyncPreference = (
  preferences: RelayPersonalDocumentSyncPreferences,
  kind: RelayPersonalDocumentSyncKind,
  enabled: boolean
): RelayPersonalDocumentSyncPreferences => ({
  ...preferences,
  [kind]: enabled
})

export const updateRelayTeamDocumentSyncPreference = (
  storedServer: RelayStoredServer | undefined,
  teamId: string,
  kind: RelayPersonalDocumentSyncKind,
  enabled: boolean
): RelayTeamDocumentSyncPreferences | undefined => {
  const current = normalizeRelayTeamDocumentSyncPreferences(storedServer?.teamDocumentSync) ?? {}
  const nextPreferences = updateRelayPersonalDocumentSyncPreference(
    readRelayTeamDocumentSyncPreferences(storedServer, teamId),
    kind,
    enabled
  )
  const next = { ...current }
  if (relayPersonalDocumentSyncEnabled(nextPreferences)) {
    next[teamId] = nextPreferences
  } else {
    delete next[teamId]
  }
  return serializeRelayTeamDocumentSyncPreferences(next)
}
