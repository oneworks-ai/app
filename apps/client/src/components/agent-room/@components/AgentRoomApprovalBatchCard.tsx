/* eslint-disable max-lines -- Approval batch rendering keeps animated disclosure state colocated. */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentRoomApprovalBatchItemView, AgentRoomApprovalBatchView } from '../@types/agent-room-view'

interface ApprovalMetric {
  icon: string
  label: string
  value: number
}

const DISCLOSURE_TRANSITION_MS = 220

const scheduleDisclosureFrame = (callback: () => void) => {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    const frame = globalThis.requestAnimationFrame(callback)
    return () => globalThis.cancelAnimationFrame(frame)
  }

  const timeout = setTimeout(callback, 16)
  return () => clearTimeout(timeout)
}

const useAnimatedPresence = (isOpen: boolean) => {
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [isVisible, setIsVisible] = useState(isOpen)

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
      return scheduleDisclosureFrame(() => setIsVisible(true))
    }

    setIsVisible(false)
    const timeout = setTimeout(() => setShouldRender(false), DISCLOSURE_TRANSITION_MS)
    return () => clearTimeout(timeout)
  }, [isOpen])

  return { isVisible, shouldRender }
}

const getMentionLabel = (label: string) => {
  const normalized = label.trim().replace(/^@+/, '')
  return normalized === '' ? label : `@${normalized}`
}

const getItemStatusIcon = (item: AgentRoomApprovalBatchItemView) => (
  item.status === 'pending' ? 'pending_actions' : 'check_circle'
)

export function AgentRoomApprovalBatchCard({
  batch
}: {
  batch: AgentRoomApprovalBatchView
}) {
  const { t } = useTranslation()
  const targetLabel = batch.runTitle === ''
    ? getMentionLabel(batch.memberLabel)
    : `${getMentionLabel(batch.memberLabel)} / ${batch.runTitle}`
  const latestStatusLabel = batch.latest.status === 'pending'
    ? t('agentRoom.approvalBatch.pending')
    : t('agentRoom.approvalBatch.handled')
  const metrics: ApprovalMetric[] = [
    {
      icon: 'rule',
      label: t('agentRoom.approvalBatch.total', { count: batch.totalCount }),
      value: batch.totalCount
    },
    {
      icon: 'pending_actions',
      label: t('agentRoom.approvalBatch.pendingCount', { count: batch.pendingCount }),
      value: batch.pendingCount
    },
    {
      icon: 'check_circle',
      label: t('agentRoom.approvalBatch.handledCount', { count: batch.handledCount }),
      value: batch.handledCount
    },
    ...(batch.actionCount > 0
      ? [{
        icon: 'done_all',
        label: t('agentRoom.approvalBatch.actionCount', { count: batch.actionCount }),
        value: batch.actionCount
      }]
      : [])
  ]
  const historyItems = [...batch.items].reverse()
  const actionItems = [...batch.actions].reverse()
  const historyCount = batch.items.length + batch.actions.length
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false)
  const historyLabel = t('agentRoom.approvalBatch.history', { count: historyCount })
  const shouldShowCurrentRequest = batch.latest.status === 'pending'
  const currentDisclosure = useAnimatedPresence(shouldShowCurrentRequest)
  const historyDisclosure = useAnimatedPresence(isHistoryExpanded && historyCount > 1)

  return (
    <section className='agent-room-approval-batch'>
      <header className='agent-room-approval-batch__header'>
        <span className='material-symbols-rounded agent-room-approval-batch__icon' aria-hidden='true'>
          rule
        </span>
        <div className='agent-room-approval-batch__title-block'>
          <div className='agent-room-approval-batch__title'>{t('agentRoom.approvalBatch.title')}</div>
          <div className='agent-room-approval-batch__target'>{targetLabel}</div>
        </div>
        {historyCount > 1 && (
          <button
            type='button'
            className='agent-room-approval-batch__history-toggle'
            aria-label={historyLabel}
            title={historyLabel}
            aria-expanded={isHistoryExpanded}
            onClick={() => setIsHistoryExpanded(value => !value)}
          >
            <span className='material-symbols-rounded' aria-hidden='true'>
              {isHistoryExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
            </span>
          </button>
        )}
      </header>

      <div className='agent-room-approval-batch__metrics' aria-label={t('agentRoom.approvalBatch.summary')}>
        {metrics.map(metric => (
          <span
            key={metric.icon}
            className='agent-room-approval-batch__metric'
            aria-label={metric.label}
            title={metric.label}
          >
            <span className='material-symbols-rounded agent-room-approval-batch__metric-icon' aria-hidden='true'>
              {metric.icon}
            </span>
            <span className='agent-room-approval-batch__metric-count'>{metric.value}</span>
          </span>
        ))}
      </div>

      {currentDisclosure.shouldRender && (
        <div
          className={[
            'agent-room-approval-batch__current',
            currentDisclosure.isVisible ? 'agent-room-approval-batch__current--visible' : ''
          ].filter(Boolean).join(' ')}
          aria-hidden={!currentDisclosure.isVisible}
        >
          <div className='agent-room-approval-batch__current-shell'>
            <div className='agent-room-approval-batch__current-content'>
              <div className='agent-room-approval-batch__current-head'>
                <span>{t('agentRoom.approvalBatch.currentRequest')}</span>
                <span
                  className={`agent-room-approval-batch__status agent-room-approval-batch__status--${batch.latest.status}`}
                >
                  {latestStatusLabel}
                </span>
              </div>
              <div className='agent-room-approval-batch__request-text'>{batch.latest.content}</div>
            </div>
          </div>
        </div>
      )}

      {historyDisclosure.shouldRender && historyCount > 1 && (
        <div
          className={[
            'agent-room-approval-batch__history',
            historyDisclosure.isVisible ? 'agent-room-approval-batch__history--visible' : ''
          ].filter(Boolean).join(' ')}
          aria-hidden={!historyDisclosure.isVisible}
          aria-label={historyDisclosure.isVisible ? historyLabel : undefined}
        >
          <div className='agent-room-approval-batch__history-shell'>
            <div className='agent-room-approval-batch__history-list'>
              {actionItems.map(action => (
                <div key={action.id} className='agent-room-approval-batch__history-item'>
                  <span
                    className='material-symbols-rounded agent-room-approval-batch__history-icon agent-room-approval-batch__history-icon--action'
                    aria-hidden='true'
                  >
                    done_all
                  </span>
                  <div className='agent-room-approval-batch__history-body'>
                    <div className='agent-room-approval-batch__history-meta'>
                      <span>{t('agentRoom.approvalBatch.handledByLeader')}</span>
                      {action.createdAtLabel != null && <span>{action.createdAtLabel}</span>}
                      {action.interactionIds.map(interactionId => <span key={interactionId}>{interactionId}</span>)}
                    </div>
                    <div className='agent-room-approval-batch__history-text'>{action.content}</div>
                  </div>
                </div>
              ))}
              {historyItems.map(item => (
                <div key={item.id} className='agent-room-approval-batch__history-item'>
                  <span
                    className={`material-symbols-rounded agent-room-approval-batch__history-icon agent-room-approval-batch__history-icon--${item.status}`}
                    aria-hidden='true'
                  >
                    {getItemStatusIcon(item)}
                  </span>
                  <div className='agent-room-approval-batch__history-body'>
                    <div className='agent-room-approval-batch__history-meta'>
                      <span>
                        {item.status === 'pending'
                          ? t('agentRoom.approvalBatch.pending')
                          : t('agentRoom.approvalBatch.handled')}
                      </span>
                      {item.createdAtLabel != null && <span>{item.createdAtLabel}</span>}
                      {item.interactionId != null && <span>{item.interactionId}</span>}
                    </div>
                    <div className='agent-room-approval-batch__history-text'>{item.content}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
