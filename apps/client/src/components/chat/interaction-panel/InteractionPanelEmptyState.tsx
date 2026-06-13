import { Tooltip } from 'antd'
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
  openResourceShortcutLabel,
  onNewMobileDebugPage,
  onNewSession,
  onNewTerminal,
  onNewWebPage,
  onOpenResource
}: {
  canCreateSessionTab: boolean
  extraActions?: InteractionPanelEmptyAction[]
  openResourceShortcutLabel?: string
  onNewMobileDebugPage: () => void
  onNewSession: () => void
  onNewTerminal: () => void
  onNewWebPage: () => void
  onOpenResource: () => void
}) {
  const { t } = useTranslation()
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  const openResourceShortcut = useMemo(
    () => openResourceShortcutLabel ?? formatInteractionPanelShortcut(INTERACTION_PANEL_OPEN_FILE_SHORTCUT, isMac),
    [isMac, openResourceShortcutLabel]
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
          {actions.map((action) => {
            const description = action.description?.trim() ?? ''

            return (
              <Tooltip
                key={action.key}
                title={description !== '' ? description : undefined}
                placement='topLeft'
                mouseEnterDelay={.35}
              >
                <button
                  type='button'
                  className='chat-interaction-panel-empty__action'
                  onClick={action.onClick}
                >
                  <span className='material-symbols-rounded chat-interaction-panel-empty__action-icon'>
                    {action.icon}
                  </span>
                  <span className='chat-interaction-panel-empty__action-title'>{action.label}</span>
                  {action.shortcut != null && action.shortcut !== '' && (
                    <span className='chat-interaction-panel-empty__shortcut'>{action.shortcut}</span>
                  )}
                </button>
              </Tooltip>
            )
          })}
        </section>
      </div>
    </div>
  )
}
