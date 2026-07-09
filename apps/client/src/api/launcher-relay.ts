import type { LauncherDirectoryList, LauncherWorkspaceOpenResponse } from '@oneworks/types'

import { fetchApiJson, jsonHeaders } from './base'
import { createLauncherApiUrl, createLauncherClientOriginHeaders } from './launcher'

export interface LauncherRelayWorkspaceConnectionSource {
  deviceId?: string
  deviceName?: string
  serverId?: string
  serverName?: string
  workspaceFolder?: string
}

export type LauncherWorkspaceConnection =
  & Pick<
    LauncherWorkspaceOpenResponse,
    'serverBaseUrl' | 'workspaceFolder' | 'workspaceId'
  >
  & {
    relay?: LauncherRelayWorkspaceConnectionSource
  }

export const getLauncherRelayStatus = () => (
  fetchApiJson<unknown>(createLauncherApiUrl('/api/plugins/relay/proxy/relay/status'), {
    timeoutMs: 10_000
  })
)

export const openLauncherRelayWorkspace = (input: {
  deviceId: string
  deviceName?: string
  managerServerBaseUrl?: string
  serverId: string
  serverName?: string
  workspaceFolder: string
}) => (
  fetchApiJson<LauncherWorkspaceConnection>(
    createLauncherApiUrl(
      '/api/plugins/relay/proxy/relay/workspaces/open',
      input.managerServerBaseUrl
    ),
    {
      method: 'POST',
      headers: {
        ...jsonHeaders,
        ...createLauncherClientOriginHeaders()
      },
      body: JSON.stringify({
        deviceId: input.deviceId,
        ...(input.deviceName == null ? {} : { deviceName: input.deviceName }),
        serverId: input.serverId,
        ...(input.serverName == null ? {} : { serverName: input.serverName }),
        workspaceFolder: input.workspaceFolder
      }),
      timeoutMs: 45_000
    }
  )
)

export const listLauncherRelayDirectories = (input: {
  deviceId: string
  directory?: string
  serverId: string
}) => (
  fetchApiJson<LauncherDirectoryList>(createLauncherApiUrl('/api/plugins/relay/proxy/relay/workspaces/directories'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
    timeoutMs: 30_000
  })
)

export const createLauncherRelayWorkspaceInDirectory = (input: {
  deviceId: string
  parentDirectory: string
  projectName: string
  serverId: string
}) => (
  fetchApiJson<{ workspaceFolder: string }>(createLauncherApiUrl('/api/plugins/relay/proxy/relay/workspaces/create'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
    timeoutMs: 45_000
  })
)

export const getLauncherRelayWorkspaceConnection = (
  workspaceId: string,
  input: {
    managerServerBaseUrl?: string
  } = {}
) => (
  fetchApiJson<LauncherWorkspaceConnection>(
    createLauncherApiUrl(
      `/api/plugins/relay/proxy/relay/workspaces/${encodeURIComponent(workspaceId)}/connection`,
      input.managerServerBaseUrl
    ),
    {
      headers: createLauncherClientOriginHeaders(),
      timeoutMs: 10_000
    }
  )
)
