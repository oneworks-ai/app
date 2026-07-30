import { afterEach, describe, expect, it, vi } from 'vitest'

import { getAuthStatus } from '#~/api/auth'
import { getConfig } from '#~/api/config'
import { getLauncherAuthStatus } from '#~/api/launcher'
import { getServerBuildInfo } from '#~/components/config/ConfigAboutSection'

const serverBuild = {
  version: '2.3.4',
  commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  buildTime: '2026-07-30T01:00:00.000Z',
  buildTimeSource: 'build'
}

describe('About API boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('decodes JSON envelopes through auth, config, and launcher wrappers before About consumes build data', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const data = url.includes('/api/config')
        ? {}
        : {
          authenticated: true,
          build: serverBuild,
          enabled: false,
          passwordSource: 'generated',
          usernames: []
        }
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      })
    }))

    const [auth, config, launcher] = await Promise.all([
      getAuthStatus(),
      getConfig(),
      getLauncherAuthStatus()
    ])
    expect(config).toEqual({})
    expect(getServerBuildInfo({ build: auth.build, version: auth.version })).toEqual(serverBuild)
    expect(getServerBuildInfo({ build: launcher.build, version: launcher.version })).toEqual(serverBuild)
  })
})
