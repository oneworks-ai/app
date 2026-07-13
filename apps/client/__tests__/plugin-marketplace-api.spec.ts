import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  listPluginMarketplaceCatalog,
  resolvePluginMarketplaceVersions,
  syncPluginMarketplaceSelection
} from '#~/plugins/marketplace-api'

vi.mock('#~/homepage-preview/runtime-loader', () => ({
  handleHomepagePreviewFetchIfEnabled: () => undefined
}))

const makeResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

describe('plugin marketplace api server targeting', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (input) => {
      const pathname = new URL(String(input)).pathname
      if (pathname.endsWith('/versions')) return makeResponse({ versions: [] })
      if (pathname.endsWith('/selection')) return makeResponse({ results: [] })
      return makeResponse({ plugins: [], sources: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('routes catalog, version, and selection requests to the selected workspace server', async () => {
    const options = { serverBaseUrl: 'https://remote.example/base' }

    await listPluginMarketplaceCatalog(options)
    await resolvePluginMarketplaceVersions('generation-1', [{ marketplace: 'team', plugin: 'review' }], options)
    await syncPluginMarketplaceSelection('team', 'review', true, 'project', options)

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://remote.example/base/api/plugins/marketplace/catalog',
      'https://remote.example/base/api/plugins/marketplace/versions',
      'https://remote.example/base/api/plugins/marketplace/plugins/team/review/selection'
    ])
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ enabled: true, target: 'project' })
    })
  })

  it('keeps the current server as the default source', async () => {
    await listPluginMarketplaceCatalog()

    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).not.toContain('remote.example')
    expect(new URL(url).pathname).toBe('/api/plugins/marketplace/catalog')
  })
})
