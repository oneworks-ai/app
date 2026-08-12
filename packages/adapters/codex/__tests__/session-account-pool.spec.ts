import { PassThrough } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdapterOutputEvent } from '@oneworks/types'

import { createCodexSession } from '#~/runtime/session.js'

const mocks = vi.hoisted(() => ({
  classifyFailure: vi.fn(),
  createDirect: vi.fn(),
  createStream: vi.fn(),
  markFailure: vi.fn(),
  releaseProxyMeta: vi.fn(),
  resolvePool: vi.fn(),
  resolveSessionBase: vi.fn(),
  watcherStart: vi.fn(),
  watcherStop: vi.fn()
}))

vi.mock('#~/runtime/accounts.js', () => ({
  classifyCodexAccountPoolFailure: mocks.classifyFailure,
  markCodexAccountPoolFailure: mocks.markFailure,
  resolveCodexAccountPoolCandidates: mocks.resolvePool
}))

vi.mock('#~/runtime/direct.js', () => ({
  createDirectCodexSession: mocks.createDirect
}))

vi.mock('#~/runtime/proxy.js', () => ({
  releaseCodexProxyMeta: mocks.releaseProxyMeta
}))

vi.mock('#~/runtime/session-common.js', () => ({
  resolveSessionBase: mocks.resolveSessionBase
}))

vi.mock('#~/runtime/stream.js', () => ({
  createStreamCodexSession: mocks.createStream
}))

vi.mock('#~/runtime/transcript-hooks.js', () => ({
  createCodexTranscriptHookWatcher: () => ({
    start: mocks.watcherStart,
    stop: mocks.watcherStop
  })
}))

const makeCtx = () =>
  ({
    cache: {
      get: vi.fn(),
      set: vi.fn()
    },
    configs: [],
    ctxId: 'ctx',
    cwd: '/tmp/workspace',
    env: {},
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      stream: new PassThrough(),
      warn: vi.fn()
    }
  }) as any

const makeBase = (account: string) =>
  ({
    effectiveEffort: 'medium',
    proxyRouteTokens: [`route-${account}`],
    resolvedAccount: account,
    resolvedModel: 'gpt-5.4',
    spawnEnv: {},
    useYolo: false
  }) as any

describe('codex session account failover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePool.mockResolvedValue({
      enabled: true,
      cooldownMs: 60_000,
      candidates: [
        { key: 'primary', priority: 100, credentialFingerprint: 'primary-v1' },
        { key: 'backup', priority: 50, credentialFingerprint: 'backup-v1' }
      ]
    })
    mocks.classifyFailure.mockReturnValue({ reason: 'rate_limit', cooldownMs: 60_000 })
    mocks.markFailure.mockResolvedValue(undefined)
    mocks.resolveSessionBase.mockImplementation(async (_ctx, options) => makeBase(options.account))
  })

  it('switches accounts before the first committed event and emits only the winning init', async () => {
    const events: AdapterOutputEvent[] = []
    const sessions = new Map<string, { kill: ReturnType<typeof vi.fn> }>()
    const attemptOptions = new Map<string, any>()
    mocks.createStream.mockImplementation(async (base, _ctx, options) => {
      attemptOptions.set(base.resolvedAccount, options)
      const session = { kill: vi.fn(), emit: vi.fn(), pid: base.resolvedAccount === 'primary' ? 1 : 2 }
      sessions.set(base.resolvedAccount, session)
      return session
    })

    const session = await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session',
      description: 'hello',
      model: 'gpt-5.4',
      onEvent: (event: AdapterOutputEvent) => events.push(event)
    } as any)

    expect(events).toEqual([])
    expect(attemptOptions.get('primary').onRecoverableInitialAccountFailure(new Error('429 rate limit')))
      .toBe(true)
    await vi.waitFor(() => expect(mocks.createStream).toHaveBeenCalledTimes(2))
    expect(mocks.markFailure).toHaveBeenCalledWith(expect.objectContaining({
      candidate: expect.objectContaining({ key: 'primary' }),
      model: 'gpt-5.4',
      reason: 'rate_limit'
    }))
    expect(events).toEqual([])

    attemptOptions.get('backup').onEvent({
      type: 'message',
      data: { id: 'message', role: 'assistant', content: 'hello', createdAt: Date.now() }
    })

    expect(events.map(event => event.type)).toEqual(['init', 'message'])
    expect(events[0]).toMatchObject({ type: 'init', data: { account: 'backup' } })
    expect(events.filter(event => event.type === 'init')).toHaveLength(1)
    expect(session.pid).toBe(2)

    session.kill()
    expect(sessions.get('backup')?.kill).toHaveBeenCalledOnce()
    expect(mocks.releaseProxyMeta).toHaveBeenCalledWith('route-primary')
    expect(mocks.releaseProxyMeta).toHaveBeenCalledWith('route-backup')
  })

  it('does not enable pool failover for an explicitly selected account', async () => {
    mocks.resolveSessionBase.mockResolvedValue(makeBase('primary'))
    mocks.createStream.mockResolvedValue({ kill: vi.fn(), emit: vi.fn(), pid: 1 })
    const events: AdapterOutputEvent[] = []

    await createCodexSession(makeCtx(), {
      account: 'primary',
      type: 'create',
      runtime: 'server',
      sessionId: 'session',
      description: 'hello',
      onEvent: (event: AdapterOutputEvent) => events.push(event)
    } as any)

    expect(mocks.resolvePool).not.toHaveBeenCalled()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'init', data: { account: 'primary' } })
  })

  it('emits init immediately and does not defer failures for an empty initial prompt', async () => {
    const events: AdapterOutputEvent[] = []
    mocks.createStream.mockResolvedValue({ kill: vi.fn(), emit: vi.fn(), pid: 1 })

    await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session-empty',
      description: '',
      onEvent: (event: AdapterOutputEvent) => events.push(event)
    } as any)

    expect(mocks.createStream).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ deferInitialFailure: false })
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'init', data: { account: 'primary' } })
  })

  it('marks the final candidate unhealthy even when there is nowhere left to fail over', async () => {
    const attemptOptions = new Map<string, any>()
    mocks.createStream.mockImplementation(async (base, _ctx, options) => {
      attemptOptions.set(base.resolvedAccount, options)
      return { kill: vi.fn(), emit: vi.fn(), pid: 1 }
    })
    await createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session',
      description: 'hello',
      model: 'gpt-5.4',
      onEvent: vi.fn()
    } as any)

    expect(attemptOptions.get('primary').onRecoverableInitialAccountFailure(new Error('429 primary'))).toBe(true)
    await vi.waitFor(() => expect(mocks.createStream).toHaveBeenCalledTimes(2))
    expect(attemptOptions.get('backup').onRecoverableInitialAccountFailure(new Error('429 backup'))).toBe(false)
    await vi.waitFor(() => expect(mocks.markFailure).toHaveBeenCalledTimes(2))
    expect(mocks.markFailure).toHaveBeenLastCalledWith(expect.objectContaining({
      candidate: expect.objectContaining({ key: 'backup' })
    }))
  })

  it('marks the final candidate unhealthy when session-base resolution fails', async () => {
    mocks.resolveSessionBase
      .mockRejectedValueOnce(new Error('429 primary'))
      .mockRejectedValueOnce(new Error('429 backup'))

    await expect(createCodexSession(makeCtx(), {
      type: 'create',
      runtime: 'server',
      sessionId: 'session',
      description: 'hello',
      model: 'gpt-5.4',
      onEvent: vi.fn()
    } as any)).rejects.toThrow('429 backup')

    expect(mocks.markFailure).toHaveBeenCalledTimes(2)
    expect(mocks.markFailure).toHaveBeenLastCalledWith(expect.objectContaining({
      candidate: expect.objectContaining({ key: 'backup' })
    }))
  })
})
