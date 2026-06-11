import { Empty } from 'antd'
import { useTranslation } from 'react-i18next'

import type { AgentRoomMessageView, AgentRoomRunView } from '#~/components/agent-room'

const getDisplayMemberLabel = (label: string | undefined) => label?.trim().replace(/^@+/, '') ?? ''

export function WorkspaceDrawerApprovals({
  approvals,
  onOpenRun
}: {
  approvals: AgentRoomMessageView[]
  onOpenRun?: (run: AgentRoomRunView) => void
}) {
  const { t } = useTranslation()

  if (approvals.length === 0) {
    return (
      <div className='chat-workspace-drawer__approvals-empty'>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('agentRoom.approvals.empty')} />
      </div>
    )
  }

  return (
    <div className='chat-workspace-drawer__approvals' aria-label={t('chat.workspaceDrawerApprovals')}>
      {approvals.map((message) => {
        const displayMemberLabel = getDisplayMemberLabel(message.member?.label)
        const memberLabel = displayMemberLabel !== ''
          ? displayMemberLabel
          : t('agentRoom.message.agent')
        const run = message.run
        const runTitle = message.run?.title
        const statusLabel = t('agentRoom.approvals.waitingForInput')

        return (
          <article
            key={message.id}
            className='chat-workspace-drawer__approval-card'
            aria-label={statusLabel}
          >
            <div className='chat-workspace-drawer__approval-head'>
              <div className='chat-workspace-drawer__approval-context'>
                <span className='chat-workspace-drawer__approval-agent'>{memberLabel}</span>
                {runTitle != null && runTitle !== '' && (
                  <span className='chat-workspace-drawer__approval-run'>{runTitle}</span>
                )}
              </div>
              <span className='chat-workspace-drawer__approval-status'>{statusLabel}</span>
            </div>
            <div className='chat-workspace-drawer__approval-message'>{message.content}</div>
            <div className='chat-workspace-drawer__approval-note'>
              {t('agentRoom.approvals.waitingDescription')}
            </div>
            {run != null && onOpenRun != null && (
              <button
                type='button'
                className='chat-workspace-drawer__approval-open-run'
                onClick={() => onOpenRun(run)}
              >
                <span className='material-symbols-rounded' aria-hidden='true'>open_in_new</span>
                <span>{t('agentRoom.actions.openRun')}</span>
              </button>
            )}
          </article>
        )
      })}
    </div>
  )
}
