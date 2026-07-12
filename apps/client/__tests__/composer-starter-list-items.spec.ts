import { describe, expect, it } from 'vitest'

import { partitionComposerStarterListItems } from '#~/components/composer-landing/composer-starter-list-items'

const items = [
  { key: 'daily', order: 0, searchText: 'daily project brief morning' },
  { key: 'health', order: 1, searchText: 'scheduled health check tests' },
  { key: 'weekly', order: 2, searchText: 'weekly review friday' },
  { key: 'reminder', order: 3, searchText: 'important reminder todos' }
]

describe('composer starter list items', () => {
  it('prioritizes favorites and recent items before applying the visible limit', () => {
    expect(partitionComposerStarterListItems({
      favoriteKeys: ['weekly'],
      items,
      maxRecentCount: 3,
      query: '',
      recentKeys: ['health', 'weekly'],
      remainingLimit: 2
    })).toEqual({
      favorites: [items[2]],
      hiddenRemainingCount: 1,
      isSearchMode: false,
      recentKeys: ['health', 'weekly'],
      totalRemainingCount: 3,
      visibleRemaining: [items[1], items[0]]
    })
  })

  it('searches all items without applying the collapsed limit', () => {
    expect(
      partitionComposerStarterListItems({
        favoriteKeys: [],
        items,
        maxRecentCount: 3,
        query: 'health tests',
        recentKeys: [],
        remainingLimit: 1
      }).visibleRemaining
    ).toEqual([items[1]])
  })
})
