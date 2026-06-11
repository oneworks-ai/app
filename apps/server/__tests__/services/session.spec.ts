/* eslint-disable max-lines -- session service coverage is intentionally consolidated. */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import { resolveSessionRuntimeStoreRoot } from '#~/services/runtime-store/session-control.js'
import { killSession, processUserMessage, requestSessionTermination } from '#~/services/session/index.js'
import { maybeNotifySession } from '#~/services/session/notification.js'
import {
  adapterSessionStore,
  createSessionConnectionState,
  externalSessionStore,
  notifySessionUpdated
} from '#~/services/session/runtime.js'
import { resolveSessionWorkspace } from '#~/services/session/workspace.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

vi.mock('#~/channels/index.js', () => ({
  handleChannelSessionEvent: vi.fn()
}))

vi.mock('#~/services/session/runtime.js', async () => {
  const actual = await vi.importActual<typeof import('#~/services/session/runtime.js')>(
    '#~/services/session/runtime.js'
  )
  return {
    ...actual,
    notifySessionUpdated: vi.fn()
  }
})

vi.mock('#~/services/session/notification.js', () => ({
  maybeNotifySession: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('#~/services/session/workspace.js', () => ({
  provisionSessionWorkspace: vi.fn(),
  resolveSessionWorkspace: vi.fn()
}))

vi.mock('#~/utils/logger.js', () => ({
  getSessionLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}))

describe('session service', () => {
  const saveMessage = vi.fn()
  const getMessages = vi.fn()
  const getSessionRuntimeState = vi.fn()
  const updateSession = vi.fn()
  const updateSessionRuntimeState = vi.fn()
  let currentSession: any
  let previousProjectOoBaseDir: string | undefined
  let previousProjectHomeProjectsDir: string | undefined
  let tempRuntimeRoot: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    adapterSessionStore.clear()
    externalSessionStore.clear()
    previousProjectOoBaseDir = process.env.__ONEWORKS_PROJECT_BASE_DIR__
    previousProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
    tempRuntimeRoot = undefined

    currentSession = {
      id: 'sess-1',
      title: 'New Session',
      status: 'idle',
      createdAt: Date.now(),
      messageCount: 0
    }

    updateSession.mockImplementation((_id: string, updates: Record<string, unknown>) => {
      currentSession = { ...currentSession, ...updates }
    })
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'interactive',
      historySeedPending: false
    })
    vi.mocked(resolveSessionWorkspace).mockResolvedValue({
      sessionId: 'sess-1',
      workspaceFolder: '/workspace/root'
    } as any)

    vi.mocked(getDb).mockReturnValue({
      saveMessage,
      getChannelSessionBySessionId: vi.fn(() => undefined),
      getMessages,
      listSessionQueuedMessages: vi.fn(() => []),
      getSession: vi.fn(() => currentSession),
      getSessionRuntimeState,
      updateSession,
      updateSessionRuntimeState
    } as any)
  })

  afterEach(async () => {
    if (previousProjectOoBaseDir == null) {
      delete process.env.__ONEWORKS_PROJECT_BASE_DIR__
    } else {
      process.env.__ONEWORKS_PROJECT_BASE_DIR__ = previousProjectOoBaseDir
    }
    if (previousProjectHomeProjectsDir == null) {
      delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
    } else {
      process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = previousProjectHomeProjectsDir
    }

    if (tempRuntimeRoot != null) {
      await rm(tempRuntimeRoot, { force: true, recursive: true })
    }
  })

  it('processes user messages through the active adapter session cache', async () => {
    const socket = { readyState: 1, send: vi.fn() } as any
    const emit = vi.fn()
    const messageHistory = [
      {
        type: 'message',
        message: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'previous',
          createdAt: 1
        }
      } as any
    ]
    getMessages.mockReturnValue(messageHistory)

    const runtime = createSessionConnectionState()
    runtime.sockets.add(socket)
    runtime.messages = messageHistory
    adapterSessionStore.set('sess-1', {
      ...runtime,
      session: {
        emit,
        kill: vi.fn()
      } as any
    })

    await processUserMessage('sess-1', 'hello world')

    expect(saveMessage).toHaveBeenCalledOnce()
    expect(saveMessage).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          role: 'user',
          content: 'hello world'
        })
      })
    )
    expect(updateSession).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        title: 'hello world',
        lastMessage: 'hello world',
        lastUserMessage: 'hello world',
        status: 'running'
      })
    )
    expect(vi.mocked(notifySessionUpdated)).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        status: 'running',
        title: 'hello world'
      })
    )
    expect(vi.mocked(maybeNotifySession)).toHaveBeenCalledWith(
      'idle',
      'running',
      expect.objectContaining({ status: 'running' })
    )
    expect(socket.send).toHaveBeenCalledOnce()
    expect(String(vi.mocked(socket.send).mock.calls[0][0])).toContain('"type":"message"')
    expect(emit).toHaveBeenCalledWith({
      type: 'message',
      content: [{ type: 'text', text: 'hello world' }],
      parentUuid: 'assistant-1'
    })
  })

  it('kills active sessions and updates the persisted status', () => {
    const kill = vi.fn()

    adapterSessionStore.set('sess-1', {
      ...createSessionConnectionState(),
      session: {
        emit: vi.fn(),
        kill
      } as any
    })

    killSession('sess-1')

    expect(kill).toHaveBeenCalledOnce()
    expect(adapterSessionStore.has('sess-1')).toBe(false)
    expect(updateSession).toHaveBeenCalledWith('sess-1', { status: 'terminated' })
    expect(vi.mocked(notifySessionUpdated)).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        status: 'terminated'
      })
    )
  })

  it('clears parked external sessions without marking them terminated', () => {
    currentSession = {
      ...currentSession,
      status: 'running'
    }
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })
    externalSessionStore.set('sess-1', {
      ...createSessionConnectionState(),
      currentInteraction: {
        id: 'interaction-1',
        payload: {
          sessionId: 'sess-1',
          question: '是否继续？'
        }
      }
    })

    killSession('sess-1')

    expect(externalSessionStore.has('sess-1')).toBe(false)
    expect(updateSession).not.toHaveBeenCalled()
    expect(vi.mocked(notifySessionUpdated)).not.toHaveBeenCalled()
    expect(currentSession.status).toBe('running')
  })

  it('does not mark external runtime sessions as terminated', () => {
    currentSession = {
      ...currentSession,
      status: 'completed'
    }
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })
    externalSessionStore.set('sess-1', createSessionConnectionState())

    killSession('sess-1')

    expect(externalSessionStore.has('sess-1')).toBe(false)
    expect(updateSession).not.toHaveBeenCalled()
    expect(vi.mocked(notifySessionUpdated)).not.toHaveBeenCalled()
    expect(currentSession.status).toBe('completed')
  })

  it('queues stop commands into external runtime sessions', async () => {
    const runtimeAiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'ow-session-runtime-stop-'))
    tempRuntimeRoot = runtimeAiBaseDir
    const runtimeRoot = path.join(runtimeAiBaseDir, 'runtime')
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = runtimeAiBaseDir
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(runtimeAiBaseDir, 'home-projects')
    await mkdir(path.join(runtimeRoot, 'sessions', 'sess-1'), { recursive: true })
    currentSession = {
      ...currentSession,
      status: 'running'
    }
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })

    const result = await requestSessionTermination('sess-1')
    const migratedRuntimeRoot = resolveSessionRuntimeStoreRoot('/workspace/root')
    const command = JSON.parse(
      await readFile(path.join(migratedRuntimeRoot, 'sessions', 'sess-1', 'commands.jsonl'), 'utf8')
    ) as {
      mode?: string
      sessionId?: string
      type?: string
    }

    expect(result).toMatchObject({
      accepted: true,
      delivery: 'runtime_store'
    })
    expect(command).toMatchObject({
      mode: 'kill',
      sessionId: 'sess-1',
      type: 'stop'
    })
    expect(updateSession).toHaveBeenCalledWith('sess-1', { status: 'terminated' })
  })

  it('queues user messages into external runtime sessions', async () => {
    const runtimeAiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'ow-session-runtime-'))
    tempRuntimeRoot = runtimeAiBaseDir
    const runtimeRoot = path.join(runtimeAiBaseDir, 'runtime')
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = runtimeAiBaseDir
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(runtimeAiBaseDir, 'home-projects')
    await mkdir(path.join(runtimeRoot, 'sessions', 'sess-1'), { recursive: true })
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })

    await processUserMessage('sess-1', 'wake up')

    const migratedRuntimeRoot = resolveSessionRuntimeStoreRoot('/workspace/root')
    const command = JSON.parse(
      await readFile(path.join(migratedRuntimeRoot, 'sessions', 'sess-1', 'commands.jsonl'), 'utf8')
    ) as {
      commandId?: string
      content?: string
      id?: string
      message?: string
      sessionId?: string
      source?: string
      ts?: number
      type?: string
    }

    expect(command).toEqual(expect.objectContaining({
      content: 'wake up',
      message: 'wake up',
      sessionId: 'sess-1',
      source: 'user',
      type: 'send_message'
    }))
    expect(saveMessage).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          id: command.commandId,
          role: 'user',
          content: 'wake up',
          agentRoom: expect.objectContaining({
            source: 'user',
            commandId: command.commandId,
            causedByCommandId: command.id
          }),
          createdAt: command.ts
        })
      })
    )
    expect(updateSession).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        lastMessage: 'wake up',
        lastUserMessage: 'wake up',
        status: 'running'
      })
    )
    expect(getMessages).not.toHaveBeenCalled()
    expect(adapterSessionStore.has('sess-1')).toBe(false)
  })

  it('queues external runtime messages with the latest permission mode', async () => {
    const runtimeAiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'ow-session-runtime-permission-'))
    tempRuntimeRoot = runtimeAiBaseDir
    const runtimeRoot = path.join(runtimeAiBaseDir, 'runtime')
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = runtimeAiBaseDir
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(runtimeAiBaseDir, 'home-projects')
    await mkdir(path.join(runtimeRoot, 'sessions', 'sess-1'), { recursive: true })
    currentSession = {
      ...currentSession,
      permissionMode: 'bypassPermissions'
    }
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })

    await processUserMessage('sess-1', 'wake up')

    const migratedRuntimeRoot = resolveSessionRuntimeStoreRoot('/workspace/root')
    const command = JSON.parse(
      await readFile(path.join(migratedRuntimeRoot, 'sessions', 'sess-1', 'commands.jsonl'), 'utf8')
    ) as Record<string, unknown>

    expect(command).toEqual(expect.objectContaining({
      sessionId: 'sess-1',
      type: 'send_message',
      content: 'wake up',
      permissionMode: 'bypassPermissions'
    }))
  })

  it('queues external runtime messages with a per-message model override', async () => {
    const runtimeAiBaseDir = await mkdtemp(path.join(os.tmpdir(), 'ow-session-runtime-model-'))
    tempRuntimeRoot = runtimeAiBaseDir
    const runtimeRoot = path.join(runtimeAiBaseDir, 'runtime')
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = runtimeAiBaseDir
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(runtimeAiBaseDir, 'home-projects')
    await mkdir(path.join(runtimeRoot, 'sessions', 'sess-1'), { recursive: true })
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })

    await processUserMessage('sess-1', [
      { type: 'image', url: 'file:///tmp/pic.png', path: '/tmp/pic.png' }
    ], {
      model: 'gpt-5.5'
    })

    const migratedRuntimeRoot = resolveSessionRuntimeStoreRoot('/workspace/root')
    const command = JSON.parse(
      await readFile(path.join(migratedRuntimeRoot, 'sessions', 'sess-1', 'commands.jsonl'), 'utf8')
    ) as Record<string, unknown>

    expect(command).toEqual(expect.objectContaining({
      sessionId: 'sess-1',
      type: 'send_message',
      content: '[图片]',
      model: 'gpt-5.5'
    }))
  })

  it('uses an active adapter runtime even if the persisted runtime kind is external', async () => {
    const emit = vi.fn()
    getMessages.mockReturnValue([])
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeedPending: false
    })
    adapterSessionStore.set('sess-1', {
      ...createSessionConnectionState(),
      session: {
        emit,
        kill: vi.fn()
      } as any
    })

    await processUserMessage('sess-1', 'hello child')

    expect(saveMessage).toHaveBeenCalledOnce()
    expect(saveMessage).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          role: 'user',
          content: 'hello child'
        })
      })
    )
    expect(emit).toHaveBeenCalledWith({
      type: 'message',
      content: [{ type: 'text', text: 'hello child' }],
      parentUuid: undefined
    })
  })

  it('creates a runtime-store session for external forks on the first user message', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-session-fork-workspace-'))
    tempRuntimeRoot = workspaceRoot
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(workspaceRoot, 'home-projects')
    currentSession = {
      ...currentSession,
      adapter: 'codex',
      effort: 'high',
      model: 'mock,codex',
      permissionMode: 'dontAsk',
      promptName: 'client',
      promptType: 'workspace',
      title: 'Forked session'
    }
    getSessionRuntimeState.mockReturnValue({
      runtimeKind: 'external',
      historySeed: '历史上下文',
      historySeedPending: true
    })
    vi.mocked(resolveSessionWorkspace).mockResolvedValue({
      sessionId: 'sess-1',
      workspaceFolder: workspaceRoot
    } as any)

    await processUserMessage('sess-1', 'continue fork')

    const storePath = path.join(resolveSessionRuntimeStoreRoot(workspaceRoot), 'sessions', 'sess-1')
    const meta = JSON.parse(await readFile(path.join(storePath, 'meta.json'), 'utf8')) as Record<string, unknown>
    const command = JSON.parse(await readFile(path.join(storePath, 'commands.jsonl'), 'utf8')) as Record<
      string,
      unknown
    >

    expect(meta).toMatchObject({
      sessionId: 'sess-1',
      adapter: 'codex',
      model: 'mock,codex',
      promptType: 'workspace',
      promptName: 'client',
      systemPrompt: '历史上下文'
    })
    expect(command).toMatchObject({
      type: 'start',
      source: 'web',
      content: 'continue fork',
      taskType: 'workspace',
      name: 'client',
      systemPrompt: '历史上下文'
    })
    expect(getMessages).not.toHaveBeenCalled()
    expect(adapterSessionStore.has('sess-1')).toBe(false)
    expect(updateSessionRuntimeState).toHaveBeenCalledWith('sess-1', { historySeedPending: false })
    expect(updateSession).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        lastMessage: 'continue fork',
        lastUserMessage: 'continue fork',
        status: 'running'
      })
    )
  })

  it('summarizes file-only user messages with the selected workspace path', async () => {
    const socket = { readyState: 1, send: vi.fn() } as any
    const emit = vi.fn()
    getMessages.mockReturnValue([])

    const runtime = createSessionConnectionState()
    runtime.sockets.add(socket)
    adapterSessionStore.set('sess-1', {
      ...runtime,
      session: {
        emit,
        kill: vi.fn()
      } as any
    })

    await processUserMessage('sess-1', [
      { type: 'file', path: 'apps/client/src/main.tsx', name: 'main.tsx' }
    ])

    expect(updateSession).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        title: 'Context file: apps/client/src/main.tsx',
        lastMessage: 'Context file: apps/client/src/main.tsx',
        lastUserMessage: 'Context file: apps/client/src/main.tsx'
      })
    )
    expect(emit).toHaveBeenCalledWith({
      type: 'message',
      content: [{ type: 'file', path: 'apps/client/src/main.tsx', name: 'main.tsx' }],
      parentUuid: undefined
    })
  })
})
