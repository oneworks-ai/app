import { createHash } from 'node:crypto'

import {
  assignmentTargetsUser,
  filterRelayConfigPatch,
  hasProjectContext,
  matchesRelayConfigProject,
  normalizeRelayConfigAssignment,
  normalizeRelayConfigSafeFields
} from './config-snapshot-normalize.js'
import type {
  RelayConfigAssignment,
  RelayConfigProjectContext,
  RelayConfigSnapshot,
  RelayConfigSnapshotAssignment,
  RelayStore,
  RelayUser
} from './types.js'
import { isRecord } from './utils.js'

export * from './config-snapshot-normalize.js'

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

const hashRelayConfigSnapshot = (value: unknown) => (
  `sha256:${createHash('sha256').update(stableJsonStringify(value)).digest('hex')}`
)

const latestUpdatedAt = (store: RelayStore, assignments: RelayConfigSnapshotAssignment[]) => {
  let latest = assignments[0]?.updatedAt ?? store.createdAt
  for (const assignment of assignments) {
    if (assignment.updatedAt != null && Date.parse(assignment.updatedAt) >= Date.parse(latest)) {
      latest = assignment.updatedAt
    }
  }
  return latest
}

const snapshotAssignmentFromStore = (
  assignment: RelayConfigAssignment
): RelayConfigSnapshotAssignment | undefined => {
  if (assignment.enabled === false) return undefined

  const allowedFields = normalizeRelayConfigSafeFields(assignment.allowedFields)
  const configPatch = filterRelayConfigPatch(assignment.configPatch, allowedFields)
  if (configPatch == null) return undefined

  return {
    id: assignment.id,
    allowedFields,
    configPatch,
    enabled: true,
    ...(assignment.project == null ? {} : { project: assignment.project }),
    updatedAt: assignment.updatedAt,
    version: assignment.version
  }
}

export const createRelayConfigSnapshotForUser = (
  store: RelayStore,
  user: RelayUser,
  options: {
    projectContext?: RelayConfigProjectContext
    sourceServerId?: string
  } = {}
): RelayConfigSnapshot => {
  const shouldFilterProject = hasProjectContext(options.projectContext)
  const assignments = store.configAssignments
    .map(normalizeRelayConfigAssignment)
    .filter((assignment): assignment is RelayConfigAssignment => assignment != null)
    .filter(assignment => assignmentTargetsUser(assignment, user))
    .filter(assignment => !shouldFilterProject || matchesRelayConfigProject(assignment, options.projectContext ?? {}))
    .map(snapshotAssignmentFromStore)
    .filter((assignment): assignment is RelayConfigSnapshotAssignment => assignment != null)
  const updatedAt = latestUpdatedAt(store, assignments)
  const hash = hashRelayConfigSnapshot({
    assignments,
    updatedAt,
    userId: user.id
  })

  return {
    account: {
      email: user.email,
      id: user.id,
      name: user.name
    },
    assignments,
    hash,
    ...(options.sourceServerId == null ? {} : { sourceServerId: options.sourceServerId }),
    updatedAt,
    version: hash
  }
}
