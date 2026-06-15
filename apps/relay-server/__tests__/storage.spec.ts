import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseRelayServerArgs } from '../src/config.js'
import { parseRelayStorageDriver } from '../src/storage/drivers.js'
import { createDurableObjectRelayStoreRepository } from '../src/storage/durable-object.js'
import type { RelayDurableObjectStorage } from '../src/storage/durable-object.js'
import { createRelayStoreRepository } from '../src/storage/repository.js'
import { normalizeRelayTeamPolicy } from '../src/teams.js'
import type { RelayStore } from '../src/types.js'

const tempDirs: string[] = []

class MemoryDurableObjectStorage implements RelayDurableObjectStorage {
  private readonly values = new Map<string, unknown>()

  async delete(key: string) {
    return this.values.delete(key)
  }

  async get<T = unknown>(key: string) {
    return this.values.get(key) as T | undefined
  }

  async put(key: string, value: unknown) {
    this.values.set(key, value)
  }

  async transaction<T>(callback: (transaction: RelayDurableObjectStorage) => Promise<T>): Promise<T> {
    return await callback(this)
  }
}

const createTempDataPath = async (filename = 'store.json') => {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-relay-storage-test-'))
  tempDirs.push(root)
  return join(root, 'relay', filename)
}

const readPersistenceText = async (dataPath: string) => {
  const paths = [
    dataPath,
    `${dataPath}-wal`,
    `${dataPath}-shm`,
    `${dataPath}-journal`
  ]
  const buffers = await Promise.all(paths.map(async path => {
    try {
      return await readFile(path)
    } catch {
      return Buffer.alloc(0)
    }
  }))
  return buffers.map(buffer => buffer.toString('latin1')).join('\n')
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('relay storage repository', () => {
  it('persists and reads JSON relay store data through the repository', async () => {
    const dataPath = await createTempDataPath()
    const repository = createRelayStoreRepository({
      dataPath,
      storageDriver: 'json'
    })
    const store: RelayStore = {
      createdAt: '2026-01-01T00:00:00.000Z',
      configAssignments: [],
      emailRisk: {
        buckets: [],
        challenges: []
      },
      teamPolicy: normalizeRelayTeamPolicy(undefined),
      teams: [],
      teamMembers: [],
      passkeyChallenges: [],
      passkeys: [],
      users: [
        {
          id: 'user-1',
          email: 'owner@example.com',
          name: 'Owner',
          role: 'owner',
          teamIds: ['team-a'],
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      invites: [],
      ssoProviders: [],
      devices: [],
      deviceSessions: [],
      forwardingJobs: [],
      oauthStates: [],
      sessions: []
    }

    await repository.write(store)

    expect(repository.driver).toBe('json')
    expect(repository.location).toBe(dataPath)
    expect(JSON.parse(await readFile(dataPath, 'utf8'))).toMatchObject({
      users: [{ id: 'user-1', email: 'owner@example.com' }]
    })
    await expect(repository.read()).resolves.toMatchObject({
      users: [{ id: 'user-1', role: 'owner', teamIds: ['team-a'] }],
      devices: [],
      deviceSessions: [],
      forwardingJobs: []
    })
  })

  it('persists and reads SQLite relay store data through the repository', async () => {
    const dataPath = await createTempDataPath('relay.sqlite')
    const repository = createRelayStoreRepository({
      dataPath,
      storageDriver: 'sqlite'
    })
    const store: RelayStore = {
      createdAt: '2026-01-01T00:00:00.000Z',
      configAssignments: [],
      emailRisk: {
        buckets: [],
        challenges: []
      },
      teamPolicy: normalizeRelayTeamPolicy(undefined),
      teams: [],
      teamMembers: [],
      passkeyChallenges: [],
      passkeys: [],
      users: [
        {
          id: 'user-1',
          email: 'owner@example.com',
          name: 'Owner',
          role: 'owner',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      invites: [],
      ssoProviders: [],
      devices: [
        {
          id: 'device-1',
          name: 'Office Mac',
          capabilities: { sessions: true },
          deviceToken: 'device-token',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastSeenAt: '2026-01-01T00:01:00.000Z'
        }
      ],
      deviceSessions: [],
      forwardingJobs: [
        {
          id: 'job-1',
          deviceId: 'device-1',
          sessionId: 'session-1',
          status: 'queued',
          traceId: 'trace-1',
          requestId: 'request-1',
          payloadSizeBytes: 18,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      oauthStates: [],
      sessions: []
    }

    await repository.write(store)

    const reopenedRepository = createRelayStoreRepository({
      dataPath,
      storageDriver: 'sqlite'
    })

    expect(repository.driver).toBe('sqlite')
    expect(repository.location).toBe(dataPath)
    await expect(reopenedRepository.read()).resolves.toMatchObject({
      users: [{ id: 'user-1', role: 'owner' }],
      devices: [{ id: 'device-1', name: 'Office Mac' }],
      forwardingJobs: [{ id: 'job-1', traceId: 'trace-1', payloadSizeBytes: 18 }]
    })
  })

  it('persists Cloudflare Durable Object relay store data and forwarding payloads', async () => {
    const repository = createDurableObjectRelayStoreRepository(new MemoryDurableObjectStorage())
    const store: RelayStore = {
      createdAt: '2026-01-01T00:00:00.000Z',
      configAssignments: [],
      emailRisk: {
        buckets: [],
        challenges: []
      },
      teamPolicy: normalizeRelayTeamPolicy(undefined),
      teams: [],
      teamMembers: [],
      passkeyChallenges: [],
      passkeys: [],
      users: [],
      invites: [],
      ssoProviders: [],
      devices: [],
      deviceSessions: [],
      forwardingJobs: [],
      oauthStates: [],
      sessions: []
    }

    await repository.write(store)
    await repository.forwardingPayloads?.rememberPayload('job-1', {
      message: 'hello relay',
      requestId: 'request-1'
    })
    await repository.forwardingPayloads?.rememberResult('job-1', { ok: true })

    expect(repository.driver).toBe('cloudflare-do')
    await expect(repository.read()).resolves.toMatchObject({ createdAt: '2026-01-01T00:00:00.000Z' })
    await expect(repository.forwardingPayloads?.consumePayload('job-1')).resolves.toMatchObject({
      message: 'hello relay',
      payloadSize: 11,
      requestId: 'request-1'
    })
    await expect(repository.forwardingPayloads?.consumePayload('job-1')).resolves.toBeUndefined()
    await expect(repository.forwardingPayloads?.consumeResult('job-1')).resolves.toMatchObject({
      result: { ok: true }
    })
  })

  it('returns an empty normalized store when the JSON file is missing or invalid', async () => {
    const dataPath = await createTempDataPath()
    const repository = createRelayStoreRepository({
      dataPath,
      storageDriver: 'json'
    })

    await expect(repository.read()).resolves.toMatchObject({
      users: [],
      invites: [],
      devices: [],
      deviceSessions: [],
      forwardingJobs: [],
      oauthStates: [],
      sessions: []
    })

    await mkdir(dirname(dataPath), { recursive: true })
    await writeFile(dataPath, '{', 'utf8')

    await expect(repository.read()).resolves.toMatchObject({
      users: [],
      invites: [],
      devices: [],
      deviceSessions: [],
      forwardingJobs: []
    })
  })

  it('strips session content fields before persisting JSON storage', async () => {
    const dataPath = await createTempDataPath()
    const repository = createRelayStoreRepository({
      dataPath,
      storageDriver: 'json'
    })
    const store = {
      createdAt: '2026-01-01T00:00:00.000Z',
      users: [],
      invites: [],
      devices: [],
      deviceSessions: [
        {
          id: 'session-1',
          deviceId: 'device-1',
          title: 'Session',
          lastMessage: 'do not store last message',
          lastUserMessage: 'do not store last user message',
          metadata: {
            content: 'do not store metadata content'
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      forwardingJobs: [
        {
          id: 'job-1',
          deviceId: 'device-1',
          sessionId: 'session-1',
          traceId: 'trace-1',
          requestId: 'request-1',
          status: 'queued',
          payloadSizeBytes: 18,
          resultSizeBytes: 21,
          errorCode: 'none',
          message: 'do not store job message',
          content: 'do not store job content',
          result: { text: 'do not store result body' },
          metadata: {
            result: 'do not store metadata result'
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      oauthStates: [],
      sessions: []
    } as unknown as RelayStore

    await repository.write(store)

    const raw = await readFile(dataPath, 'utf8')
    const persisted = JSON.parse(raw) as Record<string, unknown>

    expect(raw).not.toContain('do not store')
    expect(raw).not.toContain('"message"')
    expect(raw).not.toContain('"content"')
    expect(raw).not.toContain('"result"')
    expect(raw).not.toContain('"lastMessage"')
    expect(raw).not.toContain('"lastUserMessage"')
    expect(persisted).toMatchObject({
      forwardingJobs: [
        {
          id: 'job-1',
          payloadSizeBytes: 18,
          requestId: 'request-1',
          resultSizeBytes: 21,
          status: 'queued',
          traceId: 'trace-1'
        }
      ]
    })
  })

  it('strips session content fields before persisting SQLite storage', async () => {
    const dataPath = await createTempDataPath('relay.sqlite')
    const repository = createRelayStoreRepository({
      dataPath,
      storageDriver: 'sqlite'
    })
    const store = {
      createdAt: '2026-01-01T00:00:00.000Z',
      users: [],
      invites: [],
      devices: [],
      deviceSessions: [
        {
          id: 'session-1',
          deviceId: 'device-1',
          title: 'Session',
          lastMessage: 'do not store last message',
          lastUserMessage: 'do not store last user message',
          metadata: {
            content: 'do not store metadata content'
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      forwardingJobs: [
        {
          id: 'job-1',
          deviceId: 'device-1',
          sessionId: 'session-1',
          traceId: 'trace-1',
          requestId: 'request-1',
          status: 'queued',
          payloadSizeBytes: 18,
          resultSizeBytes: 21,
          errorCode: 'none',
          message: 'do not store job message',
          content: 'do not store job content',
          result: { text: 'do not store result body' },
          metadata: {
            result: 'do not store metadata result'
          },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      oauthStates: [],
      sessions: []
    } as unknown as RelayStore

    await repository.write(store)

    const raw = await readPersistenceText(dataPath)

    expect(raw).not.toContain('do not store')
    expect(raw).not.toContain('"message"')
    expect(raw).not.toContain('"content"')
    expect(raw).not.toContain('"result"')
    expect(raw).not.toContain('"lastMessage"')
    expect(raw).not.toContain('"lastUserMessage"')
    await expect(repository.read()).resolves.toMatchObject({
      forwardingJobs: [
        {
          id: 'job-1',
          payloadSizeBytes: 18,
          requestId: 'request-1',
          resultSizeBytes: 21,
          status: 'queued',
          traceId: 'trace-1'
        }
      ]
    })
  })

  it('parses explicit storage driver config and exposes cloud storage adapters explicitly', () => {
    vi.stubEnv('ONEWORKS_RELAY_STORAGE_DRIVER', 'sqlite')

    const envArgs = parseRelayServerArgs([])
    const cliArgs = parseRelayServerArgs(['--storage-driver', 'postgres'])
    const postgresRepository = createRelayStoreRepository({
      dataPath: 'postgres://relay:secret@localhost:5432/relay',
      storageDriver: 'postgres'
    })

    expect(envArgs.storageDriver).toBe('sqlite')
    expect(cliArgs.storageDriver).toBe('postgres')
    expect(postgresRepository.driver).toBe('postgres')
    expect(postgresRepository.location).toBe('postgres://relay:***@localhost:5432/relay')
    expect(
      createRelayStoreRepository({
        dataPath: ':memory:',
        storageDriver: 'sqlite'
      }).driver
    ).toBe('sqlite')
    expect(() =>
      createRelayStoreRepository({
        dataPath: '/tmp/oneworks-relay.json',
        storageDriver: 'cloudflare-do'
      })
    ).toThrow(/Relay storage driver "cloudflare-do" must be created by the Cloudflare Worker adapter/)
    expect(parseRelayStorageDriver('cloudflare-do')).toBe('cloudflare-do')
    expect(() => parseRelayStorageDriver('mysql')).toThrow(/Supported values: cloudflare-do, json, sqlite, postgres/)
  })
})
