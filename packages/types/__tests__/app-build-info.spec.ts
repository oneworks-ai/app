import { describe, expect, it } from 'vitest'

import {
  APP_BUILD_VERSION_FALLBACK,
  parseAppBuildInfoJson
} from '../src/app-build-info'

describe('app build info JSON contract', () => {
  it('normalizes a complete reproducible build fingerprint from raw JSON', () => {
    expect(parseAppBuildInfoJson(JSON.stringify({
      version: '1.2.3-beta.4',
      commit: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
      buildTime: '2026-07-30T08:09:10+08:00',
      buildTimeSource: 'commit'
    }))).toEqual({
      version: '1.2.3-beta.4',
      commit: 'abcdef0123456789abcdef0123456789abcdef01',
      buildTime: '2026-07-30T00:09:10.000Z',
      buildTimeSource: 'commit'
    })
  })

  it('uses stable unavailable values for malformed, unsafe, and invalid JSON metadata', () => {
    for (const value of [undefined, '{', JSON.stringify({
      version: '/Users/example/private/package.json',
      commit: 'Bearer super-secret-token',
      buildTime: '2026-02-30T00:00:00Z'
    })]) {
      expect(parseAppBuildInfoJson(value)).toEqual({
        version: APP_BUILD_VERSION_FALLBACK,
        commit: null,
        buildTime: null,
        buildTimeSource: 'unavailable'
      })
    }
  })

  it('rejects non-canonical SemVer and impossible calendar dates', () => {
    for (const version of ['01.2.3', '1.02.3', '1.2.03', '1.2.3-01']) {
      expect(parseAppBuildInfoJson(JSON.stringify({ version })).version).toBe(APP_BUILD_VERSION_FALLBACK)
    }
    expect(parseAppBuildInfoJson(JSON.stringify({
      version: '1.2.3-0.alpha+build.01',
      buildTime: '2024-02-29T00:00:00Z'
    }))).toMatchObject({
      version: '1.2.3-0.alpha+build.01',
      buildTime: '2024-02-29T00:00:00.000Z'
    })
  })

  it('accepts ISO offsets through ±14:00 but rejects values beyond the limit', () => {
    for (const buildTime of [
      '2026-07-30T00:00:00+13:59',
      '2026-07-30T00:00:00+14:00',
      '2026-07-30T00:00:00-14:00'
    ]) {
      expect(parseAppBuildInfoJson(JSON.stringify({ buildTime })).buildTime).not.toBeNull()
    }
    for (const buildTime of [
      '2026-07-30T00:00:00+14:01',
      '2026-07-30T00:00:00-14:01'
    ]) {
      expect(parseAppBuildInfoJson(JSON.stringify({ buildTime })).buildTime).toBeNull()
    }
  })

  it('does not inspect accessors, classes, or root/nested Proxy input', () => {
    let accessorReads = 0
    let trapCount = 0
    const accessor = {}
    Object.defineProperty(accessor, 'value', { get: () => { accessorReads += 1; return 'unsafe' } })
    const proxy = new Proxy({}, { get: () => { trapCount += 1; return undefined } })
    const nestedProxy = new Proxy({}, { get: () => { trapCount += 1; return undefined } })

    expect(parseAppBuildInfoJson(accessor as unknown as string).version).toBe(APP_BUILD_VERSION_FALLBACK)
    expect(parseAppBuildInfoJson(proxy as unknown as string).version).toBe(APP_BUILD_VERSION_FALLBACK)
    expect(parseAppBuildInfoJson({ nested: nestedProxy } as unknown as string).version)
      .toBe(APP_BUILD_VERSION_FALLBACK)
    expect(parseAppBuildInfoJson(new (class { version = '1.2.3' })() as unknown as string).version)
      .toBe(APP_BUILD_VERSION_FALLBACK)
    expect(parseAppBuildInfoJson(JSON.stringify({ version: '1.2.3', nested: { value: 'safe' } })).version)
      .toBe('1.2.3')
    expect(accessorReads).toBe(0)
    expect(trapCount).toBe(0)
  })
})
