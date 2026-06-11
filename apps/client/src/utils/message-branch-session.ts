import type { Session } from '@oneworks/core'

export const MESSAGE_BRANCH_SESSION_QUERY = 'branchSessionId'

export const isMessageBranchSession = (session: Session | undefined) => (
  session?.messageBranchGroupId != null &&
  session.messageBranchGroupId !== ''
)

const mergeSessions = (sessions: Session[], extraSessions: Array<Session | undefined>) => {
  const sessionMap = new Map<string, Session>()
  for (const session of sessions) {
    sessionMap.set(session.id, session)
  }
  for (const session of extraSessions) {
    if (session != null && session.id !== '') {
      sessionMap.set(session.id, session)
    }
  }
  return sessionMap
}

export const resolveMessageBranchRootSessionId = (
  session: Session | undefined,
  sessions: Session[] = []
) => {
  if (session == null || session.id === '') {
    return undefined
  }

  const sessionMap = mergeSessions(sessions, [session])
  let current: Session | undefined = session
  const seenIds = new Set<string>()

  while (
    current?.messageBranchSourceSessionId != null &&
    current.messageBranchSourceSessionId !== '' &&
    !seenIds.has(current.id)
  ) {
    seenIds.add(current.id)
    const sourceSession = sessionMap.get(current.messageBranchSourceSessionId)
    if (sourceSession == null) {
      return current.messageBranchSourceSessionId
    }
    current = sourceSession
  }

  return current?.id ?? session.id
}

export const isMessageBranchOfRootSession = (
  session: Session | undefined,
  rootSessionId: string | undefined,
  sessions: Session[] = []
) => (
  session != null &&
  rootSessionId != null &&
  isMessageBranchSession(session) &&
  resolveMessageBranchRootSessionId(session, sessions) === rootSessionId
)

export const buildMessageBranchSearch = ({
  currentSearch,
  rootSessionId,
  targetSessionId
}: {
  currentSearch: string
  rootSessionId: string
  targetSessionId: string
}) => {
  const nextParams = new URLSearchParams(currentSearch)
  if (targetSessionId === rootSessionId) {
    nextParams.delete(MESSAGE_BRANCH_SESSION_QUERY)
  } else {
    nextParams.set(MESSAGE_BRANCH_SESSION_QUERY, targetSessionId)
  }

  const search = nextParams.toString()
  return search === '' ? '' : `?${search}`
}
