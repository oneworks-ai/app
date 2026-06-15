import { afterEach, describe, expect, it } from 'vitest'

import { upsertRelayConfigAssignment } from '../src/config-snapshot.js'
import { readRelayStore, writeRelayStore } from '../src/store.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

afterEach(cleanupRelayFixtures)

const timestamp = '2026-01-01T00:00:00.000Z'
const future = '2999-01-01T00:00:00.000Z'

const seedUsers = async (dataPath: string) => {
  const store = await readRelayStore(dataPath)
  store.users.push(
    {
      createdAt: timestamp,
      email: 'user-1@example.com',
      id: 'user-1',
      name: 'User One',
      role: 'member',
      teamIds: ['team-a']
    },
    {
      createdAt: timestamp,
      email: 'user-2@example.com',
      id: 'user-2',
      name: 'User Two',
      role: 'member',
      teamIds: ['team-b']
    }
  )
  store.sessions.push(
    {
      createdAt: timestamp,
      expiresAt: future,
      lastSeenAt: timestamp,
      token: 'user-1-session',
      userId: 'user-1'
    },
    {
      createdAt: timestamp,
      expiresAt: future,
      lastSeenAt: timestamp,
      token: 'user-2-session',
      userId: 'user-2'
    }
  )
  store.devices.push({
    capabilities: {},
    createdAt: timestamp,
    deviceToken: 'user-1-device-token',
    id: 'user-1-device',
    lastSeenAt: timestamp,
    name: 'User One Device',
    userId: 'user-1',
    workspaceFolder: '/workspaces/customer-a'
  })
  return store
}

describe('relay config snapshot route', () => {
  it('returns safe current-user assignments to an authorized device token', async () => {
    const { args, baseUrl } = await listenRelay()
    const store = await seedUsers(args.dataPath)
    upsertRelayConfigAssignment(store, {
      allowedFields: ['modelServices', 'defaultModelService'],
      configPatch: {
        defaultModelService: 'relay-user',
        env: {
          SECRET: 'do-not-send'
        },
        modelServices: {
          'relay-user': {
            apiBaseUrl: 'https://relay.example.com/v1',
            apiKey: 'relay-key'
          }
        },
        recommendedModels: [{ model: 'not-allowed' }]
      },
      id: 'user-1-models',
      target: {
        userIds: ['user-1']
      },
      updatedAt: timestamp,
      version: 'user-1-v1'
    })
    upsertRelayConfigAssignment(store, {
      configPatch: {
        defaultModelService: 'other-user'
      },
      id: 'user-2-models',
      target: {
        userIds: ['user-2']
      },
      updatedAt: timestamp,
      version: 'user-2-v1'
    })
    await writeRelayStore(args.dataPath, store)

    const snapshot = await requestJson(baseUrl, '/api/relay/config-snapshot', {
      headers: authHeaders('user-1-device-token')
    })
    const assignments = snapshot.body.assignments as Array<Record<string, unknown>>
    const serialized = JSON.stringify(snapshot.body)

    expect(snapshot.response.status).toBe(200)
    expect(snapshot.body).toMatchObject({
      account: {
        email: 'user-1@example.com',
        id: 'user-1',
        name: 'User One'
      },
      hash: expect.stringMatching(/^sha256:/),
      version: expect.stringMatching(/^sha256:/)
    })
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({
      allowedFields: ['modelServices', 'defaultModelService'],
      configPatch: {
        defaultModelService: 'relay-user',
        modelServices: {
          'relay-user': {
            apiBaseUrl: 'https://relay.example.com/v1',
            apiKey: 'relay-key'
          }
        }
      },
      id: 'user-1-models',
      version: 'user-1-v1'
    })
    expect(assignments[0]).not.toHaveProperty('target')
    expect(serialized).not.toContain('do-not-send')
    expect(serialized).not.toContain('not-allowed')
    expect(serialized).not.toContain('other-user')
    expect(serialized).not.toContain('user-2')
  })

  it('allows a user session to pull a project-filtered snapshot', async () => {
    const { args, baseUrl } = await listenRelay()
    const store = await seedUsers(args.dataPath)
    upsertRelayConfigAssignment(store, {
      configPatch: {
        defaultModelService: 'base'
      },
      id: 'base',
      target: {
        userIds: ['user-1']
      },
      updatedAt: timestamp
    })
    upsertRelayConfigAssignment(store, {
      configPatch: {
        defaultModelService: 'project'
      },
      id: 'project',
      project: {
        allow: ['customer-*']
      },
      target: {
        userIds: ['user-1']
      },
      updatedAt: '2026-01-02T00:00:00.000Z'
    })
    upsertRelayConfigAssignment(store, {
      configPatch: {
        defaultModelService: 'denied'
      },
      id: 'denied',
      project: {
        deny: ['customer-a']
      },
      target: {
        userIds: ['user-1']
      },
      updatedAt: '2026-01-03T00:00:00.000Z'
    })
    await writeRelayStore(args.dataPath, store)

    const snapshot = await requestJson(baseUrl, '/api/relay/config-snapshot?projectId=customer-a', {
      headers: authHeaders('user-1-session')
    })
    const assignments = snapshot.body.assignments as Array<{ id?: string }>

    expect(snapshot.response.status).toBe(200)
    expect(assignments.map(assignment => assignment.id)).toEqual(['base', 'project'])
    expect(snapshot.body.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(JSON.stringify(snapshot.body)).not.toContain('denied')
  })

  it('matches device workspace folder basenames against project rules', async () => {
    const { args, baseUrl } = await listenRelay()
    const store = await seedUsers(args.dataPath)
    upsertRelayConfigAssignment(store, {
      configPatch: {
        defaultModelService: 'basename-project'
      },
      id: 'basename-project',
      project: {
        allow: ['customer-a']
      },
      target: {
        userIds: ['user-1']
      },
      updatedAt: timestamp
    })
    await writeRelayStore(args.dataPath, store)

    const snapshot = await requestJson(baseUrl, '/api/relay/config-snapshot', {
      headers: authHeaders('user-1-device-token')
    })
    const assignments = snapshot.body.assignments as Array<{ id?: string }>

    expect(snapshot.response.status).toBe(200)
    expect(assignments.map(assignment => assignment.id)).toEqual(['basename-project'])
  })

  it('returns assignments targeted to one of the user teams', async () => {
    const { args, baseUrl } = await listenRelay()
    const store = await seedUsers(args.dataPath)
    upsertRelayConfigAssignment(store, {
      configPatch: {
        defaultModelService: 'team-a'
      },
      id: 'team-a',
      target: {
        teamIds: ['team-a']
      },
      updatedAt: timestamp
    })
    upsertRelayConfigAssignment(store, {
      configPatch: {
        defaultModelService: 'mixed-target'
      },
      id: 'mixed-target',
      target: {
        teamIds: ['team-a'],
        userIds: ['user-2']
      },
      updatedAt: '2026-01-02T00:00:00.000Z'
    })
    upsertRelayConfigAssignment(store, {
      configPatch: {
        defaultModelService: 'team-b'
      },
      id: 'team-b',
      target: {
        teamIds: ['team-b']
      },
      updatedAt: '2026-01-03T00:00:00.000Z'
    })
    await writeRelayStore(args.dataPath, store)

    const snapshot = await requestJson(baseUrl, '/api/relay/config-snapshot', {
      headers: authHeaders('user-1-session')
    })
    const assignments = snapshot.body.assignments as Array<{ id?: string }>

    expect(snapshot.response.status).toBe(200)
    expect(assignments.map(assignment => assignment.id)).toEqual(['team-a', 'mixed-target'])
    expect(JSON.stringify(snapshot.body)).not.toContain('team-b')
  })

  it('rejects unauthenticated snapshot requests', async () => {
    const { baseUrl } = await listenRelay()

    const snapshot = await requestJson(baseUrl, '/api/relay/config-snapshot')

    expect(snapshot.response.status).toBe(401)
    expect(snapshot.body).toEqual({ error: 'Authentication required.' })
  })

  it('does not expose assignments targeted to another user', async () => {
    const { args, baseUrl } = await listenRelay()
    const store = await seedUsers(args.dataPath)
    upsertRelayConfigAssignment(store, {
      configPatch: {
        defaultModelService: 'user-2-only'
      },
      id: 'user-2-only',
      target: {
        userIds: ['user-2']
      },
      updatedAt: timestamp
    })
    await writeRelayStore(args.dataPath, store)

    const snapshot = await requestJson(baseUrl, '/api/relay/config-snapshot', {
      headers: authHeaders('user-1-session')
    })

    expect(snapshot.response.status).toBe(200)
    expect(snapshot.body.assignments).toEqual([])
    expect(JSON.stringify(snapshot.body)).not.toContain('user-2-only')
  })
})
