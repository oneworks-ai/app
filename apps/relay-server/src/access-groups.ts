/* eslint-disable max-lines -- Access group normalization and effective-access helpers share one domain module. */

import { relayPermissionList, relayPermissions } from './permissions/index.js'
import { rolePermissionMatrix } from './permissions/roles.js'
import { normalizeTeamRole } from './teams.js'
import type {
  RelayAccessGroup,
  RelayAccessGroupScope,
  RelayAccessToken,
  RelayEffectiveAccess,
  RelayEffectiveAccessSource,
  RelayRole,
  RelayStore,
  RelayTeam,
  RelayTeamMember,
  RelayTeamRole,
  RelayUser
} from './types.js'
import { isRecord, normalizeRole, now } from './utils.js'

const systemCreatedAt = '1970-01-01T00:00:00.000Z'

export const platformAccessGroupIdForRole = (role: RelayRole) => `platform:${role}`

export const teamAccessGroupIdForRole = (role: RelayTeamRole) => `team:${role}`

export const defaultPlatformAccessGroupIds = (role: unknown) => [
  platformAccessGroupIdForRole(normalizeRole(role, 'member'))
]

export const defaultTeamAccessGroupIds = (role: unknown) => [teamAccessGroupIdForRole(normalizeTeamRole(role))]

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeStringArray = (value: unknown) => (
  Array.isArray(value)
    ? [...new Set(value.map(normalizeString).filter((item): item is string => item != null))]
    : undefined
)

const normalizeQuotaValue = (value: unknown) => {
  if (value == null || value === '') return null
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : undefined
}

const normalizeQuotas = (value: unknown): Record<string, number | null> | undefined => {
  if (!isRecord(value)) return undefined
  const quotas: Record<string, number | null> = {}
  for (const [key, rawValue] of Object.entries(value)) {
    const quotaValue = normalizeQuotaValue(rawValue)
    if (quotaValue !== undefined) quotas[key] = quotaValue
  }
  return Object.keys(quotas).length === 0 ? undefined : quotas
}

const normalizeCapabilities = (value: unknown) => {
  const record = isRecord(value) ? value : {}
  return {
    allow: normalizeStringArray(record.allow) ?? [],
    deny: normalizeStringArray(record.deny) ?? []
  }
}

const normalizeLocalizedTextMap = (value: unknown) => {
  if (!isRecord(value)) return undefined
  const localizedText: Record<string, string> = {}
  for (const [rawLocale, rawText] of Object.entries(value)) {
    const locale = normalizeString(rawLocale)
    const text = normalizeString(rawText)
    if (locale != null && text != null) localizedText[locale] = text
  }
  return Object.keys(localizedText).length === 0 ? undefined : localizedText
}

export const defaultRelayAccessGroups = (): RelayAccessGroup[] => [
  {
    id: platformAccessGroupIdForRole('owner'),
    scope: 'platform',
    name: 'Owner',
    localizedNames: {
      'zh-Hans': '平台所有者',
      en: 'Owner'
    },
    description: '平台最高权限内置用户组。',
    localizedDescriptions: {
      'zh-Hans': '平台最高权限内置用户组。',
      en: 'Built-in group with the highest platform permissions.'
    },
    builtIn: true,
    capabilities: { allow: [...relayPermissionList] },
    quotas: {
      maxDevices: null,
      maxMembersPerOwnedTeam: null,
      maxTeamsJoined: null,
      maxTeamsOwned: null
    },
    createdAt: systemCreatedAt
  },
  {
    id: platformAccessGroupIdForRole('admin'),
    scope: 'platform',
    name: 'Admin',
    localizedNames: {
      'zh-Hans': '平台管理员',
      en: 'Admin'
    },
    description: '平台管理内置用户组。',
    localizedDescriptions: {
      'zh-Hans': '平台管理内置用户组。',
      en: 'Built-in group for platform administration.'
    },
    builtIn: true,
    capabilities: { allow: [...relayPermissionList] },
    quotas: {
      maxDevices: null,
      maxMembersPerOwnedTeam: null,
      maxTeamsJoined: null,
      maxTeamsOwned: null
    },
    createdAt: systemCreatedAt
  },
  {
    id: platformAccessGroupIdForRole('member'),
    scope: 'platform',
    name: 'Member',
    localizedNames: {
      'zh-Hans': '普通用户',
      en: 'Member'
    },
    description: '普通已登录用户默认用户组。',
    localizedDescriptions: {
      'zh-Hans': '普通已登录用户默认用户组。',
      en: 'Default group for signed-in users.'
    },
    builtIn: true,
    capabilities: { allow: [...rolePermissionMatrix.member] },
    quotas: {
      maxDevices: null,
      maxTeamsJoined: 20,
      maxTeamsOwned: 20
    },
    createdAt: systemCreatedAt
  },
  {
    id: platformAccessGroupIdForRole('viewer'),
    scope: 'platform',
    name: 'Viewer',
    localizedNames: {
      'zh-Hans': '只读用户',
      en: 'Viewer'
    },
    description: '只读访问内置用户组。',
    localizedDescriptions: {
      'zh-Hans': '只读访问内置用户组。',
      en: 'Built-in read-only access group.'
    },
    builtIn: true,
    capabilities: { allow: [...rolePermissionMatrix.viewer] },
    quotas: {
      maxDevices: null,
      maxTeamsJoined: 20,
      maxTeamsOwned: 0
    },
    createdAt: systemCreatedAt
  }
]

export const defaultRelayTeamAccessGroups = (): RelayAccessGroup[] => [
  {
    id: teamAccessGroupIdForRole('owner'),
    scope: 'team',
    name: '团队所有者',
    localizedNames: {
      'zh-Hans': '团队所有者',
      en: 'Team Owner'
    },
    description: '当前团队内最高权限成员组。',
    localizedDescriptions: {
      'zh-Hans': '当前团队内最高权限成员组。',
      en: 'Highest-privilege member group in the current team.'
    },
    builtIn: true,
    capabilities: {
      allow: [
        relayPermissions.relayTeamMembersRead,
        relayPermissions.relayTeamMembersWrite,
        relayPermissions.relayTeamsRead,
        relayPermissions.relayTeamsWrite,
        relayPermissions.relayTeamAuditRead,
        relayPermissions.relayTeamConfigProfilesRead,
        relayPermissions.relayTeamConfigProfilesWrite,
        relayPermissions.relayTeamConfigSecretsRead,
        relayPermissions.relayTeamConfigSecretsWrite,
        relayPermissions.relayMessagesWrite
      ]
    },
    quotas: { maxMembersPerOwnedTeam: null },
    createdAt: systemCreatedAt
  },
  {
    id: teamAccessGroupIdForRole('admin'),
    scope: 'team',
    name: '团队管理员',
    localizedNames: {
      'zh-Hans': '团队管理员',
      en: 'Team Admin'
    },
    description: '当前团队内成员和配置管理成员组。',
    localizedDescriptions: {
      'zh-Hans': '当前团队内成员和配置管理成员组。',
      en: 'Member group for managing members and configuration in the current team.'
    },
    builtIn: true,
    capabilities: {
      allow: [
        relayPermissions.relayTeamMembersRead,
        relayPermissions.relayTeamMembersWrite,
        relayPermissions.relayTeamsRead,
        relayPermissions.relayTeamsWrite,
        relayPermissions.relayTeamAuditRead,
        relayPermissions.relayTeamConfigProfilesRead,
        relayPermissions.relayTeamConfigProfilesWrite,
        relayPermissions.relayTeamConfigSecretsRead,
        relayPermissions.relayTeamConfigSecretsWrite,
        relayPermissions.relayMessagesWrite
      ]
    },
    createdAt: systemCreatedAt
  },
  {
    id: teamAccessGroupIdForRole('editor'),
    scope: 'team',
    name: '配置编辑者',
    localizedNames: {
      'zh-Hans': '配置编辑者',
      en: 'Config Editor'
    },
    description: '当前团队内配置方案和密钥维护成员组。',
    localizedDescriptions: {
      'zh-Hans': '当前团队内配置方案和密钥维护成员组。',
      en: 'Member group for maintaining configuration profiles and secrets in the current team.'
    },
    builtIn: true,
    capabilities: {
      allow: [
        relayPermissions.relayTeamMembersRead,
        relayPermissions.relayTeamsRead,
        relayPermissions.relayTeamConfigProfilesRead,
        relayPermissions.relayTeamConfigProfilesWrite,
        relayPermissions.relayTeamConfigSecretsRead,
        relayPermissions.relayTeamConfigSecretsWrite
      ]
    },
    createdAt: systemCreatedAt
  },
  {
    id: teamAccessGroupIdForRole('member'),
    scope: 'team',
    name: '团队成员',
    localizedNames: {
      'zh-Hans': '团队成员',
      en: 'Team Member'
    },
    description: '当前团队内普通成员组。',
    localizedDescriptions: {
      'zh-Hans': '当前团队内普通成员组。',
      en: 'Standard member group in the current team.'
    },
    builtIn: true,
    capabilities: {
      allow: [
        relayPermissions.relayTeamMembersRead,
        relayPermissions.relayTeamsRead
      ]
    },
    createdAt: systemCreatedAt
  },
  {
    id: teamAccessGroupIdForRole('viewer'),
    scope: 'team',
    name: '只读成员',
    localizedNames: {
      'zh-Hans': '只读成员',
      en: 'Read-only Member'
    },
    description: '当前团队内只读成员组。',
    localizedDescriptions: {
      'zh-Hans': '当前团队内只读成员组。',
      en: 'Read-only member group in the current team.'
    },
    builtIn: true,
    capabilities: {
      allow: [
        relayPermissions.relayTeamMembersRead,
        relayPermissions.relayTeamsRead
      ]
    },
    createdAt: systemCreatedAt
  }
]

export const normalizeRelayAccessGroup = (value: Record<string, unknown>): RelayAccessGroup | undefined => {
  const id = normalizeString(value.id)
  const scope = value.scope === 'team' ? 'team' : value.scope === 'platform' ? 'platform' : undefined
  const name = normalizeString(value.name)
  if (id == null || scope == null || name == null) return undefined
  return {
    id,
    scope,
    name,
    localizedNames: normalizeLocalizedTextMap(value.localizedNames),
    description: normalizeString(value.description),
    localizedDescriptions: normalizeLocalizedTextMap(value.localizedDescriptions),
    builtIn: value.builtIn === true,
    parentGroupId: normalizeString(value.parentGroupId),
    disabledAt: typeof value.disabledAt === 'string' ? value.disabledAt : undefined,
    capabilities: normalizeCapabilities(value.capabilities),
    quotas: normalizeQuotas(value.quotas),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined
  }
}

const normalizeScopedRelayAccessGroups = (
  value: unknown,
  defaults: RelayAccessGroup[],
  scope: RelayAccessGroupScope
): RelayAccessGroup[] => {
  const groupsById = new Map(defaults.map(group => [group.id, group]))
  const customGroups = Array.isArray(value)
    ? value.filter(isRecord).map(normalizeRelayAccessGroup).filter((group): group is RelayAccessGroup => group != null)
    : []

  for (const group of customGroups) {
    if (group.scope !== scope) continue
    const builtin = groupsById.get(group.id)
    if (builtin?.builtIn === true) {
      groupsById.set(group.id, {
        ...builtin,
        name: group.name,
        description: group.description ?? builtin.description,
        localizedDescriptions: {
          ...(builtin.localizedDescriptions ?? {}),
          ...(group.localizedDescriptions ?? {})
        },
        localizedNames: {
          ...(builtin.localizedNames ?? {}),
          ...(group.localizedNames ?? {})
        },
        parentGroupId: undefined,
        disabledAt: group.disabledAt,
        capabilities: builtin.capabilities,
        quotas: group.quotas ?? builtin.quotas,
        updatedAt: group.updatedAt ?? builtin.updatedAt
      })
      continue
    }
    groupsById.set(group.id, group)
  }
  return [...groupsById.values()]
}

export const normalizeRelayAccessGroups = (value: unknown): RelayAccessGroup[] =>
  normalizeScopedRelayAccessGroups(value, defaultRelayAccessGroups(), 'platform')

export const normalizeRelayTeamAccessGroups = (value: unknown): RelayAccessGroup[] =>
  normalizeScopedRelayAccessGroups(value, defaultRelayTeamAccessGroups(), 'team')

const collectGroupChain = (
  groupsById: Map<string, RelayAccessGroup>,
  group: RelayAccessGroup,
  visited = new Set<string>()
): RelayAccessGroup[] => {
  if (visited.has(group.id)) return []
  visited.add(group.id)
  const parent = group.parentGroupId == null ? undefined : groupsById.get(group.parentGroupId)
  return parent == null || parent.builtIn === true
    ? [group]
    : [...collectGroupChain(groupsById, parent, visited), group]
}

const mergeQuota = (current: number | null | undefined, next: number | null) => {
  if (current === undefined) return next
  if (current == null) return next
  if (next == null) return current
  return Math.min(current, next)
}

export const resolveAccessForGroupIds = (
  groups: RelayAccessGroup[],
  groupIds: string[],
  scope: RelayAccessGroupScope
): RelayEffectiveAccess => {
  const groupsById = new Map(groups.map(group => [group.id, group]))
  const allow = new Set<string>()
  const deny = new Set<string>()
  const quotas: Record<string, number | null> = {}
  const sources: RelayEffectiveAccessSource[] = []

  for (const groupId of groupIds) {
    const group = groupsById.get(groupId)
    if (group == null || group.scope !== scope || group.disabledAt != null) continue
    for (const inheritedGroup of collectGroupChain(groupsById, group)) {
      if (inheritedGroup.scope !== scope || inheritedGroup.disabledAt != null) continue
      for (const capability of inheritedGroup.capabilities.allow ?? []) allow.add(capability)
      for (const capability of inheritedGroup.capabilities.deny ?? []) deny.add(capability)
      for (const [key, value] of Object.entries(inheritedGroup.quotas ?? {})) {
        quotas[key] = mergeQuota(quotas[key], value)
      }
      sources.push({
        groupId: inheritedGroup.id,
        groupName: inheritedGroup.name,
        ...(inheritedGroup.id === group.id ? {} : { inheritedFromGroupId: group.id }),
        scope
      })
    }
  }

  for (const capability of deny) allow.delete(capability)
  return {
    capabilities: [...allow].sort(),
    deniedCapabilities: [...deny].sort(),
    quotas,
    sources
  }
}

export const resolveUserPlatformAccess = (store: Pick<RelayStore, 'accessGroups'>, user: RelayUser) =>
  resolveAccessForGroupIds(store.accessGroups, user.groupIds ?? defaultPlatformAccessGroupIds(user.role), 'platform')

export const userAccessTokenCapabilities = Object.freeze([
  relayPermissions.relayConfigSnapshotRead,
  relayPermissions.relayDevicesRead,
  relayPermissions.relayDevicesRegister,
  relayPermissions.relayJobsRead,
  relayPermissions.relayJobsResultRead,
  relayPermissions.relaySessionsRead,
  relayPermissions.relaySessionsSubmit
])

export const resolveAccessTokenPlatformAccess = (
  store: Pick<RelayStore, 'accessGroups'>,
  user: RelayUser,
  accessToken: RelayAccessToken
) => {
  const userGroupIds = user.groupIds ?? defaultPlatformAccessGroupIds(user.role)
  const requestedGroupIds = accessToken.permissionGroupMode === 'custom'
    ? accessToken.permissionGroupIds ?? []
    : userGroupIds
  const userGroupIdSet = new Set(userGroupIds)
  const effectiveGroupIds = requestedGroupIds.filter(groupId => userGroupIdSet.has(groupId))
  return resolveAccessForGroupIds(store.accessGroups, effectiveGroupIds, 'platform')
}

export const resolveAccessTokenAccess = (
  store: Pick<RelayStore, 'accessGroups' | 'teamMembers' | 'teams'>,
  user: RelayUser,
  accessToken: RelayAccessToken
): RelayEffectiveAccess => {
  if (accessToken.scope === 'user') {
    return {
      capabilities: [...userAccessTokenCapabilities],
      deniedCapabilities: [],
      quotas: {},
      sources: []
    }
  }
  if (accessToken.scope === 'team') {
    const member = store.teamMembers.find(item => item.teamId === accessToken.teamId && item.userId === user.id)
    if (member == null) {
      return {
        capabilities: [],
        deniedCapabilities: [],
        quotas: {},
        sources: []
      }
    }
    const memberGroupIds = member.groupIds ?? defaultTeamAccessGroupIds(member.role)
    const requestedGroupIds = accessToken.permissionGroupMode === 'custom'
      ? accessToken.permissionGroupIds ?? []
      : memberGroupIds
    const memberGroupIdSet = new Set(memberGroupIds)
    return resolveAccessForGroupIds(
      teamAccessGroupsForTeam(store.teams.find(team => team.id === member.teamId)),
      requestedGroupIds.filter(groupId => memberGroupIdSet.has(groupId)),
      'team'
    )
  }
  return resolveAccessTokenPlatformAccess(store, user, accessToken)
}

export const teamAccessGroupsForTeam = (team: RelayTeam | undefined) =>
  normalizeRelayTeamAccessGroups(team?.accessGroups)

export const resolveTeamMemberAccess = (store: Pick<RelayStore, 'teams'>, member: RelayTeamMember) => {
  const team = store.teams.find(item => item.id === member.teamId)
  return resolveAccessForGroupIds(
    teamAccessGroupsForTeam(team),
    member.groupIds ?? defaultTeamAccessGroupIds(member.role),
    'team'
  )
}
