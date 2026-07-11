import { afterEach, describe, expect, it, vi } from 'vitest'

import { openRelayLoginProvider } from '../src/login/RelayLoginApp.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relay login provider navigation', () => {
  it('navigates the top-level page from an embedded login frame', () => {
    const frameLocation = { href: 'https://relay.example/login' }
    const topLocation = { href: 'https://oneworks.example/plugins/relay/home/accounts/login' }
    vi.stubGlobal('window', {
      location: frameLocation,
      self: {},
      top: { location: topLocation }
    })

    openRelayLoginProvider('https://sso.example/authorize')

    expect(topLocation.href).toBe('https://sso.example/authorize')
    expect(frameLocation.href).toBe('https://relay.example/login')
  })

  it('keeps top-level login navigation in the current window', () => {
    const topLevelWindow = {}
    const location = { href: 'https://relay.example/login' }
    vi.stubGlobal('window', {
      location,
      self: topLevelWindow,
      top: topLevelWindow
    })

    openRelayLoginProvider('https://sso.example/authorize')

    expect(location.href).toBe('https://sso.example/authorize')
  })
})
