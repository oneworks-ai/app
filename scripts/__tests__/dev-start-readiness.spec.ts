import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { describe, expect, it } from 'vitest'

import { repoRoot } from '../dev-start/paths'
import { stateReady } from '../dev-start/readiness'

const listen = (server: ReturnType<typeof createServer>) =>
  new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port)
    })
  })

const close = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => error == null ? resolve() : reject(error))
  })

describe('dev-start readiness', () => {
  it('does not treat another worktree URL as ready when the recorded pid is gone', async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 200
      response.end('ok')
    })
    const port = await listen(server)

    try {
      await expect(stateReady({
        root: repoRoot,
        serverUrl: `http://127.0.0.1:${port}`,
        servicePid: 99_999_999,
        target: 'web'
      })).resolves.toBe(false)

      await expect(stateReady({
        root: repoRoot,
        serverUrl: `http://127.0.0.1:${port}`,
        target: 'web'
      })).resolves.toBe(true)
    } finally {
      await close(server)
    }
  })
})
