import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { describe, expect, it } from 'vitest'

import { repoRoot } from '../dev-start/paths'
import { processFingerprint } from '../dev-start/process-identity'
import { stateHasLiveProcesses, stateReady } from '../dev-start/readiness'

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
  it('does not reuse schema v1 state and detects its live pid for explicit cleanup', async () => {
    const legacy = {
      root: repoRoot,
      servicePid: process.pid,
      target: 'web' as const
    }
    await expect(stateReady(legacy)).resolves.toBe(false)
    expect(stateHasLiveProcesses(legacy)).toBe(true)
  })

  it('does not treat another worktree URL as ready when the recorded pid is gone', async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 200
      response.end('ok')
    })
    const port = await listen(server)

    try {
      await expect(stateReady({
        root: repoRoot,
        schemaVersion: 2,
        serverUrl: `http://127.0.0.1:${port}`,
        servicePid: 99_999_999,
        target: 'web'
      })).resolves.toBe(false)

      await expect(stateReady({
        root: repoRoot,
        schemaVersion: 2,
        serverUrl: `http://127.0.0.1:${port}`,
        target: 'web'
      })).resolves.toBe(false)
    } finally {
      await close(server)
    }
  })

  it('uses component health and lifecycle phase for shared service state', async () => {
    const server = createServer((request, response) => {
      response.statusCode = request.url === '/api/auth/status' ? 404 : 200
      response.end('ok')
    })
    const port = await listen(server)
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('spawn', resolve)
    })
    const fingerprint = processFingerprint(child.pid)

    try {
      const state = {
        components: [
          {
            fingerprint,
            healthUrl: `http://127.0.0.1:${port}/health`,
            id: 'relay-server',
            kind: 'http' as const,
            pid: child.pid
          }
        ],
        phase: 'ready' as const,
        root: repoRoot,
        schemaVersion: 2 as const,
        serverUrl: `http://127.0.0.1:${port}`,
        target: 'relay' as const
      }
      await expect(stateReady(state)).resolves.toBe(true)
      await expect(stateReady({ ...state, phase: 'stopped' })).resolves.toBe(false)
      await expect(stateReady({
        ...state,
        components: [{ ...state.components[0], fingerprint: 'wrong' }]
      })).resolves.toBe(false)
    } finally {
      child.kill('SIGKILL')
      await close(server)
    }
  })

  it('keeps docs unhealthy when its linked homepage is unavailable', async () => {
    const docsServer = createServer((_request, response) => response.end('ok'))
    const port = await listen(docsServer)
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('spawn', resolve)
    })
    try {
      await expect(stateReady({
        components: [{
          fingerprint: processFingerprint(child.pid),
          healthUrl: `http://127.0.0.1:${port}/docs/`,
          id: 'docs',
          kind: 'http',
          pid: child.pid
        }],
        docsUrl: `http://127.0.0.1:${port}/docs/`,
        linkedHomepageUrl: 'http://127.0.0.1:1/',
        phase: 'ready',
        root: repoRoot,
        schemaVersion: 2,
        target: 'docs'
      })).resolves.toBe(false)
    } finally {
      child.kill('SIGKILL')
      await close(docsServer)
    }
  })
})
