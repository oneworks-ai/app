import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildAuditEvent } from '../src/security/audit.js'
import { readRelayStore, writeRelayStore } from '../src/store.js'
import type { RelayStore } from '../src/types.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanupRelayFixtures()
})

const future = '2999-01-01T00:00:00.000Z'
const timestamp = '2026-01-01T00:00:00.000Z'

const createSecurityStore = (): RelayStore => ({
  createdAt: timestamp,
  emailRisk: {
    buckets: [],
    challenges: []
  },
  users: [
    {
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      role: 'member',
      createdAt: timestamp
    }
  ],
  invites: [],
  ssoProviders: [],
  devices: [
    {
      id: 'device-1',
      name: 'Device',
      userId: 'user-1',
      capabilities: { sessions: true },
      createdAt: timestamp,
      deviceToken: 'device-token',
      lastSeenAt: timestamp
    }
  ],
  deviceSessions: [],
  forwardingJobs: [],
  oauthStates: [],
  sessions: [
    {
      token: 'session-token',
      userId: 'user-1',
      createdAt: timestamp,
      expiresAt: future,
      lastSeenAt: timestamp
    }
  ]
})

describe('relay server security hardening', () => {
  it('rate limits sensitive device registration attempts', async () => {
    vi.stubEnv('ONEWORKS_RELAY_RATE_LIMIT_DEVICE_REGISTER_MAX', '1')
    vi.stubEnv('ONEWORKS_RELAY_RATE_LIMIT_DEVICE_REGISTER_WINDOW_SECONDS', '60')
    const { baseUrl } = await listenRelay()

    const first = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ deviceId: 'device-1' })
    })
    const limited = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ deviceId: 'device-2' })
    })

    expect(first.response.status).toBe(200)
    expect(limited.response.status).toBe(429)
    expect(limited.response.headers.get('retry-after')).toBe('60')
    expect(limited.body).toMatchObject({
      error: 'Too many requests.',
      rateLimit: {
        category: 'device-registration'
      }
    })
    expect(JSON.stringify(limited.body)).not.toContain('admin-token')
  })

  it('builds audit events from allowlisted metadata only', () => {
    const event = buildAuditEvent({
      action: 'device.register',
      actor: 'session:user-1',
      authorization: 'Bearer secret-token',
      body: { content: 'do not log' },
      ip: '127.0.0.1',
      payload: { message: 'do not log' },
      requestId: 'request-1',
      resource: 'device',
      result: { text: 'do not log' },
      status: 'success',
      token: 'secret-token',
      userAgent: 'vitest'
    })

    expect(event).toEqual({
      action: 'device.register',
      actor: 'session:user-1',
      ip: '127.0.0.1',
      requestId: 'request-1',
      resource: 'device',
      status: 'success',
      userAgent: 'vitest'
    })
    expect(JSON.stringify(event)).not.toContain('secret-token')
    expect(JSON.stringify(event)).not.toContain('do not log')
  })

  it('rotates session and device tokens while leaving admin token rotation explicit', async () => {
    const { args, baseUrl } = await listenRelay()
    await writeRelayStore(args.dataPath, createSecurityStore())

    const rotatedSession = await requestJson(baseUrl, '/api/admin/security/tokens/rotate', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ kind: 'session', token: 'session-token' })
    })
    const sessionToken = String(rotatedSession.body.sessionToken)
    const oldSession = await requestJson(baseUrl, '/api/auth/me', {
      headers: authHeaders('session-token')
    })
    const newSession = await requestJson(baseUrl, '/api/auth/me', {
      headers: authHeaders(sessionToken)
    })

    const rotatedDevice = await requestJson(baseUrl, '/api/admin/security/tokens/rotate', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ deviceId: 'device-1', kind: 'device' })
    })
    const deviceToken = String(rotatedDevice.body.deviceToken)
    const oldDevice = await requestJson(baseUrl, '/api/relay/devices/heartbeat', {
      method: 'POST',
      headers: authHeaders('device-token'),
      body: JSON.stringify({ deviceId: 'device-1' })
    })
    const newDevice = await requestJson(baseUrl, '/api/relay/devices/heartbeat', {
      method: 'POST',
      headers: authHeaders(deviceToken),
      body: JSON.stringify({ deviceId: 'device-1' })
    })
    const adminRotation = await requestJson(baseUrl, '/api/admin/security/tokens/rotate', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ kind: 'admin' })
    })
    const store = await readRelayStore(args.dataPath)

    expect(rotatedSession.response.status).toBe(200)
    expect(sessionToken).not.toBe('session-token')
    expect(oldSession.response.status).toBe(401)
    expect(newSession.response.status).toBe(200)
    expect(rotatedDevice.response.status).toBe(200)
    expect(deviceToken).not.toBe('device-token')
    expect(oldDevice.response.status).toBe(401)
    expect(newDevice.response.status).toBe(200)
    expect(adminRotation.response.status).toBe(409)
    expect(adminRotation.body).toMatchObject({
      kind: 'admin'
    })
    expect(JSON.stringify(adminRotation.body)).not.toContain('admin-token')
    expect(store.sessions[0].token).toBe(sessionToken)
    expect(store.devices[0].deviceTokenHash).toEqual(expect.stringMatching(/^sha256:/))
    expect(store.devices[0]).not.toHaveProperty('deviceToken')
  })
})
