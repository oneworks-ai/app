import { useTranslation } from 'react-i18next'

import type { SessionStatus } from '@oneworks/core'

import { SessionCard } from '#~/components/sidebar/SessionCard'

import type { AgentRoomRunStatus, AgentRoomRunView } from '../@types/agent-room-view'

interface AgentRoomRunSessionCardView {
  id: string
  summary?: string
  status: SessionStatus
  title: string
  updatedAtLabel?: string
}

const runStatusToSessionStatus: Record<AgentRoomRunStatus, SessionStatus> = {
  completed: 'completed',
  failed: 'failed',
  running: 'running',
  stopped: 'terminated',
  waiting: 'waiting_input'
}

export const toAgentRoomRunSessionCard = (run: AgentRoomRunView): AgentRoomRunSessionCardView => ({
  id: run.sessionId,
  status: runStatusToSessionStatus[run.status],
  summary: run.latestSummary,
  title: run.title,
  updatedAtLabel: run.updatedAtLabel
})

export function AgentRoomRunList({
  runs,
  onOpenRun
}: {
  runs: AgentRoomRunView[]
  onOpenRun?: (run: AgentRoomRunView) => void
}) {
  const { t } = useTranslation()

  const getStatusIcon = (status: SessionStatus, label: string) => {
    if (status === 'waiting_input') {
      return <div className='waiting-input-indicator' title={label} aria-label={label} />
    }

    const icon = status === 'completed'
      ? 'check_circle'
      : status === 'failed'
      ? 'cancel'
      : status === 'terminated'
      ? 'remove_circle'
      : 'sync'

    return (
      <span
        className={`material-symbols-rounded status-icon agent-room-run-list__status-icon agent-room-run-list__status-icon--${status} ${
          status === 'running' ? 'spin' : ''
        }`}
        title={label}
        aria-label={label}
      >
        {icon}
      </span>
    )
  }

  if (runs.length === 0) {
    return (
      <div className='agent-room-run-list agent-room-run-list--empty'>
        {t('agentRoom.roster.noRuns')}
      </div>
    )
  }

  return (
    <div className='agent-room-run-list'>
      {runs.map((run) => {
        const card = toAgentRoomRunSessionCard(run)
        const canOpenRun = onOpenRun != null
        const openRunLabel = t('agentRoom.actions.openRun')
        const title = card.title === '' ? t('common.newChat') : card.title
        const openRunTitle = title === '' ? openRunLabel : `${openRunLabel}: ${title}`
        const statusLabel = t(`common.status.${card.status}`)
        const metaLabel = card.updatedAtLabel != null && card.updatedAtLabel !== ''
          ? card.updatedAtLabel
          : statusLabel

        return (
          <SessionCard
            as='article'
            key={run.runKey}
            className={`agent-room-run-list__session-card agent-room-run-list__session-card--${run.status} session-item session-item--compact`}
            dataSessionCardSource='agent-room-run'
            dataSessionId={card.id}
            leading={
              <div className='session-leading'>
                <div className='status-indicator'>
                  {getStatusIcon(card.status, statusLabel)}
                </div>
              </div>
            }
            title={canOpenRun
              ? (
                <button
                  type='button'
                  className='agent-room-run-list__title-button session-title-text'
                  aria-label={openRunTitle}
                  title={openRunTitle}
                  onClick={() => onOpenRun(run)}
                >
                  {title}
                </button>
              )
              : <span className='session-title-text'>{title}</span>}
            headerSide={<span className='time-display'>{metaLabel}</span>}
            lastMessage={card.summary != null && card.summary !== '' && (
              <div className='last-message'>{card.summary}</div>
            )}
          />
        )
      })}
    </div>
  )
}
