import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultRelayAccessGroups } from '../src/access-groups.js'
import { parseRelayServerArgs } from '../src/config.js'
import { parseRelayStorageDriver } from '../src/storage/drivers.js'
import { createDurableObjectRelayStoreRepository } from '../src/storage/durable-object.js'
import type { RelayDurableObjectStorage } from '../src/storage/durable-object.js'
import { createRelayStoreRepository } from '../src/storage/repository.js'
import { normalizeRelayTeamPolicy } from '../src/teams.js'
import type { RelayStore } from '../src/types.js'
import { createStorageTestContext } from './storage-test-helpers.js'

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

const { cleanup, createTempDataPath } = createStorageTestContext()
afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanup()
})

describe('relay storage repository', () => {
  it('persists and reads JSON relay store data through the repository', async () => {
    const dataPath = await createTempDataPath()
    const repository = createRelayStoreRepository({ dataPath, storageDriver: 'json' })
    const store: RelayStore = {
      createdAt: '2026-01-01T00:00:00.000Z',
      accessGroups: defaultRelayAccessGroups(),
      auditEvents: [],
      configAssignments: [],
      configProfileAssignments: [],
      configProfileVersions: [],
      configProfiles: [],
      configSecrets: [],
      emailRisk: { buckets: [], challenges: [] },
      teamPolicy: normalizeRelayTeamPolicy(undefined),
      teams: [],
      teamInvitations: [],
      messages: [],
      teamMembers: [],
      authIdentities: [],
      passkeyChallenges: [],
      passkeys: [],
      users: [{
        id: 'user-1',
        email: 'owner@example.com',
        name: 'Owner',
        role: 'owner',
        teamIds: ['team-a'],
        createdAt: '2026-01-01T00:00:00.000Z'
      }],
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
      emailRisk: { buckets: [], challenges: [] },
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
    const repository = createRelayStoreRepository({ dataPath, storageDriver: 'json' })
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
    const repository = createRelayStoreRepository({ dataPath, storageDriver: 'json' })
    const store = {
      createdAt: '2026-01-01T00:00:00.000Z',
      users: [],
      invites: [],
      devices: [],
      deviceSessions: [{
        id: 'session-1',
        deviceId: 'device-1',
        title: 'Session',
        lastMessage: 'do not store last message',
        lastUserMessage: 'do not store last user message',
        metadata: { content: 'do not store metadata content' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }],
      forwardingJobs: [{
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
        metadata: { result: 'do not store metadata result' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }],
      oauthStates: [],
      accessTokens: [],
      sessions: []
    } as unknown as RelayStore

    await repository.write(store)
    const raw = await readFile(dataPath, 'utf8')
    for (
      const forbidden of [
        'do not store',
        '"message"',
        '"content"',
        '"result"',
        '"lastMessage"',
        '"lastUserMessage"'
      ]
    ) expect(raw).not.toContain(forbidden)
    expect(JSON.parse(raw)).toMatchObject({
      forwardingJobs: [{
        id: 'job-1',
        payloadSizeBytes: 18,
        requestId: 'request-1',
        resultSizeBytes: 21,
        status: 'queued',
        traceId: 'trace-1'
      }]
    })
  })

  it('preserves raw workspace identity while reading and rewriting device sessions', async () => {
    const dataPath = await createTempDataPath()
    const repository = createRelayStoreRepository({ dataPath, storageDriver: 'json' })
    const workspaceFolder = '/tmp/ relay workspace '
    await mkdir(dirname(dataPath), { recursive: true })
    await writeFile(
      dataPath,
      JSON.stringify({
        deviceSessions: [{
          createdAt: '2026-01-01T00:00:00.000Z',
          deviceId: 'device-1',
          id: 'session-1',
          updatedAt: '2026-01-01T00:00:00.000Z',
          workspaceFolder
        }]
      }),
      'utf8'
    )

    const store = await repository.read()
    expect(store.deviceSessions[0]?.workspaceFolder).toBe(workspaceFolder)

    await repository.write(store)
    const rewritten = JSON.parse(await readFile(dataPath, 'utf8')) as {
      deviceSessions?: Array<{ workspaceFolder?: string }>
    }
    expect(rewritten.deviceSessions?.[0]?.workspaceFolder).toBe(workspaceFolder)
  })

  it('parses explicit storage driver config and exposes cloud storage adapters explicitly', () => {
    vi.stubEnv('ONEWORKS_RELAY_STORAGE_DRIVER', 'sqlite')
    const envArgs = parseRelayServerArgs([])
    const cliArgs = parseRelayServerArgs(['--storage-driver', 'postgres'])
    const postgres = createRelayStoreRepository({
      dataPath: 'postgres://relay:secret@localhost:5432/relay',
      storageDriver: 'postgres'
    })

    expect(envArgs.storageDriver).toBe('sqlite')
    expect(cliArgs.storageDriver).toBe('postgres')
    expect(postgres.driver).toBe('postgres')
    expect(postgres.location).toBe('postgres://relay:***@localhost:5432/relay')
    expect(createRelayStoreRepository({ dataPath: ':memory:', storageDriver: 'sqlite' }).driver).toBe('sqlite')
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
