import { describe, expect, it } from 'vitest'

import { resolveClientBuildInfo } from '#~/client-build-info'

describe('client build info', () => {
  it('uses the injected JSON build fingerprint when available', () => {
    expect(resolveClientBuildInfo(JSON.stringify({
      version: '2.3.4',
      commit: 'abcdef0123456789abcdef0123456789abcdef01',
      buildTime: '2026-07-30T00:09:10Z',
      buildTimeSource: 'build'
    }), {})).toMatchObject({ version: '2.3.4', buildTimeSource: 'build' })
  })

  it('falls back to compiled primitive metadata when runtime JSON is absent or invalid', () => {
    expect(resolveClientBuildInfo(undefined, {
      __ONEWORKS_PROJECT_CLIENT_BUILD_TIME__: '2026-07-30T00:09:10Z',
      __ONEWORKS_PROJECT_CLIENT_BUILD_TIME_SOURCE__: 'commit',
      __ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__: 'abcdef0123456789abcdef0123456789abcdef01',
      __ONEWORKS_PROJECT_CLIENT_VERSION__: '2.3.4'
    })).toMatchObject({ version: '2.3.4', buildTimeSource: 'commit' })
    expect(resolveClientBuildInfo('{', {
      __ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__: 'abcdef0123456789abcdef0123456789abcdef01',
      __ONEWORKS_PROJECT_CLIENT_VERSION__: '2.3.4'
    })).toMatchObject({ version: '2.3.4', commit: 'abcdef0123456789abcdef0123456789abcdef01' })
  })

  it('merges valid runtime fields without allowing invalid fields to mask compiled metadata', () => {
    expect(resolveClientBuildInfo(JSON.stringify({
      version: '01.2.3',
      commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      buildTime: '2026-02-30T00:00:00Z'
    }), {
      __ONEWORKS_PROJECT_CLIENT_BUILD_TIME__: '2026-07-30T00:09:10Z',
      __ONEWORKS_PROJECT_CLIENT_BUILD_TIME_SOURCE__: 'commit',
      __ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      __ONEWORKS_PROJECT_CLIENT_VERSION__: '2.3.4'
    })).toEqual({
      version: '2.3.4',
      commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      buildTime: '2026-07-30T00:09:10.000Z',
      buildTimeSource: 'commit'
    })
  })

  it('uses whitespace-padded runtime 0.0.0 and remains stable when every candidate is invalid', () => {
    expect(resolveClientBuildInfo(JSON.stringify({
      version: ' 0.0.0 ',
      commit: 'not-a-commit',
      buildTime: 'not-a-time'
    }), {
      __ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__: 'also-not-a-commit',
      __ONEWORKS_PROJECT_CLIENT_VERSION__: '2.3.4'
    })).toMatchObject({ version: '0.0.0', commit: null, buildTime: null })
    expect(resolveClientBuildInfo(JSON.stringify({
      version: '01.2.3',
      commit: 'not-a-commit',
      buildTime: '2026-02-30T00:00:00Z'
    }), {
      __ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__: 'not-a-commit',
      __ONEWORKS_PROJECT_CLIENT_VERSION__: '01.2.3'
    })).toEqual({
      version: '0.0.0',
      commit: null,
      buildTime: null,
      buildTimeSource: 'unavailable'
    })
  })

  it('fails closed on Proxy input without triggering traps', () => {
    let trapCount = 0
    const proxy = new Proxy({}, { get: () => { trapCount += 1; return undefined } })
    expect(resolveClientBuildInfo(proxy as unknown as string, {}).version).toBe('0.0.0')
    expect(trapCount).toBe(0)
  })
})
