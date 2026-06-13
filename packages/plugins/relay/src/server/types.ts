import type { Buffer } from 'node:buffer'

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
  deviceToken: string
  id: string
  registeredAt?: string
  remoteBaseUrl: string
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
