/* eslint-disable max-lines -- workspace connection error view keeps version diagnostics, busy-session summary, and restart actions together. */
import { CloseCircleFilled } from '@ant-design/icons'
import { Button } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LauncherWorkspaceVersionConflictDetails } from '@oneworks/types'

import type { WorkspaceServerRestartActivity } from '#~/workspace-connection-state'

const formatIdentityValue = (value?: string) => {
  if (value == null || value.trim() === '') return 'n/a'
  if (value.startsWith('git:') || value.startsWith('git-runtime:')) {
    return value.length > 38 ? `${value.slice(0, 38)}...` : value
  }
  return value
}

const formatSessionTitle = (session: { id: string; title?: string }) => {
  const title = session.title?.trim()
  return title == null || title === '' ? session.id : title
}

const formatVersionPair = (existing?: string, requested?: string) => {
  const existingValue = existing?.trim() === '' || existing == null ? 'n/a' : existing
  const requestedValue = requested?.trim() === '' || requested == null ? 'n/a' : requested
  return existingValue === requestedValue ? existingValue : `${existingValue} -> ${requestedValue}`
}

const readDefaultBusyListOpen = () => (
  typeof window === 'undefined' ||
  typeof window.matchMedia !== 'function' ||
  !window.matchMedia('(max-width: 520px)').matches
)

export function WorkspaceConnectionErrorView({
  details,
  isRestarting,
  message,
  restartActivity,
  restartErrorMessage,
  onRestart,
  onRetry
}: {
  details?: LauncherWorkspaceVersionConflictDetails
  isRestarting: boolean
  message: string
  restartActivity?: WorkspaceServerRestartActivity
  restartErrorMessage?: string
  onRestart: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const busyActivity = restartActivity?.status === 'busy' ? restartActivity : undefined
  const title = details == null ? message : t('workspaceConnection.versionConflictTitle')
  const [isBusyListOpen, setIsBusyListOpen] = useState(readDefaultBusyListOpen)
  const busyStatusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of busyActivity?.activeSessions ?? []) {
      const status = session.status ?? 'unknown'
      counts.set(status, (counts.get(status) ?? 0) + 1)
    }
    return Array.from(counts.entries())
  }, [busyActivity?.activeSessions])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 520px)')
    const handleChange = () => setIsBusyListOpen(!media.matches)
    handleChange()
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  return (
    <div className='workspace-connection-gate workspace-connection-gate--error'>
      <div className='workspace-connection-gate__content' role='alert'>
        <div className='workspace-connection-gate__header'>
          <CloseCircleFilled className='workspace-connection-gate__icon' aria-hidden='true' />
          <div className='workspace-connection-gate__title'>{title}</div>
        </div>
        {details != null && (
          <div className='workspace-connection-gate__body'>
            <div className='workspace-connection-gate__details'>
              <p className='workspace-connection-gate__summary'>
                {t('workspaceConnection.versionConflictDescription')}
              </p>
              <p className='workspace-connection-gate__mobile-summary'>
                {t('workspaceConnection.mobileVersionConflictSummary')}
              </p>
              {busyActivity != null && (
                <div className='workspace-connection-gate__busy'>
                  <div className='workspace-connection-gate__busy-header'>
                    <div className='workspace-connection-gate__busy-title'>
                      {t('workspaceConnection.busyTitle', { count: busyActivity.activeSessionCount })}
                    </div>
                    <div className='workspace-connection-gate__busy-badge'>
                      {t('workspaceConnection.autoRestartPaused')}
                    </div>
                  </div>
                  <p className='workspace-connection-gate__busy-description'>
                    {t('workspaceConnection.busyDescription')}
                  </p>
                  <div
                    className='workspace-connection-gate__busy-stats'
                    aria-label={t('workspaceConnection.busyStatsLabel')}
                  >
                    <span>
                      {t('workspaceConnection.busyTotal', { count: busyActivity.activeSessionCount })}
                    </span>
                    {busyStatusCounts.map(([status, count]) => (
                      <span key={status}>
                        {status === 'unknown'
                          ? t('workspaceConnection.unknownStatus')
                          : t(`common.status.${status}`, { defaultValue: status })} {count}
                      </span>
                    ))}
                  </div>
                  {busyActivity.activeSessions.length > 0 && (
                    <>
                      <button
                        className='workspace-connection-gate__busy-toggle'
                        type='button'
                        aria-expanded={isBusyListOpen}
                        onClick={() => setIsBusyListOpen(value => !value)}
                      >
                        {isBusyListOpen
                          ? t('workspaceConnection.hideActiveSessions')
                          : t('workspaceConnection.showActiveSessions')}
                      </button>
                      {isBusyListOpen && (
                        <ul className='workspace-connection-gate__busy-list'>
                          {busyActivity.activeSessions.map(session => (
                            <li key={session.id}>
                              <span className='workspace-connection-gate__busy-session-main'>
                                <span className='workspace-connection-gate__busy-session-title'>
                                  {formatSessionTitle(session)}
                                </span>
                                <span className='workspace-connection-gate__busy-session-id'>{session.id}</span>
                              </span>
                              <span className='workspace-connection-gate__busy-session-status'>
                                {session.status == null
                                  ? t('workspaceConnection.unknownStatus')
                                  : t(`common.status.${session.status}`, { defaultValue: session.status })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}
              <section className='workspace-connection-gate__diagnostics'>
                <div className='workspace-connection-gate__diagnostics-title'>
                  {t('workspaceConnection.diagnosticsTitle')}
                </div>
                <dl className='workspace-connection-gate__meta'>
                  <div className='workspace-connection-gate__meta-row workspace-connection-gate__meta-row--compatibility'>
                    <dt>{t('workspaceConnection.runtimeCompatibilityVersion')}</dt>
                    <dd>
                      {formatVersionPair(
                        details.existing.runtimeCompatibilityVersion,
                        details.requested.runtimeCompatibilityVersion
                      )}
                    </dd>
                  </div>
                  <div className='workspace-connection-gate__meta-row workspace-connection-gate__meta-row--identity'>
                    <dt>{t('workspaceConnection.runningVersion')}</dt>
                    <dd>
                      {formatIdentityValue(details.existing.sourceVersionId ?? details.existing.implementationId)}
                    </dd>
                  </div>
                  <div className='workspace-connection-gate__meta-row workspace-connection-gate__meta-row--identity'>
                    <dt>{t('workspaceConnection.requestedVersion')}</dt>
                    <dd>
                      {formatIdentityValue(details.requested.sourceVersionId ?? details.requested.implementationId)}
                    </dd>
                  </div>
                  <div className='workspace-connection-gate__meta-row workspace-connection-gate__meta-row--endpoint'>
                    <dt>{t('workspaceConnection.serverUrl')}</dt>
                    <dd>{details.existing.serverBaseUrl ?? 'n/a'}</dd>
                  </div>
                  <div className='workspace-connection-gate__meta-row workspace-connection-gate__meta-row--endpoint'>
                    <dt>{t('workspaceConnection.processId')}</dt>
                    <dd>{details.existing.pid ?? 'n/a'}</dd>
                  </div>
                </dl>
              </section>
              <div className='workspace-connection-gate__actions'>
                {details.restartable && (
                  <Button
                    type='primary'
                    loading={isRestarting}
                    onClick={onRestart}
                  >
                    {t('workspaceConnection.restartWorkspaceServer')}
                  </Button>
                )}
                <Button onClick={onRetry} disabled={isRestarting}>
                  {t('workspaceConnection.retry')}
                </Button>
              </div>
              {restartErrorMessage != null && (
                <div className='workspace-connection-gate__restart-error'>
                  {restartErrorMessage}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
