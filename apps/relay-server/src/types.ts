export const VERSION = '3.4.0-rc'

export interface RelayServerArgs {
  allowOrigin: string
  adminToken: string
  dataPath: string
  deviceOnlineTtlMs?: number
  help?: boolean
  host: string
  oauth?: Record<string, RelayOAuthClient | undefined>
  port: number
  publicBaseUrl?: string
  sessionTtlMs?: number
  storageDriver?: RelayStorageDriver
}

export type RelayAuthProvider = string
export type RelayRole = 'owner' | 'admin' | 'member' | 'viewer'
export type RelaySsoProviderType = 'oauth2' | 'oidc'
export type RelayStorageDriver = 'json' | 'postgres' | 'sqlite'

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
  createdAt: string
  updatedAt?: string
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
  users: RelayUser[]
  invites: RelayInvite[]
  ssoProviders: RelaySsoProvider[]
  devices: RelayDevice[]
  deviceSessions: RelayDeviceSession[]
  forwardingJobs: RelayForwardingJob[]
  oauthStates: RelayOAuthState[]
  sessions: RelaySession[]
}
