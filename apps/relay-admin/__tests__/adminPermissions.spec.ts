import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchRelayAdminSnapshot } from '../src/features/dashboard/adminSnapshot'
import { canAccessRelayAdminSection } from '../src/shared/model/adminPermissions'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relay admin frontend permissions', () => {
  it('matches section entry visibility to the relay role model', () => {
    expect(canAccessRelayAdminSection('viewer', 'devices')).toBe(true)
    expect(canAccessRelayAdminSection('viewer', 'openapi')).toBe(true)
    expect(canAccessRelayAdminSection('member', 'devices')).toBe(true)
    expect(canAccessRelayAdminSection('member', 'openapi')).toBe(true)
    expect(canAccessRelayAdminSection('member', 'teams')).toBe(true)
    expect(canAccessRelayAdminSection('member', 'users')).toBe(false)
    expect(canAccessRelayAdminSection('member', 'data-dashboard')).toBe(false)
    expect(canAccessRelayAdminSection('admin', 'data-dashboard')).toBe(true)
    expect(canAccessRelayAdminSection('admin', 'teams')).toBe(true)
    expect(canAccessRelayAdminSection('admin', 'users')).toBe(true)
    expect(canAccessRelayAdminSection('owner', 'sso')).toBe(true)
  })

  it('does not call owner/admin snapshot endpoints for ordinary users', async () => {
    const requests: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        requests.push(path)
        const body = path === '/api/relay/teams'
          ? { policy: { teamsEnabled: true }, teams: [{ id: 'team-1', name: 'My team' }] }
          : { devices: [] }
        return new Response(JSON.stringify(body), {
          headers: { 'content-type': 'application/json' },
          status: 200
        })
      })
    )

    await expect(fetchRelayAdminSnapshot('member-token', { includeAdminResources: false })).resolves.toEqual({
      accessGroups: [],
      devices: [],
      invites: [],
      ssoProviders: [],
      teamPolicy: { teamsEnabled: true },
      teams: [{ accessGroups: [], id: 'team-1', name: 'My team', membership: null }],
      users: []
    })
    expect(requests).toEqual(['/api/relay/devices', '/api/relay/teams'])
  })
})
