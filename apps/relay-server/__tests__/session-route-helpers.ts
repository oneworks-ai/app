import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sendJson } from '../src/http.js'
import { handleRelaySessionsRoute } from '../src/routes/sessions.js'
import { readRelayStore } from '../src/server.js'
import { createRelayStoreRepository } from '../src/storage/repository.js'
import { writeRelayStore } from '../src/store.js'
import type { RelayServerArgs, RelayStore } from '../src/types.js'
import { authHeaders, requestJson } from './helpers.js'

const tempDirs: string[] = []
const servers: Server[] = []

export const timestamp = '2026-01-01T00:00:00.000Z'
const future = '2999-01-01T00:00:00.000Z'

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

export const cleanupSessionRelayFixtures = async () => {
  await Promise.all(servers.splice(0).map(closeServer))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
}

export const createFixtureStore = (): RelayStore => ({
  createdAt: timestamp,
  emailRisk: {
    buckets: [],
    challenges: []
  },
  users: [
    {
      id: 'user-1',
      email: 'one@example.com',
      name: 'One',
      role: 'member',
      createdAt: timestamp
    },
    {
      id: 'user-2',
      email: 'two@example.com',
      name: 'Two',
      role: 'member',
      createdAt: timestamp
    },
    {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      createdAt: timestamp
    }
  ],
  invites: [],
  ssoProviders: [],
  devices: [
    {
      id: 'device-1',
      name: 'Device One',
      userId: 'user-1',
      capabilities: { sessions: true },
      deviceToken: 'device-token-1',
      createdAt: timestamp,
      lastSeenAt: timestamp
    },
    {
      id: 'device-2',
      name: 'Device Two',
      userId: 'user-2',
      capabilities: { sessions: true },
      deviceToken: 'device-token-2',
      createdAt: timestamp,
      lastSeenAt: timestamp
    }
  ],
  deviceSessions: [],
  forwardingJobs: [],
  oauthStates: [],
  sessions: [
    {
      token: 'member-token-1',
      userId: 'user-1',
      createdAt: timestamp,
      expiresAt: future,
      lastSeenAt: timestamp
    },
    {
      token: 'member-token-2',
      userId: 'user-2',
      createdAt: timestamp,
      expiresAt: future,
      lastSeenAt: timestamp
    },
    {
      token: 'admin-session-token',
      userId: 'admin-1',
      createdAt: timestamp,
      expiresAt: future,
      lastSeenAt: timestamp
    }
  ]
})

export const listenSessionRelay = async () => {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-relay-sessions-test-'))
  tempDirs.push(root)
  const args: RelayServerArgs = {
    allowOrigin: '*',
    adminToken: 'admin-token',
    dataPath: join(root, 'relay.json'),
    host: '127.0.0.1',
    port: 0
  }
  await writeRelayStore(args.dataPath, createFixtureStore())
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const store = await readRelayStore(args.dataPath)
      if (await handleRelaySessionsRoute(req, res, args, store, createRelayStoreRepository(args), url)) return
      sendJson(res, 404, { error: 'Not found.' }, args.allowOrigin)
    })().catch(error => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }, args.allowOrigin)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(args.port, args.host, resolve))
  const address = server.address() as AddressInfo
  return {
    args,
    baseUrl: `http://${args.host}:${address.port}`
  }
}

export const postSnapshot = async (baseUrl: string, deviceId: string, token: string, sessions: unknown[]) =>
  await requestJson(
    baseUrl,
    `/api/relay/devices/${deviceId}/sessions/snapshot`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ sessions, updatedAt: timestamp })
    }
  )
