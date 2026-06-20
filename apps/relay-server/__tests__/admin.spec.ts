import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { handleAdminUi } from '../src/routes/admin-ui.js'
import type { RelayServerArgs } from '../src/server.js'
import { readRelayStore, writeRelayStore } from '../src/store.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson, requestRaw } from './helpers.js'

afterEach(cleanupRelayFixtures)

describe('relay server admin routes', () => {
  it('requires admin authorization for invites', async () => {
    const { baseUrl } = await listenRelay()
    const unauthorizedInvite = await requestJson(baseUrl, '/api/admin/invites', {
      method: 'POST',
      body: JSON.stringify({ code: 'pair-one' })
    })

    expect(unauthorizedInvite.response.status).toBe(401)
    expect(unauthorizedInvite.body).toEqual({ error: 'Admin token required.' })
  })

  it('requires admin authorization for user updates', async () => {
    const { baseUrl } = await listenRelay()
    const unauthorizedUser = await requestJson(baseUrl, '/api/admin/users', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'user-1', disabled: true })
    })

    expect(unauthorizedUser.response.status).toBe(401)
    expect(unauthorizedUser.body).toEqual({ error: 'Admin token required.' })
  })

  it('creates invite and user records with admin token', async () => {
    const { baseUrl } = await listenRelay()
    const invite = await requestJson(baseUrl, '/api/admin/invites', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ code: 'pair-one', maxUses: 1, role: 'member', userId: 'user-1' })
    })
    const user = await requestJson(baseUrl, '/api/admin/users', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ email: 'a@example.com', name: 'A', role: 'admin' })
    })

    expect(invite.response.status).toBe(200)
    expect(invite.body.invite).toMatchObject({
      code: 'pair-one',
      maxUses: 1,
      role: 'member',
      used: 0,
      userId: 'user-1'
    })
    expect(user.response.status).toBe(200)
    expect(user.body.user).toMatchObject({
      email: 'a@example.com',
      name: 'A',
      role: 'admin'
    })
  })

  it('includes team membership summaries in admin users responses', async () => {
    const { args, baseUrl } = await listenRelay()
    const store = await readRelayStore(args.dataPath)
    store.users.push({
      createdAt: '2026-01-01T00:00:00.000Z',
      email: 'member@example.com',
      id: 'member-1',
      name: 'Member One',
      role: 'member'
    })
    store.teams.push({
      createdAt: '2026-01-01T00:00:00.000Z',
      createdByUserId: 'member-1',
      id: 'team-1',
      name: 'Team One',
      slug: 'team-one'
    })
    store.teamMembers.push({
      configEnabled: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      createdByUserId: 'member-1',
      defaultForPublishing: true,
      id: 'member-team-1',
      role: 'editor',
      teamId: 'team-1',
      userId: 'member-1'
    })
    await writeRelayStore(args.dataPath, store)

    const users = await requestJson(baseUrl, '/api/admin/users', {
      headers: authHeaders('admin-token')
    })

    expect(users.response.status).toBe(200)
    expect(users.body.users).toEqual([
      expect.objectContaining({
        email: 'member@example.com',
        teams: [
          {
            archivedAt: null,
            configEnabled: false,
            defaultForPublishing: true,
            id: 'team-1',
            name: 'Team One',
            role: 'editor',
            slug: 'team-one'
          }
        ]
      })
    ])
  })

  it('updates users and rejects duplicate emails', async () => {
    const { baseUrl } = await listenRelay()
    const created = await requestJson(baseUrl, '/api/admin/users', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ email: 'Admin@Example.com', id: 'user-1', name: 'Admin', role: 'admin' })
    })
    const duplicate = await requestJson(baseUrl, '/api/admin/users', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ email: 'admin@example.com', name: 'Duplicate' })
    })
    const updated = await requestJson(baseUrl, '/api/admin/users', {
      method: 'PATCH',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ disabled: true, id: 'user-1', role: 'viewer' })
    })
    const passwordUpdated = await requestJson(baseUrl, '/api/admin/users', {
      method: 'PATCH',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ id: 'user-1', password: 'new-password' })
    })
    const users = await requestJson(baseUrl, '/api/admin/users', {
      headers: authHeaders('admin-token')
    })

    expect(created.response.status).toBe(200)
    expect(duplicate.response.status).toBe(409)
    expect(duplicate.body).toEqual({ error: 'User email already exists.' })
    expect(updated.response.status).toBe(200)
    expect(updated.body.user).toMatchObject({
      disabled: true,
      email: 'admin@example.com',
      id: 'user-1',
      role: 'viewer'
    })
    expect(passwordUpdated.response.status).toBe(200)
    expect(passwordUpdated.body.user).toMatchObject({
      id: 'user-1',
      passwordEnabled: true
    })
    expect(JSON.stringify(passwordUpdated.body.user)).not.toContain('passwordHash')
    expect(typeof updated.body.user).toBe('object')
    expect((updated.body.user as Record<string, unknown>).disabledAt).toEqual(expect.any(String))
    expect(users.body.users).toMatchObject([
      {
        disabled: true,
        id: 'user-1',
        passwordEnabled: true,
        role: 'viewer'
      }
    ])
  })

  it('rejects session users changing their own role', async () => {
    const { args, baseUrl } = await listenRelay()
    const created = await requestJson(baseUrl, '/api/admin/users', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ email: 'owner@example.com', id: 'owner-1', name: 'Owner', role: 'owner' })
    })
    const store = await readRelayStore(args.dataPath)
    store.sessions.push({
      token: 'owner-session-token',
      userId: 'owner-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2999-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z'
    })
    await writeRelayStore(args.dataPath, store)

    const rejected = await requestJson(baseUrl, '/api/admin/users', {
      method: 'PATCH',
      headers: authHeaders('owner-session-token'),
      body: JSON.stringify({ id: 'owner-1', role: 'member' })
    })
    const nextStore = await readRelayStore(args.dataPath)

    expect(created.response.status).toBe(200)
    expect(rejected.response.status).toBe(403)
    expect(rejected.body).toEqual({ error: 'Cannot change your own role.' })
    expect(nextStore.users.find(user => user.id === 'owner-1')?.role).toBe('owner')
  })

  it('rejects duplicate invite codes and supports revoke/delete', async () => {
    const { baseUrl } = await listenRelay()
    const created = await requestJson(baseUrl, '/api/admin/invites', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ code: 'pair-delete', maxUses: 1, role: 'member' })
    })
    const duplicate = await requestJson(baseUrl, '/api/admin/invites', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ code: 'pair-delete' })
    })
    const revoked = await requestJson(baseUrl, '/api/admin/invites', {
      method: 'PATCH',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ code: 'pair-delete', revoked: true })
    })
    const blockedRegistration = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders('pair-delete'),
      body: JSON.stringify({ deviceId: 'device-1' })
    })
    const deleted = await requestJson(baseUrl, '/api/admin/invites?code=pair-delete', {
      method: 'DELETE',
      headers: authHeaders('admin-token')
    })
    const invites = await requestJson(baseUrl, '/api/admin/invites', {
      headers: authHeaders('admin-token')
    })

    expect(created.response.status).toBe(200)
    expect(duplicate.response.status).toBe(409)
    expect(duplicate.body).toEqual({ error: 'Invite code already exists.' })
    expect(revoked.response.status).toBe(200)
    expect((revoked.body.invite as Record<string, unknown>).revokedAt).toEqual(expect.any(String))
    expect(blockedRegistration.response.status).toBe(401)
    expect(deleted.response.status).toBe(200)
    expect(deleted.body).toMatchObject({
      deleted: true,
      invite: { code: 'pair-delete' }
    })
    expect(invites.body.invites).toEqual([])
  })

  it('serves the exported admin page response', async () => {
    const args: RelayServerArgs = {
      allowOrigin: '*',
      adminToken: 'admin-token',
      dataPath: '/tmp/oneworks-relay-admin-page-test.json',
      host: '127.0.0.1',
      port: 0
    }
    const server = createServer((req, res) => handleAdminUi(req, res, args))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/admin`)
      const body = await response.text()

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(body).toContain('Relay Admin')
      expect(body).toContain('id="root"')
      expect(body).toContain('/admin/assets/favicon-dark.svg')
      expect(body).toContain('/admin/assets/favicon-light.svg')
      expect(body).toContain('/admin/assets/admin.css')
      expect(body).toContain('/admin/assets/admin.js')
      expect(body).not.toContain('/api/admin/users')
      expect(body).not.toContain('oneworks-relay-admin-token')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error == null) {
            resolve()
          } else {
            reject(error)
          }
        })
      })
    }
  })

  it('serves admin history routes through the admin page', async () => {
    const { baseUrl } = await listenRelay()
    const response = await requestRaw(baseUrl, '/admin/users')
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(body).toContain('/admin/assets/admin.js')
  })
})
