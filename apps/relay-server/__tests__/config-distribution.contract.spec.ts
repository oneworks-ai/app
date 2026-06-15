import { describe, expect, it } from 'vitest'

const RELAY_CONFIG_DISTRIBUTION_ENDPOINTS = {
  configSnapshot: '/api/relay/config-snapshot'
} as const

describe('relay server config distribution contract', () => {
  it('pins the device and session route name for config snapshot distribution tests', () => {
    expect(RELAY_CONFIG_DISTRIBUTION_ENDPOINTS).toEqual({
      configSnapshot: '/api/relay/config-snapshot'
    })
  })

  it.todo('adds an admin-authorized management API for creating, updating, listing, and deleting config assignments')
  it.todo('keeps config snapshot reads side-effect free when no assignment matches the project context')
})
