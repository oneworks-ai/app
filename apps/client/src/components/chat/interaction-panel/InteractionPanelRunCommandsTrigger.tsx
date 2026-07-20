import { Button } from 'antd'
import { forwardRef, useRef } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { RouteHeaderActionGroup } from '@oneworks/components/route-layout'

import { getInteractionPanelRunCommandIcon, getInteractionPanelRunCommandTitle } from './interaction-panel-run-commands'
import type { InteractionPanelRunCommand, InteractionPanelRunCommandTaskStatus } from './interaction-panel-run-commands'

const EMPTY_RUN_COMMAND_TRIGGER_ICON = 'slideshow'

export interface InteractionPanelRunCommandsTriggerProps {
  children?: ReactNode
  command?: InteractionPanelRunCommand
  iconClassName: string
  taskStatus?: InteractionPanelRunCommandTaskStatus
  onTerminateTask?: (terminalId: string) => void
  onPrimaryClick: () => void
}

export const InteractionPanelRunCommandsTrigger = forwardRef<
  HTMLSpanElement,
  InteractionPanelRunCommandsTriggerProps
>(({
  children,
  command,
  iconClassName,
  taskStatus,
  onTerminateTask,
  onPrimaryClick
}, ref) => {
  const { t } = useTranslation()
  const primaryMouseHandledRef = useRef(false)
  const commandTitle = getInteractionPanelRunCommandTitle(command)
  const primaryLabel = command == null
    ? t('chat.interactionPanel.addRunCommand')
    : t('chat.interactionPanel.runCommandPrimary', { command: commandTitle })
  const shouldIgnorePrimaryMouseDown = (event: MouseEvent<HTMLElement>) =>
    (event.target as HTMLElement | null)?.closest('.chat-header-run-command-trigger__status') != null
  const handlePrimaryMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || shouldIgnorePrimaryMouseDown(event)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    primaryMouseHandledRef.current = true
    window.setTimeout(() => {
      primaryMouseHandledRef.current = false
    }, 0)
    onPrimaryClick()
  }
  const handlePrimaryClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    if (primaryMouseHandledRef.current) {
      return
    }

    onPrimaryClick()
  }

  return (
    <RouteHeaderActionGroup
      ref={ref}
      className={`chat-header-run-command-trigger ${children == null ? 'chat-header-run-command-trigger--solo' : ''}`
        .trim()}
      joined={children != null}
    >
      <span className='route-container-header__action-segment'>
        <Button
          type='text'
          className={[
            'route-container-header__action-button',
            command == null ? '' : 'route-container-header__action-button--content',
            'chat-header-run-command-trigger__primary'
          ].filter(Boolean).join(' ')}
          data-dock-panel-no-resize='true'
          title={primaryLabel}
          aria-label={primaryLabel}
          onMouseDown={handlePrimaryMouseDown}
          onClick={handlePrimaryClick}
        >
          <span className={iconClassName}>
            {command == null ? EMPTY_RUN_COMMAND_TRIGGER_ICON : getInteractionPanelRunCommandIcon(command)}
          </span>
          {command != null && (
            <span className='chat-header-run-command-trigger__title'>
              {commandTitle}
            </span>
          )}
          {taskStatus?.isRunning === true && (
            <span
              className='chat-header-run-command-trigger__status material-symbols-rounded'
              title={t('chat.interactionPanel.runTaskTerminate')}
              aria-label={t('chat.interactionPanel.runTaskTerminate')}
              onClick={(event) => {
                event.stopPropagation()
                onTerminateTask?.(taskStatus.terminalId)
              }}
            >
              stop_circle
            </span>
          )}
        </Button>
      </span>
      {children}
    </RouteHeaderActionGroup>
  )
})

InteractionPanelRunCommandsTrigger.displayName = 'InteractionPanelRunCommandsTrigger'
