import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getMarketplacePluginVersionKey,
  publishMarketplacePluginVersionSources,
  resolvePluginMarketplaceVersions
} from '#~/services/plugins/marketplace-version-resolver.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('plugin marketplace version resolver', () => {
  it('keeps catalog generations isolated and plugin identities collision-free', async () => {
    const firstSources = new Map([
      [
        getMarketplacePluginVersionKey('a:b', 'c'),
        { source: 'github' as const, repo: 'acme/first', sha: 'first-generation-sha' }
      ],
      [
        getMarketplacePluginVersionKey('a', 'b:c'),
        { source: 'github' as const, repo: 'acme/second', sha: 'second-generation-sha' }
      ]
    ])
    const firstGeneration = publishMarketplacePluginVersionSources(firstSources)
    publishMarketplacePluginVersionSources(new Map())
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        json: async () => ({ version: url.includes('/first/') ? '1.0.0' : '2.0.0' }),
        ok: true,
        status: 200
      }))
    )

    await expect(resolvePluginMarketplaceVersions(firstGeneration, [
      { marketplace: 'a:b', plugin: 'c' },
      { marketplace: 'a', plugin: 'b:c' }
    ])).resolves.toEqual({
      found: true,
      retryable: [],
      versions: [
        { marketplace: 'a:b', plugin: 'c', version: '1.0.0' },
        { marketplace: 'a', plugin: 'b:c', version: '2.0.0' }
      ]
    })
  })

  it('refreshes successful lookups for movable refs after the cache TTL', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ version: '1.0.0' }), ok: true, status: 200 })
      .mockResolvedValueOnce({ json: async () => ({ version: '1.1.0' }), ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    const generation = publishMarketplacePluginVersionSources(
      new Map([[
        getMarketplacePluginVersionKey('shared', 'moving'),
        { source: 'github' as const, repo: 'acme/moving', ref: 'main' }
      ]])
    )
    const items = [{ marketplace: 'shared', plugin: 'moving' }]

    await expect(resolvePluginMarketplaceVersions(generation, items)).resolves.toEqual(
      expect.objectContaining({ versions: [expect.objectContaining({ version: '1.0.0' })] })
    )
    vi.advanceTimersByTime(5 * 60_000 + 1)
    await expect(resolvePluginMarketplaceVersions(generation, items)).resolves.toEqual(
      expect.objectContaining({ versions: [expect.objectContaining({ version: '1.1.0' })] })
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('expires old catalog generations as an atomic unit', async () => {
    const expiredGeneration = publishMarketplacePluginVersionSources(new Map())
    for (let index = 0; index < 4; index += 1) publishMarketplacePluginVersionSources(new Map())

    await expect(resolvePluginMarketplaceVersions(expiredGeneration, [])).resolves.toEqual({
      found: false,
      retryable: [],
      versions: []
    })
  })
})
