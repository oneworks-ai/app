import './AgentRoomView.scss'
import './AgentRoomTranscript.scss'

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { AgentRoomMessageList } from './@components/AgentRoomMessageList'
import { buildAgentRoomViewModel } from './@core/build-room-view-model'
import type { AgentRoomMessageView, AgentRoomRunView, AgentRoomViewModel } from './@types/agent-room-view'

export interface AgentRoomTranscriptProps {
  room: AgentRoomViewModel
  onOpenHostSession?: () => void
  onOpenRun?: (run: AgentRoomRunView) => void
  onReplyToRun?: (message: AgentRoomMessageView) => void
  onRespondInteraction?: (interactionId: string, data: string | string[]) => Promise<void> | void
  onSelectHostTarget?: () => void
  onSelectMemberTarget?: (member: NonNullable<AgentRoomMessageView['member']>) => void
}

export function AgentRoomTranscript({
  room,
  onOpenHostSession,
  onOpenRun,
  onReplyToRun,
  onRespondInteraction,
  onSelectHostTarget,
  onSelectMemberTarget
}: AgentRoomTranscriptProps) {
  const { t } = useTranslation()
  const viewModel = useMemo(() => buildAgentRoomViewModel(room), [room])

  return (
    <section
      className='agent-room-transcript'
      aria-label={t('agentRoom.transcript.ariaLabel', { title: viewModel.title })}
    >
      {viewModel.messages.length > 0
        ? (
          <AgentRoomMessageList
            messages={viewModel.messages}
            variant='transcript'
            showTimelineSeparators
            onOpenHostSession={onOpenHostSession}
            onOpenRun={onOpenRun}
            onReplyToRun={onReplyToRun}
            onRespondInteraction={onRespondInteraction}
            onSelectHostTarget={onSelectHostTarget}
            onSelectMemberTarget={onSelectMemberTarget}
          />
        )
        : (
          <div className='agent-room-transcript__empty'>
            {t('agentRoom.transcript.empty')}
          </div>
        )}
    </section>
  )
}
