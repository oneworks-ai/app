/* eslint-disable max-lines -- Relay server public types stay in one package-local contract file. */

export interface RelayServerArgs {
  allowOrigin: string
  adminToken: string
  dataPath: string
  defaultLoginMethod?: RelayLoginMethod
  deviceMetadataSecret?: string
  deviceOnlineTtlMs?: number
  email?: RelayEmailConfig
  emailProvider?: RelayEmailProvider
  embeddedAdminUi?: boolean
  help?: boolean
  host: string
  oauth?: Record<string, RelayOAuthClient | undefined>
  passkey?: RelayPasskeyConfig
  port: number
  publicBaseUrl?: string
  sessionTtlMs?: number
  storageDriver?: RelayStorageDriver
}

export type RelayAuthProvider = string
export type RelayConfigAssignmentMode = 'default' | 'override'
export type RelayConfigProfileStatus = 'disabled' | 'draft' | 'published'
export type RelayEmailProviderKind = 'disabled' | 'resend'
export type RelayEmailPurpose = 'email-verification' | 'invite' | 'login'
export type RelayLocale = 'en' | 'zh-CN'
export type RelayLoginMethod = 'passkey' | 'password' | 'verification_code'
export type RelayMessageAudienceScope = 'all' | 'team' | 'users'
export type RelayMessageKind = 'announcement' | 'personal' | 'system'
export type RelayPasskeyChallengeKind = 'authentication' | 'registration'
export type RelayRegistrationMode = 'admin_created_only' | 'email_verified' | 'invite_required'
export type RelayRole = 'owner' | 'admin' | 'member' | 'viewer'
export type RelaySecretMode = 'device_encrypted' | 'proxy'
export type RelaySsoProviderType = 'oauth2' | 'oidc'
export type RelayTeamInvitationStatus = 'accepted' | 'declined' | 'pending' | 'revoked'
export type RelayStorageDriver = 'cloudflare-do' | 'json' | 'postgres' | 'sqlite'
export type RelayTeamRole = 'owner' | 'admin' | 'editor' | 'member' | 'viewer'
export type RelayTurnstileMode = 'auto' | 'off' | 'required'
export type RelayAccessGroupScope = 'platform' | 'team'
export type RelayAccessTokenScope = 'platform' | 'team' | 'user'

export interface RelayAccessGroupCapabilities {
  allow?: string[]
  deny?: string[]
}

export interface RelayAccessGroup {
  id: string
  scope: RelayAccessGroupScope
  name: string
  localizedNames?: Record<string, string>
  description?: string
  localizedDescriptions?: Record<string, string>
  builtIn?: boolean
  parentGroupId?: string
  disabledAt?: string
  capabilities: RelayAccessGroupCapabilities
  quotas?: Record<string, number | null>
  createdAt: string
  updatedAt?: string
}

export interface RelayEffectiveAccessSource {
  groupId: string
  groupName: string
  inheritedFromGroupId?: string
  scope: RelayAccessGroupScope
}

export interface RelayEffectiveAccess {
  capabilities: string[]
  deniedCapabilities: string[]
  quotas: Record<string, number | null>
  sources: RelayEffectiveAccessSource[]
}

export interface RelayPasskeyConfig {
  emailVerificationRequired: boolean
  enabled: boolean
  origin?: string
  registrationMode: RelayRegistrationMode
  rpId?: string
  rpName: string
  timeoutMs: number
}

export interface RelayOAuthClient {
  authorizationUrl?: string
  clientId: string
  clientSecret: string
  displayName?: string
  id?: string
  scope?: string
  tokenUrl?: string
  userInfoUrl?: string
}

export interface RelayEmailProviderInput {
  code: string
  email: string
  expiresAt: string
  locale?: RelayLocale
  purpose: RelayEmailPurpose
}

export interface RelayEmailProviderResult {
  messageId?: string
}

export interface RelayEmailProvider {
  sendVerificationCode: (input: RelayEmailProviderInput) => Promise<RelayEmailProviderResult>
}

export interface RelayTurnstileConfig {
  mode: RelayTurnstileMode
  secretKey?: string
  verifyUrl?: string
}

export interface RelayEmailRiskWindowConfig {
  max: number
  windowMs: number
}

export interface RelayEmailRiskConfig {
  allowDomains: string[]
  blockDomains: string[]
  codeTtlMs: number
  dailyBudget: number
  disposableBlocklist: boolean
  enabled: boolean
  monthlyBudget: number
  perDomain: RelayEmailRiskWindowConfig
  perEmail: RelayEmailRiskWindowConfig
  perIp: RelayEmailRiskWindowConfig
  resendCooldownMs: number
}

export interface RelayEmailConfig {
  from?: string
  logoUrl?: string
  provider: RelayEmailProviderKind
  resendApiKey?: string
  risk: RelayEmailRiskConfig
  turnstile: RelayTurnstileConfig
}

export interface RelayUser {
  id: string
  email: string
  loginId?: string
  name: string
  avatarUrl?: string
  disabledAt?: string
  groupIds?: string[]
  maxDevices?: number
  passwordHash?: string
  provider?: RelayAuthProvider
  providerUserId?: string
  role: RelayRole
  teamIds?: string[]
  createdAt: string
  updatedAt?: string
}

export interface RelayTeam {
  id: string
  slug: string
  name: string
  description?: string
  accessGroups?: RelayAccessGroup[]
  avatarUrl?: string
  proxyModeEnabled?: boolean
  createdByUserId: string
  archivedAt?: string
  createdAt: string
  updatedAt?: string
}

export interface RelayTeamMember {
  id: string
  teamId: string
  userId: string
  role: RelayTeamRole
  groupIds?: string[]
  configEnabled?: boolean
  defaultForPublishing?: boolean
  createdByUserId: string
  createdAt: string
  updatedAt?: string
}

export interface RelayTeamInvitation {
  id: string
  teamId: string
  userId?: string
  email?: string
  role: RelayTeamRole
  groupIds?: string[]
  configEnabled?: boolean
  defaultForPublishing?: boolean
  status: RelayTeamInvitationStatus
  createdByUserId: string
  createdAt: string
  updatedAt?: string
  respondedAt?: string
}

export interface RelayMessageAudience {
  scope: RelayMessageAudienceScope
  teamId?: string
  userIds?: string[]
}

export interface RelayMessageLoginMetadata {
  ip?: string
  location?: string
  userAgent?: string
}

export interface RelayMessageMetadata {
  login?: RelayMessageLoginMetadata
}

export interface RelayMessage {
  id: string
  kind: RelayMessageKind
  title: string
  body: string
  audience: RelayMessageAudience
  metadata?: RelayMessageMetadata
  createdByUserId: string
  createdAt: string
  updatedAt?: string
}

export interface RelayTeamPolicy {
  allowedMarketplaceIds?: string[]
  allowedPluginIds?: string[]
  allowedSecretModes: RelaySecretMode[]
  allowedSkillRegistries?: string[]
  allowedSkillSources?: string[]
  maxAssignmentsPerProfile?: number
  maxMembersPerTeam?: number
  maxProfilesPerTeam?: number
  maxSecretTtlHours?: number
  maxTeamsPerTenant?: number
  maxTeamsPerUser?: number
  proxyModeEnabled: boolean
  requireOwnerApprovalForSecretProfiles?: boolean
  selfServiceTeamCreation: boolean
  teamsEnabled: boolean
  tenantId: string
  updatedAt?: string
  updatedByUserId?: string
}

export interface RelayAuthIdentity {
  id: string
  userId: string
  provider: RelayAuthProvider
  providerUserId: string
  email?: string
  emailVerified?: boolean
  createdAt: string
  lastUsedAt?: string
  updatedAt?: string
}

export interface RelayPasskeyCredential {
  backedUp: boolean
  counter: number
  createdAt: string
  deviceType: string
  id: string
  lastUsedAt?: string
  name?: string
  publicKey: string
  transports?: string[]
  updatedAt?: string
  userId: string
}

export interface RelayPasskeyChallenge {
  challenge: string
  createdAt: string
  emailChallengeId?: string
  emailHash?: string
  expiresAt: string
  id: string
  inviteCode?: string
  kind: RelayPasskeyChallengeKind
  origin: string
  rpId: string
  userId?: string
}

export interface RelayInvite {
  code: string
  role: RelayRole
  groupIds?: string[]
  userId?: string
  maxUses: number
  used: number
  expiresAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt?: string
}

export interface RelaySsoProvider {
  id: string
  name: string
  type: RelaySsoProviderType
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  scope: string
  enabled: boolean
  clientId: string
  clientSecret: string
  createdAt: string
  updatedAt?: string
}

export interface RelayDevice {
  id: string
  alias?: string
  name?: string
  userId?: string
  deviceInfo?: RelayDeviceEnvironmentInfo
  capabilities?: Record<string, unknown>
  workspaceFolder?: string
  pluginScope?: string
  deviceToken?: string
  deviceTokenHash?: string
  encryptedMetadata?: RelayEncryptedPayload
  createdAt: string
  lastSeenAt: string
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

export interface RelayDeviceProject {
  createdAt?: string
  id?: string
  lastSeenAt?: string
  name?: string
  status?: RelayDeviceStatus
  title?: string
  workspaceFolder?: string
}

export interface RelayDeviceManagementServer {
  createdAt?: string
  environment?: RelayDeviceEnvironmentInfo
  id: string
  ip?: string
  kind?: string
  lastSeenAt?: string
  lastSeenIp?: string
  name?: string
  pluginScope?: string
  projects?: RelayDeviceProject[]
  registeredIp?: string
  status?: RelayDeviceStatus
  workspaceFolder?: string
}

export interface RelayEncryptedPayload {
  algorithm: 'aes-256-gcm'
  ciphertext: string
  iv: string
  tag: string
  version: 1
}

export type RelayConfigSafeField =
  | 'defaultModelService'
  | 'marketplaces'
  | 'modelServices'
  | 'plugins'
  | 'recommendedModels'
  | 'skillRegistries'
  | 'skills'
  | 'skillsMeta'
  | 'adapters'

export interface RelayConfigPatch {
  adapters?: Record<string, unknown>
  defaultModelService?: string
  marketplaces?: Record<string, unknown>
  modelServices?: Record<string, unknown>
  plugins?: unknown[] | Record<string, unknown>
  recommendedModels?: unknown[]
  skillRegistries?: unknown
  skills?: unknown
  skillsMeta?: Record<string, unknown>
  [key: string]: unknown
}

export interface RelayConfigProjectRule {
  allow?: string[]
  deny?: string[]
}

export interface RelayConfigAssignmentTarget {
  teamIds?: string[]
  userIds?: string[]
}

export interface RelayConfigAssignment {
  allowedFields?: RelayConfigSafeField[]
  configPatch?: RelayConfigPatch
  enabled?: boolean
  id: string
  project?: RelayConfigProjectRule
  target?: RelayConfigAssignmentTarget
  updatedAt?: string
  version?: string
}

export interface RelayConfigProfile {
  id: string
  teamId: string
  name: string
  description?: string
  status: RelayConfigProfileStatus
  activeVersionId?: string
  createdByUserId: string
  updatedByUserId?: string
  createdAt: string
  updatedAt?: string
}

export interface RelayConfigProfileVersion {
  id: string
  profileId: string
  version: number
  allowedFields: RelayConfigSafeField[]
  configPatch: RelayConfigPatch
  secretRefs?: Record<string, string>
  sourceHash: string
  createdByUserId: string
  changeNote?: string
  createdAt: string
}

export interface RelayConfigSecret {
  id: string
  teamId: string
  name: string
  encryptedPayload: RelayEncryptedPayload
  secretVersion: number
  createdByUserId: string
  createdAt: string
  rotatedAt?: string
  revokedAt?: string
}

export interface RelayConfigProfileAssignment {
  id: string
  profileId: string
  versionId?: string
  priority: number
  target?: RelayConfigAssignmentTarget
  project?: RelayConfigProjectRule
  mode: RelayConfigAssignmentMode
  enabled: boolean
  createdAt: string
  updatedAt?: string
}

export interface RelayConfigSnapshotProvenance {
  teamId: string
  teamName?: string
  profileId: string
  profileName: string
  versionId: string
  version: number
  assignmentId: string
  mode: RelayConfigAssignmentMode
  fields: RelayConfigSafeField[]
}

export interface RelayConfigSnapshotSecretEnvelope {
  algorithm: 'aes-256-gcm'
  ciphertext: string
  expiresAt: string
  iv: string
  keyId: string
  recipientDeviceId: string
  ref: string
  secretId: string
  secretVersion: number
  tag: string
  version: 1
}

export interface RelayConfigSnapshotAssignment {
  allowedFields?: RelayConfigSafeField[]
  configPatch?: RelayConfigPatch
  enabled?: boolean
  id: string
  mustRefreshAfter?: string
  project?: RelayConfigProjectRule
  provenance?: RelayConfigSnapshotProvenance
  secrets?: RelayConfigSnapshotSecretEnvelope[]
  updatedAt?: string
  version?: string
}

export interface RelayConfigSnapshot {
  account?: {
    email?: string
    id?: string
    name?: string
  }
  assignments: RelayConfigSnapshotAssignment[]
  hash: string
  sourceServerId?: string
  team?: {
    id?: string
    name?: string
  }
  updatedAt: string
  version: string
}

export interface RelayPersonalConfigSnapshot {
  allowedFields: RelayConfigSafeField[]
  configPatch?: RelayConfigPatch
  documents?: RelayPersonalDocumentSnapshot
  hash: string
  sourceDeviceId?: string
  updatedAt: string
  userId: string
  version: string
}

export type RelayPersonalDocumentKind = 'agents' | 'ooAgents' | 'ooRules'

export interface RelayPersonalDocumentCounts {
  agents: number
  ooAgents: number
  ooRules: number
}

export interface RelayPersonalDocumentSnapshot {
  countsByKind: RelayPersonalDocumentCounts
  documentCount: number
  encryptedPayload: RelayEncryptedPayload
  hash: string
  totalSizeBytes: number
  updatedAt: string
  version: 1
}

export interface RelayTeamDocumentSnapshot extends RelayPersonalDocumentSnapshot {
  teamId: string
  updatedByUserId?: string
}

export interface RelayAuditLogEntry {
  id: string
  actor: string
  action: string
  resource: string
  status: string
  ip?: string
  userAgent?: string
  requestId?: string
  createdAt: string
}

export interface RelayOpenApiAuditEvent {
  id: string
  tokenId: string
  tokenPreview: string
  userId: string
  method: string
  path: string
  status: number
  ip?: string
  userAgent?: string
  permission?: string
  error?: string
  createdAt: string
}

export interface RelayConfigProjectContext {
  cwd?: string
  projectId?: string
  projectName?: string
  workspaceFolder?: string
}

export interface RelayOAuthState {
  state: string
  provider: RelayAuthProvider
  redirectUri?: string
  inviteCode?: string
  createdAt: string
  expiresAt: string
}

export interface RelaySession {
  token: string
  userId: string
  createdAt: string
  expiresAt: string
  lastSeenAt: string
}

export interface RelayAccessToken {
  id: string
  userId: string
  name: string
  permissionGroupIds?: string[]
  permissionGroupMode?: 'all' | 'custom'
  scope?: RelayAccessTokenScope
  teamId?: string
  tokenHash: string
  tokenPreview: string
  createdAt: string
  lastUsedAt?: string
  revokedAt?: string
}

export interface RelayEmailRiskBucket {
  count: number
  key: string
  resetAt: string
  updatedAt: string
}

export interface RelayEmailChallenge {
  codeHash: string
  createdAt: string
  domain: string
  emailHash: string
  expiresAt: string
  id: string
  lastSentAt: string
  providerMessageId?: string
  purpose: RelayEmailPurpose
  sendCount: number
  updatedAt?: string
  verifiedAt?: string
}

export interface RelayEmailRiskState {
  buckets: RelayEmailRiskBucket[]
  challenges: RelayEmailChallenge[]
}

export type RelayDeviceStatus = 'offline' | 'online' | 'stale'

export interface RelayDeviceSession {
  id: string
  deviceId: string
  userId?: string
  title: string
  state?: string
  workspaceFolder?: string
  lastActiveAt?: string
  createdAt: string
  updatedAt: string
}

export type RelayForwardingJobStatus = 'cancelled' | 'claimed' | 'failed' | 'queued' | 'running' | 'succeeded'

export interface RelayForwardingJob {
  id: string
  deviceId: string
  sessionId: string
  userId?: string
  status: RelayForwardingJobStatus
  traceId: string
  requestId?: string
  mode?: string
  claimedByDeviceId?: string
  payloadSizeBytes: number
  resultSizeBytes?: number
  errorCode?: string
  createdAt: string
  updatedAt: string
  claimedAt?: string
  completedAt?: string
}

export interface RelayStore {
  createdAt: string
  accessGroups: RelayAccessGroup[]
  auditEvents: RelayAuditLogEntry[]
  openApiAuditEvents?: RelayOpenApiAuditEvent[]
  configAssignments: RelayConfigAssignment[]
  configProfileAssignments: RelayConfigProfileAssignment[]
  personalConfigSnapshots?: RelayPersonalConfigSnapshot[]
  teamDocumentSnapshots?: RelayTeamDocumentSnapshot[]
  configSecrets: RelayConfigSecret[]
  configProfileVersions: RelayConfigProfileVersion[]
  configProfiles: RelayConfigProfile[]
  emailRisk: RelayEmailRiskState
  teamPolicy: RelayTeamPolicy
  teams: RelayTeam[]
  teamInvitations?: RelayTeamInvitation[]
  messages?: RelayMessage[]
  teamMembers: RelayTeamMember[]
  users: RelayUser[]
  authIdentities: RelayAuthIdentity[]
  invites: RelayInvite[]
  ssoProviders: RelaySsoProvider[]
  passkeyChallenges: RelayPasskeyChallenge[]
  passkeys: RelayPasskeyCredential[]
  devices: RelayDevice[]
  deviceSessions: RelayDeviceSession[]
  forwardingJobs: RelayForwardingJob[]
  oauthStates: RelayOAuthState[]
  accessTokens: RelayAccessToken[]
  sessions: RelaySession[]
}
