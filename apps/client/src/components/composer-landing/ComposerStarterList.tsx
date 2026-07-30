import './ComposerStarterList.scss'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import { InteractionList } from '#~/components/interaction-list'
import type { InteractionListItem } from '#~/components/interaction-list'

import { ComposerStarterListFooter } from './ComposerStarterListFooter'
import type { ComposerStarterListItem } from './composer-starter-list-items'
import {
  areComposerStarterKeyListsEqual,
  partitionComposerStarterListItems,
  readStoredComposerStarterKeys
} from './composer-starter-list-items'

const DEFAULT_VISIBLE_ITEM_COUNT = 3
const DEFAULT_MAX_RECENT_COUNT = 3

export interface ComposerStarterListLabels {
  emptySearch: string
  favorite: string
  recent: string
  searchPlaceholder: string
  showLess: string
  showMore: (count: number) => string
  unfavorite: string
}

export interface ComposerStarterListStorageKeys {
  favorites: string
  recent: string
}

export type ComposerStarterListSelectionResult =
  | boolean
  | void
  | Promise<boolean | void>

interface ComposerStarterInteractionItem<TValue> extends InteractionListItem {
  starter: ComposerStarterListItem<TValue>
}

export function ComposerStarterList<TValue>({
  className,
  defaultVisibleItemCount = DEFAULT_VISIBLE_ITEM_COUNT,
  disabled = false,
  items,
  labels,
  maxRecentCount = DEFAULT_MAX_RECENT_COUNT,
  storageKeys,
  onSelect
}: {
  className?: string
  defaultVisibleItemCount?: number
  disabled?: boolean
  items: Array<ComposerStarterListItem<TValue>>
  labels: ComposerStarterListLabels
  maxRecentCount?: number
  storageKeys?: ComposerStarterListStorageKeys
  onSelect: (
    item: ComposerStarterListItem<TValue>
  ) => ComposerStarterListSelectionResult
}) {
  const [favoriteKeys, setFavoriteKeys] = useState<string[]>(() => (
    readStoredComposerStarterKeys(storageKeys?.favorites)
  ))
  const [recentKeys, setRecentKeys] = useState<string[]>(() => (
    readStoredComposerStarterKeys(storageKeys?.recent)
  ))
  const [searchQuery, setSearchQuery] = useState('')
  const [showAllRemaining, setShowAllRemaining] = useState(false)
  const [searchPinnedHeight, setSearchPinnedHeight] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const visibleState = useMemo(
    () =>
      partitionComposerStarterListItems({
        favoriteKeys,
        items,
        maxRecentCount,
        query: searchQuery,
        recentKeys,
        remainingLimit: showAllRemaining ? items.length : defaultVisibleItemCount
      }),
    [defaultVisibleItemCount, favoriteKeys, items, maxRecentCount, recentKeys, searchQuery, showAllRemaining]
  )

  useEffect(() => {
    if (storageKeys == null) return
    try {
      localStorage.setItem(storageKeys.favorites, JSON.stringify(favoriteKeys))
      localStorage.setItem(storageKeys.recent, JSON.stringify(recentKeys))
    } catch {}
  }, [favoriteKeys, recentKeys, storageKeys])

  useEffect(() => {
    const validKeys = new Set(items.map(item => item.key))
    setFavoriteKeys((current) => {
      const next = current.filter(key => validKeys.has(key))
      return areComposerStarterKeyListsEqual(current, next) ? current : next
    })
    setRecentKeys((current) => {
      const next = current.filter(key => validKeys.has(key)).slice(0, maxRecentCount)
      return areComposerStarterKeyListsEqual(current, next) ? current : next
    })
  }, [items, maxRecentCount])

  useEffect(() => {
    setShowAllRemaining(false)
  }, [searchQuery])

  useEffect(() => {
    if (!visibleState.isSearchMode && searchPinnedHeight != null) setSearchPinnedHeight(null)
  }, [searchPinnedHeight, visibleState.isSearchMode])

  if (items.length === 0) return null

  const handleSearchChange = (nextQuery: string) => {
    if (searchQuery.length === 0 && nextQuery.length > 0) {
      const nextHeight = containerRef.current?.getBoundingClientRect().height
      if (nextHeight != null && Number.isFinite(nextHeight)) setSearchPinnedHeight(Math.round(nextHeight))
    }
    if (nextQuery.length === 0) setSearchPinnedHeight(null)
    setSearchQuery(nextQuery)
  }

  const handleToggleFavorite = (key: string) => {
    setFavoriteKeys(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])
  }

  const handleSelect = async (item: ComposerStarterListItem<TValue>) => {
    try {
      const selected = await onSelect(item)
      if (selected === false) return
      setRecentKeys(current => [item.key, ...current.filter(key => key !== item.key)].slice(0, maxRecentCount))
    } catch {}
  }

  const isExpanded = showAllRemaining && !visibleState.isSearchMode
  const visibleItems = [...visibleState.favorites, ...visibleState.visibleRemaining]
  const interactionItems: Array<ComposerStarterInteractionItem<TValue>> = visibleItems.map(item => ({
    badge: visibleState.recentKeys.includes(item.key) ? labels.recent : undefined,
    description: item.description,
    disabled,
    icon: item.icon,
    key: item.key,
    searchText: item.searchText,
    starter: item,
    title: item.title
  }))
  const style = visibleState.isSearchMode && searchPinnedHeight != null
    ? { minHeight: `${searchPinnedHeight}px` } as CSSProperties
    : undefined

  return (
    <div
      ref={containerRef}
      className={['composer-starter-list', isExpanded ? 'is-expanded' : '', className].filter(Boolean).join(' ')}
      aria-busy={disabled}
      style={style}
    >
      <InteractionList
        actionDisplay='inline'
        actions={item => [{
          disabled,
          icon: favoriteKeys.includes(item.key) ? 'star' : 'star_outline',
          key: 'favorite',
          label: favoriteKeys.includes(item.key) ? labels.unfavorite : labels.favorite,
          onSelect: () => handleToggleFavorite(item.key)
        }]}
        className='composer-starter-list__interaction-list'
        descriptionPlacement='titleHover'
        emptyText={labels.emptySearch}
        items={interactionItems}
        mode='resource'
        padding='none'
        search={{
          placeholder: labels.searchPlaceholder,
          value: searchQuery,
          onChange: handleSearchChange
        }}
        showItemDescription={false}
        splitActionHover
        onSelect={item => void handleSelect(item.starter)}
      />
      {!visibleState.isSearchMode && (
        <ComposerStarterListFooter
          defaultVisibleItemCount={defaultVisibleItemCount}
          disabled={disabled}
          hiddenRemainingCount={visibleState.hiddenRemainingCount}
          isExpanded={isExpanded}
          labels={labels}
          totalRemainingCount={visibleState.totalRemainingCount}
          onCollapse={() => setShowAllRemaining(false)}
          onExpand={() => setShowAllRemaining(true)}
        />
      )}
    </div>
  )
}
