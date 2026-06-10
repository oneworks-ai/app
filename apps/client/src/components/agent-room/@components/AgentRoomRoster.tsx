import './AgentRoomRoster.scss'

import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { RoomPixelAvatar } from '#~/components/room-pixel-avatar/RoomPixelAvatar'

import type { AgentRoomLayoutMode, AgentRoomMemberView, AgentRoomRunView } from '../@types/agent-room-view'
import { AgentRoomRunList } from './AgentRoomRunList'

const getDisplayMemberLabel = (label: string) => label.trim().replace(/^@+/, '')

const getConfiguredAvatarLabel = (member: AgentRoomMemberView) => {
  const avatarLabel = member.avatarLabel?.trim()
  return avatarLabel === '' ? undefined : avatarLabel
}

const getAvatarSeed = (member: AgentRoomMemberView) => `agent-room:${member.memberKey}`

export function AgentRoomRoster({
  defaultExpandedMemberKeys = [],
  members,
  layout,
  onOpenRun,
  showHeader = true
}: {
  defaultExpandedMemberKeys?: string[]
  members: AgentRoomMemberView[]
  layout: Extract<AgentRoomLayoutMode, 'desktop' | 'compact'>
  onOpenRun?: (run: AgentRoomRunView) => void
  showHeader?: boolean
}) {
  const { t } = useTranslation()
  const rosterId = useId()
  const [expandedMemberKeys, setExpandedMemberKeys] = useState<Set<string>>(
    () => new Set(defaultExpandedMemberKeys)
  )

  const toggleMemberRuns = (memberKey: string) => {
    setExpandedMemberKeys((current) => {
      const next = new Set(current)
      if (next.has(memberKey)) {
        next.delete(memberKey)
      } else {
        next.add(memberKey)
      }
      return next
    })
  }

  const content = (
    <div className='agent-room-roster__members'>
      {members.map((member) => {
        const displayLabel = getDisplayMemberLabel(member.label)
        const avatarLabel = getConfiguredAvatarLabel(member)
        const isExpanded = expandedMemberKeys.has(member.memberKey)
        const hasRuns = member.runs.length > 0
        const runsPanelId = `${rosterId}-${member.memberKey}-runs`

        return (
          <section
            key={member.memberKey}
            className={`agent-room-roster__member agent-room-roster__member--${member.status}`}
          >
            <div className='agent-room-roster__member-head'>
              <div
                className={[
                  'agent-room-roster__avatar',
                  avatarLabel == null ? 'agent-room-roster__avatar--pixel' : ''
                ].filter(Boolean).join(' ')}
                aria-hidden='true'
              >
                {avatarLabel ??
                  <RoomPixelAvatar className='agent-room-roster__avatar-pixel' seed={getAvatarSeed(member)} />}
              </div>
              <div className='agent-room-roster__member-copy'>
                <div className='agent-room-roster__member-name'>{displayLabel}</div>
                {member.subtitle != null && member.subtitle !== '' && (
                  <div className='agent-room-roster__member-subtitle'>{member.subtitle}</div>
                )}
              </div>
              <span className='agent-room-roster__status'>
                {t(`agentRoom.status.member.${member.status}`)}
              </span>
            </div>
            {member.latestSummary != null && member.latestSummary !== '' && (
              <div className='agent-room-roster__summary'>{member.latestSummary}</div>
            )}
            {hasRuns && (
              <button
                type='button'
                className={`agent-room-roster__runs-toggle ${isExpanded ? 'is-expanded' : ''}`}
                aria-expanded={isExpanded}
                aria-controls={runsPanelId}
                onClick={() => toggleMemberRuns(member.memberKey)}
              >
                <span className='material-symbols-rounded' aria-hidden='true'>chevron_right</span>
                <span>
                  {isExpanded ? t('agentRoom.roster.collapseRuns') : t('agentRoom.roster.expandRuns')}
                </span>
              </button>
            )}
            {hasRuns && isExpanded && (
              <div id={runsPanelId} className='agent-room-roster__runs-panel'>
                <AgentRoomRunList runs={member.runs} onOpenRun={onOpenRun} />
              </div>
            )}
          </section>
        )
      })}
    </div>
  )

  if (layout === 'compact') {
    return (
      <details className='agent-room-roster agent-room-roster--compact' open>
        <summary className='agent-room-roster__compact-trigger'>
          <span className='material-symbols-rounded' aria-hidden='true'>groups</span>
          <span>{t('agentRoom.roster.compactTitle', { count: members.length })}</span>
        </summary>
        {content}
      </details>
    )
  }

  return (
    <aside className='agent-room-roster agent-room-roster--desktop' aria-label={t('agentRoom.roster.title')}>
      {showHeader && (
        <div className='agent-room-roster__header'>
          <div>
            <div className='agent-room-roster__eyebrow'>{t('agentRoom.roster.eyebrow')}</div>
            <h2>{t('agentRoom.roster.title')}</h2>
          </div>
          <span>{t('agentRoom.roster.memberCount', { count: members.length })}</span>
        </div>
      )}
      {content}
    </aside>
  )
}
