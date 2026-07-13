import React from 'react'

import {
  KNOWLEDGE_ASSET_PAGE_SIZE,
  filterKnowledgeAssetsByScope,
  paginateKnowledgeAssets
} from './knowledge-asset-list-utils'
import type { KnowledgeAssetScope } from './knowledge-asset-list-utils'

export function useKnowledgeAssetList<T extends { source?: KnowledgeAssetScope }>(
  items: T[],
  filteredItems: T[],
  resetKey: string
) {
  const [scope, setScope] = React.useState<KnowledgeAssetScope>('project')
  const [page, setPage] = React.useState(1)
  const scopedItems = React.useMemo(
    () => filterKnowledgeAssetsByScope(items, scope),
    [items, scope]
  )
  const scopedFilteredItems = React.useMemo(
    () => filterKnowledgeAssetsByScope(filteredItems, scope),
    [filteredItems, scope]
  )
  const maxPage = Math.max(1, Math.ceil(scopedFilteredItems.length / KNOWLEDGE_ASSET_PAGE_SIZE))
  const currentPage = Math.min(page, maxPage)
  const visibleItems = React.useMemo(
    () => paginateKnowledgeAssets(scopedFilteredItems, currentPage),
    [currentPage, scopedFilteredItems]
  )

  React.useEffect(() => {
    if (page !== currentPage) setPage(currentPage)
  }, [currentPage, page])

  React.useEffect(() => setPage(1), [resetKey])

  const changeScope = React.useCallback((value: KnowledgeAssetScope) => {
    setScope(value)
    setPage(1)
  }, [])

  return {
    changeScope,
    currentPage,
    pageResetKey: `${scope}:${resetKey}`,
    scope,
    scopedItems,
    setPage,
    total: scopedFilteredItems.length,
    visibleItems
  }
}
