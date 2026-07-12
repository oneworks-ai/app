import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ComposerStarterGuide } from '#~/components/composer-landing/ComposerStarterGuide'
import type { ComposerStarterListLabels } from '#~/components/composer-landing/ComposerStarterList'
import type { ComposerStarterListItem } from '#~/components/composer-landing/composer-starter-list-items'

const PLUGIN_STARTER_STORAGE_KEYS = {
  favorites: 'oneworks_plugin_starter_favorites',
  recent: 'oneworks_plugin_starter_recent'
}

export function PluginCreateGuide({
  composer,
  onSelectStarter
}: {
  composer: ReactNode
  onSelectStarter: (prompt: string) => void
}) {
  const { t } = useTranslation()
  const starterItems = useMemo<Array<ComposerStarterListItem<string>>>(() => [
    {
      description: t('pluginStore.starterChatActionDescription'),
      icon: 'add_comment',
      key: 'chat-action',
      order: 0,
      searchText: [
        t('pluginStore.starterChatActionTitle'),
        t('pluginStore.starterChatActionDescription'),
        t('pluginStore.starterChatActionPrompt')
      ].join(' '),
      title: t('pluginStore.starterChatActionTitle'),
      value: t('pluginStore.starterChatActionPrompt')
    },
    {
      description: t('pluginStore.starterLauncherDescription'),
      icon: 'manage_search',
      key: 'launcher-search',
      order: 1,
      searchText: [
        t('pluginStore.starterLauncherTitle'),
        t('pluginStore.starterLauncherDescription'),
        t('pluginStore.starterLauncherPrompt')
      ].join(' '),
      title: t('pluginStore.starterLauncherTitle'),
      value: t('pluginStore.starterLauncherPrompt')
    },
    {
      description: t('pluginStore.starterWorkbenchDescription'),
      icon: 'tab',
      key: 'workbench-panel',
      order: 2,
      searchText: [
        t('pluginStore.starterWorkbenchTitle'),
        t('pluginStore.starterWorkbenchDescription'),
        t('pluginStore.starterWorkbenchPrompt')
      ].join(' '),
      title: t('pluginStore.starterWorkbenchTitle'),
      value: t('pluginStore.starterWorkbenchPrompt')
    },
    {
      description: t('pluginStore.starterRouteDescription'),
      icon: 'route',
      key: 'plugin-route',
      order: 3,
      searchText: [
        t('pluginStore.starterRouteTitle'),
        t('pluginStore.starterRouteDescription'),
        t('pluginStore.starterRoutePrompt')
      ].join(' '),
      title: t('pluginStore.starterRouteTitle'),
      value: t('pluginStore.starterRoutePrompt')
    }
  ], [t])
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
    <ComposerStarterGuide
      className='plugin-create-guide'
      composer={composer}
      description={t('pluginStore.createLandingDescription')}
      icon='extension'
      items={starterItems}
      labels={labels}
      storageKeys={PLUGIN_STARTER_STORAGE_KEYS}
      onSelect={item => onSelectStarter(item.value)}
    />
  )
}
