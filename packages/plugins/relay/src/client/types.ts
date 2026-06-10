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
    servers?: RelayServerStatus[]
  }
  servers?: RelayServerStatus[]
  [key: string]: unknown
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
  devices?: RelayDeviceSummary[]
  devicesError?: string
  hasToken?: boolean
  id?: string
  name?: string
  port?: number
  protocol?: string
  registeredAt?: string | null
  remoteBaseUrl?: string
  server?: string
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

export interface RelayLoginCallback {
  serverId?: string
  token: string
}

export interface RelayLoginUrlResponse {
  loginUrl?: string
}
