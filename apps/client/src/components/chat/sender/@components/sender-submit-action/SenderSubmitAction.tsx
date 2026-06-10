/* eslint-disable max-lines -- submit action renders send, queue, stop, and permission-confirm states. */
import '../sender-toolbar/SenderSelectShared.scss'
import './SenderSubmitAction.scss'

import type { SessionQueuedMessageMode } from '@oneworks/core'
import { Button, Tooltip } from 'antd'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { ShortcutDisplay } from '#~/components/ShortcutDisplay'
import { ShortcutTooltip } from '#~/components/ShortcutTooltip'

const handleActionKeyDown = (event: KeyboardEvent<HTMLDivElement>, action?: () => void) => {
  if (action == null || (event.key !== 'Enter' && event.key !== ' ')) {
    return
  }

  event.preventDefault()
  action()
}

export function SenderSubmitAction({
  isInlineEdit,
  submitLoading,
  submitLabel,
  hasComposerContent,
  modelUnavailable,
  sendBlocked,
  sendBlockedTooltip,
  showConfirmInteractionAction,
  confirmInteractionLabel,
  isThinking,
  stopLoading,
  resolvedSendShortcut,
  queueSteerShortcut,
  queueNextShortcut,
  isMac,
  onCancel,
  onConfirmInteractionAction,
  onSend,
  onStop
}: {
  isInlineEdit: boolean
  submitLoading: boolean
  submitLabel?: string
  hasComposerContent: boolean
  modelUnavailable: boolean
  sendBlocked: boolean
  sendBlockedTooltip?: string
  showConfirmInteractionAction: boolean
  confirmInteractionLabel?: string
  isThinking: boolean
  stopLoading: boolean
  resolvedSendShortcut: string
  queueSteerShortcut?: string
  queueNextShortcut?: string
  isMac: boolean
  onCancel?: () => void
  onConfirmInteractionAction?: () => void
  onSend: (mode?: SessionQueuedMessageMode) => void
  onStop?: () => void
}) {
  const { t } = useTranslation()
  const showStopAction = isThinking && !hasComposerContent
  const isStopDisabled = showStopAction && stopLoading
  const isSendDisabled = !showStopAction && (modelUnavailable || sendBlocked || submitLoading)
  const handleSendClick = () => onSend()
  const stopAction = isStopDisabled ? undefined : onStop
  const sendAction = isSendDisabled ? undefined : handleSendClick
  const buttonClasses = [
    'chat-send-btn',
    hasComposerContent && !isSendDisabled ? 'active' : '',
    showStopAction ? 'stop' : '',
    isStopDisabled ? 'disabled' : '',
    isSendDisabled ? 'disabled' : '',
    sendBlocked ? 'blocked' : ''
  ].filter(Boolean).join(' ')
  const stopTooltipTitle = stopLoading
    ? t('chat.sessionStoppingMessage')
    : (
      <div className='sender-send-tooltip'>
        <div className='sender-send-tooltip__row'>
          <span className='sender-send-tooltip__label'>{t('chat.queue.stopShortcutTooltip')}</span>
          <ShortcutDisplay shortcut='esc' isMac={isMac} />
        </div>
      </div>
    )

  if (isInlineEdit) {
    return (
      <>
        {onCancel != null && (
          <Button autoInsertSpace={false} size='small' disabled={submitLoading} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button
          autoInsertSpace={false}
          type='primary'
          size='small'
          loading={submitLoading}
          disabled={!hasComposerContent}
          onClick={handleSendClick}
        >
          {submitLabel ?? t('chat.send')}
        </Button>
      </>
    )
  }

  if (isThinking) {
    if (showStopAction) {
      return (
        <Tooltip
          title={stopTooltipTitle}
          placement='top'
          classNames={{ root: 'sender-send-tooltip-popover' }}
          trigger={['hover']}
          mouseEnterDelay={.3}
          mouseLeaveDelay={.08}
        >
          <div className='sender-control-tooltip-target'>
            <div
              className={buttonClasses}
              role='button'
              tabIndex={isStopDisabled ? -1 : 0}
              aria-disabled={isStopDisabled || undefined}
              aria-label={stopLoading ? t('chat.sessionStoppingMessage') : t('chat.stop')}
              onClick={stopAction}
              onKeyDown={event => handleActionKeyDown(event, stopAction)}
            >
              <span className='material-symbols-rounded'>{stopLoading ? 'progress_activity' : 'stop_circle'}</span>
            </div>
          </div>
        </Tooltip>
      )
    }

    return (
      <Tooltip
        title={
          <div className='sender-send-tooltip'>
            <div className='sender-send-tooltip__row'>
              <span className='sender-send-tooltip__label'>{t('chat.queue.steerShortcutTooltip')}</span>
              <ShortcutDisplay shortcut={queueSteerShortcut} isMac={isMac} />
            </div>
            <div className='sender-send-tooltip__row'>
              <span className='sender-send-tooltip__label'>{t('chat.queue.nextShortcutTooltip')}</span>
              <ShortcutDisplay shortcut={queueNextShortcut} isMac={isMac} />
            </div>
          </div>
        }
        placement='top'
        classNames={{ root: 'sender-send-tooltip-popover' }}
        trigger={['hover']}
        mouseEnterDelay={.3}
        mouseLeaveDelay={.08}
      >
        <div className='sender-control-tooltip-target'>
          <div
            className={buttonClasses}
            role='button'
            tabIndex={isSendDisabled ? -1 : 0}
            aria-disabled={isSendDisabled || undefined}
            aria-label={t('chat.send')}
            onClick={sendAction}
            onKeyDown={event => handleActionKeyDown(event, sendAction)}
          >
            <span className='material-symbols-rounded'>send</span>
          </div>
        </div>
      </Tooltip>
    )
  }

  if (sendBlocked) {
    return (
      <>
        <Tooltip
          title={sendBlockedTooltip}
          placement='top'
          classNames={{ root: 'sender-send-tooltip-popover' }}
          trigger={['hover']}
          mouseEnterDelay={.3}
          mouseLeaveDelay={.08}
        >
          <div className='sender-control-tooltip-target'>
            <div
              className={buttonClasses}
              role='button'
              tabIndex={0}
              aria-label={t('chat.send')}
              onClick={handleSendClick}
              onKeyDown={event => handleActionKeyDown(event, handleSendClick)}
            >
              <span className='material-symbols-rounded'>send</span>
            </div>
          </div>
        </Tooltip>

        {showConfirmInteractionAction && onConfirmInteractionAction != null && (
          <Tooltip
            title={t('chat.permissionConfirmOptionTooltip')}
            placement='top'
            classNames={{ root: 'sender-send-tooltip-popover' }}
            trigger={['hover']}
            mouseEnterDelay={.3}
            mouseLeaveDelay={.08}
          >
            <Button
              autoInsertSpace={false}
              size='small'
              type='default'
              className='chat-confirm-btn'
              onClick={onConfirmInteractionAction}
            >
              <span className='material-symbols-rounded'>task_alt</span>
              <span>{confirmInteractionLabel ?? t('chat.permissionConfirmOption')}</span>
            </Button>
          </Tooltip>
        )}
      </>
    )
  }

  return (
    <ShortcutTooltip
      shortcut={resolvedSendShortcut}
      isMac={isMac}
      title={t('chat.sendShortcutTooltip')}
      targetClassName='sender-control-tooltip-target'
      enabled
    >
      <div
        className={buttonClasses}
        role='button'
        tabIndex={isSendDisabled ? -1 : 0}
        aria-disabled={isSendDisabled || undefined}
        aria-label={t('chat.send')}
        onClick={sendAction}
        onKeyDown={event => handleActionKeyDown(event, sendAction)}
      >
        <span className='material-symbols-rounded'>{submitLoading ? 'progress_activity' : 'send'}</span>
      </div>
    </ShortcutTooltip>
  )
}
