import { describe, expect, it } from 'vitest'

import { readLauncherLocationState, resolveLauncherUrlNavigation } from '#~/routes/launcher-route-state'

describe('launcher route state', () => {
  it('isolates an embedded workspace launcher from the host URL', () => {
    expect(readLauncherLocationState(
      'embedded',
      '/w/w_route/launcher/settings',
      '?view=about&q=host-query'
    )).toEqual({ mode: 'commands', query: '' })
    expect(resolveLauncherUrlNavigation({
      currentHash: '',
      currentPathname: '/w/w_route',
      currentSearch: '?tab=chat',
      mode: 'settings',
      query: 'launcher-query',
      routingMode: 'embedded'
    })).toBeUndefined()
  })

  it('canonicalizes legacy query views for the standalone launcher', () => {
    expect(readLauncherLocationState('url', '/launcher', '?view=settings&q=theme')).toEqual({
      mode: 'settings',
      query: 'theme'
    })
    expect(resolveLauncherUrlNavigation({
      currentHash: '#appearance',
      currentPathname: '/launcher',
      currentSearch: '?view=settings&q=theme',
      mode: 'settings',
      routingMode: 'url'
    })).toEqual({
      replace: false,
      to: {
        hash: '#appearance',
        pathname: '/launcher/settings',
        search: '?q=theme'
      }
    })
  })
})
