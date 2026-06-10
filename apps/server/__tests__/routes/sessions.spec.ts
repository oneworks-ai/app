/* eslint-disable max-lines -- route tests cover session endpoint behavior in one fixture. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import { sessionsRouter } from '#~/routes/sessions.js'
import { createServerRuntimeSession } from '#~/services/runtime-store/session-control.js'
import { deleteRuntimeSessionStores } from '#~/services/runtime-store/session-delete.js'
import { createSessionWithInitialMessage } from '#~/services/session/create.js'
import { resetSessionCreationCancellationState } from '#~/services/session/creation-cancellation.js'
import { applySessionEvent } from '#~/services/session/events.js'
import { branchSessionFromMessage, buildHistorySeedFromEvents } from '#~/services/session/history.js'
import {
  killSession,
  processUserMessage,
  requestSessionTermination,
  updateAndNotifySession
} from '#~/services/session/index.js'
import { notifySessionUpdated } from '#~/services/session/runtime.js'
import { provisionSessionWorkspace, resolveSessionWorkspace } from '#~/services/session/workspace.js'
import { disposeTerminalSession } from '#~/services/terminal/index.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

vi.mock('#~/services/session/create.js', () => ({
  createSessionWithInitialMessage: vi.fn()
}))

vi.mock('#~/services/session/events.js', () => ({
  applySessionEvent: vi.fn()
}))

vi.mock('#~/services/session/history.js', () => ({
  branchSessionFromMessage: vi.fn(),
  buildHistorySeedFromEvents: vi.fn(() => '历史上下文')
}))

vi.mock('#~/services/runtime-store/session-control.js', () => ({
  createServerRuntimeSession: vi.fn(),
  summarizeRuntimeSessionContent: (content: string | Array<{ text?: string; type: string }>) =>
    typeof content === 'string'
      ? content.trim()
      : content.flatMap(item => item.type === 'text' && item.text != null ? [item.text.trim()] : []).join('\n')
}))

vi.mock('#~/services/runtime-store/session-delete.js', () => ({
  deleteRuntimeSessionStores: vi.fn()
}))

vi.mock('#~/services/session/index.js', () => ({
  killSession: vi.fn(),
  processUserMessage: vi.fn(),
  requestSessionTermination: vi.fn(),
  updateAndNotifySession: vi.fn()
}))

vi.mock('#~/services/session/interaction.js', () => ({
  getSessionInteraction: vi.fn(),
  handleInteractionResponse: vi.fn(),
  setSessionInteraction: vi.fn()
}))

vi.mock('#~/services/session/queue.js', () => ({
  createSessionQueuedMessage: vi.fn(),
  deleteSessionQueuedMessage: vi.fn(),
  listSessionQueuedMessages: vi.fn(() => []),
  moveSessionQueuedMessage: vi.fn(),
  reorderSessionQueuedMessages: vi.fn(),
  updateSessionQueuedMessage: vi.fn()
}))

vi.mock('#~/services/session/runtime.js', () => ({
  broadcastSessionEvent: vi.fn(),
  notifySessionUpdated: vi.fn()
}))

vi.mock('#~/services/session/workspace.js', () => ({
  createSessionManagedWorktree: vi.fn(),
  deleteSessionWorkspace: vi.fn(),
  provisionSessionWorkspace: vi.fn(),
  resolveSessionWorkspace: vi.fn(),
  resolveSessionWorkspaceFolder: vi.fn(),
  transferSessionWorkspaceToLocal: vi.fn()
}))

vi.mock('#~/services/terminal/index.js', () => ({
  disposeTerminalSession: vi.fn()
}))

vi.mock('#~/services/workspace/tree.js', () => ({
  listWorkspaceTree: vi.fn()
}))

const findRouteHandler = (path: string, method: string) => {
  const router = sessionsRouter() as any
  const layer = router.stack.find((item: any) => {
    const paths = Array.isArray(item.path) ? item.path : [item.path]
    return paths.includes(path) && item.methods.includes(method)
  })
  if (layer == null) {
    throw new Error(`Route ${method} ${path} not found`)
  }
  return layer.stack[0] as (ctx: any) => Promise<void> | void
}

describe('sessionsRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionCreationCancellationState()
    vi.mocked(provisionSessionWorkspace).mockResolvedValue(undefined as any)
    vi.mocked(createServerRuntimeSession).mockResolvedValue({} as any)
    vi.mocked(deleteRuntimeSessionStores).mockResolvedValue(undefined)
    vi.mocked(resolveSessionWorkspace).mockResolvedValue({
      sessionId: 'session-branch',
      workspaceFolder: '/workspace/root'
    } as any)
  })

  it('returns a single session by id', () => {
    const session = {
      id: 'session-child',
      title: 'Child run session'
    }
    const db = {
      getSession: vi.fn(() => session)
    }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handleGetSession = findRouteHandler('/:id', 'GET')
    const ctx = {
      params: { id: session.id },
      body: undefined
    }

    handleGetSession(ctx)

    expect(db.getSession).toHaveBeenCalledWith(session.id)
    expect(ctx.body).toEqual({ session })
  })

  it('throws session_not_found when a single session does not exist', () => {
    const db = {
      getSession: vi.fn(() => undefined)
    }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handleGetSession = findRouteHandler('/:id', 'GET')
    const ctx = {
      params: { id: 'missing-session' },
      body: undefined
    }

    expect(() => handleGetSession(ctx)).toThrow('Session not found')
  })

  it('throws session_not_found when messages are requested for a missing session', () => {
    const db = {
      getSession: vi.fn(() => undefined),
      getMessages: vi.fn()
    }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handleGetMessages = findRouteHandler('/:id/messages', 'GET')
    const ctx = {
      params: { id: 'missing-session' },
      query: {},
      body: undefined
    }

    expect(() => handleGetMessages(ctx)).toThrow('Session not found')
    expect(db.getMessages).not.toHaveBeenCalled()
  })

  it('passes normalized tags when creating a session', async () => {
    const session = {
      id: 'session-relay'
    }
    vi.mocked(getDb).mockReturnValue({} as any)
    vi.mocked(createSessionWithInitialMessage).mockResolvedValue(session as any)

    const handleCreateSession = findRouteHandler('/', 'POST')
    const ctx = {
      request: {
        body: {
          initialMessage: 'hello',
          tags: [
            ' ow:plugin:relay:relay-server:local ',
            '',
            42,
            'alpha'
          ]
        }
      },
      body: undefined
    }

    await handleCreateSession(ctx)

    expect(createSessionWithInitialMessage).toHaveBeenCalledWith(expect.objectContaining({
      initialMessage: 'hello',
      tags: ['ow:plugin:relay:relay-server:local', 'alpha']
    }))
    expect(ctx.body).toEqual({ session })
  })

  it('updates the session permission mode through the patch route', () => {
    const db = {
      updateSessionArchivedWithChildren: vi.fn(),
      updateSessionTags: vi.fn(),
      getSession: vi.fn()
    }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handlePatch = findRouteHandler('/:id', 'PATCH')
    const ctx = {
      params: { id: 'session-1' },
      request: {
        body: {
          permissionMode: 'bypassPermissions'
        }
      },
      body: undefined
    }

    handlePatch(ctx)

    expect(updateAndNotifySession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ permissionMode: 'bypassPermissions' })
    )
    expect(killSession).not.toHaveBeenCalled()
    expect(ctx.body).toEqual({ ok: true })
  })

  it('rejects invalid session permission modes', () => {
    const db = {
      updateSessionArchivedWithChildren: vi.fn(),
      updateSessionTags: vi.fn(),
      getSession: vi.fn()
    }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handlePatch = findRouteHandler('/:id', 'PATCH')
    const ctx = {
      params: { id: 'session-1' },
      request: {
        body: {
          permissionMode: 'root'
        }
      },
      body: undefined
    }

    expect(() => handlePatch(ctx)).toThrow('Invalid permission mode')
    expect(updateAndNotifySession).not.toHaveBeenCalled()
  })

  it('accepts a user message without waiting for the adapter turn to finish', () => {
    const session = { id: 'session-message' }
    const db = {
      getSession: vi.fn(() => session)
    }
    vi.mocked(getDb).mockReturnValue(db as any)
    vi.mocked(processUserMessage).mockReturnValue(new Promise(() => undefined) as any)

    const handlePostMessage = findRouteHandler('/:id/messages', 'POST')
    const ctx = {
      params: { id: session.id },
      request: {
        body: {
          text: 'follow up'
        }
      },
      body: undefined
    }

    handlePostMessage(ctx)

    expect(db.getSession).toHaveBeenCalledWith(session.id)
    expect(processUserMessage).toHaveBeenCalledWith(session.id, 'follow up')
    expect(ctx.body).toEqual({ ok: true })
  })

  it('applies the current permission mode before accepting a user message', () => {
    const session = { id: 'session-message-permission', permissionMode: 'default' }
    const db = { getSession: vi.fn(() => session) }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handlePostMessage = findRouteHandler('/:id/messages', 'POST')
    const ctx = {
      params: { id: session.id },
      request: { body: { text: 'follow up', permissionMode: 'bypassPermissions' } },
      body: undefined
    }

    handlePostMessage(ctx)

    expect(updateAndNotifySession).toHaveBeenCalledWith(session.id, { permissionMode: 'bypassPermissions' })
    expect(processUserMessage).toHaveBeenCalledWith(session.id, 'follow up')
    expect(vi.mocked(updateAndNotifySession).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(processUserMessage).mock.invocationCallOrder[0]
    )
    expect(ctx.body).toEqual({ ok: true })
  })

  it('rejects invalid permission modes on user messages', () => {
    const session = { id: 'session-message-invalid-permission' }
    const db = { getSession: vi.fn(() => session) }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handlePostMessage = findRouteHandler('/:id/messages', 'POST')
    const ctx = {
      params: { id: session.id },
      request: { body: { text: 'follow up', permissionMode: 'root' } },
      body: undefined
    }

    expect(() => handlePostMessage(ctx)).toThrow('Invalid permission mode')
    expect(updateAndNotifySession).not.toHaveBeenCalled()
    expect(processUserMessage).not.toHaveBeenCalled()
  })

  it('accepts adapter events for session history projection', () => {
    const session = { id: 'session-compact' }
    const db = {
      getSession: vi.fn(() => session)
    }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handlePostEvent = findRouteHandler('/:id/events', 'POST')
    const ctx = {
      params: { id: session.id },
      request: {
        body: {
          type: 'adapter_event',
          data: {
            source: 'adapter',
            type: 'context_compaction',
            id: 'compact-1'
          }
        }
      },
      body: undefined
    }

    handlePostEvent(ctx)

    expect(applySessionEvent).toHaveBeenCalledWith(
      session.id,
      {
        type: 'adapter_event',
        data: {
          source: 'adapter',
          type: 'context_compaction',
          id: 'compact-1'
        }
      },
      expect.any(Object)
    )
    expect(ctx.body).toEqual({ ok: true })
  })

  it('records a pending creation cancellation when terminating a session that is not stored yet', async () => {
    const db = {
      getSession: vi.fn(() => undefined)
    }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handleTerminate = findRouteHandler('/:id/terminate', 'POST')
    const ctx = {
      params: { id: 'session-pending-create' },
      body: undefined
    }

    await handleTerminate(ctx)

    expect(requestSessionTermination).not.toHaveBeenCalled()
    expect(ctx.body).toEqual({
      ok: true,
      creationCancellation: 'pending',
      termination: {
        accepted: true,
        delivery: 'creation_pending'
      }
    })
  })

  it('does not record a pending creation cancellation for stored sessions', async () => {
    const session = { id: 'session-running' }
    const db = {
      getSession: vi.fn(() => session)
    }
    vi.mocked(getDb).mockReturnValue(db as any)
    vi.mocked(requestSessionTermination).mockResolvedValue({
      accepted: true,
      delivery: 'runtime_store'
    })

    const handleTerminate = findRouteHandler('/:id/terminate', 'POST')
    const ctx = {
      params: { id: session.id },
      body: undefined
    }

    await handleTerminate(ctx)

    expect(requestSessionTermination).toHaveBeenCalledWith(session.id)
    expect(ctx.body).toEqual({
      ok: true,
      creationCancellation: 'none',
      termination: {
        accepted: true,
        delivery: 'runtime_store'
      }
    })
  })

  it('deletes the projected runtime store when deleting a session', async () => {
    const db = {
      deleteChannelSessionBySessionId: vi.fn(),
      deleteSession: vi.fn(() => true),
      getSessionWorkspace: vi.fn(() => ({
        sessionId: 'session-delete',
        workspaceFolder: '/workspace/root'
      }))
    }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handleDeleteSession = findRouteHandler('/:id', 'DELETE')
    const ctx = {
      params: { id: 'session-delete' },
      query: { force: 'true' },
      body: undefined
    }

    await handleDeleteSession(ctx)

    expect(killSession).toHaveBeenCalledWith('session-delete', { recordWorkspaceChanges: false })
    expect(disposeTerminalSession).toHaveBeenCalledWith('session-delete')
    expect(deleteRuntimeSessionStores).toHaveBeenCalledWith({
      cwd: '/workspace/root',
      sessionId: 'session-delete'
    })
    expect(db.deleteSession).toHaveBeenCalledWith('session-delete')
    expect(notifySessionUpdated).toHaveBeenCalledWith('session-delete', {
      id: 'session-delete',
      isDeleted: true
    })
    expect(ctx.body).toEqual({ ok: true, removed: true })
  })

  it('preserves the fixed prompt target when forking a session', async () => {
    const originalSession = {
      id: 'session-root',
      title: 'Root',
      promptType: 'workspace',
      promptName: 'client'
    }
    const newSession = {
      id: 'session-fork',
      title: 'Root (Fork)'
    }
    const updatedSession = {
      ...newSession,
      promptType: 'workspace',
      promptName: 'client'
    }
    const db = {
      getSession: vi.fn((id: string) => {
        if (id === originalSession.id) return originalSession
        if (id === newSession.id) return updatedSession
        return undefined
      }),
      createSession: vi.fn(() => newSession),
      updateSession: vi.fn(),
      copyMessages: vi.fn(),
      getMessages: vi.fn(() => [{
        type: 'message',
        message: {
          id: 'msg-1',
          role: 'user',
          content: 'first prompt',
          createdAt: 100
        }
      }]),
      deleteSession: vi.fn()
    }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handleFork = findRouteHandler('/:id/fork', 'POST')
    const ctx = {
      params: { id: originalSession.id },
      request: { body: {} },
      body: undefined
    }

    await handleFork(ctx)

    expect(buildHistorySeedFromEvents).toHaveBeenCalledWith(db.getMessages.mock.results[0]?.value)
    expect(db.createSession).toHaveBeenCalledWith(
      'Root (Fork)',
      undefined,
      undefined,
      originalSession.id,
      {
        runtimeKind: 'external',
        historySeed: '历史上下文',
        historySeedPending: true
      }
    )
    expect(db.updateSession).toHaveBeenCalledWith(newSession.id, {
      promptType: 'workspace',
      promptName: 'client'
    })
    expect(provisionSessionWorkspace).toHaveBeenCalledWith(newSession.id, {
      sourceSessionId: originalSession.id
    })
    expect(db.copyMessages).toHaveBeenCalledWith(originalSession.id, newSession.id)
    expect(createServerRuntimeSession).toHaveBeenCalledWith({
      sessionId: 'session-fork',
      cwd: '/workspace/root',
      title: 'Root (Fork)',
      model: undefined,
      effort: undefined,
      permissionMode: undefined,
      adapter: undefined,
      account: undefined,
      promptType: 'workspace',
      promptName: 'client',
      systemPrompt: '历史上下文',
      start: false
    })
    expect(notifySessionUpdated).toHaveBeenCalledWith(newSession.id, updatedSession)
    expect(ctx.body).toEqual({ session: updatedSession })
  })

  it('continues message branches through runtime store with history seed', async () => {
    const branchSession = {
      id: 'session-branch',
      title: 'Branch',
      model: 'mock,codex',
      adapter: 'codex',
      promptType: 'workspace',
      promptName: 'client',
      permissionMode: 'dontAsk',
      effort: 'high'
    }
    vi.mocked(branchSessionFromMessage).mockResolvedValue({
      session: branchSession,
      replayContent: 'edited prompt',
      historySeed: '历史上下文'
    } as any)
    const db = {
      getSession: vi.fn(() => branchSession),
      updateSessionRuntimeState: vi.fn()
    }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handleBranch = findRouteHandler('/:id/messages/:messageId/branch', 'POST')
    const ctx = {
      params: { id: 'session-root', messageId: 'msg-1' },
      request: {
        body: {
          action: 'edit',
          content: 'edited prompt'
        }
      },
      body: undefined
    }

    await handleBranch(ctx)

    expect(db.updateSessionRuntimeState).toHaveBeenCalledWith('session-branch', { runtimeKind: 'external' })
    expect(createServerRuntimeSession).toHaveBeenCalledWith({
      sessionId: 'session-branch',
      cwd: '/workspace/root',
      title: 'Branch',
      content: 'edited prompt',
      message: 'edited prompt',
      model: 'mock,codex',
      effort: 'high',
      permissionMode: 'dontAsk',
      adapter: 'codex',
      account: undefined,
      promptType: 'workspace',
      promptName: 'client',
      systemPrompt: '历史上下文'
    })
    expect(ctx.body).toEqual({ session: branchSession })
  })
})
