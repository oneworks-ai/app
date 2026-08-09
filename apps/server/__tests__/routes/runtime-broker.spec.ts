import http from 'node:http'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RuntimeBrokerHttpClient } from '@oneworks/runtime-broker'

import { startRuntimeBrokerLoopbackTransport } from '#~/routes/runtime-broker-transport.js'
import { isRuntimeBrokerLoopbackAddress, runtimeBrokerRouter } from '#~/routes/runtime-broker.js'
import {
  configureRuntimeBrokerTransport,
  disposeRuntimeBroker,
  getRuntimeBroker,
  getRuntimeBrokerCallbackConnection,
  getRuntimeBrokerWorkspaceConnection
} from '#~/services/runtime-broker/index.js'

const createServerEnv = (role: 'manager' | 'workspace') => ({
  __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
  __ONEWORKS_PROJECT_SERVER_PORT__: 8787,
  __ONEWORKS_PROJECT_SERVER_WS_PATH__: '/ws',
  __ONEWORKS_PROJECT_SERVER_DATA_DIR__: '/tmp/ow-data',
  __ONEWORKS_PROJECT_SERVER_LOG_DIR__: '/tmp/ow-logs',
  __ONEWORKS_PROJECT_SERVER_LOG_LEVEL__: 'info',
  __ONEWORKS_PROJECT_SERVER_DEBUG__: false,
  __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__: false,
  __ONEWORKS_PROJECT_SERVER_ROLE__: role,
  __ONEWORKS_PROJECT_CLIENT_MODE__: 'none'
} as const)

describe('runtime broker route', () => {
  let server: http.Server | undefined

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (server == null) return resolve()
      server.close(error => error == null ? resolve() : reject(error))
    })
    server = undefined
    await disposeRuntimeBroker()
  })

  const start = async (role: 'manager' | 'workspace') => {
    const app = new Koa()
    app.use(async (ctx, next) => {
      try {
        await next()
      } catch (error) {
        ctx.status = typeof (error as { status?: unknown }).status === 'number'
          ? (error as { status: number }).status
          : 500
      }
    })
    app.use(bodyParser())
    const root = new Router()
    const brokerRouter = runtimeBrokerRouter(createServerEnv(role))
    root.use('/api/internal/runtime-broker', brokerRouter.routes(), brokerRouter.allowedMethods())
    app.use(root.routes())
    server = http.createServer(app.callback())
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('Test server failed to listen.')
    const url = `http://127.0.0.1:${address.port}`
    configureRuntimeBrokerTransport(url)
    return url
  }

  it('accepts only raw loopback socket addresses', () => {
    expect(isRuntimeBrokerLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isRuntimeBrokerLoopbackAddress('127.0.0.2')).toBe(true)
    expect(isRuntimeBrokerLoopbackAddress('::1')).toBe(true)
    expect(isRuntimeBrokerLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isRuntimeBrokerLoopbackAddress('192.168.1.5')).toBe(false)
    expect(isRuntimeBrokerLoopbackAddress(undefined)).toBe(false)
  })

  it('uses a dedicated loopback transport when the manager binds to a LAN host', async () => {
    const env = {
      ...createServerEnv('manager'),
      __ONEWORKS_PROJECT_SERVER_HOST__: '192.168.31.223'
    }
    const transport = await startRuntimeBrokerLoopbackTransport(env)
    server = transport.server
    configureRuntimeBrokerTransport(transport.baseUrl)

    const address = transport.server.address()
    expect(address).toMatchObject({ address: '127.0.0.1' })
    const connection = getRuntimeBrokerWorkspaceConnection('workspace:lan-manager')!
    expect(new URL(connection.url).hostname).toBe('127.0.0.1')
    await expect(new RuntimeBrokerHttpClient(connection).acquire({
      driverId: 'missing.driver',
      profileKey: 'profile-a'
    })).rejects.toMatchObject({ code: 'driver_not_found' })
  })

  it('round-trips a generic driver while binding every lease to its workspace owner', async () => {
    await start('manager')
    const release = vi.fn()
    const unregister = getRuntimeBroker().registerDriver({
      id: 'test.echo',
      acquire: async (_payload, context) => ({
        metadata: { ownerId: context.ownerId },
        invoke: async (operation, payload) => ({ operation, payload }),
        release
      }),
      callback: async (payload, context) => ({
        callback: payload,
        context: {
          callbackId: context.callbackId,
          leaseId: context.leaseId,
          profileKey: context.profileKey,
          signalAborted: context.signal?.aborted
        }
      })
    })
    const workspaceA = new RuntimeBrokerHttpClient(getRuntimeBrokerWorkspaceConnection('workspace:a')!)
    const workspaceB = new RuntimeBrokerHttpClient(getRuntimeBrokerWorkspaceConnection('workspace:b')!)
    const lease = await workspaceA.acquire({
      driverId: 'test.echo',
      profileKey: 'profile-a',
      payload: { resource: 'shared' }
    })

    expect(lease.metadata).toEqual({ ownerId: 'workspace:a' })
    await expect(lease.invoke('echo', { value: 1 })).resolves.toEqual({
      operation: 'echo',
      payload: { value: 1 }
    })
    await expect(workspaceB.request({
      action: 'invoke',
      leaseId: lease.leaseId,
      operation: 'echo'
    })).rejects.toMatchObject({ code: 'lease_not_found' })
    await expect(workspaceA.request({
      action: 'poll',
      afterCursor: -1,
      leaseId: lease.leaseId
    })).rejects.toMatchObject({ code: 'invalid_request' })

    const callbackClient = new RuntimeBrokerHttpClient(
      getRuntimeBrokerCallbackConnection('test.echo', 'profile-a', lease.leaseId)!
    )
    await expect(callbackClient.callback('test.echo', { event: 'ready' })).resolves.toEqual({
      callback: { event: 'ready' },
      context: {
        callbackId: expect.any(String),
        leaseId: lease.leaseId,
        profileKey: 'profile-a',
        signalAborted: false
      }
    })
    lease.release()
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
    unregister()
  })

  it('does not expose the internal broker from workspace-role servers', async () => {
    const baseUrl = await start('workspace')
    const response = await fetch(`${baseUrl}/api/internal/runtime-broker`, { method: 'POST' })
    expect(response.status).toBe(404)
  })

  it('invalidates callback capabilities when the broker generation changes', async () => {
    const baseUrl = await start('manager')
    const firstCallback = vi.fn(async () => ({ generation: 'first' }))
    getRuntimeBroker().registerDriver({
      id: 'test.generation',
      acquire: async () => ({ invoke: async () => ({}), release: () => undefined }),
      callback: firstCallback
    })
    const connection = getRuntimeBrokerCallbackConnection('test.generation', 'profile-a')!
    const client = new RuntimeBrokerHttpClient(connection)
    const request = {
      action: 'callback',
      callbackId: 'callback-generation-a',
      driverId: 'test.generation',
      payload: { event: 'ready' }
    }

    await expect(client.request(request)).resolves.toEqual({ generation: 'first' })
    expect(firstCallback).toHaveBeenCalledOnce()

    await disposeRuntimeBroker()
    configureRuntimeBrokerTransport(baseUrl)
    const secondCallback = vi.fn(async () => ({ generation: 'second' }))
    getRuntimeBroker().registerDriver({
      id: 'test.generation',
      acquire: async () => ({ invoke: async () => ({}), release: () => undefined }),
      callback: secondCallback
    })

    await expect(client.request(request)).rejects.toMatchObject({ code: 'transport_error' })
    expect(secondCallback).not.toHaveBeenCalled()
    await expect(
      new RuntimeBrokerHttpClient(
        getRuntimeBrokerCallbackConnection('test.generation', 'profile-a')!
      ).callback('test.generation', { event: 'ready' })
    ).resolves.toEqual({ generation: 'second' })
    expect(secondCallback).toHaveBeenCalledOnce()
  })
})
