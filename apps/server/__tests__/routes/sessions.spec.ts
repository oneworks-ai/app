/* eslint-disable max-lines -- route tests cover session endpoint behavior in one fixture. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import { sessionsRouter } from '#~/routes/sessions.js'
import {
  consumeNativeProjectHistoryImportPrompt,
  importNativeProjectHistoryAndReplay,
  previewNativeProjectHistory
} from '#~/services/runtime-store/history-import.js'
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
  resolveExternalRuntimeProjectConfigFailure,
  retryExternalRuntimeSessionProjectConfig,
  updateAndNotifySession
} from '#~/services/session/index.js'
import {
  createSessionQueuedMessage,
  moveSessionQueuedMessage,
  reorderSessionQueuedMessages,
  updateSessionQueuedMessage
} from '#~/services/session/queue.js'
import { notifySessionUpdated } from '#~/services/session/runtime.js'
import { provisionSessionWorkspace, resolveSessionWorkspace } from '#~/services/session/workspace.js'
import { disposeTerminalSession } from '#~/services/terminal/index.js'
import { openWorkspaceFileInExternalOpener } from '#~/services/workspace/file-opener.js'

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

vi.mock('#~/services/runtime-store/history-import.js', () => ({
  consumeNativeProjectHistoryImportPrompt: vi.fn(),
  importNativeProjectHistoryAndReplay: vi.fn(),
  previewNativeProjectHistory: vi.fn()
}))

vi.mock('#~/services/runtime-store/session-delete.js', () => ({
  deleteRuntimeSessionStores: vi.fn()
}))

vi.mock('#~/services/session/index.js', () => ({
  killSession: vi.fn(),
  processUserMessage: vi.fn(),
  requestSessionTermination: vi.fn(),
  resolveExternalRuntimeProjectConfigFailure: vi.fn(),
  retryExternalRuntimeSessionProjectConfig: vi.fn(),
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

vi.mock('#~/services/workspace/file-opener.js', () => ({
  openWorkspaceFileInExternalOpener: vi.fn()
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

  it('triggers native project history import', async () => {
    const result = {
      importedEvents: 2,
      importedSessions: 1,
      matchedFiles: 1,
      scannedFiles: 3,
      sessions: [{
        adapter: 'codex',
        createdAt: 1000,
        importedEvents: 2,
        sessionId: 'imported_codex_1',
        sourcePath: '/home/.codex/sessions/1.jsonl',
        title: 'Imported Codex session',
        updatedAt: 2000
      }]
    }
    vi.mocked(getDb).mockReturnValue({} as any)
    vi.mocked(consumeNativeProjectHistoryImportPrompt).mockResolvedValue(result as any)

    const handleImport = findRouteHandler('/native-history-import', 'POST')
    const ctx = {
      body: undefined
    }

    await handleImport(ctx)

    expect(consumeNativeProjectHistoryImportPrompt).toHaveBeenCalledWith()
    expect(ctx.body).toEqual(result)
  })

  it('runs native project history import manually', async () => {
    const result = {
      importedEvents: 0,
      importedSessions: 0,
      matchedFiles: 1,
      scannedFiles: 1,
      sessions: [{
        adapter: 'claude-code',
        createdAt: 1000,
        importedEvents: 0,
        sessionId: 'imported_claude_code_1',
        sourcePath: '/home/.claude/projects/app/1.jsonl',
        title: 'Already imported Claude session',
        updatedAt: 2000
      }]
    }
    vi.mocked(getDb).mockReturnValue({} as any)
    vi.mocked(importNativeProjectHistoryAndReplay).mockResolvedValue(result as any)

    const handleImport = findRouteHandler('/native-history-import/run', 'POST')
    const ctx = {
      request: {
        body: {
          adapters: ['claude-code'],
          projectScope: 'all-projects',
          sourcePaths: ['/home/.claude/projects/app/1.jsonl']
        }
      },
      body: undefined
    }

    await handleImport(ctx)

    expect(importNativeProjectHistoryAndReplay).toHaveBeenCalledWith({
      adapters: ['claude-code'],
      projectScope: 'all-projects',
      sourcePaths: ['/home/.claude/projects/app/1.jsonl']
    })
    expect(ctx.body).toEqual(result)
  })

  it('previews native project history candidates without importing', async () => {
    const result = {
      adapters: [{
        adapter: 'codex',
        candidates: [{
          adapter: 'codex',
          createdAt: 1000,
          cwd: '/workspace/root',
          fileSizeBytes: 1024,
          isImported: false,
          isLarge: false,
          nativeSessionId: 'codex-native-1',
          sourcePath: '/home/.codex/sessions/1.jsonl',
          title: 'Preview Codex session',
          updatedAt: 2000
        }],
        hasMore: false,
        isComplete: true,
        largeFiles: 0,
        largestFileBytes: 1024,
        matchedFiles: 1,
        scannedFiles: 2,
        totalBytes: 1024
      }],
      hasMore: false,
      isComplete: true,
      largeFileThresholdBytes: 26214400,
      largeFiles: 0,
      largestFileBytes: 1024,
      matchedFiles: 1,
      scannedFiles: 2,
      totalBytes: 1024
    }
    vi.mocked(getDb).mockReturnValue({} as any)
    vi.mocked(previewNativeProjectHistory).mockResolvedValue(result as any)

    const handlePreview = findRouteHandler('/native-history-import/preview', 'POST')
    const ctx = {
      request: {
        body: {
          adapters: ['codex'],
          candidateScope: 'unarchived',
          cursor: 'cursor-1',
          limit: 24,
          projectScope: 'current-project',
          threadScope: 'user',
          timeFilter: {
            createdAt: { to: 3000 },
            updatedAt: { from: 1000 }
          },
          timeSort: 'activity'
        }
      },
      body: undefined
    }

    await handlePreview(ctx)

    expect(previewNativeProjectHistory).toHaveBeenCalledWith({
      adapters: ['codex'],
      candidateScope: 'unarchived',
      previewCursor: 'cursor-1',
      previewLimit: 24,
      projectScope: 'current-project',
      threadScope: 'user',
      timeFilter: {
        createdAt: { to: 3000 },
        updatedAt: { from: 1000 }
      },
      timeSort: 'activity'
    })
    expect(importNativeProjectHistoryAndReplay).not.toHaveBeenCalled()
    expect(ctx.body).toEqual(result)
  })

  it('rejects invalid native history import adapters', async () => {
    vi.mocked(getDb).mockReturnValue({} as any)

    const handleImport = findRouteHandler('/native-history-import/run', 'POST')
    const ctx = {
      request: {
        body: {
          adapters: ['codex', 'cursor']
        }
      },
      body: undefined
    }

    await expect(handleImport(ctx)).rejects.toThrow('Invalid native history adapter')
    expect(importNativeProjectHistoryAndReplay).not.toHaveBeenCalled()
  })

  it('rejects invalid native history project scope', async () => {
    vi.mocked(getDb).mockReturnValue({} as any)

    const handleImport = findRouteHandler('/native-history-import/run', 'POST')
    const ctx = {
      request: {
        body: {
          adapters: ['codex'],
          projectScope: 'workspace'
        }
      },
      body: undefined
    }

    await expect(handleImport(ctx)).rejects.toThrow('Invalid native history project scope')
    expect(importNativeProjectHistoryAndReplay).not.toHaveBeenCalled()
  })

  it('rejects invalid native history thread scope', async () => {
    vi.mocked(getDb).mockReturnValue({} as any)

    const handlePreview = findRouteHandler('/native-history-import/preview', 'POST')
    const ctx = {
      request: {
        body: {
          adapters: ['codex'],
          threadScope: 'worker'
        }
      },
      body: undefined
    }

    await expect(handlePreview(ctx)).rejects.toThrow('Invalid native history thread scope')
    expect(previewNativeProjectHistory).not.toHaveBeenCalled()
  })

  it('rejects invalid native history time filters', async () => {
    vi.mocked(getDb).mockReturnValue({} as any)

    const handlePreview = findRouteHandler('/native-history-import/preview', 'POST')
    const ctx = {
      request: {
        body: {
          adapters: ['codex'],
          timeFilter: {
            updatedAt: { from: 3000, to: 1000 }
          }
        }
      },
      body: undefined
    }

    await expect(handlePreview(ctx)).rejects.toThrow('Invalid native history time filter range')
    expect(previewNativeProjectHistory).not.toHaveBeenCalled()
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
      getMessageWindowWithCursor: vi.fn()
    }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handleGetMessages = findRouteHandler('/:id/messages', 'GET')
    const ctx = {
      params: { id: 'missing-session' },
      query: {},
      body: undefined
    }

    expect(() => handleGetMessages(ctx)).toThrow('Session not found')
    expect(db.getMessageWindowWithCursor).not.toHaveBeenCalled()
  })

  it('uses the full cursor message window when no message window query is provided', () => {
    const session = { id: 'session-full', title: 'Full history' }
    const db = {
      getMessageWindowWithCursor: vi.fn(() => ({
        cursor: { firstId: 1, lastId: 1 },
        messages: [{
          type: 'message',
          message: {
            id: 'message-full',
            role: 'assistant',
            content: 'full history',
            createdAt: 1,
            sentinel: 'DROP_ME'
          }
        }]
      })),
      getSession: vi.fn(() => session)
    }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handleGetMessages = findRouteHandler('/:id/messages', 'GET')
    const ctx = {
      params: { id: 'session-full' },
      query: {},
      body: undefined
    }

    handleGetMessages(ctx)

    expect(db.getMessageWindowWithCursor).toHaveBeenCalledWith('session-full', {})
    expect(ctx.body).toMatchObject({
      cursor: { firstId: 1, lastId: 1 },
      messages: [{
        type: 'message',
        message: {
          id: 'message-full',
          role: 'assistant',
          content: 'full history',
          createdAt: 1
        }
      }],
      session
    })
  })

  it('uses a bounded DB message window when message pagination query is provided', () => {
    const session = { id: 'session-window', title: 'Windowed history' }
    const db = {
      getMessageWindowWithCursor: vi.fn(() => ({
        cursor: { firstId: 13, lastId: 13 },
        messages: [{
          type: 'message',
          message: {
            id: 'message-window',
            role: 'assistant',
            content: 'window history',
            createdAt: 13
          }
        }]
      })),
      getSession: vi.fn(() => session)
    }
    vi.mocked(getDb).mockReturnValue(db as any)

    const handleGetMessages = findRouteHandler('/:id/messages', 'GET')
    const ctx = {
      params: { id: 'session-window' },
      query: {
        afterId: '12',
        beforeId: '9',
        limit: '3000'
      },
      body: undefined
    }

    handleGetMessages(ctx)

    expect(db.getMessageWindowWithCursor).toHaveBeenCalledWith('session-window', {
      afterId: 12,
      beforeId: 9,
      limit: 1000
    })
    expect(ctx.body).toMatchObject({
      cursor: { firstId: 13, lastId: 13 },
      messages: [{
        type: 'message',
        message: {
          id: 'message-window',
          role: 'assistant',
          content: 'window history',
          createdAt: 13
        }
      }],
      session
    })
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

    expect(() => handlePatch(ctx)).toThrow('Invalid session update')
    expect(updateAndNotifySession).not.toHaveBeenCalled()
  })

  it('parses the entire patch plan before any write', () => {
    const db = {
      updateSessionArchivedWithChildren: vi.fn(),
      updateSessionTags: vi.fn(),
      getSession: vi.fn()
    }
    vi.mocked(getDb).mockReturnValue(db as any)
    const handlePatch = findRouteHandler('/:id', 'PATCH')
    const ctx = {
      params: { id: 'session-atomic' },
      request: {
        body: {
          title: 'valid early field',
          isStarred: true,
          tags: ['valid'],
          panelState: {
            bottom: { tabs: [], unknownLaterField: true },
            right: { tabs: [] }
          }
        }
      },
      body: undefined
    }

    expect(() => handlePatch(ctx)).toThrow('Invalid session update')
    expect(updateAndNotifySession).not.toHaveBeenCalled()
    expect(db.updateSessionArchivedWithChildren).not.toHaveBeenCalled()
    expect(db.updateSessionTags).not.toHaveBeenCalled()
    expect(notifySessionUpdated).not.toHaveBeenCalled()
  })

  it('accepts the panel string limit and rejects limit plus one before writes', () => {
    const db = {
      updateSessionArchivedWithChildren: vi.fn(),
      updateSessionTags: vi.fn(),
      getSession: vi.fn()
    }
    vi.mocked(getDb).mockReturnValue(db as any)
    const handlePatch = findRouteHandler('/:id', 'PATCH')
    const panel = (title: string) => ({
      bottom: { tabs: [{ id: 'tab', title, kind: 'file', path: '/tmp/file' }] },
      right: { tabs: [] }
    })

    handlePatch({
      params: { id: 'session-limit' },
      request: { body: { panelState: panel('x'.repeat(16 * 1024)) } },
      body: undefined
    })
    expect(updateAndNotifySession).toHaveBeenCalledTimes(1)

    vi.mocked(updateAndNotifySession).mockClear()
    expect(() => handlePatch({
      params: { id: 'session-over-limit' },
      request: { body: { panelState: panel('x'.repeat((16 * 1024) + 1)) } },
      body: undefined
    })).toThrow('Invalid session update')
    expect(updateAndNotifySession).not.toHaveBeenCalled()
  })

  it('pre-scans exact panel SafeJson depth and performs no partial PATCH write', () => {
    const db = {
      updateSessionArchivedWithChildren: vi.fn(),
      updateSessionTags: vi.fn(),
      getSession: vi.fn()
    }
    vi.mocked(getDb).mockReturnValue(db as any)
    const handlePatch = findRouteHandler('/:id', 'PATCH')
    const nestedState = (objectCount: number) => {
      let value: unknown = 'leaf'
      for (let index = 0; index < objectCount; index += 1) value = { child: value }
      return value
    }
    const body = (state: unknown) => ({
      title: 'valid early field',
      panelState: {
        bottom: {
          tabs: [{
            id: 'plugin',
            title: 'Plugin',
            kind: 'plugin',
            pluginScope: 'example',
            tabId: 'tab',
            viewId: 'view',
            state
          }]
        },
        right: { tabs: [] }
      }
    })

    handlePatch({
      params: { id: 'session-depth' },
      request: { body: body(nestedState(7)) },
      body: undefined
    })
    expect(updateAndNotifySession).toHaveBeenCalledTimes(1)

    vi.mocked(updateAndNotifySession).mockClear()
    expect(() => handlePatch({
      params: { id: 'session-depth-over' },
      request: { body: body(nestedState(8)) },
      body: undefined
    })).toThrow('Invalid session update')
    expect(updateAndNotifySession).not.toHaveBeenCalled()
    expect(db.updateSessionArchivedWithChildren).not.toHaveBeenCalled()
    expect(db.updateSessionTags).not.toHaveBeenCalled()
  })

  it('iteratively rejects extreme depth, breadth, prototype and cycles with zero writes', () => {
    const db = {
      updateSessionArchivedWithChildren: vi.fn(),
      updateSessionTags: vi.fn(),
      getSession: vi.fn()
    }
    vi.mocked(getDb).mockReturnValue(db as any)
    const handlePatch = findRouteHandler('/:id', 'PATCH')
    const body = (state: unknown) => ({
      title: 'valid early field',
      panelState: {
        bottom: {
          tabs: [{
            id: 'plugin',
            title: 'Plugin',
            kind: 'plugin',
            pluginScope: 'example',
            tabId: 'tab',
            viewId: 'view',
            state
          }]
        },
        right: { tabs: [] }
      }
    })
    let extremelyDeep: unknown = 'leaf'
    for (let index = 0; index < 5_000; index += 1) {
      extremelyDeep = { child: extremelyDeep }
    }
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const broad = Object.fromEntries(
      Array.from({ length: 1_025 }, (_, index) => [`field-${index}`, index])
    )
    const inherited = Object.create({ inherited: true }) as Record<string, unknown>
    inherited.visible = 'value'
    const accessor = {}
    Object.defineProperty(accessor, 'value', {
      enumerable: true,
      get: () => {
        throw new Error('scanner must not invoke accessors')
      }
    })
    const nullPrototype = Object.assign(Object.create(null), { value: 'allowed JSON record' })
    for (const [suffix, state] of [
      ['plain-record', { value: 'allowed plain record' }],
      ['plain-array', ['allowed', 'plain', 'array']],
      ['null-prototype', nullPrototype]
    ] as const) {
      handlePatch({
        params: { id: `session-${suffix}` },
        request: { body: body(state) },
        body: undefined
      })
    }
    expect(updateAndNotifySession).toHaveBeenCalledTimes(3)
    vi.mocked(updateAndNotifySession).mockClear()

    const proxyTrapCounts = {
      get: 0,
      getOwnPropertyDescriptor: 0,
      getPrototypeOf: 0,
      ownKeys: 0
    }
    const proxyHandler = {
      get: () => {
        proxyTrapCounts.get += 1
        throw new Error('proxy get trap must not execute')
      },
      getOwnPropertyDescriptor: () => {
        proxyTrapCounts.getOwnPropertyDescriptor += 1
        throw new Error('proxy descriptor trap must not execute')
      },
      getPrototypeOf: () => {
        proxyTrapCounts.getPrototypeOf += 1
        throw new Error('proxy prototype trap must not execute')
      },
      ownKeys: () => {
        proxyTrapCounts.ownKeys += 1
        throw new Error('proxy ownKeys trap must not execute')
      }
    }
    const proxy = new Proxy({ value: 'must not be inspected' }, proxyHandler)
    const proxyBody = new Proxy(body({ value: 'safe nested record' }), proxyHandler)
    const proxyArray = new Proxy(['must not be inspected'], proxyHandler)
    const proxyArrayBody = new Proxy(['root array must not be inspected'], proxyHandler)

    for (const [suffix, state] of [
      ['depth', extremelyDeep],
      ['cycle', cycle],
      ['breadth', broad],
      ['prototype', inherited],
      ['accessor', accessor],
      ['proxy', proxy],
      ['proxy-array', proxyArray]
    ] as const) {
      expect(() => handlePatch({
        params: { id: `session-${suffix}` },
        request: { body: body(state) },
        body: undefined
      })).toThrow('Invalid session update')
    }
    expect(() => handlePatch({
      params: { id: 'session-root-proxy' },
      request: { body: proxyBody },
      body: undefined
    })).toThrow('Invalid session update')
    expect(() => handlePatch({
      params: { id: 'session-root-proxy-array' },
      request: { body: proxyArrayBody },
      body: undefined
    })).toThrow('Invalid session update')
    expect(proxyTrapCounts).toEqual({
      get: 0,
      getOwnPropertyDescriptor: 0,
      getPrototypeOf: 0,
      ownKeys: 0
    })
    expect(updateAndNotifySession).not.toHaveBeenCalled()
    expect(db.updateSessionArchivedWithChildren).not.toHaveBeenCalled()
    expect(db.updateSessionTags).not.toHaveBeenCalled()
  })

  it('validates queue content limits and secrets before persistence', () => {
    const db = { getSession: vi.fn(() => ({ id: 'session-queue' })) }
    vi.mocked(getDb).mockReturnValue(db as any)
    vi.mocked(createSessionQueuedMessage).mockReturnValue({
      id: 'queue-1',
      sessionId: 'session-queue',
      mode: 'next',
      content: [{ type: 'text', text: 'x' }],
      createdAt: 1,
      updatedAt: 1,
      order: 1
    } as any)
    const handleCreate = findRouteHandler('/:id/queued-messages', 'POST')

    handleCreate({
      params: { id: 'session-queue' },
      request: {
        body: { mode: 'next', content: [{ type: 'text', text: 'x'.repeat(16 * 1024) }] }
      },
      body: undefined
    })
    expect(createSessionQueuedMessage).toHaveBeenCalledTimes(1)

    vi.mocked(createSessionQueuedMessage).mockClear()
    expect(() => handleCreate({
      params: { id: 'session-queue' },
      request: {
        body: { mode: 'next', content: [{ type: 'text', text: 'x'.repeat((16 * 1024) + 1) }] }
      },
      body: undefined
    })).toThrow()
    expect(() => handleCreate({
      params: { id: 'session-queue' },
      request: {
        body: {
          mode: 'next',
          content: Array.from({ length: 9 }, () => ({
            type: 'text',
            text: 'x'.repeat(16 * 1024)
          }))
        }
      },
      body: undefined
    })).toThrow()
    expect(() => handleCreate({
      params: { id: 'session-queue' },
      request: {
        body: {
          mode: 'next',
          content: [{
            type: 'tool_use',
            id: 'tool',
            name: 'run',
            input: { apiKey: 'SENTINEL' }
          }]
        }
      },
      body: undefined
    })).toThrow()
    expect(createSessionQueuedMessage).not.toHaveBeenCalled()

    handleCreate({
      params: { id: 'session-queue' },
      request: {
        body: {
          mode: 'next',
          content: Array.from({ length: 32 }, (_, index) => ({
            type: 'text',
            text: `item-${index}`
          }))
        }
      },
      body: undefined
    })
    expect(createSessionQueuedMessage).toHaveBeenCalledTimes(1)

    vi.mocked(createSessionQueuedMessage).mockClear()
    expect(() => handleCreate({
      params: { id: 'session-queue' },
      request: {
        body: {
          mode: 'next',
          content: Array.from({ length: 33 }, (_, index) => ({
            type: 'text',
            text: `item-${index}`
          }))
        }
      },
      body: undefined
    })).toThrow()
    expect(createSessionQueuedMessage).not.toHaveBeenCalled()
  })

  it('rejects duplicate and extra reorder fields before queue mutation', () => {
    vi.mocked(getDb).mockReturnValue({} as any)
    const handleReorder = findRouteHandler('/:id/queued-messages/reorder', 'POST')
    expect(() => handleReorder({
      params: { id: 'session-queue' },
      request: { body: { mode: 'next', ids: ['queue-1', 'queue-1'], extra: true } },
      body: undefined
    })).toThrow('Invalid queued message order')
    expect(reorderSessionQueuedMessages).not.toHaveBeenCalled()
    expect(updateSessionQueuedMessage).not.toHaveBeenCalled()
  })

  it('rejects extra queue-move fields before mutation', () => {
    vi.mocked(getDb).mockReturnValue({} as any)
    const handleMove = findRouteHandler('/:id/queued-messages/:queueId/move', 'POST')

    expect(() => handleMove({
      params: { id: 'session-queue', queueId: 'queue-1' },
      request: { body: { mode: 'next', privateToken: 'SENTINEL' } },
      body: undefined
    })).toThrow('Invalid queued message mode')
    expect(moveSessionQueuedMessage).not.toHaveBeenCalled()
  })

  it('pre-scans exact queue JSON depth before recursive schema parsing', () => {
    const db = { getSession: vi.fn(() => ({ id: 'session-queue' })) }
    vi.mocked(getDb).mockReturnValue(db as any)
    vi.mocked(createSessionQueuedMessage).mockReturnValue({
      id: 'queue-1',
      sessionId: 'session-queue',
      mode: 'next',
      content: [{ type: 'text', text: 'safe' }],
      createdAt: 1,
      updatedAt: 1,
      order: 1
    } as any)
    const handleCreate = findRouteHandler('/:id/queued-messages', 'POST')
    const nestedInput = (objectCount: number) => {
      let value: unknown = 'leaf'
      for (let index = 0; index < objectCount; index += 1) value = { child: value }
      return value
    }
    const body = (input: unknown) => ({
      mode: 'next',
      content: [{ type: 'tool_use', id: 'tool', name: 'run', input }]
    })

    handleCreate({
      params: { id: 'session-queue' },
      request: { body: body(nestedInput(9)) },
      body: undefined
    })
    expect(createSessionQueuedMessage).toHaveBeenCalledTimes(1)

    vi.mocked(createSessionQueuedMessage).mockClear()
    expect(() => handleCreate({
      params: { id: 'session-queue' },
      request: { body: body(nestedInput(10)) },
      body: undefined
    })).toThrow()
    expect(createSessionQueuedMessage).not.toHaveBeenCalled()
  })

  it('accepts exactly 128KiB of queue strings and rejects aggregate limit plus one', () => {
    const db = { getSession: vi.fn(() => ({ id: 'session-queue' })) }
    vi.mocked(getDb).mockReturnValue(db as any)
    vi.mocked(createSessionQueuedMessage).mockReturnValue({
      id: 'queue-1',
      sessionId: 'session-queue',
      mode: 'next',
      content: [{ type: 'text', text: 'safe' }],
      createdAt: 1,
      updatedAt: 1,
      order: 1
    } as any)
    const handleCreate = findRouteHandler('/:id/queued-messages', 'POST')
    const contentAtLimit = [
      ...Array.from({ length: 7 }, () => ({ type: 'text', text: 'x'.repeat(16 * 1024) })),
      { type: 'text', text: 'x'.repeat(16_348) }
    ]

    handleCreate({
      params: { id: 'session-queue' },
      request: { body: { mode: 'next', content: contentAtLimit } },
      body: undefined
    })
    expect(createSessionQueuedMessage).toHaveBeenCalledTimes(1)

    vi.mocked(createSessionQueuedMessage).mockClear()
    expect(() => handleCreate({
      params: { id: 'session-queue' },
      request: {
        body: {
          mode: 'next',
          content: [
            ...contentAtLimit.slice(0, -1),
            { type: 'text', text: 'x'.repeat(16_349) }
          ]
        }
      },
      body: undefined
    })).toThrow()
    expect(createSessionQueuedMessage).not.toHaveBeenCalled()
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

  it('queues server-owned global-only recovery without accepting a client path or policy', async () => {
    const session = { id: 'session-project-config', status: 'failed' }
    const db = {
      getSession: vi.fn(() => session)
    }
    vi.mocked(getDb).mockReturnValue(db as any)
    vi.mocked(retryExternalRuntimeSessionProjectConfig).mockResolvedValue({
      queued: false,
      reason: 'already_queued'
    })

    const handleRetry = findRouteHandler('/:id/retry-project-config', 'POST')
    const ctx = {
      params: { id: session.id },
      request: {
        body: {
          projectConfigPolicy: 'include',
          path: '../../forged.toml',
          workspaceFolder: '/tmp/forged'
        }
      },
      body: undefined
    }

    await handleRetry(ctx)

    expect(retryExternalRuntimeSessionProjectConfig).toHaveBeenCalledWith(session.id)
    expect(ctx.body).toEqual({ ok: true, queued: false, reason: 'already_queued' })
  })

  it('rejects recovery when the authoritative current failure is ineligible', async () => {
    const session = { id: 'session-other-failure', status: 'failed' }
    vi.mocked(getDb).mockReturnValue({
      getSession: vi.fn(() => session)
    } as any)
    vi.mocked(retryExternalRuntimeSessionProjectConfig).mockResolvedValue({
      queued: false,
      reason: 'current_failure_ineligible'
    })

    const handleRetry = findRouteHandler('/:id/retry-project-config', 'POST')
    const ctx = {
      params: { id: session.id },
      request: { body: {} },
      body: undefined
    }

    await expect(handleRetry(ctx)).rejects.toMatchObject({
      code: 'project_config_recovery_unavailable',
      details: { id: session.id },
      message: 'The current runtime failure is not eligible for project config recovery.',
      status: 409
    })
    expect(retryExternalRuntimeSessionProjectConfig).toHaveBeenCalledWith(session.id)
  })

  it('opens only the server-validated active project config source and location', async () => {
    const session = { id: 'session-project-config-open', status: 'failed' }
    vi.mocked(getDb).mockReturnValue({
      getSession: vi.fn(() => session)
    } as any)
    vi.mocked(resolveExternalRuntimeProjectConfigFailure).mockResolvedValue({
      available: true,
      details: {
        adapter: 'codex',
        runtimeAdapter: 'codex',
        configSource: 'project',
        configPath: '.codex/config.toml',
        workspaceSource: 'active-session-workspace',
        workspaceFolder: '/forged-but-validated-away',
        sessionId: session.id,
        reason: 'wire_api is unsupported',
        line: 4,
        column: 7
      },
      attemptCommandId: 'cmd-start',
      failureEventId: 'evt-failure',
      failureEventSeq: 9,
      workspaceFolder: '/workspace/authoritative'
    })
    const openResponse = {
      ok: true as const,
      opener: {
        available: true,
        id: 'vscode' as const,
        source: 'path' as const,
        title: 'Visual Studio Code'
      },
      path: '.codex/config.toml'
    }
    vi.mocked(openWorkspaceFileInExternalOpener).mockResolvedValue(openResponse)

    const handleOpen = findRouteHandler('/:id/project-config/open', 'POST')
    const ctx = {
      params: { id: session.id },
      request: {
        body: {
          path: '../../forged.toml',
          workspaceFolder: '/tmp/forged',
          line: 999
        }
      },
      body: undefined
    }

    await handleOpen(ctx)

    expect(openWorkspaceFileInExternalOpener).toHaveBeenCalledWith(
      '.codex/config.toml',
      {
        column: 7,
        line: 4,
        workspaceFolder: '/workspace/authoritative'
      }
    )
    expect(ctx.body).toEqual(openResponse)
  })

  it('surfaces missing runtime stores and missing project config open targets without side effects', async () => {
    const session = { id: 'session-project-config-missing', status: 'failed' }
    vi.mocked(getDb).mockReturnValue({
      getSession: vi.fn(() => session)
    } as any)
    vi.mocked(retryExternalRuntimeSessionProjectConfig).mockResolvedValue({
      queued: false,
      reason: 'runtime_store_missing'
    })
    const handleRetry = findRouteHandler('/:id/retry-project-config', 'POST')
    await expect(handleRetry({
      params: { id: session.id },
      request: { body: {} }
    })).rejects.toMatchObject({
      code: 'runtime_store_missing',
      details: { id: session.id },
      status: 409
    })

    vi.mocked(resolveExternalRuntimeProjectConfigFailure).mockResolvedValue({
      available: false,
      reason: 'runtime_store_missing'
    })
    const handleOpen = findRouteHandler('/:id/project-config/open', 'POST')
    await expect(handleOpen({
      params: { id: session.id },
      request: { body: {} }
    })).rejects.toThrow('The current runtime failure has no safe project config target.')
    expect(openWorkspaceFileInExternalOpener).not.toHaveBeenCalled()
  })

  it('surfaces opener failure and never reports the config as opened', async () => {
    const session = { id: 'session-project-config-opener-failure', status: 'failed' }
    vi.mocked(getDb).mockReturnValue({
      getSession: vi.fn(() => session)
    } as any)
    vi.mocked(resolveExternalRuntimeProjectConfigFailure).mockResolvedValue({
      available: true,
      details: {
        adapter: 'codex',
        runtimeAdapter: 'codex',
        configSource: 'project',
        configPath: '.codex/config.toml',
        workspaceSource: 'active-session-workspace',
        workspaceFolder: '/workspace/root',
        sessionId: session.id,
        reason: 'Malformed TOML.'
      },
      attemptCommandId: 'cmd-start',
      failureEventId: 'evt-failure',
      failureEventSeq: 3,
      workspaceFolder: '/workspace/root'
    })
    vi.mocked(openWorkspaceFileInExternalOpener).mockRejectedValue(
      Object.assign(new Error('Config file no longer exists.'), { code: 'ENOENT' })
    )

    const handleOpen = findRouteHandler('/:id/project-config/open', 'POST')
    const ctx = {
      params: { id: session.id },
      request: { body: {} },
      body: undefined
    }
    await expect(handleOpen(ctx)).rejects.toThrow('Config file no longer exists.')
    expect(ctx.body).toBeUndefined()
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

  it('sanitizes nested HTTP runtime audit data before DB history and live delivery', async () => {
    const sentinel = 'SENTINEL_HTTP_ADAPTER_EVENT_SECRET'
    const session = { id: 'session-http-audit', status: 'running' }
    const db = {
      getSession: vi.fn(() => session),
      saveMessage: vi.fn(() => true),
      updateSession: vi.fn()
    }
    vi.mocked(getDb).mockReturnValue(db as any)
    const handlePostEvent = findRouteHandler('/:id/events', 'POST')
    const ctx = {
      params: { id: session.id },
      request: {
        body: {
          type: 'adapter_event',
          data: {
            injectedEnvelope: sentinel,
            runtimeEvent: {
              protocolVersion: '1.0.0',
              id: 'evt-http-failed',
              seq: 11,
              ts: 100,
              sessionId: session.id,
              type: 'command_failed',
              commandId: 'cmd-http',
              code: 'legacy_runtime_failure',
              message: 'Safe failure',
              fatal: true,
              details: { token: sentinel },
              unknownPayload: sentinel
            }
          }
        }
      },
      body: undefined
    }

    handlePostEvent(ctx)
    const routedEvent = vi.mocked(applySessionEvent).mock.calls.at(-1)?.[1]
    expect(JSON.stringify(routedEvent)).not.toContain(sentinel)
    expect(routedEvent).toEqual({
      type: 'adapter_event',
      data: {
        runtimeEvent: expect.objectContaining({
          id: 'evt-http-failed',
          type: 'command_failed',
          code: 'legacy_runtime_failure',
          commandId: 'cmd-http',
          message: 'Safe failure',
          fatal: true
        })
      }
    })

    const actual = await vi.importActual<typeof import('#~/services/session/events.js')>(
      '#~/services/session/events.js'
    )
    const live: unknown[] = []
    actual.applySessionEvent(session.id, routedEvent!, {
      broadcast: event => live.push(event)
    })
    const serialized = JSON.stringify({
      history: db.saveMessage.mock.calls,
      live
    })
    expect(serialized).not.toContain(sentinel)
    expect(db.saveMessage).toHaveBeenCalledWith(session.id, routedEvent)
    expect(live).toEqual([routedEvent])
  })

  it('rejects a nested runtime event forged for another session', () => {
    const session = { id: 'session-authoritative' }
    vi.mocked(getDb).mockReturnValue({ getSession: vi.fn(() => session) } as any)
    const handlePostEvent = findRouteHandler('/:id/events', 'POST')
    expect(() => handlePostEvent({
      params: { id: session.id },
      request: {
        body: {
          type: 'adapter_event',
          data: {
            runtimeEvent: {
              id: 'evt-forged',
              sessionId: 'session-forged',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'safe', sentinel: 'NESTED_SECRET' }]
            }
          }
        }
      }
    })).toThrow('Invalid adapter event payload')
    expect(applySessionEvent).not.toHaveBeenCalled()
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
