/* eslint-disable max-lines -- app error state owns shared action ordering, details, and screen/route variants together. */
import './AppErrorState.scss'

import { App as AntdApp, Button } from 'antd'
import type { ButtonProps } from 'antd'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { copyTextWithFeedback } from '#~/utils/copy'

export type AppErrorActionKind =
  | 'changeServer'
  | 'connect'
  | 'home'
  | 'reload'
  | 'restart'
  | 'retry'

export interface AppErrorAction {
  disabled?: boolean
  kind: AppErrorActionKind
  label?: ReactNode
  loading?: boolean
  onClick: () => void
}

export interface AppErrorDetailsItem {
  label: ReactNode
  mono?: boolean
  value: ReactNode
}

export interface AppErrorDetails {
  content?: ReactNode
  copyText?: string
  items?: AppErrorDetailsItem[]
  title?: ReactNode
}

export interface AppErrorStateProps {
  actions?: AppErrorAction[]
  className?: string
  context?: ReactNode
  description?: ReactNode
  details?: AppErrorDetails
  focusOnMount?: boolean
  icon?: ReactNode
  measure?: 'compact' | 'wide'
  mobileDescription?: ReactNode
  secondaryMessage?: ReactNode
  severity?: 'error' | 'info' | 'warning'
  title: ReactNode
  variant?: 'fullscreen' | 'inline' | 'route'
}

const PRIMARY_ACTION_KINDS = new Set<AppErrorActionKind>(['connect', 'home', 'reload', 'restart', 'retry'])
const MOBILE_DETAILS_MEDIA_QUERY = '(max-width: 520px)'

const ACTION_ICONS: Record<AppErrorActionKind, string> = {
  changeServer: 'swap_horiz',
  connect: 'link',
  home: 'home',
  reload: 'refresh',
  restart: 'restart_alt',
  retry: 'refresh'
}

const getDefaultActionLabelKey = (kind: AppErrorActionKind) => {
  switch (kind) {
    case 'changeServer':
      return 'errorState.actions.changeServer'
    case 'connect':
      return 'errorState.actions.connect'
    case 'home':
      return 'errorState.actions.home'
    case 'reload':
      return 'errorState.actions.reload'
    case 'restart':
      return 'errorState.actions.restart'
    case 'retry':
      return 'errorState.actions.retry'
  }
}

const renderMaterialIcon = (icon: string) => (
  <span className='material-symbols-rounded app-error-state__action-icon' aria-hidden='true'>
    {icon}
  </span>
)

const readDefaultDetailsExpanded = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return !window.matchMedia(MOBILE_DETAILS_MEDIA_QUERY).matches
}

export function AppErrorState({
  actions = [],
  className,
  context,
  description,
  details,
  focusOnMount = true,
  icon,
  measure = 'compact',
  mobileDescription,
  secondaryMessage,
  severity = 'error',
  title,
  variant = 'route'
}: AppErrorStateProps) {
  const { t } = useTranslation()
  const { message } = AntdApp.useApp()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [detailsExpanded, setDetailsExpanded] = useState(readDefaultDetailsExpanded)
  const canShowMobileDescription = mobileDescription != null
  const detailsTitle = details?.title ?? t('errorState.details')
  const hasDetails = details != null &&
    ((details.items?.length ?? 0) > 0 || details.content != null || details.copyText != null)
  const detailsCopyText = details?.copyText?.trim() === '' ? undefined : details?.copyText
  const canCopyDetails = detailsCopyText != null

  useEffect(() => {
    if (!focusOnMount) return
    titleRef.current?.focus({ preventScroll: true })
  }, [focusOnMount])

  useEffect(() => {
    if (!hasDetails || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(MOBILE_DETAILS_MEDIA_QUERY)
    const syncDetailsExpanded = () => setDetailsExpanded(!media.matches)
    syncDetailsExpanded()
    media.addEventListener('change', syncDetailsExpanded)
    return () => media.removeEventListener('change', syncDetailsExpanded)
  }, [hasDetails])

  const copyDetails = () => {
    if (!canCopyDetails) return
    void copyTextWithFeedback({
      failureMessage: t('errorState.copyDiagnosticsFailed'),
      messageApi: message,
      successMessage: t('errorState.copyDiagnosticsSuccess'),
      text: detailsCopyText
    })
  }

  const actionButtons = actions.map((action, index) => {
    const buttonType: ButtonProps['type'] = index === 0 && PRIMARY_ACTION_KINDS.has(action.kind) ? 'primary' : 'default'
    return (
      <Button
        key={`${action.kind}-${index}`}
        type={buttonType}
        loading={action.loading}
        disabled={action.disabled}
        icon={renderMaterialIcon(ACTION_ICONS[action.kind])}
        onClick={action.onClick}
      >
        {action.label ?? t(getDefaultActionLabelKey(action.kind))}
      </Button>
    )
  })

  return (
    <div
      className={[
        'app-error-state',
        `app-error-state--${variant}`,
        `app-error-state--${severity}`,
        `app-error-state--measure-${measure}`,
        className
      ].filter(Boolean).join(' ')}
      role='alert'
    >
      <div className='app-error-state__content'>
        <div className='app-error-state__header'>
          <span className='app-error-state__icon' aria-hidden='true'>
            {icon ?? <span className='material-symbols-rounded'>error</span>}
          </span>
          <h1 ref={titleRef} className='app-error-state__title' tabIndex={-1}>{title}</h1>
        </div>
        {description != null && (
          <p className='app-error-state__description'>{description}</p>
        )}
        {canShowMobileDescription && (
          <p className='app-error-state__mobile-description'>{mobileDescription}</p>
        )}
        {context != null && (
          <div className='app-error-state__body'>
            <div className='app-error-state__context'>{context}</div>
          </div>
        )}
        {actionButtons.length > 0 && (
          <div className='app-error-state__actions'>{actionButtons}</div>
        )}
        {secondaryMessage != null && (
          <div className='app-error-state__secondary-message'>{secondaryMessage}</div>
        )}
      </div>
      {hasDetails && (
        <section
          className='app-error-state__details'
          data-expanded={detailsExpanded}
        >
          <div className='app-error-state__details-header'>
            <div className='app-error-state__details-title'>{detailsTitle}</div>
            <div className='app-error-state__details-actions'>
              {canCopyDetails && (
                <button
                  className='app-error-state__details-copy'
                  type='button'
                  onClick={copyDetails}
                >
                  <span className='material-symbols-rounded' aria-hidden='true'>content_copy</span>
                  <span>{t('errorState.copyDiagnostics')}</span>
                </button>
              )}
              <button
                className='app-error-state__details-toggle'
                type='button'
                aria-expanded={detailsExpanded}
                aria-label={detailsExpanded
                  ? t('errorState.collapseDiagnostics')
                  : t('errorState.expandDiagnostics')}
                onClick={() => setDetailsExpanded(value => !value)}
              >
                <span className='material-symbols-rounded' aria-hidden='true'>
                  {detailsExpanded ? 'expand_more' : 'expand_less'}
                </span>
              </button>
            </div>
          </div>
          <div className='app-error-state__details-body'>
            {(details?.items?.length ?? 0) > 0 && (
              <dl className='app-error-state__detail-list'>
                {details?.items?.map((item, index) => (
                  <div key={index} className='app-error-state__detail-row'>
                    <dt className='app-error-state__detail-label'>{item.label}</dt>
                    <dd
                      className={[
                        'app-error-state__detail-value',
                        item.mono === true ? 'app-error-state__detail-value--mono' : undefined
                      ].filter(Boolean).join(' ')}
                    >
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {details?.content}
          </div>
        </section>
      )}
    </div>
  )
}

export function FullscreenErrorState({
  compact = false,
  measure = 'compact',
  ...props
}: AppErrorStateProps & { compact?: boolean }) {
  return (
    <div className={`app-error-state-screen ${compact ? 'app-error-state-screen--compact' : ''}`}>
      <AppErrorState {...props} measure={measure} variant='fullscreen' />
    </div>
  )
}

export function RouteErrorState(props: AppErrorStateProps) {
  return (
    <div className='app-error-state-route'>
      <AppErrorState {...props} variant='route' />
    </div>
  )
}
