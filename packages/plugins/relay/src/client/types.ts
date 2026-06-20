/* eslint-disable max-lines -- relay client types mirror account status, config sharing, and source controls. */
import type { RelayClientI18nHost } from './i18n.js'

export interface Disposable {
  dispose: () => void
}

export interface PluginClientContext {
  scope: string
  api: {
    fetch: (path: string, init?: RequestInit) => Promise<Response>
  }
  commands: {
    register: (commandId: string, handler: (payload?: unknown) => unknown | Promise<unknown>) => Disposable
  }
  i18n?: RelayClientI18nHost & {
    subscribe?: (listener: () => void) => Disposable
  }
  notifications?: {
    show?: (input: {
      description?: string
      level?: 'error' | 'info' | 'success' | 'warning'
      title: string
    }) => { close?: () => void; id?: string } | void
  }
  options?: Record<string, unknown>
  slots?: {
    register: (slot: string, contribution: Record<string, unknown> & { id: string }) => Disposable
  }
  views: {
    register: (
      viewId: string,
      render: (container: HTMLElement, view?: PluginViewContext) => Disposable | void
    ) => Disposable
  }
}

export interface PluginViewContext {
  options?: {
    update?: (
      options: Record<string, unknown>,
      target?: 'workspace' | 'global'
    ) => Promise<Record<string, unknown>>
    value?: Record<string, unknown>
  }
}

export interface RelayStatus {
  configDistribution?: RelayConfigDistributionStatus
  configSync?: RelayConfigDistributionStatus
  connection?: {
    activeServerId?: string
    remoteBaseUrl?: string
    state?: string
  }
  device?: {
    hasToken?: boolean
    id?: string
    name?: string
  }
  options?: {
    deviceName?: string
    officialServices?: {
      cloudflare?: boolean
      vercel?: boolean
    }
    servers?: RelayServerStatus[]
  }
  servers?: RelayServerStatus[]
  [key: string]: unknown
}

export interface RelayConfigDistributionStatus {
  allowedFields?: string[]
  hash?: string | null
  lastAppliedAt?: string | null
  lastError?: string | null
  lastSyncedAt?: string | null
  marketplaceKeys?: string[]
  matchedProject?: boolean | string | null
  modelServiceKeys?: string[]
  pluginKeys?: string[]
  skillKeys?: string[]
  skillRegistryKeys?: string[]
  sourceServerId?: string | null
  sources?: RelayConfigDistributionSourceStatus[]
  version?: string | null
}

export interface RelayConfigDistributionSourceStatus {
  assignmentId?: string
  disabledBy?: Array<'assignment' | 'profile' | 'team'>
  enabled?: boolean
  fields?: string[]
  mode?: 'default' | 'override'
  profileId?: string
  profileName?: string
  teamId?: string
  teamName?: string
  version?: number
  versionId?: string
}

export interface RelayServerStatus {
  account?: {
    avatarUrl?: string
    email?: string
    name?: string
  }
  accountAvatarUrl?: string
  accountEmail?: string
  accountName?: string
  active?: boolean
  connected?: boolean
  connection?: {
    activeServerId?: string
    lastConnectedAt?: string | null
    lastError?: string | null
    message?: string
    remoteBaseUrl?: string
    state?: string
  }
  devices?: RelayDeviceSummary[]
  devicesError?: string
  hasToken?: boolean
  id?: string
  name?: string
  official?: boolean
  platform?: string
  port?: number
  protocol?: string
  registeredAt?: string | null
  remoteBaseUrl?: string
  server?: string
  sessionAuthenticated?: boolean
  sessionExpiresAt?: string | null
}

export interface RelayDeviceSummary {
  capabilities?: Record<string, unknown>
  createdAt?: string
  id?: string
  lastSeenAt?: string
  name?: string
  pluginScope?: string
  status?: string
}

export interface RelayViewState {
  error: string | null
  loading: boolean
  status: RelayStatus | null
}

export interface RelayConfigShareDraft {
  allowedFields?: string[]
  configPatch?: Record<string, unknown>
  fieldSummaries?: Array<{
    field?: string
    itemCount?: number
    secretCount?: number
  }>
  issues?: Array<{
    code?: string
    message?: string
    path?: string
    severity?: string
  }>
  rejectedFields?: string[]
  secretItems?: Array<{
    displayName?: string
    path?: string
    ref?: string
  }>
}

export interface RelayConfigShareTargets {
  profilesByTeamId?: Record<string, unknown[]>
  teams?: Array<{
    id?: string
    membership?: {
      role?: string
    } | null
    name?: string
    slug?: string
  }>
}

export interface RelayConfigShareViewState {
  draft: RelayConfigShareDraft | null
  error: string | null
  loading: boolean
  profileName: string
  publishing: boolean
  targets: RelayConfigShareTargets | null
  teamId: string
  text: string
}

export interface RelayLoginCallback {
  serverId?: string
  token: string
}

export interface RelayLoginUrlResponse {
  loginUrl?: string
}
