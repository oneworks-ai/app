/* eslint-disable max-lines -- workspace connection state keeps browser, desktop, and reconnect heuristics in one boundary. */
import type {
  LauncherWorkspaceOpenResponse,
  LauncherWorkspaceVersionConflictDetails,
  WorkspaceActivityResponse,
  WorkspaceActivitySession
} from '@oneworks/types'

import { ApiError } from '#~/api/base'
import {
  createServerUrlFromBase,
  mergeRuntimeEnv,
  normalizeServerBaseUrl,
  normalizeWorkspaceId
} from '#~/runtime-config'

export const WORKSPACE_CONNECTION_CHANGE_EVENT = 'oneworks:workspace-connection-change'

export type WorkspaceServerRestartActivity =
  | { status: 'busy'; activeSessionCount: number; activeSessions: WorkspaceActivitySession[] }
  | { status: 'idle' }
  | { status: 'unknown' }

export type WorkspaceConnectionTransport = 'local' | 'relay'

export interface WorkspaceConnectionRelaySource {
  deviceId?: string
  deviceName?: string
  serverId?: string
  serverName?: string
  workspaceFolder?: string
}

export interface WorkspaceConnectionResponse {
  serverBaseUrl: string
  workspaceFolder?: string
  workspaceId?: string
}

export interface WorkspaceConnection extends WorkspaceConnectionResponse {
  managerServerBaseUrl?: string
  project?: LauncherWorkspaceOpenResponse['project']
  relay?: WorkspaceConnectionRelaySource
}

export interface WorkspaceConnectionMetadata extends WorkspaceConnection {
  transport?: WorkspaceConnectionTransport
  updatedAt?: string
}

export const withWorkspaceRouteId = (
  connection: WorkspaceConnection,
  routeWorkspaceId: string | undefined
): WorkspaceConnection => {
  // The URL identifies the workspace being mounted. Restored metadata may be stale,
  // so it can only provide an id when the route itself has none.
  const workspaceId = normalizeWorkspaceId(routeWorkspaceId) ?? normalizeWorkspaceId(connection.workspaceId)
  return workspaceId == null ? connection : { ...connection, workspaceId }
}

type StoredWorkspaceConnection = WorkspaceConnectionMetadata

interface WorkspaceSessionsResponse {
  sessions?: unknown
}

const WORKSPACE_ACTIVITY_CHECK_TIMEOUT_MS = 4_000
const ACTIVE_WORKSPACE_SESSION_STATUSES = new Set(['running', 'waiting_input'])
const WORKSPACE_CONNECTION_STORAGE_KEY = 'oneworks_workspace_connections'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const isWorkspaceConnectionResponse = (
  value: unknown
): value is WorkspaceConnectionResponse => (
  isRecord(value) &&
  typeof value.serverBaseUrl === 'string' &&
  normalizeServerBaseUrl(value.serverBaseUrl) != null &&
  (value.workspaceFolder == null || typeof value.workspaceFolder === 'string') &&
  (value.workspaceId == null || typeof value.workspaceId === 'string')
)

const isLauncherWorkspaceVersionConflictDetails = (
  value: unknown
): value is LauncherWorkspaceVersionConflictDetails => (
  isRecord(value) &&
  isRecord(value.existing) &&
  isRecord(value.requested) &&
  typeof value.workspaceFolder === 'string' &&
  typeof value.restartable === 'boolean'
)

export const getWorkspaceVersionConflictDetails = (error: unknown) => (
  error instanceof ApiError &&
    error.code === 'workspace_server_version_conflict' &&
    isLauncherWorkspaceVersionConflictDetails(error.details)
    ? error.details
    : undefined
)

const unwrapApiEnvelope = (value: unknown) => (
  isRecord(value) && value.success === true && 'data' in value ? value.data : value
)

const readActiveSession = (value: unknown): WorkspaceActivitySession | undefined => {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.trim() === '') {
    return undefined
  }

  const status = typeof value.status === 'string' && ACTIVE_WORKSPACE_SESSION_STATUSES.has(value.status)
    ? value.status as WorkspaceActivitySession['status']
    : undefined
  if (status == null) {
    return undefined
  }

  const title = typeof value.title === 'string' && value.title.trim() !== ''
    ? value.title.trim()
    : undefined
  return {
    id: value.id,
    status,
    ...(title == null ? {} : { title })
  }
}

const readActiveSessions = (value: unknown) => (
  Array.isArray(value)
    ? value.map(readActiveSession).filter((session): session is WorkspaceActivitySession => session != null)
    : []
)

const fetchWorkspaceServerJson = async (url: string): Promise<unknown> => {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), WORKSPACE_ACTIVITY_CHECK_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      credentials: 'include',
      signal: controller.signal
    })
    if (!response.ok) {
      return undefined
    }

    const text = await response.text()
    if (text.trim() === '') {
      return undefined
    }

    try {
      return unwrapApiEnvelope(JSON.parse(text) as unknown)
    } catch {
      return undefined
    }
  } catch {
    return undefined
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

const readWorkspaceActivityEndpoint = async (
  serverBaseUrl: string
): Promise<WorkspaceServerRestartActivity> => {
  const body = await fetchWorkspaceServerJson(createServerUrlFromBase(serverBaseUrl, '/api/workspace/activity'))
  if (!isRecord(body)) {
    return { status: 'unknown' }
  }

  const activity = body as Partial<WorkspaceActivityResponse>
  if (activity.idle === true) {
    return { status: 'idle' }
  }
  if (activity.idle === false) {
    const activeSessions = readActiveSessions(activity.activeSessions)
    return {
      status: 'busy',
      activeSessionCount: typeof activity.activeSessionCount === 'number'
        ? activity.activeSessionCount
        : activeSessions.length > 0
        ? activeSessions.length
        : 1,
      activeSessions
    }
  }

  return { status: 'unknown' }
}

const readWorkspaceSessionsFallback = async (
  serverBaseUrl: string
): Promise<WorkspaceServerRestartActivity> => {
  const body = await fetchWorkspaceServerJson(createServerUrlFromBase(serverBaseUrl, '/api/sessions'))
  const sessions = (body as WorkspaceSessionsResponse | undefined)?.sessions
  if (!Array.isArray(sessions)) {
    return { status: 'unknown' }
  }

  const activeSessions = readActiveSessions(sessions)
  return activeSessions.length > 0
    ? { status: 'busy', activeSessionCount: activeSessions.length, activeSessions }
    : { status: 'idle' }
}

export const getWorkspaceServerRestartActivity = async (
  details: LauncherWorkspaceVersionConflictDetails
): Promise<WorkspaceServerRestartActivity> => {
  const serverBaseUrl = normalizeServerBaseUrl(details.existing.serverBaseUrl)
  if (serverBaseUrl == null) {
    return { status: 'unknown' }
  }

  const activity = await readWorkspaceActivityEndpoint(serverBaseUrl)
  return activity.status === 'unknown'
    ? await readWorkspaceSessionsFallback(serverBaseUrl)
    : activity
}

export const applyWorkspaceConnection = (connection: WorkspaceConnectionResponse) => {
  const serverBaseUrl = normalizeServerBaseUrl(connection.serverBaseUrl)
  if (serverBaseUrl == null) {
    throw new Error('Workspace server returned an invalid URL.')
  }
  const workspaceId = normalizeWorkspaceId(connection.workspaceId)

  // Route-based workspace pages install their workspace ID before async restore;
  // transports that only return a server URL must not erase that route identity.
  mergeRuntimeEnv({
    __ONEWORKS_PROJECT_SERVER_BASE_URL__: serverBaseUrl,
    __ONEWORKS_PROJECT_SERVER_ROLE__: 'workspace',
    __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: connection.workspaceFolder,
    ...(workspaceId == null ? {} : { __ONEWORKS_PROJECT_WORKSPACE_ID__: workspaceId })
  })
}

const readWorkspaceConnectionCache = (): Record<string, StoredWorkspaceConnection> => {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(WORKSPACE_CONNECTION_STORAGE_KEY) ?? '{}') as unknown
    return isRecord(parsed) ? parsed as Record<string, StoredWorkspaceConnection> : {}
  } catch {
    return {}
  }
}

const readOptionalString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizeRelaySource = (value: unknown): WorkspaceConnectionRelaySource | undefined => {
  if (!isRecord(value)) return undefined
  const source: WorkspaceConnectionRelaySource = {
    deviceId: readOptionalString(value.deviceId),
    deviceName: readOptionalString(value.deviceName),
    serverId: readOptionalString(value.serverId),
    serverName: readOptionalString(value.serverName),
    workspaceFolder: readOptionalString(value.workspaceFolder)
  }
  return Object.values(source).some(item => item != null) ? source : undefined
}

const notifyWorkspaceConnectionChange = (workspaceId: string) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_CONNECTION_CHANGE_EVENT, {
      detail: { workspaceId }
    })
  )
}

export const rememberWorkspaceConnection = (
  connection: WorkspaceConnection,
  transport: WorkspaceConnectionTransport = 'local',
  options: {
    managerServerBaseUrl?: string
    project?: LauncherWorkspaceOpenResponse['project']
    relay?: WorkspaceConnectionRelaySource
  } = {}
) => {
  const serverBaseUrl = normalizeServerBaseUrl(connection.serverBaseUrl)
  if (serverBaseUrl == null || connection.workspaceId == null || connection.workspaceId.trim() === '') return

  const cache = readWorkspaceConnectionCache()
  const relay = normalizeRelaySource(options.relay ?? connection.relay)
  const project = options.project ?? connection.project
  const managerServerBaseUrl = normalizeServerBaseUrl(options.managerServerBaseUrl ?? connection.managerServerBaseUrl)
  cache[connection.workspaceId] = {
    ...connection,
    ...(managerServerBaseUrl == null ? {} : { managerServerBaseUrl }),
    ...(project == null ? {} : { project }),
    ...(relay == null ? {} : { relay }),
    serverBaseUrl,
    transport,
    updatedAt: new Date().toISOString()
  }
  globalThis.localStorage?.setItem(WORKSPACE_CONNECTION_STORAGE_KEY, JSON.stringify(cache))
  notifyWorkspaceConnectionChange(connection.workspaceId)
}

export const readRememberedWorkspaceConnectionMetadata = (
  workspaceId: string,
  transport?: WorkspaceConnectionTransport
): WorkspaceConnectionMetadata | undefined => {
  const connection = readWorkspaceConnectionCache()[workspaceId]
  if (connection == null) return undefined
  if (transport != null && connection.transport !== transport) return undefined
  const serverBaseUrl = normalizeServerBaseUrl(connection.serverBaseUrl)
  if (serverBaseUrl == null) return undefined
  const workspaceFolder = readOptionalString(connection.workspaceFolder)
  const resolvedWorkspaceId = readOptionalString(connection.workspaceId)
  if (workspaceFolder == null || resolvedWorkspaceId == null) return undefined
  return {
    serverBaseUrl,
    workspaceFolder,
    workspaceId: resolvedWorkspaceId,
    ...(normalizeServerBaseUrl(connection.managerServerBaseUrl) == null
      ? {}
      : { managerServerBaseUrl: normalizeServerBaseUrl(connection.managerServerBaseUrl) }),
    ...(connection.project == null ? {} : { project: connection.project }),
    ...(normalizeRelaySource(connection.relay) == null ? {} : { relay: normalizeRelaySource(connection.relay) }),
    ...(connection.transport == null ? {} : { transport: connection.transport }),
    ...(connection.updatedAt == null ? {} : { updatedAt: connection.updatedAt })
  }
}

export const readRememberedWorkspaceConnection = (
  workspaceId: string,
  transport?: WorkspaceConnectionTransport
) => {
  const connection = readRememberedWorkspaceConnectionMetadata(workspaceId, transport)
  if (connection == null) return undefined
  return {
    serverBaseUrl: connection.serverBaseUrl,
    workspaceFolder: connection.workspaceFolder,
    workspaceId: connection.workspaceId
  }
}
