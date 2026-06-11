import type { Session } from '@oneworks/core'
import type { SessionInfo } from '@oneworks/types'

import type { SessionCompactionInfo } from '#~/hooks/chat/session-compaction'

import { SessionSettingsPanel } from './ChatHeader'

export function ChatSettingsView({
  session,
  sessionCompactionInfo,
  sessionInfo,
  onClose
}: {
  session: Session
  sessionCompactionInfo?: SessionCompactionInfo | null
  sessionInfo: SessionInfo | null
  onClose: () => void
}) {
  return (
    <div className='chat-settings-panel'>
      <SessionSettingsPanel
        session={session}
        sessionCompactionInfo={sessionCompactionInfo}
        sessionInfo={sessionInfo}
        onClose={onClose}
      />
    </div>
  )
}
