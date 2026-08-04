import { describe, expect, it } from 'vitest'

import { RelayDurableObject } from '../cloudflare/worker.js'
import { hashDeviceToken } from '../src/devices/private-metadata.js'
import type { RelayDurableObjectStorage } from '../src/storage/durable-object.js'
import { createFixtureStore } from './session-route-helpers.js'

class Storage implements RelayDurableObjectStorage {
  failCommit = false
  failWrites = false
  values = new Map<string, unknown>()
  async delete(key: string) {
    return this.values.delete(key)
  }
  async get<T = unknown>(key: string) {
    return this.values.get(key) as T | undefined
  }
  async put(key: string, value: unknown) {
    if (this.failWrites) throw new Error('persistence failed')
    this.values.set(key, value)
  }
  async transaction<T>(callback: (transaction: RelayDurableObjectStorage) => Promise<T>) {
    const result = await callback(this)
    if (this.failCommit) throw new Error('commit failed')
    return result
  }
}

class Socket {
  attachment: unknown
  closed: Array<unknown> = []
  sent: string[] = []
  close(...args: unknown[]) {
    this.closed = args
  }
  deserializeAttachment() {
    return this.attachment
  }
  send(value: string) {
    this.sent.push(value)
  }
  serializeAttachment(value: unknown) {
    this.attachment = value
  }
}

class State {
  storage = new Storage()
  sockets: Array<{ socket: Socket; tags: string[] }> = []
  acceptWebSocket(socket: Socket, tags: string[] = []) {
    this.sockets.push({ socket, tags })
  }
  getWebSockets(tag?: string) {
    return this.sockets
      .filter(entry => tag == null || entry.tags.includes(tag))
      .map(entry => entry.socket)
  }
}

const setup = async () => {
  const state = new State()
  const store = createFixtureStore()
  store.devices[0].deviceTokenHash = hashDeviceToken('device-token-1')
  delete store.devices[0].deviceToken
  store.deviceSessions.push({
    createdAt: '2026-01-01T00:00:00.000Z',
    deviceId: 'device-1',
    id: 'session-1',
    title: 'Session One',
    updatedAt: '2026-01-01T00:00:00.000Z'
  })
  await state.storage.put('relay:store', store)
  const client = new Socket()
  const server = new Socket()
  const object = new RelayDurableObject(
    state as never,
    {
      ONEWORKS_RELAY_DEVICE_API_URL: 'https://worker.example',
      ONEWORKS_RELAY_DEVICE_CONTROL_WS_URL: 'wss://worker.example/api/relay/devices/control',
      RELAY_OBJECT: {}
    } as never,
    {
      createUpgradeResponse: upgraded => ({ status: 101, webSocket: upgraded }) as never,
      createWebSocketPair: () => ({ 0: client, 1: server }) as never
    }
  )
  return { client, object, server, state }
}

const upgradeRequest = (token = 'device-token-1') =>
  new Request(
    'https://relay/api/relay/devices/control',
    {
      headers: {
        authorization: `Bearer ${token}`,
        upgrade: 'websocket',
        'x-oneworks-relay-device-id': 'device-1'
      }
    }
  )

describe('cloudflare relay control socket', () => {
  it('rejects bad bearer tokens before upgrade', async () => {
    const { object } = await setup()
    const response = await object.fetch(upgradeRequest('bad'))
    expect(response.status).toBe(401)
  })

  it('upgrades the fixed header endpoint with a hash-only hibernation attachment', async () => {
    const { client, object, server, state } = await setup()
    const response = await object.fetch(upgradeRequest()) as Response & { webSocket?: Socket }

    expect(response.status).toBe(101)
    expect(response.webSocket).toBe(client)
    expect(state.getWebSockets('device-1')).toEqual([server])
    expect(server.attachment).toMatchObject({
      version: 1,
      deviceId: 'device-1',
      deviceTokenHash: hashDeviceToken('device-token-1')
    })
    expect(JSON.stringify(server.attachment)).not.toContain('device-token-1')
  })

  it('revalidates every frame and applies heartbeat through the shared mutation', async () => {
    const { object, server, state } = await setup()
    await object.fetch(upgradeRequest())
    await object.webSocketMessage(
      server as never,
      JSON.stringify({
        type: 'heartbeat',
        payload: { deviceName: 'Updated' }
      })
    )

    const store = await state.storage.get<{ devices: Array<{ lastSeenAt?: string }> }>('relay:store')
    expect(store?.devices[0].lastSeenAt).toEqual(expect.any(String))

    server.serializeAttachment({ version: 1, deviceId: 'device-1', deviceTokenHash: 'rotated' })
    await object.webSocketMessage(server as never, JSON.stringify({ type: 'heartbeat' }))
    expect(server.closed[0]).toBe(1008)
  })

  it('rejects a hibernated socket after its device token rotates in durable storage', async () => {
    const { object, server, state } = await setup()
    await object.fetch(upgradeRequest())
    const store = await state.storage.get<ReturnType<typeof createFixtureStore>>('relay:store')
    store!.devices[0].deviceTokenHash = hashDeviceToken('rotated-token')
    await state.storage.put('relay:store', store)

    await object.webSocketMessage(server as never, JSON.stringify({ type: 'heartbeat' }))

    expect(server.closed[0]).toBe(1008)
  })

  it('rejects a hibernated socket after the device owner loses access', async () => {
    const { object, server, state } = await setup()
    await object.fetch(upgradeRequest())
    const store = await state.storage.get<ReturnType<typeof createFixtureStore>>('relay:store')
    store!.users[0].disabledAt = '2026-01-01T00:00:00.000Z'
    await state.storage.put('relay:store', store)

    await object.webSocketMessage(server as never, JSON.stringify({ type: 'heartbeat' }))

    expect(server.closed[0]).toBe(1008)
  })

  it('migrates a legacy plaintext device token after hash-only socket authentication', async () => {
    const { object, server, state } = await setup()
    const store = await state.storage.get<ReturnType<typeof createFixtureStore>>('relay:store')
    expect(store).toBeDefined()
    store!.devices[0].deviceToken = 'device-token-1'
    delete store!.devices[0].deviceTokenHash
    await state.storage.put('relay:store', store)

    await object.fetch(upgradeRequest())
    await object.webSocketMessage(server as never, JSON.stringify({ type: 'heartbeat' }))

    const migrated = await state.storage.get<ReturnType<typeof createFixtureStore>>('relay:store')
    expect(migrated?.devices[0].deviceTokenHash).toBe(hashDeviceToken('device-token-1'))
    expect(migrated?.devices[0].deviceToken).toBeUndefined()
  })

  it('fans out only after job payload and store persistence succeed', async () => {
    const { object, server, state } = await setup()
    await object.fetch(upgradeRequest())
    const submit = () =>
      object.fetch(
        new Request(
          'https://relay/api/relay/devices/device-1/sessions/session-1/messages',
          {
            method: 'POST',
            headers: {
              authorization: 'Bearer member-token-1',
              'content-type': 'application/json'
            },
            body: JSON.stringify({ message: 'hello' })
          }
        )
      )

    expect((await submit()).status).toBe(202)
    expect(server.sent).toEqual([JSON.stringify({ type: 'jobs-available' })])

    server.sent.length = 0
    state.storage.failCommit = true
    expect((await submit()).status).toBe(500)
    expect(server.sent).toEqual([])
  })

  it('closes malformed frames without exposing attachment contents', async () => {
    const { object, server } = await setup()
    await object.fetch(upgradeRequest())
    await object.webSocketMessage(server as never, '{')
    expect(server.closed[0]).toBe(1003)
  })

  it('closes oversized frames with the shared 1009 limit', async () => {
    const { object, server } = await setup()
    await object.fetch(upgradeRequest())

    await object.webSocketMessage(server as never, 'x'.repeat(64 * 1024 + 1))

    expect(server.closed[0]).toBe(1009)
  })

  it('closes safely when hibernation attachment data is missing', async () => {
    const { object, server } = await setup()
    server.serializeAttachment(undefined)

    await object.webSocketMessage(server as never, JSON.stringify({ type: 'heartbeat' }))

    expect(server.closed[0]).toBe(1008)
  })
})
