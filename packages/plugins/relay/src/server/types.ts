import type { Buffer } from 'node:buffer'

import type { RelayConfigSourcePreferences } from './config-source-preferences.js'
import type { RelayLocalSessionAdapter } from './session-types.js'

export type RelayLocalizedText = string | Record<string, string>

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
  body: Buffer
}

export interface PluginProxyResponse {
  status?: number
  headers?: Record<string, string>
  body?: unknown
}

export interface RelayCapabilities {
  sessions: boolean
  terminal: boolean
  workspaceFiles: boolean
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
  registeredAt?: string
  remoteBaseUrl: string
  sessionExpiresAt?: string
  sessionToken?: string
  updatedAt?: string
}

export interface RelayRemoteDeviceSummary {
  capabilities?: Record<string, unknown>
  createdAt?: string
  id?: string
  lastSeenAt?: string
  name?: string
  pluginScope?: string
  status?: string
}

export interface RelayAccountProfile {
  avatarUrl?: string
  email?: string
  id?: string
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
  connected: boolean
  connection: RelayConnectionState
  devices?: RelayRemoteDeviceSummary[]
  devicesError?: string
  hasToken: boolean
  registeredAt: string | null
  sessionExpiresAt: string | null
  sessionAuthenticated: boolean
  updatedAt: string | null
}

export interface RelayPublicStatus {
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
  servers: RelayPublicServerStatus[]
  storePath: string
}
