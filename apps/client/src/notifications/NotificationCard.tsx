import { Button, Tooltip } from 'antd'
import { useCallback, useState } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { MarkdownContent } from '#~/components/MarkdownContent'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'

import { getNotificationSourceIcon, getNotificationSourceKey, getNotificationSourceTitle } from './notification-store'
import type { UiNotification, UiNotificationAction, UiNotificationSource } from './notification-types'

interface NotificationCardProps {
  index: number
  isExiting: boolean
  language: string
  notification: UiNotification
  onClose: (id: string) => void
  onMuteSource: (source: UiNotificationSource) => void
  onPauseAutoClose: (id: string) => void
  onResumeAutoClose: (notification: UiNotification) => void
}

const levelIcons: Record<UiNotification['level'], string> = {
  error: 'bug_report',
  info: 'notifications',
  success: 'check',
  warning: 'fact_check'
}
const NOTIFICATION_TOOLTIP_Z_INDEX = 1110

type NotificationCardStyle = CSSProperties & {
  '--notification-index': number
}

const formatCreatedAt = (value: number, language: string) => (
  new Intl.DateTimeFormat(language, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value))
)

export function NotificationCard({
  index,
  isExiting,
  language,
  notification,
  onClose,
  onMuteSource,
  onPauseAutoClose,
  onResumeAutoClose
}: NotificationCardProps) {
  const { t } = useTranslation()
  const [runningActions, setRunningActions] = useState<Set<string>>(() => new Set())
  const sourceTitle = getNotificationSourceTitle(notification.source)
  const sourceKey = getNotificationSourceKey(notification.source)
  const sourceScope = notification.source.kind === 'plugin' ? notification.source.scope : undefined
  const createdAt = formatCreatedAt(notification.createdAt, language)
  const fullCreatedAt = new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(notification.createdAt))

  const runAction = useCallback(async (action: UiNotificationAction) => {
    const actionKey = `${notification.id}:${action.id}`
    setRunningActions((current) => new Set(current).add(actionKey))
    try {
      await action.onClick?.({
        close: () => onClose(notification.id),
        id: notification.id,
        muteSource: () => onMuteSource(notification.source),
        source: notification.source
      })
      if (action.closeOnClick !== false) {
        onClose(notification.id)
      }
    } catch (error) {
      console.error('[notifications] action failed', error)
    } finally {
      setRunningActions((current) => {
        const next = new Set(current)
        next.delete(actionKey)
        return next
      })
    }
  }, [notification, onClose, onMuteSource])

  return (
    <article
      className={`oneworks-notification-card oneworks-notification-card--${notification.level} ${
        isExiting ? 'is-exiting' : ''
      }`}
      data-source={sourceKey}
      style={{ '--notification-index': index } as NotificationCardStyle}
      onMouseEnter={() => onPauseAutoClose(notification.id)}
      onMouseLeave={() => onResumeAutoClose(notification)}
    >
      <div className='oneworks-notification-card__header'>
        <span className='oneworks-notification-card__level' aria-hidden='true'>
          <MaterialSymbol name={levelIcons[notification.level]} />
        </span>
        <div className='oneworks-notification-card__meta'>
          <span className='oneworks-notification-card__source'>
            <MaterialSymbol name={getNotificationSourceIcon(notification.source)} />
            <span className='oneworks-notification-card__source-title'>{sourceTitle}</span>
            {sourceScope != null && sourceScope !== sourceTitle && (
              <code>{sourceScope}</code>
            )}
          </span>
          <Tooltip title={fullCreatedAt} zIndex={NOTIFICATION_TOOLTIP_Z_INDEX}>
            <time
              className='oneworks-notification-card__time'
              dateTime={new Date(notification.createdAt).toISOString()}
            >
              {createdAt}
            </time>
          </Tooltip>
        </div>
        <div className='oneworks-notification-card__chrome'>
          {notification.source.kind === 'plugin' && (
            <Tooltip
              title={t('common.notifications.mutePlugin', { plugin: sourceTitle })}
              zIndex={NOTIFICATION_TOOLTIP_Z_INDEX}
            >
              <Button
                aria-label={t('common.notifications.mutePlugin', { plugin: sourceTitle })}
                className='oneworks-notification-card__icon-button'
                icon={<MaterialSymbol name='extension_off' />}
                size='small'
                type='text'
                onClick={() => onMuteSource(notification.source)}
              />
            </Tooltip>
          )}
          <Tooltip title={t('common.notifications.close')} zIndex={NOTIFICATION_TOOLTIP_Z_INDEX}>
            <Button
              aria-label={t('common.notifications.close')}
              className='oneworks-notification-card__icon-button'
              icon={<MaterialSymbol name='close' />}
              size='small'
              type='text'
              onClick={() => onClose(notification.id)}
            />
          </Tooltip>
        </div>
      </div>
      <div className='oneworks-notification-card__body'>
        <h3>{notification.title}</h3>
        {notification.description != null && notification.description !== '' && (
          <div className='oneworks-notification-card__description'>
            {notification.descriptionFormat === 'text'
              ? <p>{notification.description}</p>
              : <MarkdownContent content={notification.description} openLinksInNewTab />}
          </div>
        )}
      </div>
      {notification.actions != null && notification.actions.length > 0 && (
        <div className='oneworks-notification-card__actions'>
          {notification.actions.map((action) => {
            const actionKey = `${notification.id}:${action.id}`
            return (
              <Button
                className={`oneworks-notification-card__action oneworks-notification-card__action--${
                  action.tone ?? 'default'
                }`}
                danger={action.tone === 'danger'}
                icon={action.icon == null ? undefined : <MaterialSymbol name={action.icon} />}
                key={action.id}
                loading={runningActions.has(actionKey)}
                size='small'
                type={action.tone === 'primary' ? 'primary' : 'default'}
                onClick={() => void runAction(action)}
              >
                {action.title}
              </Button>
            )
          })}
        </div>
      )}
    </article>
  )
}
