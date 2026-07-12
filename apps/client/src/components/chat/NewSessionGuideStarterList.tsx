import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { ConversationStarterConfig } from '@oneworks/types'

import { ComposerStarterList } from '#~/components/composer-landing/ComposerStarterList'
import type { ComposerStarterListLabels } from '#~/components/composer-landing/ComposerStarterList'
import type { ComposerStarterListItem } from '#~/components/composer-landing/composer-starter-list-items'

import {
  buildConversationStarterListItems,
  buildConversationStarterSearchText,
  normalizeConversationStarterMode
} from './new-session-guide-config'

const NEW_SESSION_STARTER_STORAGE_KEYS = {
  favorites: 'oneworks_new_session_guide_favorites',
  recent: 'oneworks_new_session_guide_recent'
}

const trimText = (value: string | undefined) => value?.trim() ?? ''

const resolveStarterIcon = (starter: ConversationStarterConfig) => {
  const customIcon = trimText(starter.icon)
  if (customIcon !== '') return customIcon

  switch (normalizeConversationStarterMode(starter.mode)) {
    case 'workspace':
      return 'workspaces'
    case 'entity':
      return 'group_work'
    case 'spec':
      return 'account_tree'
    default:
      return 'bolt'
  }
}

export function NewSessionGuideStarterList({
  startupPresets,
  builtinActions,
  onApplyStarter
}: {
  startupPresets: ConversationStarterConfig[]
  builtinActions: ConversationStarterConfig[]
  onApplyStarter: (starter: ConversationStarterConfig) => void
}) {
  const { t } = useTranslation()
  const items = useMemo<Array<ComposerStarterListItem<ConversationStarterConfig>>>(() => (
    buildConversationStarterListItems(startupPresets, builtinActions).map((item) => {
      const fallbackPrefix = item.source === 'builtinActions'
        ? t('chat.newSessionGuide.fallbackActionPrefix')
        : t('chat.newSessionGuide.fallbackPresetPrefix')
      const title = trimText(item.starter.title) || `${fallbackPrefix} #${item.sourceIndex + 1}`

      return {
        description: trimText(item.starter.description) || undefined,
        icon: resolveStarterIcon(item.starter),
        key: item.key,
        order: item.order,
        searchText: buildConversationStarterSearchText(item),
        title,
        value: item.starter
      }
    })
  ), [builtinActions, startupPresets, t])
  const labels = useMemo<ComposerStarterListLabels>(() => ({
    emptySearch: t('chat.newSessionGuide.emptySearch'),
    favorite: t('chat.newSessionGuide.favoriteAction'),
    recent: t('chat.newSessionGuide.recentTitle'),
    searchPlaceholder: t('chat.newSessionGuide.searchPlaceholder'),
    showLess: t('chat.newSessionGuide.showLess'),
    showMore: count => t('chat.newSessionGuide.showMore', { count }),
    unfavorite: t('chat.newSessionGuide.unfavoriteAction')
  }), [t])

  return (
    <ComposerStarterList
      items={items}
      labels={labels}
      storageKeys={NEW_SESSION_STARTER_STORAGE_KEYS}
      onSelect={item => onApplyStarter(item.value)}
    />
  )
}
