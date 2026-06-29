import type {
  LauncherWorkspaceVersionConflictDetails,
  WorkspaceActivityResponse,
  WorkspaceActivitySession
} from '@oneworks/types'

import { ApiError } from '#~/api/base'
import { createServerUrlFromBase, mergeRuntimeEnv, normalizeServerBaseUrl } from '#~/runtime-config'

export type WorkspaceServerRestartActivity =
  | { status: 'busy'; activeSessionCount: number; activeSessions: WorkspaceActivitySession[] }
  | { status: 'idle' }
  | { status: 'unknown' }

export interface WorkspaceConnectionResponse {
  serverBaseUrl: string
  workspaceFolder?: string
  workspaceId?: string
}

interface WorkspaceSessionsResponse {
  sessions?: unknown
}

const WORKSPACE_ACTIVITY_CHECK_TIMEOUT_MS = 4_000
const ACTIVE_WORKSPACE_SESSION_STATUSES = new Set(['running', 'waiting_input'])

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

  mergeRuntimeEnv({
    __ONEWORKS_PROJECT_SERVER_BASE_URL__: serverBaseUrl,
    __ONEWORKS_PROJECT_SERVER_ROLE__: 'workspace',
    __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: connection.workspaceFolder,
    __ONEWORKS_PROJECT_WORKSPACE_ID__: connection.workspaceId
  })
}
