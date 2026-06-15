/* eslint-disable max-lines -- Relay server public types stay in one package-local contract file. */
export const VERSION = '3.4.0-rc'

export interface RelayServerArgs {
  allowOrigin: string
  adminToken: string
  dataPath: string
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
export type RelayPasskeyChallengeKind = 'authentication' | 'registration'
export type RelayRegistrationMode = 'admin_created_only' | 'email_verified' | 'invite_required'
export type RelayRole = 'owner' | 'admin' | 'member' | 'viewer'
export type RelaySecretMode = 'device_encrypted' | 'proxy'
export type RelaySsoProviderType = 'oauth2' | 'oidc'
export type RelayStorageDriver = 'cloudflare-do' | 'json' | 'postgres' | 'sqlite'
export type RelayTeamRole = 'owner' | 'admin' | 'editor' | 'member' | 'viewer'
export type RelayTurnstileMode = 'auto' | 'off' | 'required'

export interface RelayPasskeyConfig {
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
  name: string
  avatarUrl?: string
  disabledAt?: string
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
  configEnabled?: boolean
  defaultForPublishing?: boolean
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
  name?: string
  userId?: string
  capabilities?: Record<string, unknown>
  workspaceFolder?: string
  pluginScope?: string
  deviceToken?: string
  deviceTokenHash?: string
  encryptedMetadata?: RelayEncryptedPayload
  createdAt: string
  lastSeenAt: string
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

export interface RelayConfigPatch {
  defaultModelService?: string
  marketplaces?: Record<string, unknown>
  modelServices?: Record<string, unknown>
  plugins?: Record<string, unknown>
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
  configAssignments: RelayConfigAssignment[]
  configProfileAssignments: RelayConfigProfileAssignment[]
  configSecrets: RelayConfigSecret[]
  configProfileVersions: RelayConfigProfileVersion[]
  configProfiles: RelayConfigProfile[]
  emailRisk: RelayEmailRiskState
  teamPolicy: RelayTeamPolicy
  teams: RelayTeam[]
  teamMembers: RelayTeamMember[]
  users: RelayUser[]
  invites: RelayInvite[]
  ssoProviders: RelaySsoProvider[]
  passkeyChallenges: RelayPasskeyChallenge[]
  passkeys: RelayPasskeyCredential[]
  devices: RelayDevice[]
  deviceSessions: RelayDeviceSession[]
  forwardingJobs: RelayForwardingJob[]
  oauthStates: RelayOAuthState[]
  sessions: RelaySession[]
}
