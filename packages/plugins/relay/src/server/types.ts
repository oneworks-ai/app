/* eslint-disable max-lines -- relay plugin server contracts are kept together for scoped API parity. */
import type { Buffer } from 'node:buffer'
import type { IncomingHttpHeaders } from 'node:http'

import type { RelayConfigSourcePreferences } from './config-source-preferences.js'
import type { RelayPersonalDocumentSyncPreferences } from './personal-document-sync-preferences.js'
import type { RelayLocalSessionAdapter } from './session-types.js'

export type RelayLocalizedText = string | Record<string, string>
export type RelayPluginRuntimeRole = 'manager' | 'workspace'

export interface RelayPluginApiRegistration {
  description?: RelayLocalizedText
  headerSchema?: Record<string, unknown>
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  title?: RelayLocalizedText
  handler: (request: PluginProxyRequest) => PluginProxyResponse | Promise<PluginProxyResponse>
}

export interface RelayPluginContext {
  scope: string
  runtime: {
    role: RelayPluginRuntimeRole
  }
  workspaceFolder: string
  projectHome: string
  options: Record<string, unknown>
  configDistribution?: {
    getStatus?: () => RelayConfigDistributionStatus | Promise<RelayConfigDistributionStatus>
    refresh?: () => RelayConfigDistributionStatus | Promise<RelayConfigDistributionStatus>
  }
  logger: {
    warn: (...args: unknown[]) => void
  }
  sessions?: RelayLocalSessionAdapter
  registerApi: (apiId: string, options: RelayPluginApiRegistration) => void
  registerCommand: (commandId: string, handler: (payload?: unknown) => unknown | Promise<unknown>) => void
  dispose: (callback: () => void) => void
}

export interface PluginProxyRequest {
  method: string
  path: string
  query?: string
  headers?: IncomingHttpHeaders
  body: Buffer
}

export interface PluginProxyResponse {
  status?: number
  headers?: Record<string, string>
  body?: unknown
}

export interface RelayCapabilities {
  workspaceLauncher: boolean
  sessions: boolean
  terminal: boolean
  workspaceFiles: boolean
}

export interface RelayDeviceEnvironmentInfo {
  arch?: string
  deviceType?: string
  osName?: string
  osPlatform?: string
  osRelease?: string
  osVersion?: string
  runtime?: string
  runtimeVersion?: string
}

export interface RelayServerOptions {
  id: string
  name: string
  official?: boolean
  pairingTokenConfigured: boolean
  platform?: string
  port?: number
  protocol: 'http' | 'https'
  remoteBaseUrl: string
  server: string
}

export interface RelayOptions {
  activeServerId: string
  autoConnect: boolean
  capabilities: RelayCapabilities
  deviceName: string
  officialServices: {
    cloudflare: boolean
    vercel: boolean
  }
  servers: RelayServerOptions[]
}

export interface RelayStoredServer {
  account?: RelayAccountProfile
  configDisabledSources?: RelayConfigSourcePreferences
  deviceToken: string
  id: string
  personalDocumentSync?: RelayPersonalDocumentSyncPreferences
  teamDocumentSync?: Record<string, RelayPersonalDocumentSyncPreferences>
  registeredAt?: string
  remoteBaseUrl: string
  sessionExpiresAt?: string
  sessionToken?: string
  updatedAt?: string
}

export interface RelayRemoteDeviceSummary {
  alias?: string
  capabilities?: Record<string, unknown>
  createdAt?: string
  deviceInfo?: RelayDeviceEnvironmentInfo
  id?: string
  isCurrentClientDevice?: boolean
  ip?: string
  lastSeenAt?: string
  lastSeenIp?: string
  managementServers?: RelayRemoteDeviceManagementServerSummary[]
  name?: string
  pluginScope?: string
  registeredIp?: string
  status?: string
  workspaceFolder?: string
}

export interface RelayRemoteDeviceProjectSummary {
  createdAt?: string
  id?: string
  lastSeenAt?: string
  name?: string
  status?: string
  title?: string
  workspaceFolder?: string
}

export interface RelayRemoteDeviceManagementServerSummary {
  createdAt?: string
  environment?: RelayDeviceEnvironmentInfo
  id?: string
  ip?: string
  kind?: string
  lastSeenAt?: string
  lastSeenIp?: string
  name?: string
  pluginScope?: string
  projects?: RelayRemoteDeviceProjectSummary[]
  registeredIp?: string
  status?: string
  workspaceFolder?: string
}

export interface RelayProfileCurrentUser {
  avatarUrl?: string | null
  disabledAt?: string | null
  effectiveAccess?: Record<string, unknown>
  email: string
  groupIds: string[]
  id: string
  loginId?: string | null
  name: string
  provider?: string | null
  role: string
}

export type RelayProfileAccessTokenScope = 'platform' | 'team' | 'user'

export interface RelayProfileAccessToken {
  createdAt: string
  id: string
  lastUsedAt: string | null
  name: string
  permissionGroupIds: string[]
  permissionGroupMode: 'all' | 'custom'
  revokedAt: string | null
  scope: RelayProfileAccessTokenScope
  teamId: string | null
  tokenPreview: string
}

export interface RelayProfileSecuritySummary {
  accessTokens: RelayProfileAccessToken[]
  accountDeletion: {
    available: boolean
  }
  password: {
    enabled: boolean
  }
  passkeys: {
    count: number
    enabled: boolean
    lastUsedAt: string | null
  }
  twoFactor: {
    available: boolean
    enabled: boolean
  }
}

export interface RelayProfileOpenApiAuditEvent {
  createdAt: string
  error: string | null
  id: string
  ip: string | null
  method: string
  path: string
  permission: string | null
  status: number
  tokenId: string
  tokenPreview: string
  userAgent: string | null
  userId: string
}

export type RelayProfileMessageKind = 'announcement' | 'personal' | 'system'
export type RelayProfileMessageAudienceScope = 'all' | 'team' | 'users'

export interface RelayProfileMessageUser {
  avatarUrl: string | null
  email: string
  id: string
  name: string
  provider: string | null
  role: string
}

export interface RelayProfileMessageTeam {
  avatarUrl: string | null
  id: string
  name: string
  slug: string
}

export interface RelayProfileMessageAudience {
  scope: RelayProfileMessageAudienceScope
  team: RelayProfileMessageTeam | null
  teamId: string | null
  userIds: string[]
  users: Array<RelayProfileMessageUser | null>
}

export interface RelayProfileMessageLoginMetadata {
  ip?: string
  location?: string
  userAgent?: string
}

export interface RelayProfileMessageMetadata {
  login?: RelayProfileMessageLoginMetadata
}

export interface RelayProfileMessage {
  audience: RelayProfileMessageAudience
  body: string
  createdAt: string
  createdBy: RelayProfileMessageUser | null
  createdByUserId: string
  id: string
  kind: RelayProfileMessageKind
  metadata?: RelayProfileMessageMetadata
  title: string
  updatedAt: string | null
}

export interface RelayProfileTeamInvitation {
  configEnabled: boolean
  createdAt: string
  createdByUserId: string
  defaultForPublishing: boolean
  email: string | null
  groupIds: string[]
  id: string
  inviter: RelayProfileMessageUser | null
  respondedAt: string | null
  role: string
  status: string
  teamAvatarUrl: string | null
  teamId: string
  teamName: string | null
  teamSlug: string | null
  updatedAt: string | null
  user: RelayProfileMessageUser | null
  userId: string | null
}

export interface RelayProfileTeam {
  archivedAt: string | null
  avatarUrl: string | null
  configEnabled: boolean
  defaultForPublishing: boolean
  description: string | null
  id: string
  memberCount: number
  membership: {
    configEnabled: boolean
    defaultForPublishing: boolean
    groupIds: string[]
    role: string
  } | null
  name: string
  role?: string
  slug: string
  updatedAt: string | null
}

export interface RelayProfileSessionSummary {
  expiresAt?: string
  lastSeenAt?: string
}

export interface RelayProfileStatus {
  account: RelayPublicAuthAccount
  accounts: RelayPublicAuthAccount[]
  auditEvents: RelayProfileOpenApiAuditEvent[]
  devices: RelayRemoteDeviceSummary[]
  errors?: Partial<Record<'audit' | 'devices' | 'messages' | 'profile' | 'security' | 'teams', string>>
  invitations: RelayProfileTeamInvitation[]
  messages: RelayProfileMessage[]
  ok: true
  security: RelayProfileSecuritySummary
  session?: RelayProfileSessionSummary
  teams: RelayProfileTeam[]
  user: RelayProfileCurrentUser
}

export interface RelayAccountProfile {
  avatarUrl?: string
  email?: string
  id?: string
  loginId?: string
  name?: string
  provider?: string
  role?: string
}

export interface RelayStore {
  deviceId: string
  deviceSecret: string
  deviceName: string
  servers: Record<string, RelayStoredServer>
}

export interface RelayConnectionState {
  state: 'idle' | 'connecting' | 'registered' | 'error'
  message: string
  activeServerId?: string
  lastConnectedAt: string | null
  lastError: string | null
  remoteBaseUrl?: string
}

export interface RelayConfigDistributionStatus {
  allowedFields: string[]
  hash: string | null
  lastAppliedAt: string | null
  lastError: string | null
  lastSyncedAt: string | null
  marketplaceKeys: string[]
  matchedProject: boolean | string | null
  modelServiceKeys: string[]
  pluginKeys: string[]
  skillKeys: string[]
  skillRegistryKeys: string[]
  sourceServerId: string | null
  sources?: RelayConfigDistributionSourceStatus[]
  version: string | null
}

export interface RelayPersonalDocumentSyncStatus {
  appliedRemote: boolean
  conflictBackups: number
  countsByKind: RelayPersonalDocumentSyncCounts
  documentCount: number
  enabled: boolean
  entries?: RelayPersonalDocumentEntry[]
  hash: string | null
  lastError: string | null
  lastSyncedAt: string | null
  preferences: RelayPersonalDocumentSyncPreferences
  pushedLocal: boolean
  totalSizeBytes: number
}

export interface RelayPersonalDocumentEntry {
  displayName: string
  exists: boolean
  kind: keyof RelayPersonalDocumentSyncPreferences
  localOnly: boolean
  path: string
  relativePath: string
}

export interface RelayPersonalDocumentSyncCounts {
  agents: number
  ooAgents: number
  ooRules: number
}

export interface RelayConfigDistributionSourceStatus {
  assignmentId: string
  disabledBy: Array<'assignment' | 'profile' | 'team'>
  enabled: boolean
  fields: string[]
  mode: 'default' | 'override'
  profileId: string
  profileName: string
  teamId: string
  teamName?: string
  version: number
  versionId: string
}

export interface RelayPublicServerStatus extends RelayServerOptions {
  account?: RelayAccountProfile
  active: boolean
  availabilityError?: string
  avatarUrl?: string
  lastCheckedAt?: string
  connected: boolean
  connection: RelayConnectionState
  devices?: RelayRemoteDeviceSummary[]
  devicesError?: string
  hasToken: boolean
  online?: boolean
  registeredAt: string | null
  sessionExpiresAt: string | null
  sessionAuthenticated: boolean
  updatedAt: string | null
}

export interface RelayPublicAuthAccount {
  accountKey: string
  avatarUrl?: string
  email?: string
  enabled: boolean
  loginId?: string
  name?: string
  registeredAt?: string
  role?: string
  serverAlias: string
  serverId: string
  serverUrl: string
  sessionAuthenticated: boolean
  sessionExpiresAt?: string
  updatedAt?: string
  userId: string
}

export interface RelayPublicStatus {
  accounts: RelayPublicAuthAccount[]
  configDistribution: RelayConfigDistributionStatus
  connection: RelayConnectionState & {
    activeServerId?: string
    remoteBaseUrl?: string
  }
  device: {
    hasToken: boolean
    id: string
    name: string
    registeredAt: string | null
    updatedAt: string | null
  }
  options: RelayOptions
  personalDocumentSync: RelayPersonalDocumentSyncStatus
  projectRuleDocumentSync: Record<string, RelayPersonalDocumentSyncStatus>
  servers: RelayPublicServerStatus[]
  storePath: string
  teamDocumentSync: Record<string, RelayPersonalDocumentSyncStatus>
}
