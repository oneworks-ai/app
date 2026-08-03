import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { readRequestBody } from '../src/http.js'
import { createRelayFetchHandler } from '../src/platform/fetch-handler.js'
import type { RelayStoreRepository } from '../src/storage/repository.js'
import type { RelayServerArgs } from '../src/types.js'
import { authHeaders } from './helpers.js'
import { createFixtureStore } from './session-route-helpers.js'

afterEach(() => vi.useRealTimers())

describe('relay body long polling', () => {
  it('stops accumulating an oversized body before concatenating partial chunks', async () => {
    const chunks = [Buffer.alloc(64), Buffer.alloc(1), Buffer.alloc(1)]
    let consumed = 0
    const request = {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          consumed += 1
          yield chunk
        }
      }
    }
    const concat = vi.spyOn(Buffer, 'concat')

    await expect(readRequestBody(request as never, { maxBytes: 64 })).rejects.toMatchObject({
      maxBytes: 64,
      name: 'RelayRequestBodyTooLargeError'
    })

    expect(consumed).toBe(2)
    expect(concat).not.toHaveBeenCalled()
    concat.mockRestore()
  })

  it('refreshes shared storage at most eleven times during an empty 50-second v2 body poll', async () => {
    vi.useFakeTimers()
    let store = createFixtureStore()
    let reads = 0
    const repository: RelayStoreRepository = {
      driver: 'json',
      location: 'instrumented',
      read: async () => {
        reads += 1
        return structuredClone(store)
      },
      withStore: async callback => {
        const local = await repository.read()
        await callback(local, repository)
        store = local
      },
      write: async next => {
        store = structuredClone(next)
      }
    }
    const args: RelayServerArgs = {
      adminToken: 'admin-token',
      allowOrigin: '*',
      dataPath: 'instrumented',
      host: '127.0.0.1',
      port: 0
    }
    const handler = createRelayFetchHandler(args, { storeRepository: repository })
    const response = handler(
      new Request('https://relay.example/api/relay/devices/device-1/session-jobs', {
        method: 'POST',
        headers: authHeaders('device-token-1'),
        body: JSON.stringify({
          heartbeat: { deviceId: 'device-1' },
          limit: 50,
          status: 'queued',
          waitMs: 50_000
        })
      })
    )

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(50_000)
    const finished = await response

    expect(finished.status).toBe(200)
    await expect(finished.json()).resolves.toMatchObject({ jobs: [], nextPollMs: 60_000 })
    expect(reads).toBeLessThanOrEqual(11)
  })

  it('rejects an oversized v2 body before loading or caching relay state', async () => {
    const repository: RelayStoreRepository = {
      driver: 'json',
      location: 'instrumented',
      read: vi.fn(),
      withStore: vi.fn(),
      write: vi.fn()
    }
    const args: RelayServerArgs = {
      adminToken: 'admin-token',
      allowOrigin: '*',
      dataPath: 'instrumented',
      host: '127.0.0.1',
      port: 0
    }
    const handler = createRelayFetchHandler(args, { storeRepository: repository })

    const response = await handler(
      new Request('https://relay.example/api/relay/devices/device-1/session-jobs', {
        method: 'POST',
        headers: authHeaders('device-token-1'),
        body: JSON.stringify({
          heartbeat: { deviceId: 'device-1', padding: 'x'.repeat(64 * 1024) },
          status: 'queued',
          waitMs: 50_000
        })
      })
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'Long-poll request body is too large.' })
    expect(repository.read).not.toHaveBeenCalled()
    expect(repository.withStore).not.toHaveBeenCalled()
    expect(repository.write).not.toHaveBeenCalled()
  })
})
