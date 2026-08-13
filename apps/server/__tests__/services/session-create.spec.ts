import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import { createSessionWithInitialMessage, discardIncompleteSessionCreation } from '#~/services/session/create.js'
import {
  cancelSessionCreation,
  resetSessionCreationCancellationState
} from '#~/services/session/creation-cancellation.js'
import { resetSessionCreationLifecycleState, waitForSessionCreation } from '#~/services/session/creation-lifecycle.js'

const mocks = vi.hoisted(() => ({
  getWorkspaceFolder: vi.fn(),
  loadConfigState: vi.fn(),
  checkoutSessionGitBranch: vi.fn(),
  createSessionGitBranch: vi.fn(),
  createServerRuntimeSession: vi.fn(),
  deleteRuntimeSessionStores: vi.fn(),
  broadcastSessionEvent: vi.fn(),
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

vi.mock('#~/services/runtime-store/session-delete.js', () => ({
  deleteRuntimeSessionStores: mocks.deleteRuntimeSessionStores
}))

vi.mock('#~/services/session/runtime.js', () => ({
  broadcastSessionEvent: mocks.broadcastSessionEvent,
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
  const getSessionRuntimeState = vi.fn()
  const getSession = vi.fn()
  const getSessionWorkspace = vi.fn()
  const saveMessage = vi.fn()
  const updateSessionTags = vi.fn()
  const deleteSession = vi.fn()
  const deleteSessionWorkspace = vi.fn()
  const createAgentRoom = vi.fn()
  const ensureAgentRoomForHostSession = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionCreationCancellationState()
    resetSessionCreationLifecycleState()

    createSession.mockImplementation((title?: string, id?: string) => ({
      id: id ?? 'sess-1',
      title,
      createdAt: Date.now()
    }))
    getSession.mockImplementation((id: string) => ({
      id,
      createdAt: Date.now()
    }))
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'interactive',
      historySeedPending: false
    })
    saveMessage.mockReturnValue(true)
    vi.mocked(getDb).mockReturnValue({
      createSession,
      updateSession,
      updateSessionRuntimeState,
      getSessionRuntimeState,
      getSession,
      getSessionWorkspace,
      saveMessage,
      updateSessionTags,
      deleteSession,
      deleteSessionWorkspace,
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
    mocks.createServerRuntimeSession.mockResolvedValue({
      runtimeRoot: '/runtime',
      sessionId: 'sess-1',
      startCommand: {
        id: 'cmd-start-1',
        commandId: 'session-start-1',
        sessionId: 'sess-1',
        source: 'web',
        ts: 123,
        type: 'start',
        content: 'hello',
        message: 'hello'
      },
      storePath: '/runtime/sess-1'
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

  it('wakes early websocket waiters only after workspace provisioning completes', async () => {
    let sessionPersisted = false
    let finishProvisioning: (() => void) | undefined
    createSession.mockImplementationOnce((title?: string, id?: string) => {
      sessionPersisted = true
      return {
        id: id ?? 'sess-creation-race',
        title,
        createdAt: Date.now()
      }
    })
    getSession.mockImplementation((id: string) =>
      sessionPersisted
        ? { id, createdAt: Date.now() }
        : undefined
    )
    mocks.provisionSessionWorkspace.mockImplementationOnce(() =>
      new Promise((resolve) => {
        finishProvisioning = () =>
          resolve({
            sessionId: 'sess-creation-race',
            workspaceFolder: '/workspace/root'
          })
      })
    )

    const waitPromise = waitForSessionCreation('sess-creation-race')
    let waiterSettled = false
    void waitPromise.then(() => {
      waiterSettled = true
    })
    const creationPromise = createSessionWithInitialMessage({
      id: 'sess-creation-race',
      shouldStart: false
    })

    await vi.waitFor(() => {
      expect(mocks.provisionSessionWorkspace).toHaveBeenCalledOnce()
    })
    expect(waiterSettled).toBe(false)

    finishProvisioning?.()
    await creationPromise
    await expect(waitPromise).resolves.toBeUndefined()
  })

  it('does not discard an existing non-shell session on duplicate creation', async () => {
    getSession.mockReturnValue({
      id: 'sess-existing',
      createdAt: Date.now(),
      messageCount: 0,
      title: 'Existing session'
    })
    createSession.mockImplementationOnce(() => {
      throw new Error('UNIQUE constraint failed: sessions.id')
    })

    await expect(createSessionWithInitialMessage({
      id: 'sess-existing',
      shouldStart: false
    })).rejects.toThrow('UNIQUE constraint failed')

    expect(mocks.deleteRuntimeSessionStores).not.toHaveBeenCalled()
    expect(deleteSession).not.toHaveBeenCalled()
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

  it('keeps the first creation cancellable after an overlapping duplicate request fails', async () => {
    let rejectProvisioning: ((error: unknown) => void) | undefined
    createSession
      .mockImplementationOnce((title?: string, id?: string) => ({
        id: id ?? 'sess-overlap-cancel',
        title,
        createdAt: Date.now()
      }))
      .mockImplementationOnce(() => {
        throw new Error('UNIQUE constraint failed: sessions.id')
      })
    mocks.provisionSessionWorkspace.mockImplementationOnce(async (_sessionId, options) =>
      new Promise((_resolve, reject) => {
        rejectProvisioning = reject
        options.signal?.addEventListener('abort', () => {
          reject(options.signal?.reason)
        }, { once: true })
      })
    )

    const firstCreation = createSessionWithInitialMessage({
      id: 'sess-overlap-cancel',
      initialMessage: 'hello'
    })
    await vi.waitFor(() => {
      expect(rejectProvisioning).toBeTypeOf('function')
    })

    await expect(createSessionWithInitialMessage({
      id: 'sess-overlap-cancel',
      initialMessage: 'duplicate'
    })).rejects.toThrow('UNIQUE constraint failed')

    expect(cancelSessionCreation('sess-overlap-cancel')).toBe('active')
    await expect(firstCreation).rejects.toMatchObject({
      code: 'session_creation_cancelled'
    })
    expect(deleteSession).toHaveBeenCalledWith('sess-overlap-cancel')
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
    expect(saveMessage).toHaveBeenCalledWith('sess-1', {
      type: 'message',
      message: {
        id: 'session-start-1',
        role: 'user',
        content: 'hello',
        agentRoom: {
          source: 'user',
          commandId: 'session-start-1',
          causedByCommandId: 'cmd-start-1'
        },
        createdAt: 123
      }
    })
    expect(updateSession).toHaveBeenCalledWith('sess-1', {
      lastMessage: 'hello',
      lastUserMessage: 'hello',
      status: 'running'
    })
    expect(mocks.broadcastSessionEvent).toHaveBeenCalledWith('sess-1', {
      type: 'message',
      message: {
        id: 'session-start-1',
        role: 'user',
        content: 'hello',
        agentRoom: {
          source: 'user',
          commandId: 'session-start-1',
          causedByCommandId: 'cmd-start-1'
        },
        createdAt: 123
      }
    })
    expect(mocks.notifySessionUpdated).toHaveBeenCalledWith('sess-1', {
      id: 'sess-1',
      createdAt: expect.any(Number)
    })
    expect(mocks.createServerRuntimeSession).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      cwd: '/workspace/root',
      title: 'Demo',
      content: 'hello',
      message: 'hello',
      runtimeContent: 'hello',
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

  it('passes the client action ID into the initial runtime command', async () => {
    const clientActionId = 'client-action-00000000-0000-4000-8000-000000000001'

    await createSessionWithInitialMessage({
      clientActionId,
      initialMessage: 'hello'
    })

    expect(mocks.createServerRuntimeSession).toHaveBeenCalledWith(expect.objectContaining({ clientActionId }))
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

  it('discards incomplete runtime and database state before deterministic retry', async () => {
    await discardIncompleteSessionCreation('resume-session-1')

    expect(mocks.deleteRuntimeSessionStores).toHaveBeenCalledWith({
      cwd: '/workspace/root',
      sessionId: 'resume-session-1'
    })
    expect(deleteSession).toHaveBeenCalledWith('resume-session-1')
  })
})
