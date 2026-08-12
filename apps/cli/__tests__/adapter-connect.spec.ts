import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveCodexModelSharingUrl } from '#~/commands/adapter/connect.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('adapter connect codex', () => {
  it('prefers explicit PM runtime values', async () => {
    await expect(resolveCodexModelSharingUrl({
      __ONEWORKS_PROJECT_SERVER_HOST__: '0.0.0.0',
      __ONEWORKS_PROJECT_SERVER_PORT__: '5176'
    })).resolves.toBe('ws://127.0.0.1:5176/api/adapters/codex/app-server')

    await expect(resolveCodexModelSharingUrl({
      __ONEWORKS_PROJECT_SERVER_BASE_URL__: 'https://pm.example.test/ui/'
    })).resolves.toBe('wss://pm.example.test/api/adapters/codex/app-server')
  })

  it('discovers a dynamic desktop PM port from the manager project home', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ow-codex-connect-'))
    tempDirs.push(root)
    const dataDir = resolve(root, 'projects', 'manager', 'server', 'data')
    await mkdir(dataDir, { recursive: true })
    const statusServer = await import('node:http').then(({ createServer }) =>
      createServer((request, response) => {
        response.writeHead(request.url === '/api/auth/status' ? 200 : 404)
        response.end('{}')
      })
    )
    await new Promise<void>(resolvePromise => statusServer.listen(0, '127.0.0.1', resolvePromise))
    const address = statusServer.address()
    if (address == null || typeof address === 'string') throw new Error('missing server address')
    await writeFile(
      resolve(dataDir, 'instance.json'),
      `${
        JSON.stringify({
          pid: process.pid,
          role: 'manager',
          serverBaseUrl: `http://127.0.0.1:${address.port}`,
          startedAt: new Date().toISOString()
        })
      }\n`
    )

    try {
      await expect(resolveCodexModelSharingUrl({
        __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: resolve(root, 'projects')
      }, root)).resolves.toBe(`ws://127.0.0.1:${address.port}/api/adapters/codex/app-server`)
    } finally {
      await new Promise<void>((resolvePromise, reject) =>
        statusServer.close(error => (
          error == null ? resolvePromise() : reject(error)
        ))
      )
    }
  })

  it('ignores an inherited workspace endpoint and discovers the manager instead', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ow-codex-connect-workspace-'))
    tempDirs.push(root)
    const dataDir = resolve(root, 'projects', 'manager', 'server', 'data')
    await mkdir(dataDir, { recursive: true })
    const statusServer = await import('node:http').then(({ createServer }) =>
      createServer((request, response) => {
        response.writeHead(request.url === '/api/auth/status' ? 200 : 404)
        response.end('{}')
      })
    )
    await new Promise<void>(resolvePromise => statusServer.listen(0, '127.0.0.1', resolvePromise))
    const address = statusServer.address()
    if (address == null || typeof address === 'string') throw new Error('missing server address')
    await writeFile(
      resolve(dataDir, 'instance.json'),
      `${
        JSON.stringify({
          pid: process.pid,
          role: 'manager',
          serverBaseUrl: `http://127.0.0.1:${address.port}`,
          startedAt: new Date().toISOString()
        })
      }\n`
    )

    try {
      await expect(resolveCodexModelSharingUrl({
        __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: resolve(root, 'projects'),
        __ONEWORKS_PROJECT_SERVER_BASE_URL__: 'http://127.0.0.1:9999',
        __ONEWORKS_PROJECT_SERVER_PORT__: '9999',
        __ONEWORKS_PROJECT_SERVER_ROLE__: 'workspace'
      }, root)).resolves.toBe(`ws://127.0.0.1:${address.port}/api/adapters/codex/app-server`)
    } finally {
      await new Promise<void>((resolvePromise, reject) =>
        statusServer.close(error => (
          error == null ? resolvePromise() : reject(error)
        ))
      )
    }
  })

  it('fails with an actionable error instead of guessing port 8787', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ow-codex-connect-missing-'))
    tempDirs.push(root)
    await expect(resolveCodexModelSharingUrl({
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: resolve(root, 'projects')
    }, root)).rejects.toThrow('No running One Works PM service was discovered')
  })
})
