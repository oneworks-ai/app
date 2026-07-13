export type KnowledgeAssetScope = 'project' | 'plugin'

export const KNOWLEDGE_ASSET_PAGE_SIZE = 20

export const filterKnowledgeAssetsByScope = <T extends { source?: KnowledgeAssetScope }>(
  items: T[],
  scope: KnowledgeAssetScope
) => items.filter(item => (item.source === 'plugin' ? 'plugin' : 'project') === scope)

export const paginateKnowledgeAssets = <T>(
  items: T[],
  page: number,
  pageSize = KNOWLEDGE_ASSET_PAGE_SIZE
) => {
  const normalizedPage = Math.max(1, page)
  const offset = (normalizedPage - 1) * pageSize
  return items.slice(offset, offset + pageSize)
}
