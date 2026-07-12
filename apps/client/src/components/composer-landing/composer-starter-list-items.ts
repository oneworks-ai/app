import type { IconAsset } from '#~/components/icons/IconAsset'

export interface ComposerStarterListItem<TValue = unknown> {
  description?: string
  icon: IconAsset
  key: string
  order: number
  searchText: string
  title: string
  value: TValue
}

export interface PartitionComposerStarterListItemsResult<TItem> {
  favorites: TItem[]
  hiddenRemainingCount: number
  isSearchMode: boolean
  recentKeys: string[]
  totalRemainingCount: number
  visibleRemaining: TItem[]
}

export const readStoredComposerStarterKeys = (storageKey: string | undefined) => {
  if (storageKey == null) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export const areComposerStarterKeyListsEqual = (left: string[], right: string[]) => (
  left.length === right.length && left.every((value, index) => value === right[index])
)

interface KeyedSearchItem {
  key: string
  order: number
  searchText: string
}

const filterUniqueStrings = (values: string[]) => Array.from(new Set(values))

const collectVisibleRecentKeys = (
  recentKeys: string[],
  validKeys: Set<string>,
  limit: number
) => {
  if (limit <= 0) return []

  const visibleKeys: string[] = []

  for (const key of filterUniqueStrings(recentKeys)) {
    if (!validKeys.has(key)) continue

    visibleKeys.push(key)
    if (visibleKeys.length >= limit) break
  }

  return visibleKeys
}

const orderItemsByPriorityKeys = <TItem extends KeyedSearchItem>(
  items: TItem[],
  priorityKeys: string[]
) => {
  if (priorityKeys.length === 0) return items

  const priorityMap = new Map(priorityKeys.map((key, index) => [key, index]))

  return [...items].sort((left, right) => {
    const leftPriority = priorityMap.get(left.key)
    const rightPriority = priorityMap.get(right.key)

    if (leftPriority != null && rightPriority != null) return leftPriority - rightPriority
    if (leftPriority != null) return -1
    if (rightPriority != null) return 1
    return left.order - right.order
  })
}

export const partitionComposerStarterListItems = <TItem extends KeyedSearchItem>({
  favoriteKeys,
  items,
  maxRecentCount,
  query,
  recentKeys,
  remainingLimit
}: {
  favoriteKeys: string[]
  items: TItem[]
  maxRecentCount: number
  query: string
  recentKeys: string[]
  remainingLimit: number
}): PartitionComposerStarterListItemsResult<TItem> => {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery !== '') {
    const searchTerms = normalizedQuery.split(/\s+/).filter(Boolean)
    const matchedItems = items.filter((item) => {
      const searchText = item.searchText.toLowerCase()
      return searchTerms.every(term => searchText.includes(term))
    })

    return {
      favorites: [],
      hiddenRemainingCount: 0,
      isSearchMode: true,
      recentKeys: [],
      totalRemainingCount: matchedItems.length,
      visibleRemaining: matchedItems
    }
  }

  const favoriteSet = new Set(filterUniqueStrings(favoriteKeys))
  const itemByKey = new Map(items.map(item => [item.key, item]))
  const recentKeysByPriority = collectVisibleRecentKeys(
    recentKeys,
    new Set(itemByKey.keys()),
    maxRecentCount
  )
  const favoriteItems = orderItemsByPriorityKeys(
    items.filter(item => favoriteSet.has(item.key)),
    recentKeysByPriority
  )
  const favoriteKeySet = new Set(favoriteItems.map(item => item.key))
  const recentRemainingKeys = recentKeysByPriority.filter(key => !favoriteKeySet.has(key))
  const excludedKeySet = new Set([...favoriteKeySet, ...recentRemainingKeys])
  const remaining = items.filter(item => !excludedKeySet.has(item.key))
  const orderedRemainingItems = [
    ...recentRemainingKeys.map(key => itemByKey.get(key)).filter((item): item is TItem => item != null),
    ...remaining
  ]
  const safeLimit = Math.max(0, remainingLimit)

  return {
    favorites: favoriteItems,
    hiddenRemainingCount: Math.max(0, orderedRemainingItems.length - safeLimit),
    isSearchMode: false,
    recentKeys: recentKeysByPriority,
    totalRemainingCount: orderedRemainingItems.length,
    visibleRemaining: orderedRemainingItems.slice(0, safeLimit)
  }
}
