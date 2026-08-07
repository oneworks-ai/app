import { afterEach, describe, expect, it, vi } from 'vitest'

import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import WebSocket from 'ws'

import { visibleDevicePrivateMetadata } from '../src/devices/private-metadata.js'
import { attachRelayNodeControl } from '../src/platform/node-control.js'
import type { RelayStoreRepository } from '../src/storage/repository.js'
import { readRelayStore, writeRelayStore } from '../src/store.js'
import { createRelayTelemetry } from '../src/telemetry/metrics.js'
import type { RelayServerArgs } from '../src/types.js'
import { authHeaders, requestJson } from './helpers.js'
import {
  cleanupSessionRelayFixtures,
  createFixtureStore,
  listenSessionRelay,
  postSnapshot
} from './session-route-helpers.js'

afterEach(cleanupSessionRelayFixtures)

const waitForOpen = async (socket: WebSocket) =>
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })

const waitForClose = async (socket: WebSocket) =>
  await new Promise<number>((resolve, reject) => {
    socket.once('close', code => resolve(code))
    socket.once('error', reject)
  })

const waitForMessage = async (socket: WebSocket) =>
  await new Promise<unknown>((resolve, reject) => {
    socket.once('message', data => resolve(JSON.parse(String(data))))
    socket.once('error', reject)
  })

const waitForPong = async (socket: WebSocket) =>
  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const settle = (error?: Error) => {
      if (timeout != null) clearTimeout(timeout)
      socket.off('pong', onPong)
      socket.off('error', onError)
      socket.off('close', onClose)
      if (error == null) resolve()
      else reject(error)
    }
    const onPong = () => settle()
    const onError = (error: Error) => settle(error)
    const onClose = () => settle(new Error('Control socket closed before the pong barrier.'))
    socket.once('pong', onPong)
    socket.once('error', onError)
    socket.once('close', onClose)
    timeout = setTimeout(() => settle(new Error('Timed out waiting for the control socket pong barrier.')), 2_000)
    try {
      socket.ping()
    } catch (error) {
      settle(error instanceof Error ? error : new Error('Failed to send the control socket ping.'))
    }
  })

const waitForUpgradeRejection = async (socket: WebSocket) =>
  await new Promise<Error>(resolve => {
    socket.once('error', resolve)
  })

const waitForStoreState = async (
  dataPath: string,
  predicate: (store: Awaited<ReturnType<typeof readRelayStore>>) => boolean
) =>
  await vi.waitFor(async () => {
    expect(predicate(await readRelayStore(dataPath))).toBe(true)
  }, { interval: 10, timeout: 2_000 })

const createDeferred = () => {
  let resolve: () => void = () => {}
  const promise = new Promise<void>(deferredResolve => {
    resolve = deferredResolve
  })
  return { promise, resolve }
}

const waitForSignal = async (promise: Promise<void>, label: string) => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 2_000)
      })
    ])
  } finally {
    if (timeout != null) clearTimeout(timeout)
  }
}

const sendRawUpgrade = async (baseUrl: string, request: string) => {
  const target = new URL(baseUrl)
  return await new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: target.hostname, port: Number(target.port) })
    let response = ''
    socket.setEncoding('utf8')
    socket.once('error', reject)
    socket.on('data', chunk => {
      response += chunk
    })
    socket.once('close', () => resolve(response))
    socket.once('connect', () => socket.end(request))
  })
}

describe('node relay control socket', () => {
  it('rejects unauthenticated upgrades and advertises the actual port-zero loopback endpoint', async () => {
    const { baseUrl } = await listenSessionRelay()
    const controlUrl = `${baseUrl.replace(/^http/u, 'ws')}/api/relay/devices/control`
    const unauthorized = new WebSocket(controlUrl)
    const rejection = waitForUpgradeRejection(unauthorized)
    const info = await requestJson(baseUrl, '/api/relay/info')

    await expect(rejection).resolves.toMatchObject({
      message: 'Unexpected server response: 401'
    })
    expect(info.body.deviceTransport).toMatchObject({
      apiBaseUrl: `${baseUrl}/`,
      controlWebSocketUrl: controlUrl,
      version: 1
    })
  })

  it('does not reuse a deployment-specific control transport on the Node listener', async () => {
    const { baseUrl } = await listenSessionRelay({
      deviceTransport: {
        apiBaseUrl: 'https://worker.example/',
        controlWebSocketUrl: 'wss://worker.example/api/relay/devices/control',
        version: 1
      }
    })

    const info = await requestJson(baseUrl, '/api/relay/info')

    expect(info.body.deviceTransport).toMatchObject({
      apiBaseUrl: `${baseUrl}/`,
      controlWebSocketUrl: `${baseUrl.replace(/^http/u, 'ws')}/api/relay/devices/control`,
      version: 1
    })
  })

  it('rejects malicious upgrade Host and request-target values without taking down the listener', async () => {
    const { baseUrl } = await listenSessionRelay()
    const host = new URL(baseUrl).host
    const maliciousHostResponse = await sendRawUpgrade(
      baseUrl,
      [
        'GET /api/relay/devices/control HTTP/1.1',
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Host: invalid%host',
        '',
        ''
      ].join('\r\n')
    )
    const malformedTargetResponse = await sendRawUpgrade(
      baseUrl,
      [
        'GET http://% HTTP/1.1',
        'Connection: Upgrade',
        'Upgrade: websocket',
        `Host: ${host}`,
        '',
        ''
      ].join('\r\n')
    )

    expect(maliciousHostResponse).toContain('401 Unauthorized')
    expect(malformedTargetResponse).not.toContain('101 Switching Protocols')
    await expect(requestJson(baseUrl, '/health')).resolves.toMatchObject({ response: { status: 200 } })
  })

  it('notifies a connected device after a persisted session job is submitted', async () => {
    const { baseUrl } = await listenSessionRelay()
    await postSnapshot(baseUrl, 'device-1', 'device-token-1', [
      { id: 'session-1', title: 'Control session', userId: 'user-1', workspaceFolder: '/workspace' }
    ])
    const controlUrl = `${baseUrl.replace(/^http/u, 'ws')}/api/relay/devices/control`
    const socket = new WebSocket(controlUrl, {
      headers: { authorization: 'Bearer device-token-1', 'x-oneworks-relay-device-id': 'device-1' }
    })
    await waitForOpen(socket)
    const notification = waitForMessage(socket)
    const submitted = await requestJson(baseUrl, '/api/relay/devices/device-1/sessions/session-1/messages', {
      method: 'POST',
      headers: authHeaders('member-token-1'),
      body: JSON.stringify({ message: 'wake control socket' })
    })

    expect(submitted.response.status).toBe(202)
    await expect(notification).resolves.toEqual({ type: 'jobs-available' })
    expect(controlUrl).not.toContain('device-token-1')
    expect(controlUrl).not.toContain('device-1')
    socket.close()
  })

  it('upgrades with header-only auth, applies heartbeats, and revokes a rotated device token per frame', async () => {
    const { args, baseUrl } = await listenSessionRelay()
    // ws accepts the control device id only as an upgrade header; it must never be present in the URL.
    const authenticated = new WebSocket(`${baseUrl.replace(/^http/u, 'ws')}/api/relay/devices/control`, {
      headers: { authorization: 'Bearer device-token-1', 'x-oneworks-relay-device-id': 'device-1' }
    })
    await waitForOpen(authenticated)
    await waitForPong(authenticated)
    const previousLastSeenAt = (await readRelayStore(args.dataPath)).devices[0].lastSeenAt
    authenticated.send(JSON.stringify({ type: 'heartbeat', payload: { deviceName: 'Node control' } }))
    await waitForStoreState(args.dataPath, store => (
      store.devices[0].lastSeenAt !== previousLastSeenAt
    ))

    const store = await readRelayStore(args.dataPath)
    store.devices[0].deviceTokenHash = 'sha256:rotated'
    await writeRelayStore(args.dataPath, store)
    const closed = waitForClose(authenticated)
    authenticated.send(JSON.stringify({ type: 'heartbeat', payload: {} }))
    expect(await closed).toBe(1008)
  })

  it('closes malformed frames and frames that lose device permission', async () => {
    const { args, baseUrl } = await listenSessionRelay()
    const controlUrl = `${baseUrl.replace(/^http/u, 'ws')}/api/relay/devices/control`
    const malformed = new WebSocket(controlUrl, {
      headers: { authorization: 'Bearer device-token-1', 'x-oneworks-relay-device-id': 'device-1' }
    })
    await waitForOpen(malformed)
    const malformedClosed = waitForClose(malformed)
    malformed.send('{')
    expect(await malformedClosed).toBe(1003)

    const revoked = new WebSocket(controlUrl, {
      headers: { authorization: 'Bearer device-token-1', 'x-oneworks-relay-device-id': 'device-1' }
    })
    await waitForOpen(revoked)
    const store = await readRelayStore(args.dataPath)
    store.users[0]!.disabledAt = new Date().toISOString()
    await writeRelayStore(args.dataPath, store)
    const revokedClosed = waitForClose(revoked)
    revoked.send(JSON.stringify({ type: 'heartbeat', payload: {} }))
    expect(await revokedClosed).toBe(1008)
  })

  it('bounds a slow heartbeat repository to the in-flight frame and the latest pending frame', async () => {
    const store = createFixtureStore()
    const firstHeartbeatStarted = createDeferred()
    const unblockFirstHeartbeat = createDeferred()
    const secondHeartbeatStarted = createDeferred()
    const secondHeartbeatCompleted = createDeferred()
    let heartbeatTransactions = 0
    const repository: RelayStoreRepository = {
      driver: 'json',
      location: 'slow-test',
      read: async () => store,
      withStore: async callback => {
        heartbeatTransactions += 1
        const transaction = heartbeatTransactions
        if (transaction === 1) {
          firstHeartbeatStarted.resolve()
          await unblockFirstHeartbeat.promise
        }
        if (transaction === 2) secondHeartbeatStarted.resolve()
        const result = await callback(store, repository)
        if (transaction === 2) secondHeartbeatCompleted.resolve()
        return result
      },
      write: async () => {}
    }
    const args: RelayServerArgs = {
      adminToken: 'admin-token',
      allowOrigin: '*',
      dataPath: 'slow-test',
      host: '127.0.0.1',
      port: 0
    }
    const server = createServer()
    attachRelayNodeControl({ args, repository, server, telemetry: createRelayTelemetry() })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = Number((server.address() as { port: number }).port)
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/relay/devices/control`, {
      headers: { authorization: 'Bearer device-token-1', 'x-oneworks-relay-device-id': 'device-1' }
    })
    try {
      await waitForOpen(socket)
      for (let index = 0; index < 128; index += 1) {
        socket.send(JSON.stringify({ type: 'heartbeat', payload: { deviceName: `Burst ${index}` } }))
      }
      await waitForSignal(firstHeartbeatStarted.promise, 'the first heartbeat transaction')
      await waitForPong(socket)
      unblockFirstHeartbeat.resolve()
      await waitForSignal(secondHeartbeatStarted.promise, 'the pending heartbeat transaction')
      await waitForSignal(secondHeartbeatCompleted.promise, 'the pending heartbeat completion')
      await new Promise<void>(resolve => setImmediate(resolve))

      expect(heartbeatTransactions).toBe(2)
      expect(visibleDevicePrivateMetadata(args, store.devices[0]).name).toBe('Burst 127')
    } finally {
      unblockFirstHeartbeat.resolve()
      socket.terminate()
      await new Promise<void>((resolve, reject) => server.close(error => error == null ? resolve() : reject(error)))
    }
  })

  it('closes oversized frames with 1009 and keeps the Node listener healthy', async () => {
    const { baseUrl } = await listenSessionRelay()
    const socket = new WebSocket(`${baseUrl.replace(/^http/u, 'ws')}/api/relay/devices/control`, {
      headers: { authorization: 'Bearer device-token-1', 'x-oneworks-relay-device-id': 'device-1' }
    })
    await waitForOpen(socket)
    const closed = waitForClose(socket)

    socket.send('x'.repeat(64 * 1024 + 1))

    expect(await closed).toBe(1009)
    await expect(requestJson(baseUrl, '/health')).resolves.toMatchObject({ response: { status: 200 } })
  })

  it('terminates an upgraded socket before Node server shutdown completes', async () => {
    const { baseUrl, server } = await listenSessionRelay()
    const socket = new WebSocket(`${baseUrl.replace(/^http/u, 'ws')}/api/relay/devices/control`, {
      headers: { authorization: 'Bearer device-token-1', 'x-oneworks-relay-device-id': 'device-1' }
    })
    await waitForOpen(socket)
    const closed = waitForClose(socket)
    await new Promise<void>((resolve, reject) => server.close(error => error == null ? resolve() : reject(error)))
    expect(await closed).toBe(1006)
  })
})
