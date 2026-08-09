import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { RuntimeBroker } from '@oneworks/runtime-broker'

import type { CodexRpcTransport } from '#~/protocol/rpc.js'
import {
  CODEX_APP_SERVER_RUNTIME_DRIVER_ID,
  RUNTIME_BROKER_CALLBACK_TOKEN_ENV,
  RUNTIME_BROKER_CALLBACK_URL_ENV,
  createCodexAppServerRuntimeBrokerDriver
} from '#~/runtime-broker-driver.js'
import type { AcquireCodexAppServerParams } from '#~/runtime/app-server-pool.js'

const createLogger = () => ({
  stream: new PassThrough(),
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn()
})

const createHarness = () => {
  const threadHandlers = new Map<string, {
    onNotification: (method: string, params: Record<string, unknown>) => void
    onRequest: (id: number, method: string, params: Record<string, unknown>) => void
  }>()
  let acquiredParams: AcquireCodexAppServerParams | undefined
  const release = vi.fn()
  const rpcRequest = vi.fn(async (method: string) => ({ method }))
  const rpc: CodexRpcTransport = {
    request: rpcRequest as CodexRpcTransport['request'],
    notify: vi.fn(),
    respond: vi.fn()
  }
  const acquireLocal = vi.fn(async (params: AcquireCodexAppServerParams) => {
    acquiredParams = params
    return {
      pid: 42,
      rpc,
      userAgent: 'codex-test',
      registerThread: async (
        threadId: string,
        _cwd: string,
        handlers: typeof threadHandlers extends Map<string, infer T> ? T : never
      ) => {
        threadHandlers.set(threadId, handlers)
      },
      unregisterThread: async (threadId: string) => {
        threadHandlers.delete(threadId)
      },
      onExit: vi.fn(),
      release,
      runThreadSetup: async <T>(task: () => Promise<T>) => await task()
    }
  })
  const broker = new RuntimeBroker({ pollTimeoutMs: 1 })
  const getCallbackConnection = vi.fn(() => ({
    token: 'callback-token',
    url: 'http://127.0.0.1:8787/api/internal/runtime-broker'
  }))
  broker.registerDriver(createCodexAppServerRuntimeBrokerDriver({
    acquireLocal,
    getCallbackConnection,
    logger: createLogger()
  }))
  return {
    acquireLocal,
    broker,
    getAcquiredParams: () => acquiredParams,
    getCallbackConnection,
    release,
    rpc,
    rpcRequest,
    threadHandlers
  }
}

const acquire = async (broker: RuntimeBroker, ownerId = 'workspace:a') =>
  await broker.acquire(ownerId, {
    driverId: CODEX_APP_SERVER_RUNTIME_DRIVER_ID,
    profileKey: 'profile-a',
    payload: {
      args: ['--enable', 'hooks'],
      binaryPath: '/usr/bin/codex',
      clientInfo: { name: 'oneworks' },
      cwd: '/tmp/shared-home',
      env: {
        HOME: '/tmp/shared-home',
        __ONEWORKS_PROJECT_RUNTIME_BROKER_TOKEN__: 'workspace-token',
        __ONEWORKS_PROJECT_RUNTIME_BROKER_URL__: 'http://127.0.0.1:8787/api/internal/runtime-broker'
      },
      experimentalApi: false,
      idleTimeoutMs: 300_000
    }
  })

describe('codex runtime broker driver', () => {
  it('returns lease-scoped hook credentials without exposing them to the app-server process', async () => {
    const harness = createHarness()
    const acquired = await acquire(harness.broker)
    const spawnEnv = harness.getAcquiredParams()?.env

    expect(acquired.metadata).toEqual({
      hookConnection: {
        token: 'callback-token',
        url: 'http://127.0.0.1:8787/api/internal/runtime-broker'
      },
      pid: 42,
      userAgent: 'codex-test'
    })
    expect(spawnEnv?.__ONEWORKS_PROJECT_RUNTIME_BROKER_TOKEN__).toBeUndefined()
    expect(spawnEnv?.__ONEWORKS_PROJECT_RUNTIME_BROKER_URL__).toBeUndefined()
    expect(spawnEnv?.[RUNTIME_BROKER_CALLBACK_URL_ENV]).toBeUndefined()
    expect(spawnEnv?.[RUNTIME_BROKER_CALLBACK_TOKEN_ENV]).toBeUndefined()
    expect(harness.getCallbackConnection).toHaveBeenCalledWith(
      CODEX_APP_SERVER_RUNTIME_DRIVER_ID,
      'profile-a',
      acquired.leaseId
    )

    await harness.broker.invoke('workspace:a', acquired.leaseId, 'thread.register', {
      cwd: '/tmp/workspace-a',
      threadId: 'thread-a'
    })
    harness.threadHandlers.get('thread-a')?.onNotification('turn/started', {
      threadId: 'thread-a',
      turn: { id: 'turn-a' }
    })
    await expect(harness.broker.poll('workspace:a', acquired.leaseId, 0, 1)).resolves.toMatchObject({
      events: [{
        kind: 'event',
        name: 'codex.rpc.notification',
        payload: {
          method: 'turn/started',
          params: { threadId: 'thread-a' }
        }
      }]
    })

    await harness.broker.release('workspace:a', acquired.leaseId)
    expect(harness.release).toHaveBeenCalledOnce()
    await harness.broker.dispose()
  })

  it('round-trips native hook callbacks to the thread owner only', async () => {
    const harness = createHarness()
    const acquired = await acquire(harness.broker)
    await harness.broker.invoke('workspace:a', acquired.leaseId, 'thread.register', {
      cwd: '/tmp/workspace-a',
      threadId: 'thread-a'
    })

    const input = {
      cwd: '/tmp/workspace-a',
      hookEventName: 'PreToolUse',
      sessionId: 'thread-a',
      toolName: 'Bash'
    }
    const callback = harness.broker.callback(CODEX_APP_SERVER_RUNTIME_DRIVER_ID, input, {
      callbackId: 'callback-owner-a',
      leaseId: acquired.leaseId,
      profileKey: 'profile-a'
    })
    const duplicateCallback = harness.broker.callback(CODEX_APP_SERVER_RUNTIME_DRIVER_ID, input, {
      callbackId: 'callback-owner-b',
      leaseId: acquired.leaseId,
      profileKey: 'profile-a'
    })
    const polled = await harness.broker.poll('workspace:a', acquired.leaseId, 0, 1)
    const hookRequest = polled.events.find(event => event.name === 'codex.hook')
    expect(hookRequest).toMatchObject({ kind: 'request' })
    harness.broker.respond(
      'workspace:a',
      acquired.leaseId,
      hookRequest!.requestId!,
      { decision: 'block', reason: 'policy' }
    )

    await expect(callback).resolves.toEqual({ decision: 'block', reason: 'policy' })
    await expect(duplicateCallback).resolves.toEqual({ decision: 'block', reason: 'policy' })
    expect(polled.events.filter(event => event.name === 'codex.hook')).toHaveLength(1)
    await harness.broker.release('workspace:a', acquired.leaseId)
    await harness.broker.dispose()
  })

  it('does not let a callback credential cross app-server profiles', async () => {
    const harness = createHarness()
    const acquired = await acquire(harness.broker)
    await harness.broker.invoke('workspace:a', acquired.leaseId, 'thread.register', {
      cwd: '/tmp/workspace-a',
      threadId: 'thread-a'
    })

    await expect(harness.broker.callback(CODEX_APP_SERVER_RUNTIME_DRIVER_ID, {
      cwd: '/tmp/workspace-a',
      hookEventName: 'PreToolUse',
      sessionId: 'thread-a',
      toolName: 'Bash'
    }, {
      callbackId: 'callback-profile-a',
      leaseId: acquired.leaseId,
      profileKey: 'profile-b'
    })).rejects.toMatchObject({
      code: 'lease_not_found'
    })
    await expect(harness.broker.poll('workspace:a', acquired.leaseId, 0, 1)).resolves.toEqual({
      events: [],
      nextCursor: 0
    })
    await harness.broker.release('workspace:a', acquired.leaseId)
    await harness.broker.dispose()
  })

  it('uses the serialized setup binding only until a thread owner is registered', async () => {
    const harness = createHarness()
    const acquired = await acquire(harness.broker)
    const setup = await harness.broker.invoke<{ setupId: string }>(
      'workspace:a',
      acquired.leaseId,
      'setup.begin',
      { cwd: '/tmp/workspace-a' }
    )
    const callback = harness.broker.callback(CODEX_APP_SERVER_RUNTIME_DRIVER_ID, {
      cwd: '/tmp/workspace-a',
      hookEventName: 'SessionStart',
      sessionId: 'not-registered-yet'
    }, {
      callbackId: 'callback-setup-a',
      leaseId: acquired.leaseId,
      profileKey: 'profile-a'
    })
    const polled = await harness.broker.poll('workspace:a', acquired.leaseId, 0, 1)
    harness.broker.respond(
      'workspace:a',
      acquired.leaseId,
      polled.events[0]!.requestId!,
      { continue: true }
    )
    await expect(callback).resolves.toEqual({ continue: true })
    await harness.broker.invoke('workspace:a', acquired.leaseId, 'setup.end', setup)

    await expect(harness.broker.callback(CODEX_APP_SERVER_RUNTIME_DRIVER_ID, {
      cwd: '/tmp/workspace-a',
      hookEventName: 'SessionStart',
      sessionId: 'still-unowned'
    }, {
      callbackId: 'callback-setup-b',
      leaseId: acquired.leaseId,
      profileKey: 'profile-a'
    })).resolves.toEqual({ continue: true })
    await harness.broker.release('workspace:a', acquired.leaseId)
    await harness.broker.dispose()
  })

  it('does not let a lease-scoped callback target another workspace on the same profile', async () => {
    const harness = createHarness()
    const workspaceA = await acquire(harness.broker, 'workspace:a')
    const workspaceB = await acquire(harness.broker, 'workspace:b')
    await harness.broker.invoke('workspace:a', workspaceA.leaseId, 'thread.register', {
      cwd: '/tmp/workspace-a',
      threadId: 'thread-a'
    })
    await harness.broker.invoke('workspace:b', workspaceB.leaseId, 'thread.register', {
      cwd: '/tmp/workspace-b',
      threadId: 'thread-b'
    })

    await expect(harness.broker.callback(CODEX_APP_SERVER_RUNTIME_DRIVER_ID, {
      cwd: '/tmp/workspace-b',
      hookEventName: 'Stop',
      sessionId: 'thread-b'
    }, {
      callbackId: 'callback-cross-workspace-a',
      leaseId: workspaceA.leaseId,
      profileKey: 'profile-a'
    })).resolves.toEqual({ continue: true })
    await expect(harness.broker.poll('workspace:b', workspaceB.leaseId, 0, 1)).resolves.toEqual({
      events: [],
      nextCursor: 0
    })

    await harness.broker.release('workspace:a', workspaceA.leaseId)
    await harness.broker.release('workspace:b', workspaceB.leaseId)
    await harness.broker.dispose()
  })

  it('authorizes shared app-server RPC and cleanup by workspace lease ownership', async () => {
    const harness = createHarness()
    const workspaceA = await acquire(harness.broker, 'workspace:a')
    const workspaceB = await acquire(harness.broker, 'workspace:b')
    await harness.broker.invoke('workspace:a', workspaceA.leaseId, 'thread.register', {
      cwd: '/tmp/workspace-a',
      threadId: 'thread-a'
    })

    const expectAccessDenied = async (operation: string, payload: unknown) => {
      await expect(
        harness.broker.invoke('workspace:b', workspaceB.leaseId, operation, payload)
      ).rejects.toMatchObject({ code: 'codex_rpc_access_denied' })
    }

    await expectAccessDenied('rpc.request', {
      method: 'turn/interrupt',
      params: { threadId: 'thread-a', turnId: 'turn-a' }
    })
    await expectAccessDenied('rpc.request', { method: 'thread/list', params: {} })
    await expectAccessDenied('rpc.request', {
      method: 'thread/read',
      params: { threadId: 'thread-a' }
    })
    await expectAccessDenied('rpc.request', {
      method: 'thread/resume',
      params: { cwd: '/tmp/workspace-b', threadId: 'thread-a' }
    })
    await expectAccessDenied('rpc.request', {
      method: 'thread/unsubscribe',
      params: { threadId: 'thread-a' }
    })
    await expectAccessDenied('rpc.notify', { method: 'initialized', params: {} })
    await expectAccessDenied('thread.unregister', { threadId: 'thread-a' })
    await expectAccessDenied('session.close', { responses: [], threadId: 'thread-a' })
    await expectAccessDenied('setup.begin', {
      cwd: '/tmp/workspace-b',
      threadId: 'thread-a'
    })

    harness.threadHandlers.get('thread-a')?.onRequest(41, 'item/commandExecution/requestApproval', {
      threadId: 'thread-a'
    })
    await expectAccessDenied('rpc.respond', { id: 41, result: { decision: 'decline' } })

    await expect(harness.broker.invoke('workspace:a', workspaceA.leaseId, 'rpc.request', {
      method: 'turn/interrupt',
      params: { threadId: 'thread-a', turnId: 'turn-a' }
    })).resolves.toEqual({ method: 'turn/interrupt' })
    await expect(harness.broker.invoke('workspace:a', workspaceA.leaseId, 'rpc.respond', {
      id: 41,
      result: { decision: 'decline' }
    })).resolves.toEqual({})

    expect(harness.rpcRequest).toHaveBeenCalledOnce()
    expect(harness.rpcRequest).toHaveBeenCalledWith(
      'turn/interrupt',
      { threadId: 'thread-a', turnId: 'turn-a' }
    )
    expect(harness.rpc.respond).toHaveBeenCalledWith(41, { decision: 'decline' })

    await harness.broker.release('workspace:a', workspaceA.leaseId)
    await harness.broker.release('workspace:b', workspaceB.leaseId)
    await harness.broker.dispose()
  })
})
