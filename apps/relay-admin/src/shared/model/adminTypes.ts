/* eslint-disable max-lines -- Relay Admin API wire contracts are centralized for shared UI typing. */

export type RelayAdminRole = 'owner' | 'admin' | 'member' | 'viewer'
export type RelayAdminAccessGroupScope = 'platform' | 'team'
export type RelayAdminSsoProviderType = 'oauth2' | 'oidc'

export interface RelayAdminAccessGroupCapabilities {
  allow: string[]
  deny: string[]
}

export interface RelayAdminEffectiveAccessSource {
  groupId: string
  groupName: string
  inheritedFromGroupId?: string
  scope: RelayAdminAccessGroupScope
}

export interface RelayAdminEffectiveAccess {
  capabilities: string[]
  deniedCapabilities: string[]
  quotas: Record<string, number | null>
  sources: RelayAdminEffectiveAccessSource[]
}

export interface RelayAdminAccessGroup {
  builtIn: boolean
  capabilities: RelayAdminAccessGroupCapabilities
  createdAt: string
  description: string | null
  disabled: boolean
  disabledAt: string | null
  id: string
  localizedDescriptions: Record<string, string>
  localizedNames: Record<string, string>
  memberCount: number
  name: string
  parentGroupId: string | null
  quotas: Record<string, number | null>
  scope: RelayAdminAccessGroupScope
  updatedAt: string | null
}

export interface RelayAdminCurrentUser {
  avatarUrl?: string | null
  disabledAt?: string | null
  email: string
  effectiveAccess: RelayAdminEffectiveAccess
  groupIds: string[]
  id: string
  loginId?: string | null
  name: string
  provider?: string | null
  role: RelayAdminRole
}

export interface RelayAdminMeResponse {
  session: {
    expiresAt: string
    lastSeenAt: string
  }
  user: RelayAdminCurrentUser
}

export interface RelayAdminUser {
  avatarUrl: string | null
  createdAt: string
  deviceCount: number
  disabled: boolean
  disabledAt: string | null
  email: string
  effectiveAccess: RelayAdminEffectiveAccess
  groupIds: string[]
  id: string
  loginId: string | null
  maxDevices: number | null
  name: string
  passwordEnabled: boolean
  provider: string | null
  role: RelayAdminRole
  teams: RelayAdminUserTeamSummary[]
  updatedAt: string | null
}

export interface RelayAdminUserTeamSummary {
  archivedAt: string | null
  configEnabled: boolean
  defaultForPublishing: boolean
  id: string
  name: string
  role: 'admin' | 'editor' | 'member' | 'owner' | 'viewer'
  slug: string
}

export interface RelayAdminInvite {
  code: string
  createdAt: string
  expiresAt: string | null
  groupIds: string[]
  maxUses: number
  revokedAt: string | null
  role: RelayAdminRole
  updatedAt: string | null
  used: number
  userId: string | null
}

export interface RelayAdminSsoProvider {
  id: string
  name: string
  type: RelayAdminSsoProviderType
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  scope: string
  enabled: boolean
  clientId: string
  clientSecret: '********' | null
  createdAt: string
  updatedAt: string | null
}

export type RelayAdminDeviceStatus = 'offline' | 'online' | 'stale'

export interface RelayAdminDevice {
  capabilities: Record<string, unknown>
  createdAt: string
  id: string
  lastSeenAt: string
  name: string
  pluginScope?: string
  status?: RelayAdminDeviceStatus
  userId?: string
  workspaceFolder?: string
}

export interface RelayAdminDeviceSession {
  createdAt: string
  deviceId: string
  id: string
  lastActiveAt?: string
  state?: string
  title: string
  updatedAt: string
  userId?: string
}

export interface CreateUserInput {
  disabled?: boolean
  email: string
  loginId?: string | null
  maxDevices?: number | null
  name?: string
  password?: string
  groupIds?: string[]
  role: RelayAdminRole
}

export interface UpdateUserInput {
  disabled?: boolean
  groupIds?: string[]
  id: string
  loginId?: string | null
  maxDevices?: number | null
  password?: string
  role?: RelayAdminRole
}

export interface CreateInviteInput {
  code?: string
  groupIds?: string[]
  maxUses: number
  role: RelayAdminRole
  userId?: string
}

export interface CreateAccessGroupInput {
  capabilities: RelayAdminAccessGroupCapabilities
  description?: string
  localizedDescriptions?: Record<string, string>
  localizedNames?: Record<string, string>
  name: string
  parentGroupId?: string | null
  quotas?: Record<string, number | null>
  scope: RelayAdminAccessGroupScope
}

export interface UpdateAccessGroupInput {
  capabilities?: RelayAdminAccessGroupCapabilities
  description?: string | null
  disabled?: boolean
  id: string
  localizedDescriptions?: Record<string, string> | null
  localizedNames?: Record<string, string> | null
  name?: string
  parentGroupId?: string | null
  quotas?: Record<string, number | null>
}

export interface CreateSsoProviderInput {
  id: string
  name: string
  type: RelayAdminSsoProviderType
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  scope: string
  enabled: boolean
  clientId: string
  clientSecret: string
}

export interface UpdateSsoProviderInput {
  id: string
  name?: string
  type?: RelayAdminSsoProviderType
  authorizationUrl?: string
  tokenUrl?: string
  userInfoUrl?: string
  scope?: string
  enabled?: boolean
  clientId?: string
  clientSecret?: string
}
