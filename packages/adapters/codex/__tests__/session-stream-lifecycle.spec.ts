import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquire: vi.fn()
}))

vi.mock('#~/runtime/app-server-pool.js', () => ({
  acquireCodexAppServer: mocks.acquire
}))

const createHarness = (params: { failThreadStart?: boolean } = {}) => {
  const events: string[] = []
  const request = vi.fn(async (method: string) => {
    if (method === 'thread/start') {
      if (params.failThreadStart === true) throw new Error('synthetic thread start failure')
      return { thread: { id: 'thread-1' } }
    }
    if (method === 'thread/unsubscribe') events.push('unsubscribe')
    return {}
  })
  const appServer = {
    drain: vi.fn(async () => {
      events.push('drain')
    }),
    hookEnv: {},
    onExit: vi.fn(),
    pid: 4242,
    registerThread: vi.fn(async () => undefined),
    release: vi.fn(() => {
      events.push('release')
    }),
    rpc: {
      request,
      respond: vi.fn()
    },
    runThreadSetup: vi.fn(async (task: () => Promise<unknown>) => await task()),
    setHookHandler: vi.fn(),
    unregisterThread: vi.fn(async () => {
      events.push('unregister')
    }),
    userAgent: 'synthetic-codex'
  }
  const reconcileCredentialOwner = vi.fn(async () => {
    events.push('reconcile')
    throw new Error('synthetic reconciliation failure')
  })
  const onEvent = vi.fn((event: { type: string }) => {
    if (event.type === 'exit') events.push('exit')
  })
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
  const cacheStore = new Map<string, unknown>()
  const ctx = {
    cache: {
      get: vi.fn(async (key: string) => cacheStore.get(key)),
      set: vi.fn(async (key: string, value: unknown) => {
        cacheStore.set(key, value)
      })
    },
    configs: [],
    ctxId: 'synthetic-stream',
    cwd: '/synthetic/workspace',
    env: {},
    logger
  }
  const base = {
    appServerIdleTimeoutMs: 1_000,
    appServerPoolKey: 'synthetic-profile',
    approvalPolicy: 'never',
    binaryPath: '/synthetic/codex',
    cachedThreadId: undefined,
    configOverrideArgs: [],
    cwd: '/synthetic/workspace',
    features: {},
    logger,
    reconcileCredentialOwner,
    resolvedAccount: 'work',
    resolvedMaxOutputTokens: undefined,
    resolvedModel: undefined,
    resolvedModelProvider: undefined,
    sandboxPolicy: { type: 'readOnly' },
    serviceTier: undefined,
    spawnEnv: { HOME: '/synthetic/codex-home' },
    threadCacheKey: 'synthetic-thread-cache',
    threadConfig: {},
    threadEnv: {},
    turnEffort: undefined,
    useYolo: false
  }
  const options = {
    description: undefined,
    onEvent,
    permissionMode: 'dontAsk',
    runtime: 'server',
    sessionId: 'synthetic-session',
    type: 'query'
  }
  return { appServer, base, ctx, events, onEvent, options, reconcileCredentialOwner }
}

describe('codex stream lifecycle cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('releases the actual stream entrypoint after cleanup when reconciliation rejects', async () => {
    const harness = createHarness()
    mocks.acquire.mockResolvedValueOnce(harness.appServer)
    const { createStreamCodexSession } = await import('#~/runtime/stream.js')
    const session = await createStreamCodexSession(
      harness.base as any,
      harness.ctx as any,
      harness.options as any
    )

    session.kill()

    await vi.waitFor(() => {
      expect(harness.appServer.release).toHaveBeenCalledOnce()
      expect(harness.onEvent).toHaveBeenCalledWith({ type: 'exit', data: { exitCode: 0 } })
    })
    expect(harness.appServer.unregisterThread).toHaveBeenCalledWith('thread-1')
    expect(harness.appServer.drain).toHaveBeenCalledOnce()
    expect(harness.reconcileCredentialOwner).toHaveBeenCalledOnce()
    expect(harness.events.indexOf('unregister')).toBeLessThan(harness.events.indexOf('reconcile'))
    expect(harness.events.indexOf('drain')).toBeLessThan(harness.events.indexOf('reconcile'))
    expect(harness.events.indexOf('reconcile')).toBeLessThan(harness.events.indexOf('release'))
    expect(harness.events.indexOf('release')).toBeLessThan(harness.events.indexOf('exit'))
  })

  it('releases the actual stream entrypoint after an initial error and reconciliation rejection', async () => {
    const harness = createHarness({ failThreadStart: true })
    mocks.acquire.mockResolvedValueOnce(harness.appServer)
    const { createStreamCodexSession } = await import('#~/runtime/stream.js')

    await expect(createStreamCodexSession(
      harness.base as any,
      harness.ctx as any,
      { ...harness.options, deferInitialFailure: true } as any
    )).rejects.toThrow('synthetic thread start failure')

    expect(harness.reconcileCredentialOwner).toHaveBeenCalledOnce()
    expect(harness.appServer.release).toHaveBeenCalledOnce()
    expect(harness.events.indexOf('reconcile')).toBeLessThan(harness.events.indexOf('release'))
  })

  it('reconciles exactly once and preserves an app-server acquisition error', async () => {
    const harness = createHarness()
    mocks.acquire.mockRejectedValueOnce(new Error('synthetic acquisition failure'))
    const { createStreamCodexSession } = await import('#~/runtime/stream.js')

    await expect(createStreamCodexSession(
      harness.base as any,
      harness.ctx as any,
      harness.options as any
    )).rejects.toThrow('synthetic acquisition failure')

    expect(harness.reconcileCredentialOwner).toHaveBeenCalledOnce()
    expect(harness.appServer.release).not.toHaveBeenCalled()
    expect(harness.ctx.logger.warn).toHaveBeenCalledWith(
      '[codex session] credential owner reconciliation failed after app-server acquisition',
      expect.objectContaining({ error: 'synthetic reconciliation failure' })
    )
  })
})
