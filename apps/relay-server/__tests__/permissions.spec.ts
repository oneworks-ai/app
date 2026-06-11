import { afterEach, describe, expect, it } from 'vitest'

import {
  adminTokenPrincipal,
  hasRelayPermission,
  hasRolePermission,
  permissionsForRole,
  relayPermissions,
  sessionPrincipalForUser
} from '../src/permissions/index.js'
import { readRelayStore } from '../src/server.js'
import { writeRelayStore } from '../src/store.js'
import type { RelayRole, RelayUser } from '../src/types.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'
import { cleanupSessionRelayFixtures, listenSessionRelay, postSnapshot, timestamp } from './session-route-helpers.js'

afterEach(async () => {
  await cleanupRelayFixtures()
  await cleanupSessionRelayFixtures()
})

const future = '2999-01-01T00:00:00.000Z'

const userWithRole = (role: RelayRole): RelayUser => ({
  id: `${role}-user`,
  email: `${role}@example.com`,
  name: role,
  role,
  createdAt: timestamp
})

describe('relay permission matrix', () => {
  it('allows and denies capabilities from the centralized role mapping', () => {
    const owner = sessionPrincipalForUser(userWithRole('owner'))
    const member = sessionPrincipalForUser(userWithRole('member'))
    const viewer = sessionPrincipalForUser(userWithRole('viewer'))

    expect(hasRelayPermission(owner, relayPermissions.adminUsersWrite)).toBe(true)
    expect(hasRelayPermission(member, relayPermissions.relaySessionsSubmit)).toBe(true)
    expect(hasRelayPermission(member, relayPermissions.adminUsersRead)).toBe(false)
    expect(hasRelayPermission(viewer, relayPermissions.relaySessionsRead)).toBe(true)
    expect(hasRelayPermission(viewer, relayPermissions.relaySessionsSubmit)).toBe(false)
  })

  it('denies unknown roles and unknown permissions', () => {
    const unknownRoleUser = {
      ...userWithRole('member'),
      role: 'contractor' as RelayRole
    }
    const unknownRole = sessionPrincipalForUser(unknownRoleUser)

    expect(permissionsForRole('contractor')).toEqual([])
    expect(hasRelayPermission(unknownRole, relayPermissions.relayDevicesRead)).toBe(false)
    expect(hasRolePermission('owner', 'relay.not-real')).toBe(false)
    expect(hasRelayPermission(adminTokenPrincipal(), 'relay.not-real')).toBe(false)
  })
})

describe('relay route permission checks', () => {
  it('authorizes admin API sessions by capability and rejects non-admin sessions', async () => {
    const { args, baseUrl } = await listenRelay()
    const store = await readRelayStore(args.dataPath)
    store.users.push(
      {
        id: 'admin-user',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
        createdAt: timestamp
      },
      {
        id: 'member-user',
        email: 'member@example.com',
        name: 'Member',
        role: 'member',
        createdAt: timestamp
      }
    )
    store.sessions.push(
      {
        token: 'admin-session-token',
        userId: 'admin-user',
        createdAt: timestamp,
        expiresAt: future,
        lastSeenAt: timestamp
      },
      {
        token: 'member-session-token',
        userId: 'member-user',
        createdAt: timestamp,
        expiresAt: future,
        lastSeenAt: timestamp
      }
    )
    await writeRelayStore(args.dataPath, store)

    const denied = await requestJson(baseUrl, '/api/admin/users', {
      method: 'POST',
      headers: authHeaders('member-session-token'),
      body: JSON.stringify({ email: 'blocked@example.com', name: 'Blocked' })
    })
    const created = await requestJson(baseUrl, '/api/admin/users', {
      method: 'POST',
      headers: authHeaders('admin-session-token'),
      body: JSON.stringify({ email: 'created@example.com', name: 'Created' })
    })

    expect(denied.response.status).toBe(403)
    expect(denied.body).toEqual({ error: 'Permission denied.' })
    expect(created.response.status).toBe(200)
    expect(created.body.user).toMatchObject({
      email: 'created@example.com',
      name: 'Created',
      role: 'member'
    })
  })

  it('lets viewers read owned relay sessions but rejects message submission', async () => {
    const { args, baseUrl } = await listenSessionRelay()
    const store = await readRelayStore(args.dataPath)
    store.users.push({
      id: 'viewer-1',
      email: 'viewer@example.com',
      name: 'Viewer',
      role: 'viewer',
      createdAt: timestamp
    })
    store.sessions.push({
      token: 'viewer-token',
      userId: 'viewer-1',
      createdAt: timestamp,
      expiresAt: future,
      lastSeenAt: timestamp
    })
    store.devices.push({
      id: 'viewer-device',
      name: 'Viewer Device',
      userId: 'viewer-1',
      capabilities: { sessions: true },
      deviceToken: 'viewer-device-token',
      createdAt: timestamp,
      lastSeenAt: timestamp
    })
    await writeRelayStore(args.dataPath, store)
    await postSnapshot(baseUrl, 'viewer-device', 'viewer-device-token', [
      {
        id: 'viewer-session',
        title: 'Viewer session',
        userId: 'viewer-1'
      }
    ])

    const listed = await requestJson(baseUrl, '/api/relay/devices/viewer-device/sessions', {
      headers: authHeaders('viewer-token')
    })
    const submitted = await requestJson(
      baseUrl,
      '/api/relay/devices/viewer-device/sessions/viewer-session/messages',
      {
        method: 'POST',
        headers: authHeaders('viewer-token'),
        body: JSON.stringify({ message: 'viewer cannot submit' })
      }
    )

    expect(listed.response.status).toBe(200)
    expect(listed.body.sessions).toMatchObject([
      {
        id: 'viewer-session'
      }
    ])
    expect(submitted.response.status).toBe(403)
    expect(submitted.body).toEqual({ error: 'Forbidden.' })
  })
})
