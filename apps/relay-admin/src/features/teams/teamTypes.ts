/* eslint-disable max-lines -- Relay Admin team contracts stay in one feature-local type file. */
export type RelayAdminTeamMemberRole = 'admin' | 'editor' | 'member' | 'owner' | 'viewer'
export type RelayAdminConfigAssignmentMode = 'default' | 'override'
export type RelayAdminConfigProfileStatus = 'disabled' | 'draft' | 'published'
export type RelayAdminConfigSafeField =
  | 'defaultModelService'
  | 'marketplaces'
  | 'modelServices'
  | 'plugins'
  | 'recommendedModels'
  | 'skillRegistries'
  | 'skills'
  | 'skillsMeta'

export interface RelayAdminTeamPolicy {
  allowedMarketplaceIds: string[]
  allowedPluginIds: string[]
  allowedSecretModes: string[]
  allowedSkillRegistries: string[]
  allowedSkillSources: string[]
  maxAssignmentsPerProfile: number | null
  maxMembersPerTeam: number | null
  maxProfilesPerTeam: number | null
  maxSecretTtlHours: number | null
  maxTeamsPerTenant: number | null
  maxTeamsPerUser: number | null
  proxyModeEnabled: boolean
  requireOwnerApprovalForSecretProfiles: boolean
  selfServiceTeamCreation: boolean
  teamsEnabled: boolean
  tenantId: string
  updatedAt: string | null
  updatedByUserId: string | null
}

export interface RelayAdminTeam {
  archivedAt: string | null
  avatarUrl: string | null
  createdAt: string
  createdByUserId: string
  description: string | null
  id: string
  memberCount: number
  membership: {
    configEnabled: boolean
    defaultForPublishing: boolean
    role: RelayAdminTeamMemberRole
  } | null
  name: string
  proxyModeEnabled: boolean
  slug: string
  updatedAt: string | null
}

export interface RelayAdminTeamMember {
  configEnabled: boolean
  createdAt: string
  createdByUserId: string
  defaultForPublishing: boolean
  email: string | null
  id: string
  name: string | null
  role: RelayAdminTeamMemberRole
  teamId: string
  updatedAt: string | null
  userId: string
}

export interface RelayAdminConfigProjectRule {
  allow?: string[]
  deny?: string[]
}

export interface RelayAdminConfigTarget {
  teamIds?: string[]
  userIds?: string[]
}

export interface RelayAdminConfigPatch {
  defaultModelService?: string
  marketplaces?: Record<string, unknown>
  modelServices?: Record<string, unknown>
  plugins?: Record<string, unknown>
  recommendedModels?: unknown[]
  skillRegistries?: unknown[] | Record<string, unknown>
  skills?: unknown[] | Record<string, unknown>
  skillsMeta?: Record<string, unknown>
}

export interface RelayAdminConfigProfile {
  activeVersionId: string | null
  assignmentCount: number
  createdAt: string
  createdByUserId: string
  description: string | null
  id: string
  name: string
  status: RelayAdminConfigProfileStatus
  teamId: string
  teamName: string | null
  updatedAt: string | null
  updatedByUserId: string | null
  versionCount: number
}

export interface RelayAdminConfigProfileVersion {
  allowedFields: RelayAdminConfigSafeField[]
  changeNote: string | null
  configPatch: RelayAdminConfigPatch
  createdAt: string
  createdByUserId: string
  id: string
  profileId: string
  secretRefs: Record<string, string>
  sourceHash: string
  version: number
}

export interface RelayAdminConfigSecret {
  createdAt: string
  createdByUserId: string
  id: string
  name: string
  revokedAt: string | null
  rotatedAt: string | null
  secretVersion: number
  teamId: string
}

export interface RelayAdminConfigProfileAssignment {
  createdAt: string
  enabled: boolean
  id: string
  mode: RelayAdminConfigAssignmentMode
  priority: number
  profileId: string
  project: RelayAdminConfigProjectRule | null
  target: RelayAdminConfigTarget | null
  updatedAt: string | null
  versionId: string | null
}

export interface RelayAdminAuditEvent {
  action: string
  actor: string
  createdAt: string
  id: string
  ip: string | null
  requestId: string | null
  resource: string
  status: string
  userAgent: string | null
}

export interface CreateTeamInput {
  avatarUrl?: string
  description?: string
  name: string
  slug?: string
}

export interface UpdateTeamInput {
  avatarUrl?: string
  description?: string
  name?: string
  proxyModeEnabled?: boolean
  slug?: string
}

export interface CreateTeamMemberInput {
  configEnabled?: boolean
  defaultForPublishing?: boolean
  email?: string
  role: RelayAdminTeamMemberRole
  teamId: string
  userId?: string
}

export interface UpdateTeamMemberInput {
  configEnabled?: boolean
  defaultForPublishing?: boolean
  role?: RelayAdminTeamMemberRole
}

export interface UpdateTeamPolicyInput {
  maxAssignmentsPerProfile?: number | null
  maxMembersPerTeam?: number | null
  maxProfilesPerTeam?: number | null
  maxSecretTtlHours?: number | null
  maxTeamsPerTenant?: number | null
  maxTeamsPerUser?: number | null
  proxyModeEnabled?: boolean
  requireOwnerApprovalForSecretProfiles?: boolean
  selfServiceTeamCreation?: boolean
  teamsEnabled?: boolean
}

export interface CreateConfigProfileInput {
  description?: string
  name: string
  teamId: string
}

export interface CreateConfigProfileVersionInput {
  allowedFields?: RelayAdminConfigSafeField[]
  changeNote?: string
  configPatch: RelayAdminConfigPatch
  secretRefs?: Record<string, string>
}

export interface CreateConfigSecretInput {
  name: string
  teamId: string
  value: string
}

export interface RotateConfigSecretInput {
  value: string
}

export interface CreateConfigProfileAssignmentInput {
  enabled?: boolean
  mode?: RelayAdminConfigAssignmentMode
  priority?: number
  project?: RelayAdminConfigProjectRule
  target?: RelayAdminConfigTarget
  versionId?: string
}
