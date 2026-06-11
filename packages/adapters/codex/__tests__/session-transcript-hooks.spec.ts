import { PassThrough } from 'node:stream'

import { spawn } from 'node:child_process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCodexSession } from '#~/runtime/session.js'
import { createCodexTranscriptHookWatcher } from '#~/runtime/transcript-hooks.js'

vi.mock('node:child_process', () => ({
  execFile: vi.fn((...args: unknown[]) => {
    const callback = args.findLast((arg): arg is (error: Error | null, stdout: string, stderr: string) => void =>
      typeof arg === 'function'
    )
    callback?.(null, '', '')
    return { kill: vi.fn() }
  }),
  spawn: vi.fn()
}))

vi.mock('#~/runtime/transcript-hooks.js', () => ({
  createCodexTranscriptHookWatcher: vi.fn()
}))

const spawnMock = vi.mocked(spawn)
const createCodexTranscriptHookWatcherMock = vi.mocked(createCodexTranscriptHookWatcher)

const makeLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
})

const makeCtx = (env: Record<string, string> = {}) => {
  const cacheStore = new Map<string, unknown>()
  return {
    ctxId: 'test-ctx',
    cwd: '/tmp/project',
    env,
    cache: {
      set: async (key: string, value: unknown) => {
        cacheStore.set(key, value)
        return { cachePath: `/tmp/${key}.json` }
      },
      get: async (key: string) => cacheStore.get(key)
    },
    logger: makeLogger(),
    configs: [undefined, undefined]
  } as any
}

const makeProc = () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let exitHandler: ((code: number | null) => void) | undefined

  stdin.on('data', (chunk: unknown) => {
    const text = String(chunk)
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue

      const message = JSON.parse(trimmed)
      if (typeof message.id !== 'number') continue

      if (message.method === 'initialize') {
        stdout.push(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex/1.0' } })}\n`)
      } else if (message.method === 'thread/start') {
        stdout.push(`${JSON.stringify({ id: message.id, result: { thread: { id: 'thr_1' } } })}\n`)
      } else if (message.method === 'turn/start') {
        stdout.push(`${JSON.stringify({ id: message.id, result: { turn: { id: 'turn_1' } } })}\n`)
      }
    }
  })

  const proc = {
    stdin,
    stdout,
    pid: 1234,
    on: (event: string, cb: (code: number | null) => void) => {
      if (event === 'exit') exitHandler = cb
      return proc
    },
    kill: vi.fn(() => {
      exitHandler?.(0)
      return true
    })
  } as any

  return proc
}

describe('createCodexSession transcript hook integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.HOME = '/tmp'
    spawnMock.mockReturnValue(makeProc())
    createCodexTranscriptHookWatcherMock.mockReturnValue({
      start: vi.fn(),
      stop: vi.fn()
    })
  })

  afterEach(() => {
    delete process.env.HOME
  })

  it('starts and stops the transcript watcher when native hooks are active', async () => {
    const session = await createCodexSession(
      makeCtx({
        __ONEWORKS_PROJECT_CODEX_NATIVE_HOOKS_AVAILABLE__: '1',
        __ONEWORKS_PROJECT_CLI_PACKAGE_DIR__: '/tmp/oneworks-cli'
      }),
      {
        type: 'create',
        runtime: 'server',
        sessionId: 'session-native-hooks',
        description: 'Reply with pong.',
        onEvent: () => {}
      } as any
    )

    expect(createCodexTranscriptHookWatcherMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/project',
      runtime: 'server',
      sessionId: 'session-native-hooks'
    }))

    const watcher = createCodexTranscriptHookWatcherMock.mock.results[0]?.value
    expect(watcher.start).toHaveBeenCalledTimes(1)

    session.kill()

    expect(watcher.stop).toHaveBeenCalledTimes(1)
  })

  it('wires transcript adapter events only for direct mode', async () => {
    const onEvent = vi.fn()
    const session = await createCodexSession(
      makeCtx({
        __ONEWORKS_PROJECT_CODEX_NATIVE_HOOKS_AVAILABLE__: '1',
        __ONEWORKS_PROJECT_CLI_PACKAGE_DIR__: '/tmp/oneworks-cli'
      }),
      {
        type: 'create',
        runtime: 'cli',
        mode: 'direct',
        sessionId: 'session-direct-hooks',
        description: 'Reply with pong.',
        onEvent
      } as any
    )

    expect(createCodexTranscriptHookWatcherMock).toHaveBeenCalledWith(expect.objectContaining({
      onEvent: expect.any(Function)
    }))

    const transcriptOnEvent = createCodexTranscriptHookWatcherMock.mock.calls[0]?.[0]?.onEvent
    transcriptOnEvent?.({
      type: 'message',
      data: {
        id: 'transcript-message',
        role: 'assistant',
        content: 'pong',
        createdAt: 1
      }
    })

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      data: expect.objectContaining({ content: 'pong' })
    }))
    session.kill()
  })

  it('does not create the transcript watcher when native hooks are unavailable', async () => {
    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-no-native-hooks',
      description: 'Reply with pong.',
      onEvent: () => {}
    } as any)

    expect(createCodexTranscriptHookWatcherMock).not.toHaveBeenCalled()
    session.kill()
  })
})
