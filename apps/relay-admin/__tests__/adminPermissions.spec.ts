import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchRelayAdminSnapshot } from '../src/features/dashboard/adminSnapshot'
import { canAccessRelayAdminSection } from '../src/shared/model/adminPermissions'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relay admin frontend permissions', () => {
  it('matches section entry visibility to the relay role model', () => {
    expect(canAccessRelayAdminSection('viewer', 'devices')).toBe(true)
    expect(canAccessRelayAdminSection('member', 'devices')).toBe(true)
    expect(canAccessRelayAdminSection('member', 'users')).toBe(false)
    expect(canAccessRelayAdminSection('admin', 'users')).toBe(true)
    expect(canAccessRelayAdminSection('owner', 'sso')).toBe(true)
  })

  it('does not call owner/admin snapshot endpoints for ordinary users', async () => {
    const requests: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        requests.push(path)
        return new Response(JSON.stringify({ devices: [] }), {
          headers: { 'content-type': 'application/json' },
          status: 200
        })
      })
    )

    await expect(fetchRelayAdminSnapshot('member-token', { includeAdminResources: false })).resolves.toEqual({
      devices: [],
      invites: [],
      ssoProviders: [],
      users: []
    })
    expect(requests).toEqual(['/api/relay/devices'])
  })
})
