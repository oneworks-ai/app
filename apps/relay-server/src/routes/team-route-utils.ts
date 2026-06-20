/* eslint-disable max-lines -- Team route helpers centralize authorization, loading, and response mapping. */

import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import { URL } from 'node:url'

import { defaultTeamAccessGroupIds, resolveTeamMemberAccess, teamAccessGroupsForTeam } from '../access-groups.js'
import { authContextHasPermission } from '../auth/permissions.js'
import type { RelayAuthContext } from '../auth/permissions.js'
import { sendJson } from '../http.js'
import { relayPermissions } from '../permissions/index.js'
import { canManageRelayTeamMembers, canUpdateRelayTeam, findRelayTeamMember, teamMemberCount } from '../teams.js'
import type {
  RelayAccessGroup,
  RelayServerArgs,
  RelayStore,
  RelayTeam,
  RelayTeamMember,
  RelayTeamPolicy,
  RelayUser
} from '../types.js'

export const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const maxTeamAvatarImageBytes = 512 * 1024
const teamAvatarDataUrlPattern = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/iu
const base64Pattern = /^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/iu

const getBase64ByteLength = (value: string) => {
  if (value === '' || value.length % 4 !== 0 || !base64Pattern.test(value)) return 0
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

const cleanAvatarDataUrl = (text: string): string | undefined => {
  const match = teamAvatarDataUrlPattern.exec(text)
  if (match == null) return undefined
  const mimeType = match[1].toLowerCase()
  const base64 = match[2].replace(/\s/gu, '')
  const byteLength = getBase64ByteLength(base64)
  if (byteLength === 0 || byteLength > maxTeamAvatarImageBytes) return undefined
  return `data:${mimeType};base64,${base64}`
}

export const cleanAvatarUrl = (value: unknown): { ok: true; value?: string } | { error: string; ok: false } => {
  const text = cleanString(value)
  if (text === '') return { ok: true }
  const dataUrl = cleanAvatarDataUrl(text)
  if (dataUrl != null) return { ok: true, value: dataUrl }
  try {
    const url = new URL(text)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { ok: true, value: url.toString() }
    }
  } catch {
    // Invalid URLs fall through to the shared validation error below.
  }
  return { error: 'Team avatar must be an HTTP/HTTPS URL or an uploaded image up to 512 KiB.', ok: false }
}

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

export const authUserId = (auth: RelayAuthContext) =>
  auth.kind === 'session' || auth.kind === 'access-token' ? auth.user.id : undefined

const accessTokenTeamId = (auth: RelayAuthContext) => (
  auth.kind === 'access-token' && auth.accessToken.scope === 'team' ? auth.accessToken.teamId : undefined
)

export const findUserByInput = (store: RelayStore, body: Record<string, unknown>) => {
  const userId = cleanString(body.userId)
  if (userId !== '') return store.users.find(user => user.id === userId)
  const email = cleanString(body.email).toLowerCase()
  if (email !== '') return store.users.find(user => user.email.toLowerCase() === email)
  return undefined
}

export const teamMembershipForAuth = (store: RelayStore, auth: RelayAuthContext, teamId: string) => {
  const tokenTeamId = accessTokenTeamId(auth)
  if (tokenTeamId != null && tokenTeamId !== teamId) return undefined
  const userId = authUserId(auth)
  return userId == null ? undefined : findRelayTeamMember(store, teamId, userId)
}

export const teamMemberHasCapability = (
  store: Pick<RelayStore, 'teams'>,
  member: RelayTeamMember | undefined,
  capability: string
) => (
  member != null && (
    resolveTeamMemberAccess(store, member).capabilities.includes(capability) ||
    (capability === relayPermissions.relayTeamsWrite && canUpdateRelayTeam(member)) ||
    (capability === relayPermissions.relayTeamMembersWrite && canManageRelayTeamMembers(member)) ||
    (
      capability === relayPermissions.relayTeamConfigProfilesWrite &&
      (member.role === 'owner' || member.role === 'admin' || member.role === 'editor')
    )
  )
)

export const canReadTeam = (store: RelayStore, auth: RelayAuthContext, teamId: string) => (
  isAdminAuth(auth) || teamMembershipForAuth(store, auth, teamId) != null
)

export const canWriteTeam = (store: RelayStore, auth: RelayAuthContext, teamId: string) => (
  isAdminAuth(auth) ||
  teamMemberHasCapability(store, teamMembershipForAuth(store, auth, teamId), relayPermissions.relayTeamsWrite)
)

export const canWriteTeamMembers = (store: RelayStore, auth: RelayAuthContext, teamId: string) => (
  isAdminAuth(auth) ||
  teamMemberHasCapability(store, teamMembershipForAuth(store, auth, teamId), relayPermissions.relayTeamMembersWrite)
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

const teamAccessGroupMemberCount = (store: RelayStore, teamId: string, groupId: string) => (
  store.teamMembers.filter(member =>
    member.teamId === teamId && (member.groupIds ?? defaultTeamAccessGroupIds(member.role)).includes(groupId)
  ).length
)

export const serializeTeamAccessGroup = (
  store: RelayStore,
  team: RelayTeam,
  group: RelayAccessGroup
) => ({
  id: group.id,
  scope: group.scope,
  name: group.name,
  description: group.description ?? null,
  localizedDescriptions: group.localizedDescriptions ?? {},
  builtIn: group.builtIn === true,
  parentGroupId: group.parentGroupId ?? null,
  disabled: group.disabledAt != null,
  disabledAt: group.disabledAt ?? null,
  capabilities: {
    allow: group.capabilities.allow ?? [],
    deny: group.capabilities.deny ?? []
  },
  quotas: group.quotas ?? {},
  memberCount: teamAccessGroupMemberCount(store, team.id, group.id),
  createdAt: group.createdAt,
  updatedAt: group.updatedAt ?? null
})

export const serializeTeamAccessGroups = (store: RelayStore, team: RelayTeam) =>
  teamAccessGroupsForTeam(team).map(group => serializeTeamAccessGroup(store, team, group))

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
    avatarUrl: team.avatarUrl ?? null,
    accessGroups: serializeTeamAccessGroups(store, team),
    proxyModeEnabled: team.proxyModeEnabled === true,
    archivedAt: team.archivedAt ?? null,
    memberCount: teamMemberCount(store, team.id),
    membership: membership == null
      ? null
      : {
        configEnabled: membership.configEnabled !== false,
        defaultForPublishing: membership.defaultForPublishing === true,
        groupIds: membership.groupIds ?? defaultTeamAccessGroupIds(membership.role),
        role: membership.role
      },
    createdByUserId: team.createdByUserId,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt ?? null
  }
}

export const serializeTeamMember = (
  member: RelayTeamMember,
  store: RelayStore,
  user: RelayUser | undefined
) => ({
  id: member.id,
  teamId: member.teamId,
  userId: member.userId,
  avatarUrl: user?.avatarUrl ?? null,
  email: user?.email ?? null,
  name: user?.name ?? null,
  role: member.role,
  groupIds: member.groupIds ?? defaultTeamAccessGroupIds(member.role),
  effectiveAccess: resolveTeamMemberAccess(store, member),
  configEnabled: member.configEnabled !== false,
  defaultForPublishing: member.defaultForPublishing === true,
  createdByUserId: member.createdByUserId,
  createdAt: member.createdAt,
  updatedAt: member.updatedAt ?? null
})

export const visibleTeams = (store: RelayStore, auth: RelayAuthContext, adminRoute: boolean) => {
  if (adminRoute || isAdminAuth(auth)) return store.teams
  const tokenTeamId = accessTokenTeamId(auth)
  if (tokenTeamId != null) {
    return teamMembershipForAuth(store, auth, tokenTeamId) == null
      ? []
      : store.teams.filter(team => team.id === tokenTeamId)
  }
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
