import './MessageStatusNotice.scss'

import { App, Button } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getApiErrorMessage } from '#~/api/base'
import {
  openSessionProjectConfig,
  retrySessionProjectConfig
} from '#~/api/sessions'

import type { ChatHistoryStatusNotice } from './build-chat-history-status-notices'
import { createScopedProjectConfigRecoveryActions } from './project-config-recovery-actions'

export function MessageStatusNotice({
  notice,
  sessionId,
  onRetryConnection,
  onRetrySessionCreation
}: {
  notice: ChatHistoryStatusNotice
  sessionId?: string
  onRetryConnection: () => void
  onRetrySessionCreation?: () => void
}) {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const actionLabel = notice.action === 'retry-session-creation'
    ? t('chat.retrySessionCreation')
    : t('chat.retryConnection')
  const handleAction = notice.action === 'retry-session-creation'
    ? onRetrySessionCreation
    : onRetryConnection
  const noticeMessage = notice.message.trim()
  const recovery = notice.projectConfigRecovery
  const operationScope = [
    sessionId ?? '',
    recovery?.workspaceFolder ?? '',
    recovery?.failureEventId ?? '',
    recovery?.failureEventSeq ?? ''
  ].join('\0')
  const rootRef = useRef<HTMLDivElement>(null)
  const scopeRef = useRef(operationScope)
  const pendingRef = useRef<'confirm' | 'open' | 'retry' | null>(null)
  const confirmationDestroyRef = useRef<(() => void) | undefined>(undefined)
  const [pending, setPending] = useState<'confirm' | 'open' | 'retry' | null>(null)
  if (scopeRef.current !== operationScope) {
    scopeRef.current = operationScope
    pendingRef.current = null
  }
  useEffect(() => {
    pendingRef.current = null
    setPending(null)
    return () => {
      if (scopeRef.current === operationScope) {
        scopeRef.current = `${operationScope}\0disposed`
        pendingRef.current = null
      }
      confirmationDestroyRef.current?.()
      confirmationDestroyRef.current = undefined
    }
  }, [operationScope])

  const setScopedPending = (
    scope: string,
    value: typeof pending
  ) => {
    if (scopeRef.current !== scope) return
    pendingRef.current = value
    setPending(value)
  }
  const focusRecoveryAction = (action: 'open' | 'retry') => {
    rootRef.current
      ?.querySelector<HTMLButtonElement>(`[data-recovery-action="${action}"]`)
      ?.focus()
  }
  const recoveryActions = sessionId == null || recovery == null || recovery.sessionId !== sessionId
    ? undefined
    : createScopedProjectConfigRecoveryActions({
        confirm: confirmation => {
          const confirmationScope = operationScope
          const closeConfirmation = () => {
            confirmationDestroyRef.current?.()
            confirmationDestroyRef.current = undefined
            if (scopeRef.current === confirmationScope) {
              focusRecoveryAction('retry')
            }
          }
          const instance = modal.confirm({
            title: t('chat.projectConfigRecovery.confirmTitle'),
            content: t('chat.projectConfigRecovery.confirmDescription'),
            okText: t('chat.projectConfigRecovery.retryGlobal'),
            cancelText: t('common.cancel'),
            onCancel: () => {
              confirmation.onCancel()
              closeConfirmation()
            },
            onOk: async () => {
              await confirmation.onOk()
              closeConfirmation()
            }
          })
          confirmationDestroyRef.current = instance.destroy
        },
        focus: focusRecoveryAction,
        getCurrentScope: () => scopeRef.current,
        getPending: () => pendingRef.current,
        onError: (action, error) => {
          void message.error(getApiErrorMessage(
            error,
            t(action === 'open'
              ? 'chat.projectConfigRecovery.openFailed'
              : 'chat.projectConfigRecovery.retryFailed')
          ))
        },
        onSuccess: result => {
          void message.success(
            result.reason === 'already_queued'
              ? t('chat.projectConfigRecovery.alreadyQueued')
              : t('chat.projectConfigRecovery.queued')
          )
        },
        open: openSessionProjectConfig,
        retry: retrySessionProjectConfig,
        scope: operationScope,
        sessionId,
        setPending: value => setScopedPending(operationScope, value)
      })

  return (
    <div
      className={`message-status-notice message-status-notice--${notice.tone}`}
      ref={rootRef}
    >
      <div
        className='message-status-notice__card'
        role='status'
        aria-busy={pending != null}
        aria-live='polite'
      >
        <div className='message-status-notice__content'>
          <span className='material-symbols-rounded message-status-notice__icon'>{notice.icon}</span>
          <div className='message-status-notice__body'>
            <div className='message-status-notice__header'>
              <div className='message-status-notice__title-row'>
                <div className='message-status-notice__title'>{notice.title}</div>
              </div>
              {notice.meta != null && notice.meta !== '' && (
                <span className='message-status-notice__meta'>{notice.meta}</span>
              )}
            </div>
            {noticeMessage !== '' && (
              <div className='message-status-notice__message'>{notice.message}</div>
            )}
            {notice.detail != null && notice.detail !== '' && (
              <div className='message-status-notice__detail'>{notice.detail}</div>
            )}
            {notice.action != null && handleAction != null && (
              <div className='message-status-notice__actions'>
                <Button size='small' disabled={pending != null} onClick={handleAction}>
                  {actionLabel}
                </Button>
              </div>
            )}
            {recovery != null && sessionId != null && recovery.sessionId === sessionId && (
              <div className='message-status-notice__actions'>
                <Button
                  data-recovery-action='open'
                  size='small'
                  disabled={pending != null}
                  loading={pending === 'open'}
                  onClick={() => void recoveryActions?.open()}
                >
                  {t('chat.projectConfigRecovery.openConfig')}
                </Button>
                <Button
                  data-recovery-action='retry'
                  size='small'
                  type='primary'
                  disabled={pending != null}
                  loading={pending === 'retry'}
                  onClick={recoveryActions?.requestRetry}
                >
                  {t('chat.projectConfigRecovery.retryGlobal')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
