import type { ConfigResponse, ConversationStarterConfig } from '@oneworks/types'

import { partitionComposerStarterListItems } from '#~/components/composer-landing/composer-starter-list-items'

export interface NewSessionGuideData {
  announcements: string[]
  startupPresets: ConversationStarterConfig[]
  builtinActions: ConversationStarterConfig[]
}

export type ConversationStarterCollectionKey = 'startupPresets' | 'builtinActions'

export interface ConversationStarterListItem {
  key: string
  order: number
  source: ConversationStarterCollectionKey
  sourceIndex: number
  starter: ConversationStarterConfig
}

export interface PartitionConversationStarterListItemsResult {
  favorites: ConversationStarterListItem[]
  isSearchMode: boolean
  recentKeys: string[]
  visibleRemaining: ConversationStarterListItem[]
  totalRemainingCount: number
  hiddenRemainingCount: number
}

const trimText = (value: string | undefined) => value?.trim() ?? ''

export const getNewSessionGuideData = (configRes?: ConfigResponse): NewSessionGuideData => {
  const general = configRes?.sources?.merged?.general
  const conversation = configRes?.sources?.merged?.conversation

  return {
    announcements: general?.announcements ?? [],
    startupPresets: conversation?.startupPresets ?? [],
    builtinActions: conversation?.builtinActions ?? []
  }
}

const buildConversationStarterListItemKey = (
  starter: ConversationStarterConfig,
  source: ConversationStarterCollectionKey,
  sourceIndex: number
) => {
  const id = trimText(starter.id)
  if (id !== '') {
    return `${source}:${id}`
  }

  const fingerprint = [
    trimText(starter.title),
    trimText(starter.target),
    trimText(starter.prompt)
  ].filter(value => value !== '')

  if (fingerprint.length > 0) {
    return `${source}:${fingerprint.join('|')}`
  }

  return `${source}:index:${sourceIndex}`
}

export const buildConversationStarterListItems = (
  startupPresets: ConversationStarterConfig[],
  builtinActions: ConversationStarterConfig[]
): ConversationStarterListItem[] => {
  let order = 0

  return [
    ...startupPresets.map((starter, sourceIndex) => ({
      key: buildConversationStarterListItemKey(starter, 'startupPresets', sourceIndex),
      order: order++,
      source: 'startupPresets' as const,
      sourceIndex,
      starter
    })),
    ...builtinActions.map((starter, sourceIndex) => ({
      key: buildConversationStarterListItemKey(starter, 'builtinActions', sourceIndex),
      order: order++,
      source: 'builtinActions' as const,
      sourceIndex,
      starter
    }))
  ]
}

export const buildConversationStarterSearchText = (item: ConversationStarterListItem) => {
  const { starter } = item

  return [
    trimText(starter.title),
    trimText(starter.description),
    trimText(starter.prompt),
    trimText(starter.target),
    trimText(starter.targetLabel),
    trimText(starter.targetDescription),
    trimText(starter.model),
    ...(starter.files?.map(path => trimText(path)) ?? []),
    ...(starter.rules?.map(rule => trimText(rule)) ?? []),
    ...(starter.skills?.map(skill => trimText(skill)) ?? [])
  ]
    .filter(value => value !== '')
    .join(' ')
    .toLowerCase()
}

export const partitionConversationStarterListItems = ({
  items,
  favoriteKeys,
  recentKeys,
  query,
  remainingLimit
}: {
  items: ConversationStarterListItem[]
  favoriteKeys: string[]
  recentKeys: string[]
  query: string
  remainingLimit: number
}): PartitionConversationStarterListItemsResult => {
  const partitioned = partitionComposerStarterListItems({
    favoriteKeys,
    items: items.map(item => ({
      item,
      key: item.key,
      order: item.order,
      searchText: buildConversationStarterSearchText(item)
    })),
    maxRecentCount: 3,
    query,
    recentKeys,
    remainingLimit
  })

  return {
    ...partitioned,
    favorites: partitioned.favorites.map(item => item.item),
    visibleRemaining: partitioned.visibleRemaining.map(item => item.item)
  }
}
