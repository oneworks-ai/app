import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listModelProviders } from '#~/api/model-providers'
import { getModelProviderCatalog, resetModelProviderCatalog } from '@oneworks/utils/model-providers'

vi.mock('#~/homepage-preview/runtime-loader', () => ({
  handleHomepagePreviewFetchIfEnabled: () => undefined
}))

vi.mock('#~/runtime-config.js', () => ({
  createServerUrl: (path: string) => new URL(path.replace(/^\/+/, ''), 'http://api.example.com:8787/').toString(),
  getServerBaseUrl: () => 'http://api.example.com:8787'
}))

const makeJsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200
  })

describe('model provider catalog api', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    resetModelProviderCatalog()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    resetModelProviderCatalog()
    vi.unstubAllGlobals()
  })

  it('installs a complete server catalog for shared client resolution', async () => {
    fetchMock.mockResolvedValue(makeJsonResponse({
      catalog: { schemaVersion: 1, source: 'managed', version: '9.9.9' },
      hostMatchers: [{ provider: 'managed-provider', hosts: ['managed.example.com'] }],
      providers: [{ id: 'managed-provider', title: 'Managed', category: 'official' }]
    }))

    await expect(listModelProviders()).resolves.toMatchObject({
      catalog: { source: 'managed', version: '9.9.9' },
      providers: [{ id: 'managed-provider' }]
    })
    expect(getModelProviderCatalog().providers.map(provider => provider.id)).toEqual(['managed-provider'])
  })

  it.each([
    { providers: [] },
    { catalog: { schemaVersion: 1, source: 'bundled' }, hostMatchers: [], providers: [] }
  ])('keeps the bundled client catalog for legacy or empty local backends', async payload => {
    fetchMock.mockResolvedValue(makeJsonResponse(payload))

    const result = await listModelProviders()

    expect(result.catalog.source).toBe('bundled')
    expect(result.providers.some(provider => provider.id === 'deepseek')).toBe(true)
    expect(getModelProviderCatalog().providers.some(provider => provider.id === 'deepseek')).toBe(true)
  })
})
