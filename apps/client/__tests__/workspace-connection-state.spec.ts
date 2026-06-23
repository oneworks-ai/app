import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LauncherWorkspaceVersionConflictDetails } from '@oneworks/types'

import { getWorkspaceServerRestartActivity } from '#~/workspace-connection-state'

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

describe('workspace connection state', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
})
