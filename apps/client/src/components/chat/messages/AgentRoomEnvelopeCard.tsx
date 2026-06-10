import { MarkdownContent } from '#~/components/MarkdownContent'

import type { AgentRoomEnvelope } from './agent-room-envelope'

interface AgentRoomEnvelopeCardProps {
  envelope: AgentRoomEnvelope
}

export function AgentRoomEnvelopeCard({ envelope }: AgentRoomEnvelopeCardProps) {
  return (
    <section className='agent-room-envelope-card'>
      <div className='agent-room-envelope-card__user-message'>
        <MarkdownContent content={envelope.userMessage} />
      </div>
    </section>
  )
}
