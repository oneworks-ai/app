import type {
  LauncherDirectoryList,
  LauncherWorkspaceOpenResponse,
  LauncherWorkspaceSelectorState
} from '@oneworks/types'

import {
  createServerUrlFromBase,
  getConfiguredServerBaseUrl,
  getServerBaseUrl,
  normalizeServerBaseUrl
} from '#~/runtime-config'

import { fetchApiJson, jsonHeaders } from './base'
import type { ApiOkResponse } from './types'

const getManagerServerBaseUrl = () => (
  normalizeServerBaseUrl(globalThis.location?.origin) ??
    getConfiguredServerBaseUrl() ??
    getServerBaseUrl()
)

const createLauncherApiUrl = (path: string) => (
  createServerUrlFromBase(getManagerServerBaseUrl(), path)
)

export const getLauncherWorkspaceSelectorState = () => (
  fetchApiJson<LauncherWorkspaceSelectorState>(createLauncherApiUrl('/api/launcher/workspaces'))
)

export const openLauncherWorkspace = (workspaceFolder: string) => (
  fetchApiJson<LauncherWorkspaceOpenResponse>(createLauncherApiUrl('/api/launcher/workspaces/open'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ workspaceFolder }),
    timeoutMs: 30_000
  })
)

export const forgetLauncherWorkspace = (workspaceFolder: string) => (
  fetchApiJson<ApiOkResponse & { workspaceFolder: string }>(createLauncherApiUrl('/api/launcher/workspaces/forget'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ workspaceFolder })
  })
)

export const listLauncherDirectories = (directory?: string) => {
  const url = new URL(createLauncherApiUrl('/api/launcher/directories'))
  if (directory != null && directory.trim() !== '') {
    url.searchParams.set('directory', directory)
  }
  return fetchApiJson<LauncherDirectoryList>(url)
}

export const createLauncherWorkspaceInDirectory = (
  parentDirectory: string,
  projectName: string
) => (
  fetchApiJson<{ workspaceFolder: string }>(createLauncherApiUrl('/api/launcher/workspaces/create'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      parentDirectory,
      projectName
    })
  })
)
