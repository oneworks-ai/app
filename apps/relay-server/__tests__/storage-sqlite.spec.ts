import { afterEach, describe, expect, it } from 'vitest'

import { defaultRelayAccessGroups } from '../src/access-groups.js'
import { createRelayStoreRepository } from '../src/storage/repository.js'
import { normalizeRelayTeamPolicy } from '../src/teams.js'
import type { RelayStore } from '../src/types.js'
import { createStorageTestContext, readPersistenceText } from './storage-test-helpers.js'

const { cleanup, createTempDataPath } = createStorageTestContext()
afterEach(cleanup)

describe('relay sqlite storage repository', () => {
  it('persists and reads SQLite relay store data through the repository', async () => {
    const dataPath = await createTempDataPath('relay.sqlite')
    const repository = createRelayStoreRepository({ dataPath, storageDriver: 'sqlite' })
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
        createdAt: '2026-01-01T00:00:00.000Z'
      }],
      invites: [],
      ssoProviders: [],
      devices: [{
        id: 'device-1',
        name: 'Office Mac',
        capabilities: { sessions: true },
        deviceToken: 'device-token',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:01:00.000Z'
      }],
      deviceSessions: [],
      forwardingJobs: [{
        id: 'job-1',
        deviceId: 'device-1',
        sessionId: 'session-1',
        status: 'queued',
        traceId: 'trace-1',
        requestId: 'request-1',
        payloadSizeBytes: 18,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }],
      oauthStates: [],
      accessTokens: [],
      sessions: []
    }

    await repository.write(store)
    const reopened = createRelayStoreRepository({ dataPath, storageDriver: 'sqlite' })
    expect(repository.driver).toBe('sqlite')
    expect(repository.location).toBe(dataPath)
    await expect(reopened.read()).resolves.toMatchObject({
      users: [{ id: 'user-1', role: 'owner' }],
      devices: [{ id: 'device-1', name: 'Office Mac' }],
      forwardingJobs: [{ id: 'job-1', traceId: 'trace-1', payloadSizeBytes: 18 }]
    })
  })

  it('serializes SQLite withStore updates across repository instances', async () => {
    const dataPath = await createTempDataPath('relay-concurrent.sqlite')
    const first = createRelayStoreRepository({ dataPath, storageDriver: 'sqlite' })
    const second = createRelayStoreRepository({ dataPath, storageDriver: 'sqlite' })
    await Promise.all([
      first.withStore?.(async (store, scoped) => {
        await new Promise(resolve => setTimeout(resolve, 20))
        store.users.push({
          createdAt: '2026-01-01T00:00:00.000Z',
          email: 'first@example.test',
          id: 'first',
          name: 'First',
          role: 'member'
        })
        await scoped.write(store)
      }),
      second.withStore?.(async (store, scoped) => {
        store.users.push({
          createdAt: '2026-01-01T00:00:00.000Z',
          email: 'second@example.test',
          id: 'second',
          name: 'Second',
          role: 'member'
        })
        await scoped.write(store)
      })
    ])
    await expect(first.read()).resolves.toMatchObject({ users: [{ id: 'first' }, { id: 'second' }] })
  })

  it('rolls back SQLite scoped writes when withStore fails', async () => {
    const dataPath = await createTempDataPath('relay-rollback.sqlite')
    const repository = createRelayStoreRepository({ dataPath, storageDriver: 'sqlite' })
    await expect(
      repository.withStore?.(async (store, scoped) => {
        store.users.push({
          createdAt: '2026-01-01T00:00:00.000Z',
          email: 'rollback@example.test',
          id: 'rollback',
          name: 'Rollback',
          role: 'member'
        })
        await scoped.write(store)
        throw new Error('abort transaction')
      })
    ).rejects.toThrow('abort transaction')
    await expect(repository.read()).resolves.toMatchObject({ users: [] })
  })

  it('exposes scoped SQLite writes to subsequent reads in the same transaction', async () => {
    const dataPath = await createTempDataPath('relay-read-after-write.sqlite')
    const repository = createRelayStoreRepository({ dataPath, storageDriver: 'sqlite' })
    const userIds = await repository.withStore?.(async (store, scoped) => {
      store.users.push({
        createdAt: '2026-01-01T00:00:00.000Z',
        email: 'scoped@example.test',
        id: 'scoped',
        name: 'Scoped',
        role: 'member'
      })
      await scoped.write(store)
      return (await scoped.read()).users.map(user => user.id)
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
    await repository.withStore?.(async (store, scoped) => {
      store.users.push({
        createdAt: '2026-01-01T00:00:00.000Z',
        email: 'commit@example.test',
        id: 'memory-commit',
        name: 'Memory Commit',
        role: 'member'
      })
      await scoped.write(store)
    })
    await expect(
      repository.withStore?.(async (store, scoped) => {
        store.users.push({
          createdAt: '2026-01-01T00:00:00.000Z',
          email: 'rollback@example.test',
          id: 'memory-rollback',
          name: 'Memory Rollback',
          role: 'member'
        })
        await scoped.write(store)
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

  it('strips session content fields before persisting SQLite storage', async () => {
    const dataPath = await createTempDataPath('relay.sqlite')
    const repository = createRelayStoreRepository({ dataPath, storageDriver: 'sqlite' })
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
    const raw = await readPersistenceText(dataPath)
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
    await expect(repository.read()).resolves.toMatchObject({
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
})
