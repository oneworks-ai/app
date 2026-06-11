import { beforeEach, describe, expect, it, vi } from 'vitest'

const loadNormalizer = async () => {
  const { normalizePluginLauncherSearchResults } = await import('#~/routes/launcher-plugin-search')
  return normalizePluginLauncherSearchResults
}

describe('launcher plugin search', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      clear: () => undefined,
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => undefined
    })
    vi.stubGlobal('navigator', {
      language: 'en-US',
      languages: ['en-US']
    })
    vi.stubGlobal('window', {})
  })

  it('keeps only invokable plugin launcher results', async () => {
    const normalizePluginLauncherSearchResults = await loadNormalizer()

    expect(
      normalizePluginLauncherSearchResults({
        results: [
          {
            description: 'Search project docs',
            icon: 'search',
            id: 'docs/result-1',
            keywords: ['docs', 42],
            title: 'Docs'
          },
          { id: '', title: 'Missing id' },
          { id: 'missing-title' }
        ]
      })
    ).toEqual({
      results: [
        {
          description: 'Search project docs',
          icon: 'search',
          id: 'docs/result-1',
          keywords: ['docs'],
          title: 'Docs'
        }
      ]
    })
  })

  it('accepts bare result arrays from early server implementations', async () => {
    const normalizePluginLauncherSearchResults = await loadNormalizer()

    expect(normalizePluginLauncherSearchResults([{ id: 'result-1', title: 'Run result' }])).toEqual({
      results: [
        {
          id: 'result-1',
          keywords: [],
          title: 'Run result'
        }
      ]
    })
  })
})
