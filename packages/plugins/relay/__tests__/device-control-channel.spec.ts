import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  RELAY_CONTROL_FALLBACK_HEARTBEAT_MS,
  RELAY_CONTROL_FALLBACK_LONG_POLL_MS,
  RELAY_CONTROL_FALLBACK_POLL_RETRY_MIN_MS,
  RELAY_CONTROL_HEARTBEAT_MS,
  RELAY_CONTROL_RETRY_MIN_MS,
  RELAY_CONTROL_SNAPSHOT_MS,
  createRelayDeviceControlChannel
} from '../src/server/device-control-channel.js'
import type { RelaySessionWorker } from '../src/server/session-worker.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

class FakeSocket extends EventEmitter {
  closed = false
  readyState = 0
  sent: string[] = []

  close() {
    this.closed = true
    this.readyState = 3
    this.emit('close')
  }

  open() {
    this.readyState = 1
    this.emit('open')
  }

  send(data: string) {
    this.sent.push(data)
  }

  terminate() {
    this.close()
  }
}

const heartbeat = {
  capabilities: { sessions: true },
  deviceId: 'device-1',
  deviceToken: 'super-secret-token',
  managementServerId: 'manager-1',
  managementServerKind: 'daemon',
  pluginScope: 'manager',
  remoteBaseUrl: 'https://cf.oneworks.cloud',
  workspaceFolder: '/workspace'
}

const createWorker = () =>
  ({
    refreshSnapshot: vi.fn(async () => {}),
    runOnce: vi.fn(async () => {}),
    stop: vi.fn()
  }) satisfies RelaySessionWorker

const transport = {
  apiBaseUrl: 'https://oneworks-relay-server.example.workers.dev/',
  controlWebSocketUrl: 'wss://oneworks-relay-server.example.workers.dev/api/relay/devices/control',
  version: 1 as const
}

describe('relay device control channel', () => {
  it('prefers WebSocket headers without URL secrets and performs zero idle HTTP polls over 24h', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const socket = new FakeSocket()
    const worker = createWorker()
    const factory = vi.fn(() => socket)
    const channel = createRelayDeviceControlChannel({
      heartbeat,
      sessionWorker: worker,
      transport,
      webSocketFactory: factory as never
    })

    socket.open()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)

    expect(factory).toHaveBeenCalledWith(transport.controlWebSocketUrl, {
      authorization: 'Bearer super-secret-token',
      'x-oneworks-relay-device-id': 'device-1'
    })
    expect(factory.mock.calls[0]?.[0]).not.toContain('device-1')
    expect(factory.mock.calls[0]?.[0]).not.toContain('super-secret-token')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(socket.sent).toHaveLength(1 + (24 * 60 * 60_000) / RELAY_CONTROL_HEARTBEAT_MS)
    expect(worker.refreshSnapshot).toHaveBeenCalledTimes(1 + (24 * 60 * 60_000) / RELAY_CONTROL_SNAPSHOT_MS)
    expect(worker.runOnce).toHaveBeenCalledTimes(1)
    expect(worker.runOnce).toHaveBeenCalledWith({
      refreshSnapshot: false,
      signal: expect.any(AbortSignal),
      waitMs: 0
    })
    channel.stop()
  })

  it('coalesces duplicate job notifications into one immediate non-polling claim', async () => {
    const socket = new FakeSocket()
    const worker = createWorker()
    const channel = createRelayDeviceControlChannel({
      heartbeat,
      sessionWorker: worker,
      transport,
      webSocketFactory: () => socket as never
    })
    socket.open()
    socket.emit('message', JSON.stringify({ type: 'jobs-available' }))
    socket.emit('message', JSON.stringify({ type: 'jobs-available' }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(worker.runOnce).toHaveBeenCalledTimes(1)
    expect(worker.runOnce).toHaveBeenCalledWith({
      refreshSnapshot: false,
      signal: expect.any(AbortSignal),
      waitMs: 0
    })
    channel.stop()
  })

  it('retains one wake that arrives while a claim is in flight', async () => {
    const socket = new FakeSocket()
    const worker = createWorker()
    let finishFirst: (() => void) | undefined
    worker.runOnce.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => {
        finishFirst = resolve
      })
    })
    const channel = createRelayDeviceControlChannel({
      heartbeat,
      sessionWorker: worker,
      transport,
      webSocketFactory: () => socket as never
    })
    socket.open()
    socket.emit('message', JSON.stringify({ type: 'jobs-available' }))
    await Promise.resolve()
    socket.emit('message', JSON.stringify({ type: 'jobs-available' }))
    socket.emit('message', JSON.stringify({ type: 'jobs-available' }))
    finishFirst?.()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(worker.runOnce).toHaveBeenCalledTimes(2)
    channel.stop()
  })

  it('uses one bounded fallback cycle and stays below the daily request budget', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const worker = createWorker()
    worker.runOnce.mockImplementation(async input => {
      await new Promise(resolve => setTimeout(resolve, input?.waitMs ?? 0))
    })
    const channel = createRelayDeviceControlChannel({
      heartbeat,
      random: () => 0.5,
      sessionWorker: worker
    })

    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    const snapshotRequests = 1 + (24 * 60 * 60_000) / RELAY_CONTROL_SNAPSHOT_MS
    const logicalRequests = fetchMock.mock.calls.length + worker.runOnce.mock.calls.length + snapshotRequests
    expect(logicalRequests).toBeLessThanOrEqual(3_200)
    expect(worker.runOnce.mock.calls.every(([input]) => (
      input?.waitMs === RELAY_CONTROL_FALLBACK_LONG_POLL_MS && input.signal instanceof AbortSignal
    ))).toBe(true)
    channel.stop()
  })

  it('keeps heartbeat-only devices out of the session job fallback', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const channel = createRelayDeviceControlChannel({
      heartbeat,
      random: () => 0.5
    })

    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(
      1 + (24 * 60 * 60_000) / RELAY_CONTROL_FALLBACK_HEARTBEAT_MS
    )
    expect(fetchMock.mock.calls.every(([request]) => (
      new URL(String(request)).pathname === '/api/relay/devices/heartbeat'
    ))).toBe(true)
    channel.stop()
  })

  it('keeps immediate poll failures inside the worst-case daily budget', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const worker = createWorker()
    worker.runOnce.mockRejectedValue(new Error('poll failed'))
    const channel = createRelayDeviceControlChannel({
      heartbeat,
      random: () => 0,
      sessionWorker: worker
    })

    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    const snapshotRequests = 1 + (24 * 60 * 60_000) / RELAY_CONTROL_SNAPSHOT_MS
    const logicalRequests = fetchMock.mock.calls.length + worker.runOnce.mock.calls.length + snapshotRequests

    expect(logicalRequests).toBeLessThanOrEqual(3_200)
    expect(worker.runOnce.mock.calls.length).toBeLessThanOrEqual(
      1 + (24 * 60 * 60_000) / RELAY_CONTROL_FALLBACK_POLL_RETRY_MIN_MS
    )
    channel.stop()
  })

  it('aborts the only in-flight fallback when a reconnect opens', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
    const first = new FakeSocket()
    const second = new FakeSocket()
    const sockets = [first, second]
    const worker = createWorker()
    let aborted = false
    worker.runOnce.mockImplementation(async input => {
      await new Promise<void>(resolve => {
        input?.signal?.addEventListener('abort', () => {
          aborted = true
          resolve()
        }, { once: true })
      })
    })
    const channel = createRelayDeviceControlChannel({
      heartbeat,
      random: () => 0.5,
      sessionWorker: worker,
      transport,
      webSocketFactory: () => sockets.shift() as never
    })

    first.close()
    await vi.advanceTimersByTimeAsync(0)
    expect(worker.runOnce).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RELAY_CONTROL_RETRY_MIN_MS)
    second.open()
    await vi.advanceTimersByTimeAsync(0)

    expect(aborted).toBe(true)
    channel.stop()
  })

  it('ignores a delayed close from a superseded socket', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
    const first = new FakeSocket()
    const second = new FakeSocket()
    const sockets = [first, second]
    const channel = createRelayDeviceControlChannel({
      heartbeat,
      random: () => 0.5,
      sessionWorker: createWorker(),
      transport,
      webSocketFactory: () => sockets.shift() as never
    })

    first.close()
    await vi.advanceTimersByTimeAsync(RELAY_CONTROL_RETRY_MIN_MS)
    second.open()
    first.emit('close')
    await vi.advanceTimersByTimeAsync(RELAY_CONTROL_RETRY_MIN_MS * 2)

    expect(sockets).toHaveLength(0)
    expect(second.closed).toBe(false)
    channel.stop()
  })

  it('keeps retry jitter in the 60-120s envelope and stop cancels all work', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
    const sockets: FakeSocket[] = []
    const worker = createWorker()
    const channel = createRelayDeviceControlChannel({
      heartbeat,
      random: () => 1,
      sessionWorker: worker,
      transport,
      webSocketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket as never
      }
    })
    sockets[0]?.close()
    const highJitterFirstRetryMs = Math.floor(RELAY_CONTROL_RETRY_MIN_MS * 1.2)
    await vi.advanceTimersByTimeAsync(highJitterFirstRetryMs - 1)
    expect(sockets).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets).toHaveLength(2)

    channel.stop()
    const calls = worker.runOnce.mock.calls.length
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(worker.runOnce).toHaveBeenCalledTimes(calls)
    expect(worker.stop).toHaveBeenCalledTimes(1)
  })
})
