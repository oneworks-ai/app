import { PassThrough } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createStreamCodexSession } from '#~/runtime/stream.js'

const acquireCodexAppServerMock = vi.hoisted(() => vi.fn())

vi.mock('#~/runtime/app-server-pool.js', () => ({
  acquireCodexAppServer: acquireCodexAppServerMock
}))

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

const makeLogger = () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  stream: new PassThrough(),
  warn: vi.fn()
})

describe('manager-owned Codex session cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drains approval responses and unsubscribes before releasing a delayed remote lease', async () => {
    const unregister = deferred()
    const unsubscribe = deferred()
    const response = deferred()
    const lifecycle: string[] = []
    let handlers: {
      onNotification(method: string, params: Record<string, unknown>): void
      onRequest(id: number, method: string, params: Record<string, unknown>): void
    } | undefined

    const rpc = {
      notify: vi.fn(),
      respond: vi.fn(() => {
        lifecycle.push('approval-response:start')
      }),
      request: vi.fn(async (method: string) => {
        if (method === 'thread/start') return { thread: { id: 'thread-a' } }
        if (method === 'turn/start') return { turn: { id: 'turn-a' } }
        if (method === 'turn/interrupt') {
          lifecycle.push('interrupt')
          return {}
        }
        if (method === 'thread/unsubscribe') {
          lifecycle.push('unsubscribe:start')
          await unsubscribe.promise
          lifecycle.push('unsubscribe:done')
          return {}
        }
        throw new Error(`Unexpected RPC request: ${method}`)
      })
    }
    const release = vi.fn(() => lifecycle.push('release'))
    acquireCodexAppServerMock.mockResolvedValue({
      drain: async () => {
        lifecycle.push('drain:start')
        await response.promise
        lifecycle.push('drain:done')
      },
      onExit: vi.fn(),
      pid: 1234,
      registerThread: vi.fn(async (_threadId, _cwd, nextHandlers) => {
        handlers = nextHandlers
      }),
      release,
      rpc,
      runThreadSetup: async (task: () => Promise<unknown>) => await task(),
      setHookHandler: vi.fn(),
      unregisterThread: vi.fn(async () => {
        lifecycle.push('unregister:start')
        await unregister.promise
        lifecycle.push('unregister:done')
      }),
      userAgent: 'codex/test'
    })

    const logger = makeLogger()
    const session = await createStreamCodexSession({
      logger,
      cwd: '/tmp/workspace',
      binaryPath: '/tmp/codex',
      spawnEnv: { HOME: '/tmp/codex-home' },
      threadEnv: {},
      proxyRouteTokens: [],
      resolvedAccount: 'account-a',
      useYolo: false,
      approvalPolicy: 'onRequest',
      sandboxPolicy: { type: 'readOnly' },
      features: {},
      configOverrideArgs: [],
      threadConfig: {},
      resolvedModel: undefined,
      resolvedModelProvider: undefined,
      resolvedMaxOutputTokens: undefined,
      effectiveEffort: undefined,
      turnEffort: undefined,
      serviceTier: undefined,
      threadCacheKey: 'cache-a',
      cachedThreadId: undefined,
      appServerPoolKey: 'profile-a',
      appServerIdleTimeoutMs: 300_000,
      networkConfig: {}
    }, {
      cache: {
        get: async () => undefined,
        set: async () => ({ cachePath: '/tmp/cache.json' })
      },
      configs: [undefined, undefined],
      ctxId: 'ctx-a',
      cwd: '/tmp/workspace',
      env: {},
      logger
    } as any, {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-a',
      description: 'hello',
      onEvent: vi.fn()
    } as any)

    handlers?.onNotification('turn/started', { turn: { id: 'turn-a' } })
    handlers?.onRequest(41, 'item/commandExecution/requestApproval', {
      threadId: 'thread-a',
      turnId: 'turn-a',
      command: 'pwd'
    })
    session.kill()

    expect(lifecycle).toEqual([
      'approval-response:start',
      'interrupt',
      'unregister:start',
      'drain:start'
    ])
    expect(release).not.toHaveBeenCalled()

    unregister.resolve()
    await vi.waitFor(() => expect(lifecycle).toContain('unsubscribe:start'))
    expect(release).not.toHaveBeenCalled()

    response.resolve()
    unsubscribe.resolve()
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
    expect(lifecycle).toEqual([
      'approval-response:start',
      'interrupt',
      'unregister:start',
      'drain:start',
      'unregister:done',
      'unsubscribe:start',
      'drain:done',
      'unsubscribe:done',
      'release'
    ])
  })
})
