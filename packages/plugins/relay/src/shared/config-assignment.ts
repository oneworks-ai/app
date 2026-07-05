import {
  filterRelayConfigPatch,
  isRecord,
  mergeRelayConfigPatches,
  normalizeRelayConfigStringList,
  normalizeRelayTeamConfigSafeFields,
  unique
} from './config-assignment-patch.js'
import { matchesRelayConfigProject } from './config-assignment-project.js'
import type {
  RelayConfigAssignment,
  RelayConfigPatch,
  RelayConfigProjectContext,
  RelayConfigSafeField,
  RelayConfigSnapshot,
  RelayResolvedConfigPatch
} from './config-assignment-types.js'

export * from './config-assignment-patch.js'
export * from './config-assignment-project.js'
export * from './config-assignment-types.js'

const getRuleEntries = (snapshot: RelayConfigSnapshot | undefined) => (
  new Map(
    (snapshot?.rules ?? [])
      .filter(rule => rule.id !== '')
      .map(rule => [rule.id, rule] as const)
  )
)

const getInlineRules = (assignment: RelayConfigAssignment) => (
  Array.isArray(assignment.rules)
    ? assignment.rules.filter((rule): rule is RelayConfigAssignment => isRecord(rule))
    : []
)

const getRuleIds = (assignment: RelayConfigAssignment) => [
  ...(normalizeRelayConfigStringList(assignment.ruleIds) ?? []),
  ...(Array.isArray(assignment.rules)
    ? assignment.rules.filter((rule): rule is string => typeof rule === 'string')
    : [])
]

const getReferencedRules = (
  assignment: RelayConfigAssignment,
  rulesById: Map<string, RelayConfigAssignment>
) => [
  ...getInlineRules(assignment),
  ...getRuleIds(assignment)
    .map(ruleId => rulesById.get(ruleId))
    .filter((rule): rule is RelayConfigAssignment => rule != null)
]

const assignmentSecretExpiry = (assignment: RelayConfigAssignment) => {
  const expiries = [
    assignment.mustRefreshAfter,
    ...(assignment.secrets ?? []).map(secret => secret.expiresAt)
  ].filter((value): value is string => typeof value === 'string' && value.trim() !== '')
  const timestamps = expiries
    .map(value => Date.parse(value))
    .filter(value => Number.isFinite(value))
  return timestamps.length === 0 ? undefined : Math.min(...timestamps)
}

const isExpiredSecretBearingAssignment = (assignment: RelayConfigAssignment) => {
  const expiry = assignmentSecretExpiry(assignment)
  return expiry != null && expiry <= Date.now()
}

const applyAssignmentPatch = (
  params: {
    allowedFields: RelayConfigSafeField[]
    assignment: RelayConfigAssignment
    context: RelayConfigProjectContext
    matchedAssignmentIds: string[]
    patch: RelayConfigPatch | undefined
  }
) => {
  if (params.assignment.enabled === false) return params.patch
  if (isExpiredSecretBearingAssignment(params.assignment)) return params.patch
  if (!matchesRelayConfigProject(params.assignment, params.context)) return params.patch

  const assignmentAllowedFields = normalizeRelayTeamConfigSafeFields(params.assignment.allowedFields)
  const nextPatch = filterRelayConfigPatch(params.assignment.configPatch, assignmentAllowedFields)
  if (nextPatch == null) return params.patch

  params.allowedFields.push(...assignmentAllowedFields)
  params.matchedAssignmentIds.push(params.assignment.id)
  return mergeRelayConfigPatches(params.patch, nextPatch)
}

const applyAssignments = (
  params: {
    allowedFields: RelayConfigSafeField[]
    assignments: RelayConfigAssignment[]
    context: RelayConfigProjectContext
    matchedAssignmentIds: string[]
    patch: RelayConfigPatch | undefined
    rulesById: Map<string, RelayConfigAssignment>
  }
) => {
  let patch = params.patch
  for (const assignment of params.assignments) {
    patch = applyAssignmentPatch({ ...params, assignment, patch })
    for (const rule of getReferencedRules(assignment, params.rulesById)) {
      patch = applyAssignmentPatch({ ...params, assignment: rule, patch })
    }
  }
  return patch
}

export const resolveRelayConfigPatchForProject = (
  snapshot: RelayConfigSnapshot | undefined,
  context: RelayConfigProjectContext
): RelayResolvedConfigPatch => {
  const matchedAssignmentIds: string[] = []
  const allowedFields: RelayConfigSafeField[] = []
  const rulesById = getRuleEntries(snapshot)
  const assignments = snapshot?.assignments ?? []
  const fallbackRules = assignments.length === 0 ? snapshot?.rules ?? [] : []
  const patch = applyAssignments({
    allowedFields,
    assignments: assignments.length > 0 ? assignments : fallbackRules,
    context,
    matchedAssignmentIds,
    patch: undefined,
    rulesById
  })

  return {
    allowedFields: unique(allowedFields),
    matchedAssignmentIds,
    patch
  }
}
