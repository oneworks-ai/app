/* eslint-disable max-lines -- workspace connection error view keeps busy-session summary and restart diagnostics together. */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LauncherWorkspaceVersionConflictDetails } from '@oneworks/types'

import { FullscreenErrorState } from '#~/components/error-state'
import type { AppErrorAction, AppErrorDetailsItem } from '#~/components/error-state'
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

const buildDiagnosticsText = (
  details: LauncherWorkspaceVersionConflictDetails,
  labels: {
    processId: string
    requestedVersion: string
    runtimeCompatibilityVersion: string
    runningVersion: string
    serverUrl: string
  }
) =>
  [
    `${labels.runtimeCompatibilityVersion}: ${
      formatVersionPair(details.existing.runtimeCompatibilityVersion, details.requested.runtimeCompatibilityVersion)
    }`,
    `${labels.runningVersion}: ${details.existing.sourceVersionId ?? details.existing.implementationId ?? 'n/a'}`,
    `${labels.requestedVersion}: ${details.requested.sourceVersionId ?? details.requested.implementationId ?? 'n/a'}`,
    `${labels.serverUrl}: ${details.existing.serverBaseUrl ?? 'n/a'}`,
    `${labels.processId}: ${details.existing.pid ?? 'n/a'}`
  ].join('\n')

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
  const diagnosticsLabels = useMemo(() => ({
    processId: t('workspaceConnection.processId'),
    requestedVersion: t('workspaceConnection.requestedVersion'),
    runtimeCompatibilityVersion: t('workspaceConnection.runtimeCompatibilityVersion'),
    runningVersion: t('workspaceConnection.runningVersion'),
    serverUrl: t('workspaceConnection.serverUrl')
  }), [t])
  const diagnosticsItems = useMemo<AppErrorDetailsItem[]>(() =>
    details == null
      ? []
      : [
        {
          label: diagnosticsLabels.runtimeCompatibilityVersion,
          mono: true,
          value: formatVersionPair(
            details.existing.runtimeCompatibilityVersion,
            details.requested.runtimeCompatibilityVersion
          )
        },
        {
          label: diagnosticsLabels.runningVersion,
          mono: true,
          value: formatIdentityValue(details.existing.sourceVersionId ?? details.existing.implementationId)
        },
        {
          label: diagnosticsLabels.requestedVersion,
          mono: true,
          value: formatIdentityValue(details.requested.sourceVersionId ?? details.requested.implementationId)
        },
        {
          label: diagnosticsLabels.serverUrl,
          mono: true,
          value: details.existing.serverBaseUrl ?? 'n/a'
        },
        {
          label: diagnosticsLabels.processId,
          mono: true,
          value: details.existing.pid ?? 'n/a'
        }
      ], [details, diagnosticsLabels])
  const busyStatusCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of busyActivity?.activeSessions ?? []) {
      const status = session.status ?? 'unknown'
      counts.set(status, (counts.get(status) ?? 0) + 1)
    }
    return Array.from(counts.entries())
  }, [busyActivity?.activeSessions])
  const actions = useMemo<AppErrorAction[]>(() => [
    ...(details?.restartable === true
      ? [{
        kind: 'restart' as const,
        loading: isRestarting,
        onClick: onRestart
      }]
      : []),
    {
      disabled: isRestarting,
      kind: 'retry' as const,
      onClick: onRetry
    }
  ], [details?.restartable, isRestarting, onRestart, onRetry])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 520px)')
    const handleChange = () => setIsBusyListOpen(!media.matches)
    handleChange()
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  return (
    <FullscreenErrorState
      actions={actions}
      className='workspace-connection-gate__state'
      context={busyActivity == null
        ? undefined
        : (
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
      description={details == null ? undefined : t('workspaceConnection.versionConflictDescription')}
      details={details == null
        ? undefined
        : {
          copyText: buildDiagnosticsText(details, diagnosticsLabels),
          items: diagnosticsItems,
          title: t('workspaceConnection.diagnosticsTitle')
        }}
      measure='wide'
      mobileDescription={details == null ? undefined : t('workspaceConnection.mobileVersionConflictSummary')}
      secondaryMessage={restartErrorMessage}
      title={title}
    />
  )
}
