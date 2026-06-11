import { mkdtemp, rm } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRelayServer } from '../src/server.js'
import type { RelayServerArgs } from '../src/server.js'

const realFetch = globalThis.fetch.bind(globalThis)
const tempDirs: string[] = []
const servers: Server[] = []

const closeServer = async (server: Server) =>
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error == null) {
        resolve()
      } else {
        reject(error)
      }
    })
  })

export const cleanupRelayFixtures = async () => {
  await Promise.all(servers.splice(0).map(closeServer))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
}

export const listenRelay = async (overrides: Partial<RelayServerArgs> = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-relay-server-test-'))
  tempDirs.push(root)
  const args: RelayServerArgs = {
    allowOrigin: '*',
    adminToken: 'admin-token',
    dataPath: join(root, 'relay.json'),
    host: '127.0.0.1',
    port: 0,
    ...overrides
  }
  const server = createRelayServer(args)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(args.port, args.host, resolve))
  const address = server.address() as AddressInfo
  return {
    args,
    baseUrl: `http://${args.host}:${address.port}`
  }
}

export const requestJson = async (
  baseUrl: string,
  path: string,
  init: RequestInit = {}
) => {
  const response = await realFetch(`${baseUrl}${path}`, init)
  return {
    body: await response.json() as Record<string, unknown>,
    response
  }
}

export const requestRaw = async (
  baseUrl: string,
  path: string,
  init: RequestInit = {}
) => await realFetch(`${baseUrl}${path}`, init)

export const authHeaders = (token: string) => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json'
})
