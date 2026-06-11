import { afterEach, describe, expect, it } from 'vitest'

import { authHeaders, requestJson } from './helpers.js'
import { cleanupSessionRelayFixtures, listenSessionRelay, postSnapshot } from './session-route-helpers.js'

afterEach(cleanupSessionRelayFixtures)

describe('relay server session snapshots', () => {
  it('lists device sessions for admins and restricts member access by device/session owner', async () => {
    const { baseUrl } = await listenSessionRelay()
    const snapshot = await postSnapshot(baseUrl, 'device-1', 'device-token-1', [
      {
        id: 'session-1',
        lastMessage: 'do not persist this',
        title: 'Own session',
        userId: 'user-1'
      },
      {
        id: 'session-2',
        title: 'Other session',
        userId: 'user-2'
      }
    ])
    await postSnapshot(baseUrl, 'device-2', 'device-token-2', [
      {
        id: 'session-3',
        title: 'Second device session',
        userId: 'user-2'
      }
    ])

    const memberList = await requestJson(baseUrl, '/api/relay/devices/device-1/sessions', {
      headers: authHeaders('member-token-1')
    })
    const otherDeviceList = await requestJson(baseUrl, '/api/relay/devices/device-2/sessions', {
      headers: authHeaders('member-token-1')
    })
    const adminList = await requestJson(baseUrl, '/api/relay/devices/device-2/sessions', {
      headers: authHeaders('admin-session-token')
    })
    const unauthenticated = await requestJson(baseUrl, '/api/relay/devices/device-1/sessions')

    expect(snapshot.response.status).toBe(200)
    expect(memberList.response.status).toBe(200)
    expect(memberList.body.sessions).toMatchObject([
      {
        id: 'session-1',
        title: 'session-1'
      }
    ])
    expect(JSON.stringify(memberList.body.sessions)).not.toContain('do not persist this')
    expect(otherDeviceList.response.status).toBe(403)
    expect(adminList.response.status).toBe(200)
    expect(adminList.body.sessions).toMatchObject([
      {
        id: 'session-3',
        title: 'session-3'
      }
    ])
    expect(unauthenticated.response.status).toBe(401)
  })
})
