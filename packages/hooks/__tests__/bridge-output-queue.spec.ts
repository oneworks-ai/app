import { PassThrough } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAdapterHookBridge } from '#~/bridge.js'
import type { HookLogger } from '#~/index.js'

const { callHookMock } = vi.hoisted(() => ({
  callHookMock: vi.fn()
}))

vi.mock('#~/call.js', () => ({
  callHook: callHookMock
}))

const createLogger = (): HookLogger => ({
  stream: new PassThrough(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
})

const createBridge = (logger: HookLogger, sessionId: string) =>
  createAdapterHookBridge({
    ctx: {
      cwd: '/tmp/project',
      env: {},
      logger
    },
    adapter: 'pi',
    runtime: 'cli',
    sessionId,
    type: 'create'
  })

describe('adapter hook bridge output queue', () => {
  beforeEach(() => {
    callHookMock.mockReset()
  })

  it('runs queued lifecycle work after pending output hooks and before SessionEnd', async () => {
    const logger = createLogger()
    const postToolUseFinished = Promise.withResolvers<void>()
    const lifecycle: string[] = []
    callHookMock.mockImplementation(async (eventName) => {
      if (eventName === 'PostToolUse') {
        lifecycle.push('PostToolUse:start')
        await postToolUseFinished.promise
        lifecycle.push('PostToolUse:end')
      }
      if (eventName === 'SessionEnd') lifecycle.push('SessionEnd')
      return { continue: true }
    })
    const bridge = createBridge(logger, 'session-ordered-exit')

    bridge.handleOutput({
      type: 'message',
      data: {
        id: 'tool-result-1',
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        toolCall: {
          id: 'tool-1',
          name: 'Read',
          args: {},
          output: 'done',
          status: 'success'
        }
      }
    })
    bridge.enqueueAfterPendingHooks(async () => {
      lifecycle.push('TaskStop')
    })
    bridge.handleOutput({ type: 'exit', data: { exitCode: 0 } })

    await vi.waitFor(() => expect(lifecycle).toContain('PostToolUse:start'))
    expect(lifecycle).not.toContain('TaskStop')
    expect(lifecycle).not.toContain('SessionEnd')

    postToolUseFinished.resolve()
    await bridge.flush()

    expect(lifecycle).toEqual([
      'PostToolUse:start',
      'PostToolUse:end',
      'TaskStop',
      'SessionEnd'
    ])
  })

  it('waits for pre-existing emit hooks before queued lifecycle work', async () => {
    const logger = createLogger()
    const promptHookFinished = Promise.withResolvers<void>()
    const lifecycle: string[] = []
    callHookMock.mockImplementation(async (eventName) => {
      if (eventName === 'UserPromptSubmit') {
        lifecycle.push('UserPromptSubmit:start')
        await promptHookFinished.promise
        lifecycle.push('UserPromptSubmit:end')
      }
      return { continue: true }
    })
    const bridge = createBridge(logger, 'session-pending-emit')
    const wrappedSession = bridge.wrapSession({
      kill: vi.fn(),
      emit: vi.fn()
    })

    wrappedSession.emit({
      type: 'message',
      content: [{ type: 'text', text: 'next turn' }]
    })
    bridge.enqueueAfterPendingHooks(async () => {
      lifecycle.push('TaskStop')
    })

    await vi.waitFor(() => expect(lifecycle).toContain('UserPromptSubmit:start'))
    expect(lifecycle).not.toContain('TaskStop')

    promptHookFinished.resolve()
    await bridge.flush()

    expect(lifecycle).toEqual([
      'UserPromptSubmit:start',
      'UserPromptSubmit:end',
      'TaskStop'
    ])
  })

  it('continues to SessionEnd when queued lifecycle work rejects', async () => {
    const logger = createLogger()
    const lifecycle: string[] = []
    const taskStopError = new Error('TaskStop rejected')
    callHookMock.mockImplementation(async (eventName) => {
      if (eventName === 'SessionEnd') lifecycle.push('SessionEnd')
      return { continue: true }
    })
    const bridge = createBridge(logger, 'session-rejected-task-stop')

    bridge.enqueueAfterPendingHooks(async () => {
      lifecycle.push('TaskStop')
      throw taskStopError
    })
    bridge.handleOutput({ type: 'exit', data: { exitCode: 1, stderr: 'failed' } })

    await bridge.flush()

    expect(lifecycle).toEqual(['TaskStop', 'SessionEnd'])
    expect(logger.error).toHaveBeenCalledWith(
      '[HookBridge] output hook queue failed',
      taskStopError
    )
  })

  it('drains TaskStop and SessionEnd before rethrowing a backing emit failure', async () => {
    const logger = createLogger()
    const lifecycle: string[] = []
    const emitError = new Error('session emit failed')
    callHookMock.mockImplementation(async (eventName) => {
      if (eventName === 'SessionEnd') lifecycle.push('SessionEnd')
      return { continue: true }
    })
    const bridge = createBridge(logger, 'session-failed-emit')
    const wrappedSession = bridge.wrapSession({
      kill: vi.fn(),
      emit: vi.fn(() => {
        throw emitError
      }),
      flushHooks: vi.fn(async () => {
        lifecycle.push('session.flushHooks')
      })
    })

    wrappedSession.emit({ type: 'interrupt' })
    bridge.enqueueAfterPendingHooks(async () => {
      lifecycle.push('TaskStop')
    })
    bridge.handleOutput({ type: 'exit', data: { exitCode: 1, stderr: 'failed' } })

    const flushPromise = wrappedSession.flushHooks?.().catch((error) => {
      lifecycle.push('flush:rejected')
      throw error
    })
    await expect(flushPromise).rejects.toBe(emitError)

    expect(lifecycle).toEqual([
      'TaskStop',
      'SessionEnd',
      'session.flushHooks',
      'flush:rejected'
    ])
    await expect(bridge.flush()).rejects.toBe(emitError)
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith('[HookBridge] emit queue failed', emitError)
  })

  it('deduplicates SessionEnd synchronously while preserving repeated queued work', async () => {
    const logger = createLogger()
    const lifecycle: string[] = []
    callHookMock.mockImplementation(async (eventName) => {
      if (eventName === 'SessionEnd') lifecycle.push('SessionEnd')
      return { continue: true }
    })
    const bridge = createBridge(logger, 'session-repeated-exit')

    bridge.enqueueAfterPendingHooks(async () => {
      lifecycle.push('TaskStop:1')
    })
    bridge.handleOutput({ type: 'exit', data: { exitCode: 0 } })
    bridge.enqueueAfterPendingHooks(async () => {
      lifecycle.push('TaskStop:2')
    })
    bridge.handleOutput({ type: 'exit', data: { exitCode: 0 } })

    await bridge.flush()

    expect(lifecycle).toEqual(['TaskStop:1', 'SessionEnd', 'TaskStop:2'])
    expect(callHookMock.mock.calls.filter(([eventName]) => eventName === 'SessionEnd')).toHaveLength(1)
  })
})
