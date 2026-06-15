import type {
  RelaySecretMode,
  RelayStore,
  RelayTeam,
  RelayTeamMember,
  RelayTeamPolicy,
  RelayTeamRole,
  RelayUser
} from './types.js'
import { isRecord, now } from './utils.js'

export const relayTeamRoles = [
  'owner',
  'admin',
  'editor',
  'member',
  'viewer'
] as const satisfies readonly RelayTeamRole[]

const relayTeamRoleSet = new Set<string>(relayTeamRoles)

export const relaySecretModes = ['device_encrypted', 'proxy'] as const satisfies readonly RelaySecretMode[]

const relaySecretModeSet = new Set<string>(relaySecretModes)

export const DEFAULT_RELAY_TEAM_POLICY: RelayTeamPolicy = {
  allowedSecretModes: ['device_encrypted'],
  maxAssignmentsPerProfile: 100,
  maxMembersPerTeam: 50,
  maxProfilesPerTeam: 50,
  maxSecretTtlHours: 24,
  maxTeamsPerTenant: 100,
  maxTeamsPerUser: 20,
  proxyModeEnabled: false,
  requireOwnerApprovalForSecretProfiles: false,
  selfServiceTeamCreation: true,
  teamsEnabled: true,
  tenantId: 'default'
}

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const isRelayTeamRole = (value: unknown): value is RelayTeamRole => (
  typeof value === 'string' && relayTeamRoleSet.has(value)
)

export const normalizeTeamRole = (value: unknown, fallback: RelayTeamRole = 'member'): RelayTeamRole => (
  isRelayTeamRole(value) ? value : fallback
)

export const normalizeStringList = (value: unknown): string[] | undefined => {
  if (typeof value === 'string') {
    const text = normalizeText(value)
    return text == null ? undefined : [text]
  }
  if (!Array.isArray(value)) return undefined
  const list = [...new Set(value.map(normalizeText).filter((item): item is string => item != null))]
  return list.length > 0 ? list : undefined
}

const normalizeOptionalLimit = (value: unknown, fallback: number | undefined) => {
  if (value == null || value === '') return fallback
  const limit = Number(value)
  return Number.isFinite(limit) && limit >= 0 ? Math.trunc(limit) : fallback
}

const normalizeSecretModes = (value: unknown, fallback: RelaySecretMode[]) => {
  if (Array.isArray(value)) {
    return [...new Set(value.filter((mode): mode is RelaySecretMode => relaySecretModeSet.has(mode)))]
  }
  const modes = normalizeStringList(value)
    ?.filter((mode): mode is RelaySecretMode => relaySecretModeSet.has(mode)) ?? fallback
  return [...new Set(modes)]
}

export const normalizeRelayTeamPolicy = (value: unknown): RelayTeamPolicy => {
  const policy = isRecord(value) ? value : {}
  const fallback = DEFAULT_RELAY_TEAM_POLICY
  return {
    allowedMarketplaceIds: normalizeStringList(policy.allowedMarketplaceIds),
    allowedPluginIds: normalizeStringList(policy.allowedPluginIds),
    allowedSecretModes: normalizeSecretModes(policy.allowedSecretModes, fallback.allowedSecretModes),
    allowedSkillRegistries: normalizeStringList(policy.allowedSkillRegistries),
    allowedSkillSources: normalizeStringList(policy.allowedSkillSources),
    maxAssignmentsPerProfile: normalizeOptionalLimit(
      policy.maxAssignmentsPerProfile,
      fallback.maxAssignmentsPerProfile
    ),
    maxMembersPerTeam: normalizeOptionalLimit(policy.maxMembersPerTeam, fallback.maxMembersPerTeam),
    maxProfilesPerTeam: normalizeOptionalLimit(policy.maxProfilesPerTeam, fallback.maxProfilesPerTeam),
    maxSecretTtlHours: normalizeOptionalLimit(policy.maxSecretTtlHours, fallback.maxSecretTtlHours),
    maxTeamsPerTenant: normalizeOptionalLimit(policy.maxTeamsPerTenant, fallback.maxTeamsPerTenant),
    maxTeamsPerUser: normalizeOptionalLimit(policy.maxTeamsPerUser, fallback.maxTeamsPerUser),
    proxyModeEnabled: policy.proxyModeEnabled === true,
    requireOwnerApprovalForSecretProfiles: policy.requireOwnerApprovalForSecretProfiles === true,
    selfServiceTeamCreation: policy.selfServiceTeamCreation !== false,
    teamsEnabled: policy.teamsEnabled !== false,
    tenantId: normalizeText(policy.tenantId) ?? fallback.tenantId,
    updatedAt: normalizeText(policy.updatedAt),
    updatedByUserId: normalizeText(policy.updatedByUserId)
  }
}

export const patchRelayTeamPolicy = (
  current: RelayTeamPolicy,
  patch: Record<string, unknown>,
  updatedByUserId?: string
): RelayTeamPolicy =>
  normalizeRelayTeamPolicy({
    ...current,
    ...patch,
    updatedAt: now(),
    updatedByUserId
  })

export const activeRelayTeams = (store: RelayStore): RelayTeam[] => store.teams.filter(team => team.archivedAt == null)

export const findRelayTeam = (store: RelayStore, teamId: string): RelayTeam | undefined =>
  store.teams.find(team => team.id === teamId)

export const findRelayTeamMember = (
  store: RelayStore,
  teamId: string,
  userId: string
): RelayTeamMember | undefined => store.teamMembers.find(member => member.teamId === teamId && member.userId === userId)

export const isTeamConfigConsumer = (member: RelayTeamMember) =>
  member.configEnabled !== false && member.role !== 'viewer'

export const getRelayUserTeamIds = (store: RelayStore, user: RelayUser) => {
  const activeTeamIds = new Set(activeRelayTeams(store).map(team => team.id))
  const userMemberships = store.teamMembers
    .filter(member => member.userId === user.id)
    .filter(member => activeTeamIds.size === 0 || activeTeamIds.has(member.teamId))
  const membershipTeamIds = userMemberships
    .filter(isTeamConfigConsumer)
    .map(member => member.teamId)
  const explicitTeamIds = new Set(userMemberships.map(member => member.teamId))
  const legacyTeamIds = (user.teamIds ?? []).filter(teamId => !explicitTeamIds.has(teamId))
  return [...new Set([...legacyTeamIds, ...membershipTeamIds])]
}

export const userTeamCount = (store: RelayStore, userId: string) =>
  store.teamMembers.filter(member => member.userId === userId).length

export const teamMemberCount = (store: RelayStore, teamId: string) =>
  store.teamMembers.filter(member => member.teamId === teamId).length

export const canManageRelayTeamMembers = (member: RelayTeamMember | undefined) =>
  member?.role === 'owner' || member?.role === 'admin'

export const canUpdateRelayTeam = (member: RelayTeamMember | undefined) =>
  member?.role === 'owner' || member?.role === 'admin'
