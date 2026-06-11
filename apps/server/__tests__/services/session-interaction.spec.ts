import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils'

import { handleChannelSessionEvent } from '#~/channels/index.js'
import { getDb } from '#~/db/index.js'
import { applySessionEvent } from '#~/services/session/events.js'
import {
  getSessionInteraction,
  handleInteractionResponse,
  requestInteraction,
  resolvePendingInteractionAsCancelled,
  waitForInteractionDeliveryPath
} from '#~/services/session/interaction.js'
import { adapterSessionStore, createSessionConnectionState, externalSessionStore } from '#~/services/session/runtime.js'

vi.mock('#~/channels/index.js', () => ({
  handleChannelSessionEvent: vi.fn(async () => true)
}))

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

vi.mock('#~/services/session/events.js', () => ({
  applySessionEvent: vi.fn()
}))

vi.mock('#~/utils/logger.js', () => ({
  getSessionLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn()
  }))
}))

describe('session interaction service', () => {
  const getChannelSessionBySessionId = vi.fn()
  const getSession = vi.fn()
  const getMessages = vi.fn()
  let previousProjectHomeProjectsDir: string | undefined
  let previousProjectOoBaseDir: string | undefined
  let tempRuntimeRoot: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    adapterSessionStore.clear()
    externalSessionStore.clear()
    previousProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
    previousProjectOoBaseDir = process.env.__ONEWORKS_PROJECT_BASE_DIR__
    tempRuntimeRoot = undefined

    getChannelSessionBySessionId.mockReturnValue(undefined)
    getSession.mockReturnValue({
      id: 'sess-1',
      status: 'running'
    })
    getMessages.mockReturnValue([])

    vi.mocked(getDb).mockReturnValue({
      getChannelSessionBySessionId,
      getSession,
      getMessages,
      getSessionWorkspace: vi.fn(() => undefined),
      getSessionRuntimeState: vi.fn(() => ({
        runtimeKind: 'interactive',
        historySeedPending: false
      }))
    } as any)
  })

  afterEach(() => {
    vi.useRealTimers()
    if (previousProjectHomeProjectsDir == null) {
      delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
    } else {
      process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = previousProjectHomeProjectsDir
    }
    if (previousProjectOoBaseDir == null) {
      delete process.env.__ONEWORKS_PROJECT_BASE_DIR__
    } else {
      process.env.__ONEWORKS_PROJECT_BASE_DIR__ = previousProjectOoBaseDir
    }
  })

  const pathExists = async (targetPath: string) => {
    try {
      await access(targetPath)
      return true
    } catch {
      return false
    }
  }

  afterEach(async () => {
    if (tempRuntimeRoot != null) {
      await rm(tempRuntimeRoot, { force: true, recursive: true })
    }
  })

  it('accepts interaction requests for channel-bound sessions without websocket sockets', async () => {
    const runtime = createSessionConnectionState()
    const adapterRuntime = Object.assign(runtime, {
      session: {
        emit: vi.fn(),
        kill: vi.fn()
      }
    })
    adapterSessionStore.set('sess-1', adapterRuntime as any)
    getChannelSessionBySessionId.mockReturnValue({
      channelType: 'lark',
      channelId: 'chat_1',
      sessionId: 'sess-1'
    })

    const interactionPromise = requestInteraction({
      sessionId: 'sess-1',
      question: '晚上吃了什么？',
      options: [
        { label: '米饭' },
        { label: '面条' }
      ]
    })

    const interactionId = adapterRuntime.currentInteraction?.id
    expect(interactionId).toBeTruthy()
    expect(vi.mocked(handleChannelSessionEvent)).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        type: 'interaction_request',
        id: interactionId
      })
    )
    await Promise.resolve()
    expect(vi.mocked(applySessionEvent)).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        type: 'interaction_request',
        id: interactionId
      }),
      expect.objectContaining({
        onSessionUpdated: expect.any(Function)
      })
    )

    await handleInteractionResponse('sess-1', interactionId!, '米饭')

    await expect(interactionPromise).resolves.toBe('米饭')
    expect(vi.mocked(applySessionEvent)).toHaveBeenCalledWith(
      'sess-1',
      {
        type: 'interaction_response',
        id: interactionId,
        data: '米饭'
      },
      expect.objectContaining({
        broadcast: expect.any(Function),
        onSessionUpdated: expect.any(Function)
      })
    )
  })

  it('rejects interaction requests when neither websocket nor channel delivery is available', async () => {
    const runtime = createSessionConnectionState()
    adapterSessionStore.set('sess-1', {
      ...runtime,
      session: {
        emit: vi.fn(),
        kill: vi.fn()
      }
    } as any)

    await expect(requestInteraction({
      sessionId: 'sess-1',
      question: '还在吗？'
    })).rejects.toThrow('Session sess-1 is not active')
  })

  it('waits for a websocket delivery path to appear', async () => {
    vi.useFakeTimers()
    const runtime = createSessionConnectionState()
    adapterSessionStore.set('sess-1', {
      ...runtime,
      session: {
        emit: vi.fn(),
        kill: vi.fn()
      }
    } as any)

    const readyPromise = waitForInteractionDeliveryPath('sess-1', {
      timeoutMs: 1_000,
      intervalMs: 50
    })

    await vi.advanceTimersByTimeAsync(50)
    runtime.sockets.add({} as any)
    await vi.advanceTimersByTimeAsync(50)

    await expect(readyPromise).resolves.toBe(true)
  })

  it('stops waiting when no delivery path appears before the timeout', async () => {
    vi.useFakeTimers()
    const runtime = createSessionConnectionState()
    adapterSessionStore.set('sess-1', {
      ...runtime,
      session: {
        emit: vi.fn(),
        kill: vi.fn()
      }
    } as any)

    const readyPromise = waitForInteractionDeliveryPath('sess-1', {
      timeoutMs: 150,
      intervalMs: 50
    })

    await vi.advanceTimersByTimeAsync(150)

    await expect(readyPromise).resolves.toBe(false)
  })

  it('rejects interaction requests when the bound channel cannot actually deliver them', async () => {
    const runtime = createSessionConnectionState()
    const adapterRuntime = Object.assign(runtime, {
      session: {
        emit: vi.fn(),
        kill: vi.fn()
      }
    })
    adapterSessionStore.set('sess-1', adapterRuntime as any)
    getChannelSessionBySessionId.mockReturnValue({
      channelType: 'lark',
      channelId: 'chat_1',
      sessionId: 'sess-1'
    })
    vi.mocked(handleChannelSessionEvent).mockResolvedValueOnce(false)

    await expect(requestInteraction({
      sessionId: 'sess-1',
      question: '晚上吃了什么？'
    })).rejects.toThrow('Session sess-1 is not active')

    expect(adapterRuntime.currentInteraction).toBeUndefined()
    expect(vi.mocked(applySessionEvent)).not.toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ type: 'interaction_request' }),
      expect.anything()
    )
  })

  it('reconstructs the latest pending interaction from stored session events', () => {
    getSession.mockReturnValue({
      id: 'sess-1',
      status: 'waiting_input'
    })

    getMessages.mockReturnValue([
      {
        type: 'interaction_request',
        id: 'interaction-1',
        payload: {
          sessionId: 'sess-1',
          question: '是否继续？'
        }
      },
      {
        type: 'interaction_response',
        id: 'interaction-1',
        data: '取消'
      },
      {
        type: 'interaction_request',
        id: 'interaction-2',
        payload: {
          sessionId: 'sess-1',
          question: '是否升级权限？',
          kind: 'permission',
          options: [
            { label: '继续', value: 'dontAsk' }
          ]
        }
      }
    ])

    expect(getSessionInteraction('sess-1')).toEqual({
      id: 'interaction-2',
      payload: {
        sessionId: 'sess-1',
        question: '是否升级权限？',
        kind: 'permission',
        options: [
          { label: '继续', value: 'dontAsk' }
        ]
      }
    })
  })

  it('does not resurrect older interaction requests once a newer response was recorded', () => {
    getMessages.mockReturnValue([
      {
        type: 'interaction_request',
        id: 'interaction-1',
        payload: {
          sessionId: 'sess-1',
          question: '第一个问题'
        }
      },
      {
        type: 'interaction_request',
        id: 'interaction-2',
        payload: {
          sessionId: 'sess-1',
          question: '第二个问题'
        }
      },
      {
        type: 'interaction_response',
        id: 'interaction-2',
        data: '已处理'
      }
    ])

    expect(getSessionInteraction('sess-1')).toBeUndefined()
  })

  it('does not reconstruct interactions after the session leaves waiting_input', () => {
    getSession.mockReturnValue({
      id: 'sess-1',
      status: 'failed'
    })
    getMessages.mockReturnValue([
      {
        type: 'interaction_request',
        id: 'interaction-1',
        payload: {
          sessionId: 'sess-1',
          question: '是否继续？'
        }
      }
    ])

    expect(getSessionInteraction('sess-1')).toBeUndefined()
  })

  it('treats sessions parked in the external runtime store as external for interaction responses', async () => {
    const runtime = createSessionConnectionState()
    runtime.currentInteraction = {
      id: 'interaction-1',
      payload: {
        sessionId: 'sess-1',
        question: '是否继续？'
      }
    }
    externalSessionStore.set('sess-1', runtime)

    await handleInteractionResponse('sess-1', 'interaction-1', '继续')

    expect(runtime.currentInteraction).toBeUndefined()
    expect(vi.mocked(applySessionEvent)).toHaveBeenCalledWith(
      'sess-1',
      {
        type: 'interaction_response',
        id: 'interaction-1',
        data: '继续'
      },
      expect.objectContaining({
        broadcast: expect.any(Function),
        onSessionUpdated: expect.any(Function)
      })
    )
  })

  it('queues submit_input commands for external runtime approval responses', async () => {
    const runtimeAiBaseDir = await mkdtemp(path.join(tmpdir(), 'ow-session-interaction-runtime-'))
    tempRuntimeRoot = runtimeAiBaseDir
    const runtimeRoot = path.join(runtimeAiBaseDir, 'runtime')
    process.env.__ONEWORKS_PROJECT_BASE_DIR__ = runtimeAiBaseDir
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(runtimeAiBaseDir, 'home-projects')
    const homeRuntimeRoot = resolveProjectHomePath(process.cwd(), process.env, 'runtime')
    await mkdir(path.join(runtimeRoot, 'sessions', 'sess-1'), { recursive: true })
    vi.mocked(getDb).mockReturnValue({
      getChannelSessionBySessionId,
      getSession,
      getMessages,
      getSessionWorkspace: vi.fn(() => ({
        sessionId: 'sess-1',
        kind: 'external_workspace',
        workspaceFolder: process.cwd(),
        cleanupPolicy: 'retain',
        state: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      })),
      getSessionRuntimeState: vi.fn(() => ({
        runtimeKind: 'external',
        historySeedPending: false
      }))
    } as any)

    const runtime = createSessionConnectionState()
    runtime.currentInteraction = {
      id: 'approval-1',
      payload: {
        sessionId: 'sess-1',
        question: 'Allow file edit?',
        kind: 'permission'
      }
    }
    externalSessionStore.set('sess-1', runtime)

    await expect(handleInteractionResponse('sess-1', 'approval-1', 'allow_once')).resolves.toBe(true)

    const command = JSON.parse(
      await readFile(path.join(homeRuntimeRoot, 'sessions', 'sess-1', 'commands.jsonl'), 'utf8')
    ) as Record<string, unknown>

    expect(command).toEqual(expect.objectContaining({
      sessionId: 'sess-1',
      type: 'submit_input',
      source: 'web',
      priority: 10,
      requestId: 'approval-1',
      interactionId: 'approval-1',
      data: 'allow_once'
    }))
    await expect(pathExists(path.join(runtimeRoot, 'sessions', 'sess-1', 'commands.jsonl'))).resolves.toBe(false)
  })

  it('persists responses for reconstructed waiting_input interactions without a pending waiter', async () => {
    getSession.mockReturnValue({
      id: 'sess-1',
      status: 'waiting_input'
    })
    getMessages.mockReturnValue([
      {
        type: 'interaction_request',
        id: 'interaction-1',
        payload: {
          sessionId: 'sess-1',
          question: '是否继续？'
        }
      }
    ])

    await expect(handleInteractionResponse('sess-1', 'interaction-1', '继续')).resolves.toBe(true)
    expect(vi.mocked(applySessionEvent)).toHaveBeenCalledWith(
      'sess-1',
      {
        type: 'interaction_response',
        id: 'interaction-1',
        data: '继续'
      },
      expect.objectContaining({
        broadcast: expect.any(Function),
        onSessionUpdated: expect.any(Function)
      })
    )
  })

  it('can resolve an in-flight interaction as cancelled without emitting a response event', async () => {
    const runtime = createSessionConnectionState()
    const adapterRuntime = Object.assign(runtime, {
      session: {
        emit: vi.fn(),
        kill: vi.fn()
      }
    })
    adapterSessionStore.set('sess-1', adapterRuntime as any)
    getChannelSessionBySessionId.mockReturnValue({
      channelType: 'lark',
      channelId: 'chat_1',
      sessionId: 'sess-1'
    })

    const interactionPromise = requestInteraction({
      sessionId: 'sess-1',
      question: '是否继续？'
    })

    await Promise.resolve()

    const interactionId = adapterRuntime.currentInteraction?.id
    expect(interactionId).toBeTruthy()
    expect(resolvePendingInteractionAsCancelled('sess-1')).toBe(true)

    await expect(interactionPromise).resolves.toBe('cancel')
    expect(adapterRuntime.currentInteraction).toBeUndefined()
    expect(vi.mocked(applySessionEvent)).not.toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        type: 'interaction_response',
        id: interactionId
      }),
      expect.anything()
    )
  })

  it('rejects stale interaction responses when no pending or persisted interaction matches', async () => {
    getSession.mockReturnValue({
      id: 'sess-1',
      status: 'waiting_input'
    })
    getMessages.mockReturnValue([
      {
        type: 'interaction_request',
        id: 'interaction-1',
        payload: {
          sessionId: 'sess-1',
          question: '是否继续？'
        }
      },
      {
        type: 'interaction_response',
        id: 'interaction-1',
        data: '继续'
      }
    ])

    await expect(handleInteractionResponse('sess-1', 'interaction-1', '重复提交')).resolves.toBe(false)
    expect(vi.mocked(applySessionEvent)).not.toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        type: 'interaction_response',
        id: 'interaction-1',
        data: '重复提交'
      }),
      expect.anything()
    )
  })
})
