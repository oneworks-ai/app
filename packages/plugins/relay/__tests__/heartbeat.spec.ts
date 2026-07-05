import { afterEach, describe, expect, it, vi } from 'vitest'

import { sendHeartbeat, startHeartbeat } from '../src/server/heartbeat.js'

const createHeartbeatOptions = (fetchImpl: typeof fetch) => ({
  capabilities: {
    sessions: true,
    terminal: false,
    workspaceFiles: true,
    workspaceLauncher: true
  },
  deviceId: 'device-1',
  deviceName: 'Office Mac',
  deviceToken: 'device-token',
  fetchImpl,
  pluginScope: 'relay',
  remoteBaseUrl: 'https://relay.example/',
  workspaceFolder: '/workspace'
})

const createHeartbeatFetch = () =>
  vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        ok: true
      }),
      {
        headers: {
          'content-type': 'application/json'
        },
        status: 200
      }
    )
  )

afterEach(() => {
  vi.useRealTimers()
})

describe('relay plugin heartbeat', () => {
  it('sends heartbeat metadata to the remote relay', async () => {
    const fetchMock = createHeartbeatFetch()

    const body = await sendHeartbeat(createHeartbeatOptions(fetchMock))
    const [, init] = fetchMock.mock.calls[0]
    const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>

    expect(body).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://relay.example/api/relay/devices/heartbeat')
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer device-token',
      'content-type': 'application/json'
    })
    expect(requestBody).toMatchObject({
      capabilities: {
        sessions: true,
        terminal: false,
        workspaceFiles: true,
        workspaceLauncher: true
      },
      deviceId: 'device-1',
      deviceName: 'Office Mac',
      pluginScope: 'relay',
      workspaceFolder: '/workspace'
    })
  })

  it('stops scheduled heartbeats', async () => {
    vi.useFakeTimers()
    const fetchMock = createHeartbeatFetch()
    const heartbeat = startHeartbeat({
      ...createHeartbeatOptions(fetchMock),
      intervalMs: 1000
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledOnce()

    heartbeat.stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('backs off and throttles logs after repeated heartbeat failures', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => {
      throw new Error('relay offline')
    }) as unknown as typeof fetch
    const logger = {
      warn: vi.fn()
    }
    const heartbeat = startHeartbeat({
      ...createHeartbeatOptions(fetchMock),
      errorLogIntervalMs: 5000,
      intervalMs: 1000,
      logger,
      maxErrorIntervalMs: 8000
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(4000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(logger.warn).toHaveBeenCalledTimes(2)

    heartbeat.stop()
  })
})
