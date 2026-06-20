/* eslint-disable max-lines -- Snapshot assembly keeps legacy assignments, profile provenance, and secret envelopes together. */
import { createHash } from 'node:crypto'

import { createRelayConfigSnapshotSecretEnvelopes, relayConfigSecretExpiresAt } from './config-secrets.js'
import {
  assignmentTargetsUser,
  filterRelayConfigPatch,
  hasProjectContext,
  matchesRelayConfigProject,
  normalizeRelayConfigAssignment,
  normalizeRelayConfigSafeFields
} from './config-snapshot-normalize.js'
import { getRelayUserTeamIds } from './teams.js'
import type {
  RelayConfigAssignment,
  RelayConfigProfile,
  RelayConfigProfileAssignment,
  RelayConfigProfileVersion,
  RelayConfigProjectContext,
  RelayConfigSnapshot,
  RelayConfigSnapshotAssignment,
  RelayDevice,
  RelayServerArgs,
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

const snapshotAssignmentForHash = (assignment: RelayConfigSnapshotAssignment) => {
  const { mustRefreshAfter: _mustRefreshAfter, secrets: _secrets, ...stableAssignment } = assignment
  return stableAssignment
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

const profileSnapshotAssignmentFromStore = (
  store: RelayStore,
  assignment: RelayConfigProfileAssignment,
  profile: RelayConfigProfile,
  version: RelayConfigProfileVersion,
  options: {
    recipientDevice?: RelayDevice
    recipientDeviceToken?: string
    serverArgs?: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>
  } = {}
): RelayConfigSnapshotAssignment | undefined => {
  if (!assignment.enabled || profile.status !== 'published') return undefined

  const configPatch = filterRelayConfigPatch(version.configPatch, version.allowedFields)
  if (configPatch == null) return undefined

  const team = store.teams.find(item => item.id === profile.teamId)
  const secretExpiresAt = relayConfigSecretExpiresAt(store)
  const secrets = createRelayConfigSnapshotSecretEnvelopes({
    args: options.serverArgs,
    expiresAt: secretExpiresAt,
    recipientDevice: options.recipientDevice,
    recipientDeviceToken: options.recipientDeviceToken,
    secretRefs: version.secretRefs,
    store,
    teamId: profile.teamId
  })
  return {
    id: assignment.id,
    allowedFields: version.allowedFields,
    configPatch,
    enabled: true,
    ...(secrets.length === 0 ? {} : { mustRefreshAfter: secretExpiresAt, secrets }),
    ...(assignment.project == null ? {} : { project: assignment.project }),
    provenance: {
      teamId: profile.teamId,
      ...(team?.name == null ? {} : { teamName: team.name }),
      profileId: profile.id,
      profileName: profile.name,
      versionId: version.id,
      version: version.version,
      assignmentId: assignment.id,
      mode: assignment.mode,
      fields: version.allowedFields
    },
    updatedAt: assignment.updatedAt ?? version.createdAt,
    version: `${profile.id}:${version.version}`
  }
}

const createProfileSnapshotAssignments = (
  store: RelayStore,
  user: RelayUser,
  options: {
    projectContext?: RelayConfigProjectContext
    recipientDevice?: RelayDevice
    recipientDeviceToken?: string
    serverArgs?: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>
    shouldFilterProject: boolean
    teamIdsForUser: string[]
  }
) =>
  store.configProfileAssignments
    .filter(assignment => assignmentTargetsUser(assignment, user, options.teamIdsForUser))
    .filter(assignment =>
      !options.shouldFilterProject || matchesRelayConfigProject(
        assignment,
        options.projectContext ?? {}
      )
    )
    .sort((left, right) =>
      left.priority - right.priority ||
      (left.updatedAt ?? left.createdAt).localeCompare(right.updatedAt ?? right.createdAt) ||
      left.id.localeCompare(right.id)
    )
    .map(assignment => {
      const profile = store.configProfiles.find(item => item.id === assignment.profileId)
      const versionId = assignment.versionId ?? profile?.activeVersionId
      const version = store.configProfileVersions.find(item => item.id === versionId)
      return profile == null || version == null || version.profileId !== profile.id
        ? undefined
        : profileSnapshotAssignmentFromStore(store, assignment, profile, version, {
          recipientDevice: options.recipientDevice,
          recipientDeviceToken: options.recipientDeviceToken,
          serverArgs: options.serverArgs
        })
    })
    .filter((assignment): assignment is RelayConfigSnapshotAssignment => assignment != null)

export const createRelayConfigSnapshotForUser = (
  store: RelayStore,
  user: RelayUser,
  options: {
    projectContext?: RelayConfigProjectContext
    recipientDevice?: RelayDevice
    recipientDeviceToken?: string
    serverArgs?: Pick<RelayServerArgs, 'adminToken' | 'dataPath' | 'deviceMetadataSecret'>
    sourceServerId?: string
  } = {}
): RelayConfigSnapshot => {
  const shouldFilterProject = hasProjectContext(options.projectContext)
  const teamIdsForUser = getRelayUserTeamIds(store, user)
  const legacyAssignments = store.configAssignments
    .map(normalizeRelayConfigAssignment)
    .filter((assignment): assignment is RelayConfigAssignment => assignment != null)
    .filter(assignment => assignmentTargetsUser(assignment, user, teamIdsForUser))
    .filter(assignment => !shouldFilterProject || matchesRelayConfigProject(assignment, options.projectContext ?? {}))
    .map(snapshotAssignmentFromStore)
    .filter((assignment): assignment is RelayConfigSnapshotAssignment => assignment != null)
  const assignments = [
    ...legacyAssignments,
    ...createProfileSnapshotAssignments(store, user, {
      projectContext: options.projectContext,
      recipientDevice: options.recipientDevice,
      recipientDeviceToken: options.recipientDeviceToken,
      serverArgs: options.serverArgs,
      shouldFilterProject,
      teamIdsForUser
    })
  ]
  const updatedAt = latestUpdatedAt(store, assignments)
  const hash = hashRelayConfigSnapshot({
    assignments: assignments.map(snapshotAssignmentForHash),
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
