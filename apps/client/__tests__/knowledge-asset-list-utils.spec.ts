import { describe, expect, it } from 'vitest'

import {
  KNOWLEDGE_ASSET_PAGE_SIZE,
  filterKnowledgeAssetsByScope,
  paginateKnowledgeAssets
} from '#~/components/knowledge-base/components/knowledge-asset-list-utils'

describe('knowledge asset list helpers', () => {
  it('separates project and plugin assets and keeps legacy assets in project', () => {
    const assets = [
      { id: 'project', source: 'project' as const },
      { id: 'plugin', source: 'plugin' as const },
      { id: 'legacy' }
    ]

    expect(filterKnowledgeAssetsByScope(assets, 'project').map(item => item.id)).toEqual([
      'project',
      'legacy'
    ])
    expect(filterKnowledgeAssetsByScope(assets, 'plugin').map(item => item.id)).toEqual([
      'plugin'
    ])
  })

  it('uses fixed twenty-item pages', () => {
    const assets = Array.from({ length: 42 }, (_, index) => index)

    expect(KNOWLEDGE_ASSET_PAGE_SIZE).toBe(20)
    expect(paginateKnowledgeAssets(assets, 1)).toEqual(assets.slice(0, 20))
    expect(paginateKnowledgeAssets(assets, 3)).toEqual(assets.slice(40, 42))
  })
})
