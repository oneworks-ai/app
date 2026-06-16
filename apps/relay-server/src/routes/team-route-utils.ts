import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'

import { authContextHasPermission } from '../auth/permissions.js'
import type { RelayAuthContext } from '../auth/permissions.js'
import { sendJson } from '../http.js'
import { relayPermissions } from '../permissions/index.js'
import { canManageRelayTeamMembers, canUpdateRelayTeam, findRelayTeamMember, teamMemberCount } from '../teams.js'
import type { RelayServerArgs, RelayStore, RelayTeam, RelayTeamMember, RelayTeamPolicy, RelayUser } from '../types.js'

export const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export const firstCleanString = (...values: unknown[]) => {
  for (const value of values) {
    const text = cleanString(value)
    if (text !== '') return text
  }
  return ''
}

export const cleanSlug = (value: unknown, fallback: string) => {
  const source = cleanString(value) !== '' ? cleanString(value) : fallback
  const slug = source.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  return slug === '' ? randomUUID() : slug
}

export const pathId = (url: URL, prefix: string) => {
  if (url.pathname === prefix) return undefined
  const escaped = url.pathname.slice(prefix.length + 1)
  return escaped === '' ? undefined : decodeURIComponent(escaped)
}

export const isAdminAuth = (auth: RelayAuthContext) => (
  auth.kind === 'admin-token' || authContextHasPermission(auth, relayPermissions.adminSettingsWrite)
)

export const authUserId = (auth: RelayAuthContext) => auth.kind === 'session' ? auth.user.id : undefined

export const findUserByInput = (store: RelayStore, body: Record<string, unknown>) => {
  const userId = cleanString(body.userId)
  if (userId !== '') return store.users.find(user => user.id === userId)
  const email = cleanString(body.email).toLowerCase()
  if (email !== '') return store.users.find(user => user.email.toLowerCase() === email)
  return undefined
}

export const teamMembershipForAuth = (store: RelayStore, auth: RelayAuthContext, teamId: string) => {
  const userId = authUserId(auth)
  return userId == null ? undefined : findRelayTeamMember(store, teamId, userId)
}

export const canReadTeam = (store: RelayStore, auth: RelayAuthContext, teamId: string) => (
  isAdminAuth(auth) || teamMembershipForAuth(store, auth, teamId) != null
)

export const canWriteTeam = (store: RelayStore, auth: RelayAuthContext, teamId: string) => (
  isAdminAuth(auth) || canUpdateRelayTeam(teamMembershipForAuth(store, auth, teamId))
)

export const canWriteTeamMembers = (store: RelayStore, auth: RelayAuthContext, teamId: string) => (
  isAdminAuth(auth) || canManageRelayTeamMembers(teamMembershipForAuth(store, auth, teamId))
)

export const serializePolicy = (policy: RelayTeamPolicy) => ({
  allowedMarketplaceIds: policy.allowedMarketplaceIds ?? [],
  allowedPluginIds: policy.allowedPluginIds ?? [],
  allowedSecretModes: policy.allowedSecretModes,
  allowedSkillRegistries: policy.allowedSkillRegistries ?? [],
  allowedSkillSources: policy.allowedSkillSources ?? [],
  maxAssignmentsPerProfile: policy.maxAssignmentsPerProfile ?? null,
  maxMembersPerTeam: policy.maxMembersPerTeam ?? null,
  maxProfilesPerTeam: policy.maxProfilesPerTeam ?? null,
  maxSecretTtlHours: policy.maxSecretTtlHours ?? null,
  maxTeamsPerTenant: policy.maxTeamsPerTenant ?? null,
  maxTeamsPerUser: policy.maxTeamsPerUser ?? null,
  proxyModeEnabled: policy.proxyModeEnabled,
  requireOwnerApprovalForSecretProfiles: policy.requireOwnerApprovalForSecretProfiles === true,
  selfServiceTeamCreation: policy.selfServiceTeamCreation,
  teamsEnabled: policy.teamsEnabled,
  tenantId: policy.tenantId,
  updatedAt: policy.updatedAt ?? null,
  updatedByUserId: policy.updatedByUserId ?? null
})

export const serializeTeam = (
  team: RelayTeam,
  store: RelayStore,
  userId?: string
) => {
  const membership = userId == null ? undefined : findRelayTeamMember(store, team.id, userId)
  return {
    id: team.id,
    slug: team.slug,
    name: team.name,
    description: team.description ?? null,
    proxyModeEnabled: team.proxyModeEnabled === true,
    archivedAt: team.archivedAt ?? null,
    memberCount: teamMemberCount(store, team.id),
    membership: membership == null
      ? null
      : {
        configEnabled: membership.configEnabled !== false,
        defaultForPublishing: membership.defaultForPublishing === true,
        role: membership.role
      },
    createdByUserId: team.createdByUserId,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt ?? null
  }
}

export const serializeTeamMember = (member: RelayTeamMember, user: RelayUser | undefined) => ({
  id: member.id,
  teamId: member.teamId,
  userId: member.userId,
  email: user?.email ?? null,
  name: user?.name ?? null,
  role: member.role,
  configEnabled: member.configEnabled !== false,
  defaultForPublishing: member.defaultForPublishing === true,
  createdByUserId: member.createdByUserId,
  createdAt: member.createdAt,
  updatedAt: member.updatedAt ?? null
})

export const visibleTeams = (store: RelayStore, auth: RelayAuthContext, adminRoute: boolean) => {
  if (adminRoute || isAdminAuth(auth)) return store.teams
  const userId = authUserId(auth)
  if (userId == null) return []
  const teamIds = new Set(store.teamMembers.filter(member => member.userId === userId).map(member => member.teamId))
  return store.teams.filter(team => teamIds.has(team.id))
}

export const policyLimitExceeded = (limit: number | undefined, count: number) => limit != null && count >= limit

export const isLastTeamOwner = (store: RelayStore, member: RelayTeamMember) => (
  member.role === 'owner' &&
  store.teamMembers.filter(item => item.teamId === member.teamId && item.role === 'owner').length <= 1
)

export const ensureTeamsWritable = (
  res: ServerResponse,
  args: RelayServerArgs,
  policy: RelayTeamPolicy
) => {
  if (!policy.teamsEnabled) {
    sendJson(res, 403, { error: 'Team sharing is disabled by tenant policy.' }, args.allowOrigin)
    return false
  }
  return true
}
