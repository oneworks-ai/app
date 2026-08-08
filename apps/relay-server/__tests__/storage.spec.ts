import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultRelayAccessGroups } from '../src/access-groups.js'
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
      accessGroups: defaultRelayAccessGroups(),
      auditEvents: [],
      configAssignments: [],
      configProfileAssignments: [],
      configProfileVersions: [],
      configProfiles: [],
      configSecrets: [],
      emailRisk: {
        buckets: [],
        challenges: []
      },
      teamPolicy: normalizeRelayTeamPolicy(undefined),
      teams: [],
      teamInvitations: [],
      messages: [],
      teamMembers: [],
      authIdentities: [],
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
      accessTokens: [],
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
      accessGroups: defaultRelayAccessGroups(),
      auditEvents: [],
      configAssignments: [],
      configProfileAssignments: [],
      configProfileVersions: [],
      configProfiles: [],
      configSecrets: [],
      emailRisk: {
        buckets: [],
        challenges: []
      },
      teamPolicy: normalizeRelayTeamPolicy(undefined),
      teams: [],
      teamInvitations: [],
      messages: [],
      teamMembers: [],
      authIdentities: [],
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
      accessTokens: [],
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

  it('serializes SQLite withStore updates across repository instances', async () => {
    const dataPath = await createTempDataPath('relay-concurrent.sqlite')
    const firstRepository = createRelayStoreRepository({ dataPath, storageDriver: 'sqlite' })
    const secondRepository = createRelayStoreRepository({ dataPath, storageDriver: 'sqlite' })

    await Promise.all([
      firstRepository.withStore?.(async (store, scopedRepository) => {
        await new Promise(resolve => setTimeout(resolve, 20))
        store.users.push({
          createdAt: '2026-01-01T00:00:00.000Z',
          email: 'first@example.test',
          id: 'first',
          name: 'First',
          role: 'member'
        })
        await scopedRepository.write(store)
      }),
      secondRepository.withStore?.(async (store, scopedRepository) => {
        store.users.push({
          createdAt: '2026-01-01T00:00:00.000Z',
          email: 'second@example.test',
          id: 'second',
          name: 'Second',
          role: 'member'
        })
        await scopedRepository.write(store)
      })
    ])

    await expect(firstRepository.read()).resolves.toMatchObject({
      users: [
        { id: 'first' },
        { id: 'second' }
      ]
    })
  })

  it('rolls back SQLite scoped writes when withStore fails', async () => {
    const dataPath = await createTempDataPath('relay-rollback.sqlite')
    const repository = createRelayStoreRepository({ dataPath, storageDriver: 'sqlite' })

    await expect(
      repository.withStore?.(async (store, scopedRepository) => {
        store.users.push({
          createdAt: '2026-01-01T00:00:00.000Z',
          email: 'rollback@example.test',
          id: 'rollback',
          name: 'Rollback',
          role: 'member'
        })
        await scopedRepository.write(store)
        throw new Error('abort transaction')
      })
    ).rejects.toThrow('abort transaction')

    await expect(repository.read()).resolves.toMatchObject({ users: [] })
  })

  it('exposes scoped SQLite writes to subsequent reads in the same transaction', async () => {
    const dataPath = await createTempDataPath('relay-read-after-write.sqlite')
    const repository = createRelayStoreRepository({ dataPath, storageDriver: 'sqlite' })

    const userIds = await repository.withStore?.(async (store, scopedRepository) => {
      store.users.push({
        createdAt: '2026-01-01T00:00:00.000Z',
        email: 'scoped@example.test',
        id: 'scoped',
        name: 'Scoped',
        role: 'member'
      })
      await scopedRepository.write(store)
      return (await scopedRepository.read()).users.map(user => user.id)
    })

    expect(userIds).toEqual(['scoped'])
    await expect(repository.read()).resolves.toMatchObject({ users: [{ id: 'scoped' }] })
  })

  it('keeps SQLite memory writes for the lifetime of one repository', async () => {
    const repository = createRelayStoreRepository({ dataPath: ':memory:', storageDriver: 'sqlite' })
    const store = await repository.read()
    store.users.push({
      createdAt: '2026-01-01T00:00:00.000Z',
      email: 'memory@example.test',
      id: 'memory-write',
      name: 'Memory Write',
      role: 'member'
    })
    await repository.write(store)

    await expect(repository.read()).resolves.toMatchObject({ users: [{ id: 'memory-write' }] })
  })

  it('keeps SQLite memory withStore commits and rolls back failures', async () => {
    const repository = createRelayStoreRepository({ dataPath: ':memory:', storageDriver: 'sqlite' })
    await repository.withStore?.(async (store, scopedRepository) => {
      store.users.push({
        createdAt: '2026-01-01T00:00:00.000Z',
        email: 'commit@example.test',
        id: 'memory-commit',
        name: 'Memory Commit',
        role: 'member'
      })
      await scopedRepository.write(store)
    })
    await expect(
      repository.withStore?.(async (store, scopedRepository) => {
        store.users.push({
          createdAt: '2026-01-01T00:00:00.000Z',
          email: 'rollback@example.test',
          id: 'memory-rollback',
          name: 'Memory Rollback',
          role: 'member'
        })
        await scopedRepository.write(store)
        throw new Error('rollback memory transaction')
      })
    ).rejects.toThrow('rollback memory transaction')

    await expect(repository.read()).resolves.toMatchObject({ users: [{ id: 'memory-commit' }] })
    expect((await repository.read()).users.map(user => user.id)).not.toContain('memory-rollback')
  })

  it('isolates SQLite memory databases between repositories', async () => {
    const first = createRelayStoreRepository({ dataPath: ':memory:', storageDriver: 'sqlite' })
    const second = createRelayStoreRepository({ dataPath: ':memory:', storageDriver: 'sqlite' })
    const store = await first.read()
    store.users.push({
      createdAt: '2026-01-01T00:00:00.000Z',
      email: 'isolated@example.test',
      id: 'first-only',
      name: 'First Only',
      role: 'member'
    })
    await first.write(store)

    await expect(first.read()).resolves.toMatchObject({ users: [{ id: 'first-only' }] })
    await expect(second.read()).resolves.toMatchObject({ users: [] })
  })

  it('persists Cloudflare Durable Object relay store data and forwarding payloads', async () => {
    const repository = createDurableObjectRelayStoreRepository(new MemoryDurableObjectStorage())
    const store: RelayStore = {
      createdAt: '2026-01-01T00:00:00.000Z',
      accessGroups: defaultRelayAccessGroups(),
      auditEvents: [],
      configAssignments: [],
      configProfileAssignments: [],
      configProfileVersions: [],
      configProfiles: [],
      configSecrets: [],
      emailRisk: {
        buckets: [],
        challenges: []
      },
      teamPolicy: normalizeRelayTeamPolicy(undefined),
      teams: [],
      teamInvitations: [],
      messages: [],
      teamMembers: [],
      authIdentities: [],
      passkeyChallenges: [],
      passkeys: [],
      users: [],
      invites: [],
      ssoProviders: [],
      devices: [],
      deviceSessions: [],
      forwardingJobs: [],
      oauthStates: [],
      accessTokens: [],
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
      accessTokens: [],
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
      accessTokens: [],
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
      accessTokens: [],
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
