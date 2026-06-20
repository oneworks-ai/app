import { createHash } from 'node:crypto'

import {
  filterRelayConfigPatch,
  normalizeRelayConfigProjectRule,
  normalizeRelayConfigSafeFields,
  normalizeRelayConfigTarget
} from './config-snapshot-normalize.js'
import type {
  RelayConfigAssignmentMode,
  RelayConfigPatch,
  RelayConfigProfile,
  RelayConfigProfileAssignment,
  RelayConfigProfileStatus,
  RelayConfigProfileVersion
} from './types.js'
import { isRecord, now } from './utils.js'

const profileStatuses = new Set<RelayConfigProfileStatus>(['draft', 'published', 'disabled'])
const assignmentModes = new Set<RelayConfigAssignmentMode>(['default', 'override'])

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const stableJsonStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value)
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`).join(',')}}`
}

export const hashRelayConfigProfileSource = (value: unknown) =>
  `sha256:${createHash('sha256').update(stableJsonStringify(value)).digest('hex')}`

const normalizeSecretRefs = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => entry[0].trim() !== '' && typeof entry[1] === 'string')
    .map(([key, item]) => [key.trim(), item.trim()] as const)
    .filter(([, item]) => item !== '')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

export const normalizeRelayConfigProfile = (value: unknown): RelayConfigProfile | undefined => {
  if (!isRecord(value)) return undefined
  const id = normalizeText(value.id)
  const teamId = normalizeText(value.teamId)
  if (id == null || teamId == null) return undefined
  const status = typeof value.status === 'string' && profileStatuses.has(value.status as RelayConfigProfileStatus)
    ? value.status as RelayConfigProfileStatus
    : 'draft'
  return {
    id,
    teamId,
    name: normalizeText(value.name) ?? id,
    description: normalizeText(value.description),
    status,
    activeVersionId: normalizeText(value.activeVersionId),
    createdByUserId: normalizeText(value.createdByUserId) ?? 'system',
    updatedByUserId: normalizeText(value.updatedByUserId),
    createdAt: normalizeText(value.createdAt) ?? now(),
    updatedAt: normalizeText(value.updatedAt)
  }
}

export const normalizeRelayConfigProfileVersion = (value: unknown): RelayConfigProfileVersion | undefined => {
  if (!isRecord(value)) return undefined
  const id = normalizeText(value.id)
  const profileId = normalizeText(value.profileId)
  if (id == null || profileId == null) return undefined
  const allowedFields = normalizeRelayConfigSafeFields(value.allowedFields)
  const configPatch = filterRelayConfigPatch(value.configPatch as RelayConfigPatch | undefined, allowedFields)
  if (configPatch == null) return undefined
  const sourceHash = normalizeText(value.sourceHash) ?? hashRelayConfigProfileSource({ allowedFields, configPatch })
  return {
    id,
    profileId,
    version: Number.isFinite(Number(value.version)) ? Math.max(1, Math.trunc(Number(value.version))) : 1,
    allowedFields,
    configPatch,
    secretRefs: normalizeSecretRefs(value.secretRefs),
    sourceHash,
    createdByUserId: normalizeText(value.createdByUserId) ?? 'system',
    changeNote: normalizeText(value.changeNote),
    createdAt: normalizeText(value.createdAt) ?? now()
  }
}

export const normalizeRelayConfigProfileAssignment = (value: unknown): RelayConfigProfileAssignment | undefined => {
  if (!isRecord(value)) return undefined
  const id = normalizeText(value.id)
  const profileId = normalizeText(value.profileId)
  if (id == null || profileId == null) return undefined
  const mode = typeof value.mode === 'string' && assignmentModes.has(value.mode as RelayConfigAssignmentMode)
    ? value.mode as RelayConfigAssignmentMode
    : 'default'
  return {
    id,
    profileId,
    versionId: normalizeText(value.versionId),
    priority: Number.isFinite(Number(value.priority)) ? Math.trunc(Number(value.priority)) : 100,
    target: normalizeRelayConfigTarget(value.target),
    project: normalizeRelayConfigProjectRule(value.project),
    mode,
    enabled: value.enabled !== false,
    createdAt: normalizeText(value.createdAt) ?? now(),
    updatedAt: normalizeText(value.updatedAt)
  }
}

export const nextConfigProfileVersionNumber = (
  versions: RelayConfigProfileVersion[],
  profileId: string
) => Math.max(0, ...versions.filter(version => version.profileId === profileId).map(version => version.version)) + 1
