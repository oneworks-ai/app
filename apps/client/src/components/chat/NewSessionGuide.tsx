import './NewSessionGuide.scss'

import { useAtom, useAtomValue } from 'jotai'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { ConversationStarterConfig } from '@oneworks/types'

import { MarkdownContent } from '#~/components/MarkdownContent'
import { ComposerStarterLayout } from '#~/components/composer-landing/ComposerStarterLayout'
import { showAnnouncementsAtom, showNewSessionStarterListAtom } from '#~/store/index.js'

import { NewSessionGuideStarterList } from './NewSessionGuideStarterList'

export function NewSessionGuide({
  announcements,
  startupPresets,
  builtinActions,
  composer,
  onApplyStarter
}: {
  announcements: string[]
  startupPresets: ConversationStarterConfig[]
  builtinActions: ConversationStarterConfig[]
  composer: ReactNode
  onApplyStarter: (starter: ConversationStarterConfig) => void
}) {
  const { t } = useTranslation()
  const [showAnnouncements, setShowAnnouncements] = useAtom(showAnnouncementsAtom)
  const showNewSessionStarterList = useAtomValue(showNewSessionStarterListAtom)
  const hasConfiguredAnnouncements = announcements.length > 0
  const visibleAnnouncements = hasConfiguredAnnouncements
    ? showAnnouncements ? announcements : []
    : [t('chat.newSessionGuide.welcomeMessage')]
  const visibleStartupPresets = showNewSessionStarterList ? startupPresets : []
  const visibleBuiltinActions = showNewSessionStarterList ? builtinActions : []
  const hasStarterList = visibleStartupPresets.length > 0 || visibleBuiltinActions.length > 0

  return (
    <ComposerStarterLayout
      className='new-session-guide'
      composer={composer}
      contentClassName='new-session-guide__content'
      introduction={visibleAnnouncements.length > 0
        ? (
          <>
            <div className='new-session-guide__announcements-list'>
              {visibleAnnouncements.map((item, index) => (
                <div key={`${item}-${index}`} className='new-session-guide__announcements-item'>
                  <span className='material-symbols-rounded new-session-guide__announcements-icon'>
                    {hasConfiguredAnnouncements ? 'campaign' : 'waving_hand'}
                  </span>
                  <div className='new-session-guide__announcements-copy'>
                    <MarkdownContent content={item} />
                  </div>
                </div>
              ))}
            </div>
            {hasConfiguredAnnouncements && (
              <button
                type='button'
                className='new-session-guide__announcements-close'
                onClick={() => setShowAnnouncements(false)}
              >
                <span className='material-symbols-rounded'>close</span>
              </button>
            )}
          </>
        )
        : undefined}
      introductionClassName='new-session-guide__announcements'
      main={hasStarterList
        ? (
          <NewSessionGuideStarterList
            startupPresets={visibleStartupPresets}
            builtinActions={visibleBuiltinActions}
            onApplyStarter={onApplyStarter}
          />
        )
        : undefined}
      mainClassName='new-session-guide__main'
      composerClassName='new-session-guide__composer'
    />
  )
}
