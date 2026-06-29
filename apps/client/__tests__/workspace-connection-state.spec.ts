import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LauncherWorkspaceVersionConflictDetails } from '@oneworks/types'

import { getRuntimeEnv, getRuntimeWorkspaceId } from '#~/runtime-config'
import {
  applyWorkspaceConnection,
  getWorkspaceServerRestartActivity,
  isWorkspaceConnectionResponse
} from '#~/workspace-connection-state'

const createConflictDetails = (
  patch: Partial<LauncherWorkspaceVersionConflictDetails> = {}
): LauncherWorkspaceVersionConflictDetails => ({
  existing: {
    implementationId: 'git-runtime:old',
    launchConfigHash: 'old-config',
    serverBaseUrl: 'http://workspace.example.com:8787',
    workspaceFolder: '/workspace'
  },
  reason: 'implementation',
  requested: {
    implementationId: 'git-runtime:new',
    launchConfigHash: 'new-config',
    workspaceFolder: '/workspace'
  },
  restartable: true,
  workspaceFolder: '/workspace',
  ...patch
})

const createJsonResponse = (body: unknown, init?: ResponseInit) => (
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
)

const clearRuntimeEnv = () => {
  delete (globalThis as { __ONEWORKS_PROJECT_RUNTIME_ENV__?: unknown }).__ONEWORKS_PROJECT_RUNTIME_ENV__
}

describe('workspace connection state', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    clearRuntimeEnv()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearRuntimeEnv()
  })

  it('uses workspace activity when the running server exposes it', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      success: true,
      data: {
        activeSessionCount: 0,
        activeSessions: [],
        idle: true
      }
    }))

    await expect(getWorkspaceServerRestartActivity(createConflictDetails())).resolves.toEqual({
      status: 'idle'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://workspace.example.com:8787/api/workspace/activity')
  })

  it('falls back to sessions and treats running sessions as busy', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ error: 'not found' }, { status: 404 }))
      .mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          sessions: [
            { id: 'completed-1', status: 'completed' },
            { id: 'waiting-1', status: 'waiting_input' },
            { id: 'running-1', status: 'running' }
          ]
        }
      }))

    await expect(getWorkspaceServerRestartActivity(createConflictDetails())).resolves.toEqual({
      activeSessionCount: 2,
      activeSessions: [
        { id: 'waiting-1', status: 'waiting_input' },
        { id: 'running-1', status: 'running' }
      ],
      status: 'busy'
    })
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'http://workspace.example.com:8787/api/workspace/activity',
      'http://workspace.example.com:8787/api/sessions'
    ])
  })

  it('returns unknown when the existing server URL is missing', async () => {
    await expect(
      getWorkspaceServerRestartActivity(createConflictDetails({
        existing: {
          implementationId: 'git-runtime:old',
          launchConfigHash: 'old-config',
          workspaceFolder: '/workspace'
        }
      }))
    ).resolves.toEqual({ status: 'unknown' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts desktop workspace connections without a launcher workspace id', () => {
    const connection = {
      serverBaseUrl: 'http://127.0.0.1:52520',
      workspaceFolder: '/tmp/oneworks-workspace'
    }

    expect(isWorkspaceConnectionResponse(connection)).toBe(true)

    applyWorkspaceConnection(connection)

    expect(getRuntimeEnv()).toMatchObject({
      __ONEWORKS_PROJECT_SERVER_BASE_URL__: 'http://127.0.0.1:52520',
      __ONEWORKS_PROJECT_SERVER_ROLE__: 'workspace',
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: '/tmp/oneworks-workspace'
    })
    expect(getRuntimeWorkspaceId()).toBeUndefined()
  })

  it('rejects missing or invalid server URLs', () => {
    expect(isWorkspaceConnectionResponse(undefined)).toBe(false)
    expect(isWorkspaceConnectionResponse({ serverBaseUrl: '' })).toBe(false)
    expect(isWorkspaceConnectionResponse({ serverBaseUrl: 'file:///tmp/server' })).toBe(false)
  })
})
