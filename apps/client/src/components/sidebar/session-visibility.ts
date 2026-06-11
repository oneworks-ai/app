import type { Session } from '@oneworks/core'

export const isMessageVersionSession = (session: Session) => (
  session.messageBranchGroupId != null && session.messageBranchGroupId !== ''
)

export const isSidebarVisibleSession = (session: Session) => !isMessageVersionSession(session)
