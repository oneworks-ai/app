import { PassThrough } from 'node:stream'

import { RuntimeBroker, RuntimeBrokerError } from '@oneworks/runtime-broker'
import type { RuntimeBrokerHttpRequest, RuntimeBrokerHttpResponse } from '@oneworks/runtime-broker'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCodexAppServerRuntimeBrokerDriver } from '#~/runtime-broker-driver.js'
import { createStreamCodexSession } from '#~/runtime/stream.js'

const makeLogger = () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  stream: new PassThrough(),
  warn: vi.fn()
})

const httpResponse = (body: RuntimeBrokerHttpResponse) =>
  ({
    json: async () => body,
    ok: true,
    status: 200
  }) as Response

describe('manager-owned Codex process exit', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries manager-side cleanup before releasing a crashed remote app-server lease', async () => {
    const logger = makeLogger()
    const localRelease = vi.fn()
    const localUnregister = vi.fn()
    let crashed = false
    let closeAttempts = 0
    let firstCloseSignal: AbortSignal | undefined
    let exitHandler: ((code: number | null) => void) | undefined
    let localThreadHandlers: {
      onRequest(id: number, method: string, params: Record<string, unknown>): void
    } | undefined
    const localLease = {
      onExit: (handler: (code: number | null) => void) => {
        exitHandler = handler
      },
      pid: 1234,
      registerThread: vi.fn(async (_threadId, _cwd, handlers) => {
        localThreadHandlers = handlers
      }),
      release: localRelease,
      rpc: {
        notify: vi.fn(),
        request: vi.fn(async (method: string) => {
          if (crashed) throw new Error('Codex app-server exited')
          if (method === 'thread/start') return { thread: { id: 'thread-a' } }
          if (method === 'turn/start') return { turn: { id: 'turn-a' } }
          return {}
        }),
        respond: vi.fn()
      },
      runThreadSetup: async (task: () => Promise<unknown>) => await task(),
      unregisterThread: localUnregister,
      userAgent: 'codex/test'
    }
    const broker = new RuntimeBroker({ pollTimeoutMs: 1 })
    broker.registerDriver(createCodexAppServerRuntimeBrokerDriver({
      acquireLocal: async () => localLease as any,
      getCallbackConnection: () => undefined,
      logger
    }))

    let pollCount = 0
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RuntimeBrokerHttpRequest
      try {
        let result: unknown
        switch (body.action) {
          case 'acquire':
            result = await broker.acquire('workspace:a', {
              driverId: body.driverId!,
              payload: body.payload,
              profileKey: body.profileKey!
            })
            break
          case 'invoke':
            if (body.operation === 'session.close') {
              closeAttempts += 1
              if (closeAttempts === 1) {
                firstCloseSignal = init?.signal as AbortSignal
                return await new Promise<Response>(() => undefined)
              }
            }
            result = await broker.invoke(
              'workspace:a',
              body.leaseId!,
              body.operation!,
              body.payload,
              body.invocationId
            )
            break
          case 'poll':
            pollCount += 1
            result = await broker.poll('workspace:a', body.leaseId!, body.afterCursor, body.timeoutMs)
            break
          case 'respond':
            broker.respond('workspace:a', body.leaseId!, body.requestId!, body.payload)
            result = {}
            break
          case 'release':
            await broker.release('workspace:a', body.leaseId!)
            result = {}
            break
          default:
            throw new RuntimeBrokerError('invalid_action', `Unexpected action: ${body.action}`)
        }
        return httpResponse({ ok: true, result })
      } catch (error) {
        return httpResponse({
          ok: false,
          error: error instanceof RuntimeBrokerError
            ? { code: error.code, message: error.message, details: error.details }
            : { code: 'internal_error', message: error instanceof Error ? error.message : String(error) }
        })
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const events: Array<{ type: string }> = []
    await createStreamCodexSession({
      logger,
      cwd: '/tmp/workspace',
      binaryPath: '/tmp/codex',
      spawnEnv: {
        HOME: '/tmp/codex-home',
        __ONEWORKS_PROJECT_RUNTIME_BROKER_TOKEN__: 'workspace-token',
        __ONEWORKS_PROJECT_RUNTIME_BROKER_URL__: 'http://127.0.0.1/runtime-broker'
      },
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
      onEvent: (event: { type: string }) => events.push(event)
    } as any)

    localThreadHandlers?.onRequest(41, 'item/commandExecution/requestApproval', {
      command: 'pwd',
      threadId: 'thread-a',
      turnId: 'turn-a'
    })
    await vi.waitFor(() => expect(events.some(event => event.type === 'interaction_request')).toBe(true))
    crashed = true
    exitHandler?.(1)

    await vi.waitFor(() => expect(localRelease).toHaveBeenCalledOnce(), { timeout: 3_000 })
    expect(closeAttempts).toBe(2)
    expect(firstCloseSignal?.aborted).toBe(true)
    expect(localLease.rpc.respond).toHaveBeenCalledWith(41, { decision: 'decline' })
    expect(localUnregister).toHaveBeenCalledWith('thread-a')
    expect(events.some(event => event.type === 'exit')).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 20))
    const settledPollCount = pollCount
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(pollCount).toBe(settledPollCount)
    await broker.dispose()
  })
})
