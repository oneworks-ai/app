import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  INTERACTION_PANEL_NEW_IFRAME_SHORTCUT,
  INTERACTION_PANEL_NEW_TERMINAL_SHORTCUT,
  INTERACTION_PANEL_OPEN_FILE_SHORTCUT,
  formatInteractionPanelShortcut
} from './interaction-panel-shortcuts'

export interface InteractionPanelEmptyAction {
  description?: string
  icon: string
  key: string
  label: string
  onClick: () => void
  shortcut?: string
}

export function InteractionPanelEmptyState({
  canCreateSessionTab,
  extraActions = [],
  onNewMobileDebugPage,
  onNewSession,
  onNewTerminal,
  onNewWebPage,
  onOpenResource
}: {
  canCreateSessionTab: boolean
  extraActions?: InteractionPanelEmptyAction[]
  onNewMobileDebugPage: () => void
  onNewSession: () => void
  onNewTerminal: () => void
  onNewWebPage: () => void
  onOpenResource: () => void
}) {
  const { t } = useTranslation()
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  const openResourceShortcut = useMemo(
    () => formatInteractionPanelShortcut(INTERACTION_PANEL_OPEN_FILE_SHORTCUT, isMac),
    [isMac]
  )
  const newTerminalShortcut = useMemo(
    () => formatInteractionPanelShortcut(INTERACTION_PANEL_NEW_TERMINAL_SHORTCUT, isMac),
    [isMac]
  )
  const newIframeShortcut = useMemo(
    () => formatInteractionPanelShortcut(INTERACTION_PANEL_NEW_IFRAME_SHORTCUT, isMac),
    [isMac]
  )
  const actions: InteractionPanelEmptyAction[] = [
    {
      description: t('chat.interactionPanel.openResourceDescription'),
      icon: 'pageview',
      key: 'open-resource',
      label: t('chat.interactionPanel.openResource'),
      onClick: onOpenResource,
      shortcut: openResourceShortcut
    },
    {
      description: t('chat.interactionPanel.addTerminalDescription'),
      icon: 'terminal',
      key: 'new-terminal',
      label: t('chat.terminal.addSession'),
      onClick: onNewTerminal,
      shortcut: newTerminalShortcut
    },
    ...(canCreateSessionTab
      ? [{
        description: t('chat.interactionPanel.addSessionDescription'),
        icon: 'chat',
        key: 'new-session',
        label: t('chat.interactionPanel.addSession'),
        onClick: onNewSession,
        shortcut: ''
      }]
      : []),
    {
      description: t('chat.interactionPanel.addIframeDescription'),
      icon: 'language',
      key: 'new-web-page',
      label: t('chat.interactionPanel.addIframe'),
      onClick: onNewWebPage,
      shortcut: newIframeShortcut
    },
    {
      description: t('chat.interactionPanel.addMobileDebugDescription'),
      icon: 'phonelink_setup',
      key: 'new-mobile-debug',
      label: t('chat.interactionPanel.addMobileDebug'),
      onClick: onNewMobileDebugPage,
      shortcut: ''
    },
    ...extraActions
  ]

  return (
    <div className='chat-interaction-panel-empty'>
      <div className='chat-interaction-panel-empty__content'>
        <section className='chat-interaction-panel-empty__section' aria-label={t('chat.interactionPanel.emptyStart')}>
          {actions.map(action => (
            <button
              key={action.key}
              type='button'
              className='chat-interaction-panel-empty__action'
              onClick={action.onClick}
            >
              <span className='chat-interaction-panel-empty__action-header'>
                <span className='material-symbols-rounded'>{action.icon}</span>
                <span className='chat-interaction-panel-empty__action-title'>{action.label}</span>
              </span>
              <span className='chat-interaction-panel-empty__action-description'>
                {action.description}
              </span>
              <span className='chat-interaction-panel-empty__action-footer'>
                <span />
                <span className='chat-interaction-panel-empty__shortcut'>{action.shortcut}</span>
              </span>
            </button>
          ))}
        </section>
      </div>
    </div>
  )
}
