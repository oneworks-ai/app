import type { LauncherWorkspaceOpenResponse, LauncherWorkspaceVersionConflictDetails } from '@oneworks/types'

import { ApiError } from '#~/api/base'
import { mergeRuntimeEnv, normalizeServerBaseUrl } from '#~/runtime-config'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
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

export const applyWorkspaceConnection = (connection: LauncherWorkspaceOpenResponse) => {
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
