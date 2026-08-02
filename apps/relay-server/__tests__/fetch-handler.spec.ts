import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRelayFetchHandler } from '../src/platform/fetch-handler.js'
import { createJsonRelayStoreRepository } from '../src/storage/repository.js'
import { writeRelayStore } from '../src/store.js'
import type { RelayServerArgs } from '../src/types.js'
import { authHeaders } from './helpers.js'
import { createFixtureStore } from './session-route-helpers.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('relay fetch handler', () => {
  it('supports Node request lifecycle events during Cloudflare long polling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-relay-fetch-handler-'))
    tempDirs.push(root)
    const args: RelayServerArgs = {
      adminToken: 'admin-token',
      allowOrigin: '*',
      dataPath: join(root, 'relay.json'),
      host: '127.0.0.1',
      port: 0
    }
    await writeRelayStore(args.dataPath, createFixtureStore())
    const handler = createRelayFetchHandler(args, {
      storeRepository: createJsonRelayStoreRepository(args.dataPath)
    })

    const response = await handler(
      new Request(
        'https://relay.example/api/relay/devices/device-1/session-jobs?status=queued&waitMs=10',
        { headers: authHeaders('device-token-1') }
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      jobs: [],
      nextPollMs: 60_000
    })
  })

  it('settles an active long poll and removes its listener when the Fetch request aborts', async () => {
    const { handler } = await createHandlerFixture()
    const abortController = new AbortController()
    const request = new Request(
      'https://relay.example/api/relay/devices/device-1/session-jobs?status=queued&waitMs=30000',
      {
        headers: authHeaders('device-token-1'),
        signal: abortController.signal
      }
    )
    const addEventListener = vi.spyOn(request.signal, 'addEventListener')
    const removeEventListener = vi.spyOn(request.signal, 'removeEventListener')

    const response = handler(request)
    await vi.waitFor(() => expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true }))
    abortController.abort()

    await expect(settlesWithin(response, 250)).rejects.toMatchObject({
      message: 'Request aborted.',
      name: 'AbortError'
    })
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('settles when the Fetch request was already aborted', async () => {
    const { handler } = await createHandlerFixture()
    const abortController = new AbortController()
    const request = new Request(
      'https://relay.example/api/relay/devices/device-1/session-jobs?status=queued&waitMs=30000',
      {
        headers: authHeaders('device-token-1'),
        signal: abortController.signal
      }
    )
    abortController.abort()

    await expect(settlesWithin(handler(request), 250)).rejects.toMatchObject({
      message: 'Request aborted.',
      name: 'AbortError'
    })
  })
})

const createHandlerFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-relay-fetch-handler-'))
  tempDirs.push(root)
  const args: RelayServerArgs = {
    adminToken: 'admin-token',
    allowOrigin: '*',
    dataPath: join(root, 'relay.json'),
    host: '127.0.0.1',
    port: 0
  }
  await writeRelayStore(args.dataPath, createFixtureStore())
  return {
    handler: createRelayFetchHandler(args, {
      storeRepository: createJsonRelayStoreRepository(args.dataPath)
    })
  }
}

const settlesWithin = async <T>(promise: Promise<T>, timeoutMs: number) => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Handler did not settle within ${timeoutMs}ms.`)), timeoutMs)
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
