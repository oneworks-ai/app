import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ComposerStarterGuide } from '#~/components/composer-landing/ComposerStarterGuide'
import type { ComposerStarterListLabels } from '#~/components/composer-landing/ComposerStarterList'
import type { ComposerStarterListItem } from '#~/components/composer-landing/composer-starter-list-items'

const AUTOMATION_STARTER_STORAGE_KEYS = {
  favorites: 'oneworks_automation_starter_favorites',
  recent: 'oneworks_automation_starter_recent'
}

interface AutomationEmptyGuideProps {
  composer: ReactNode
  onSelectStarter: (prompt: string) => void
}

export function AutomationEmptyGuide({ composer, onSelectStarter }: AutomationEmptyGuideProps) {
  const { t } = useTranslation()
  const starterItems = useMemo<Array<ComposerStarterListItem<string>>>(() => [
    {
      key: 'daily-project-brief',
      order: 0,
      icon: 'wb_sunny',
      title: t('automation.starterDailyTitle'),
      description: t('automation.starterDailyDescription'),
      searchText: [
        t('automation.starterDailyTitle'),
        t('automation.starterDailyDescription'),
        t('automation.starterDailyPrompt')
      ].join(' '),
      value: t('automation.starterDailyPrompt')
    },
    {
      key: 'scheduled-health-check',
      order: 1,
      icon: 'bug_report',
      title: t('automation.starterHealthTitle'),
      description: t('automation.starterHealthDescription'),
      searchText: [
        t('automation.starterHealthTitle'),
        t('automation.starterHealthDescription'),
        t('automation.starterHealthPrompt')
      ].join(' '),
      value: t('automation.starterHealthPrompt')
    },
    {
      key: 'weekly-review',
      order: 2,
      icon: 'summarize',
      title: t('automation.starterWeeklyTitle'),
      description: t('automation.starterWeeklyDescription'),
      searchText: [
        t('automation.starterWeeklyTitle'),
        t('automation.starterWeeklyDescription'),
        t('automation.starterWeeklyPrompt')
      ].join(' '),
      value: t('automation.starterWeeklyPrompt')
    },
    {
      key: 'important-reminder',
      order: 3,
      icon: 'notifications_active',
      title: t('automation.starterReminderTitle'),
      description: t('automation.starterReminderDescription'),
      searchText: [
        t('automation.starterReminderTitle'),
        t('automation.starterReminderDescription'),
        t('automation.starterReminderPrompt')
      ].join(' '),
      value: t('automation.starterReminderPrompt')
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
      className='automation-empty-guide'
      composer={composer}
      description={t('automation.emptyLandingDescription')}
      icon='schedule'
      items={starterItems}
      labels={labels}
      storageKeys={AUTOMATION_STARTER_STORAGE_KEYS}
      onSelect={item => onSelectStarter(item.value)}
    />
  )
}
