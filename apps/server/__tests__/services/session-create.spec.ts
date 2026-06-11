import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import { createSessionWithInitialMessage } from '#~/services/session/create.js'
import {
  cancelSessionCreation,
  resetSessionCreationCancellationState
} from '#~/services/session/creation-cancellation.js'

const mocks = vi.hoisted(() => ({
  getWorkspaceFolder: vi.fn(),
  loadConfigState: vi.fn(),
  checkoutSessionGitBranch: vi.fn(),
  createSessionGitBranch: vi.fn(),
  createServerRuntimeSession: vi.fn(),
  notifySessionUpdated: vi.fn(),
  deleteSessionWorkspace: vi.fn(),
  provisionSessionWorkspace: vi.fn(),
  resolveSessionWorkspace: vi.fn()
}))

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

vi.mock('#~/services/config/index.js', () => ({
  getWorkspaceFolder: mocks.getWorkspaceFolder,
  loadConfigState: mocks.loadConfigState
}))

vi.mock('#~/services/git/index.js', () => ({
  checkoutSessionGitBranch: mocks.checkoutSessionGitBranch,
  createSessionGitBranch: mocks.createSessionGitBranch
}))

vi.mock('#~/services/runtime-store/session-control.js', () => ({
  createServerRuntimeSession: mocks.createServerRuntimeSession,
  summarizeRuntimeSessionContent: (content: string | Array<{ path?: string; text?: string; type: string }>) => {
    if (typeof content === 'string') return content.trim()
    return content.map(item => item.text ?? item.path ?? '').filter(Boolean).join('\n')
  }
}))

vi.mock('#~/services/session/runtime.js', () => ({
  notifySessionUpdated: mocks.notifySessionUpdated
}))

vi.mock('#~/services/session/workspace.js', () => ({
  deleteSessionWorkspace: mocks.deleteSessionWorkspace,
  provisionSessionWorkspace: mocks.provisionSessionWorkspace,
  resolveSessionWorkspace: mocks.resolveSessionWorkspace
}))

describe('createSessionWithInitialMessage', () => {
  const createSession = vi.fn()
  const updateSession = vi.fn()
  const updateSessionRuntimeState = vi.fn()
  const getSession = vi.fn()
  const updateSessionTags = vi.fn()
  const deleteSession = vi.fn()
  const createAgentRoom = vi.fn()
  const ensureAgentRoomForHostSession = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionCreationCancellationState()

    createSession.mockImplementation((title?: string, id?: string) => ({
      id: id ?? 'sess-1',
      title,
      createdAt: Date.now()
    }))
    getSession.mockImplementation((id: string) => ({
      id,
      createdAt: Date.now()
    }))
    vi.mocked(getDb).mockReturnValue({
      createSession,
      updateSession,
      updateSessionRuntimeState,
      getSession,
      updateSessionTags,
      deleteSession,
      createAgentRoom,
      ensureAgentRoomForHostSession
    } as any)

    mocks.getWorkspaceFolder.mockReturnValue('/workspace/root')
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder: '/workspace/root',
      projectConfig: {},
      userConfig: {},
      mergedConfig: {}
    })
    mocks.provisionSessionWorkspace.mockResolvedValue({
      sessionId: 'sess-1',
      workspaceFolder: '/workspace/root'
    })
    mocks.deleteSessionWorkspace.mockResolvedValue(true)
    mocks.resolveSessionWorkspace.mockResolvedValue({
      sessionId: 'sess-1',
      workspaceFolder: '/workspace/root'
    })
  })

  it('uses the project config default when createWorktree is not provided', async () => {
    mocks.loadConfigState.mockResolvedValueOnce({
      workspaceFolder: '/workspace/root',
      projectConfig: {},
      userConfig: {},
      mergedConfig: {
        conversation: {
          createSessionWorktree: false
        }
      }
    })

    await createSessionWithInitialMessage({
      title: 'Demo',
      shouldStart: false
    })

    expect(mocks.provisionSessionWorkspace).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        sourceSessionId: undefined,
        createWorktree: false
      })
    )
  })

  it('cancels creation before a pending session is created', async () => {
    cancelSessionCreation('sess-cancel-before-create')

    await expect(
      createSessionWithInitialMessage({
        id: 'sess-cancel-before-create',
        initialMessage: 'hello'
      })
    ).rejects.toMatchObject({
      code: 'session_creation_cancelled'
    })

    expect(createSession).not.toHaveBeenCalled()
    expect(mocks.provisionSessionWorkspace).not.toHaveBeenCalled()
  })

  it('aborts workspace provisioning and cleans up the pending session', async () => {
    mocks.provisionSessionWorkspace.mockImplementationOnce(async (_sessionId, options) => {
      cancelSessionCreation('sess-cancel-during-workspace')
      if (options.signal?.aborted === true) {
        throw options.signal.reason
      }
      throw new Error('Expected workspace signal to be aborted')
    })

    await expect(
      createSessionWithInitialMessage({
        id: 'sess-cancel-during-workspace',
        initialMessage: 'hello',
        workspace: {
          createWorktree: true
        }
      })
    ).rejects.toMatchObject({
      code: 'session_creation_cancelled'
    })

    expect(mocks.deleteSessionWorkspace).toHaveBeenCalledWith('sess-cancel-during-workspace', { force: true })
    expect(deleteSession).toHaveBeenCalledWith('sess-cancel-during-workspace')
  })

  it('uses the shared workspace by default when the project config is not set', async () => {
    await createSessionWithInitialMessage({
      title: 'Demo',
      shouldStart: false
    })

    expect(mocks.provisionSessionWorkspace).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        sourceSessionId: undefined,
        createWorktree: false
      })
    )
  })

  it('prefers the explicit workspace option over the project config default', async () => {
    mocks.loadConfigState.mockResolvedValueOnce({
      workspaceFolder: '/workspace/root',
      projectConfig: {},
      userConfig: {},
      mergedConfig: {
        conversation: {
          createSessionWorktree: false
        }
      }
    })

    await createSessionWithInitialMessage({
      title: 'Demo',
      shouldStart: false,
      workspace: {
        createWorktree: true
      }
    })

    expect(mocks.provisionSessionWorkspace).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        sourceSessionId: undefined,
        createWorktree: true
      })
    )
  })

  it('can source a shared workspace from another session without making it the parent session', async () => {
    await createSessionWithInitialMessage({
      title: 'Panel session',
      shouldStart: false,
      workspace: {
        sourceSessionId: 'source-session',
        createWorktree: false
      }
    })

    expect(createSession).toHaveBeenCalledWith('Panel session', undefined, undefined, undefined, {
      runtimeKind: 'interactive'
    })
    expect(mocks.provisionSessionWorkspace).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        sourceSessionId: 'source-session',
        createWorktree: false
      })
    )
  })

  it('persists the fixed prompt target and starts a runtime-store backed session', async () => {
    await createSessionWithInitialMessage({
      title: 'Demo',
      initialMessage: 'hello',
      promptType: 'workspace',
      promptName: 'client'
    })

    expect(updateSession).toHaveBeenCalledWith('sess-1', {
      model: undefined,
      effort: undefined,
      permissionMode: undefined,
      adapter: undefined,
      account: undefined,
      promptType: 'workspace',
      promptName: 'client'
    })
    expect(updateSessionRuntimeState).toHaveBeenCalledWith('sess-1', { runtimeKind: 'external' })
    expect(mocks.createServerRuntimeSession).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      cwd: '/workspace/root',
      title: 'Demo',
      content: 'hello',
      message: 'hello',
      model: undefined,
      effort: undefined,
      permissionMode: undefined,
      systemPrompt: undefined,
      adapter: undefined,
      account: undefined,
      promptType: 'workspace',
      promptName: 'client',
      updateConfiguredSkills: false
    })
  })

  it('starts file-only initial content through runtime store', async () => {
    await createSessionWithInitialMessage({
      title: 'Demo',
      initialContent: [{ type: 'file', path: '/workspace/root/README.md' }],
      systemPrompt: 'channel prompt',
      account: 'work',
      updateSkills: true
    })

    expect(mocks.createServerRuntimeSession).toHaveBeenCalledWith(expect.objectContaining({
      account: 'work',
      content: [{ type: 'file', path: '/workspace/root/README.md' }],
      message: '/workspace/root/README.md',
      systemPrompt: 'channel prompt',
      updateConfiguredSkills: true
    }))
  })

  it('does not create an agent room for ordinary session creation', async () => {
    await createSessionWithInitialMessage({
      title: 'Demo',
      initialMessage: 'hello',
      shouldStart: false
    })

    expect(createAgentRoom).not.toHaveBeenCalled()
    expect(ensureAgentRoomForHostSession).not.toHaveBeenCalled()
  })
})
