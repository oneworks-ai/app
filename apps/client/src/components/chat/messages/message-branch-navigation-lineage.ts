import type { Session } from '@oneworks/core'

export interface MessageBranchVariant {
  sessionId: string
  createdAt: number
}

export const isNavigableMessageBranch = (session: Session) => (
  session.messageBranchGroupId != null &&
  session.messageBranchGroupId !== '' &&
  (session.messageBranchAction === 'edit' || session.messageBranchAction === 'fork')
)

export const byCreatedAt = (left: Session, right: Session) => {
  const createdDelta = left.createdAt - right.createdAt
  if (createdDelta !== 0) return createdDelta
  return left.id.localeCompare(right.id)
}

export const byVariantCreatedAt = (left: MessageBranchVariant, right: MessageBranchVariant) => {
  const createdDelta = left.createdAt - right.createdAt
  if (createdDelta !== 0) return createdDelta
  return left.sessionId.localeCompare(right.sessionId)
}

export const mergeSessions = (sessions: Session[], currentSession?: Session) => {
  const sessionMap = new Map<string, Session>()
  for (const session of sessions) {
    sessionMap.set(session.id, session)
  }
  if (currentSession != null && currentSession.id !== '') {
    sessionMap.set(currentSession.id, currentSession)
  }
  return [...sessionMap.values()]
}

export const getSessionLineage = (
  currentSession: Session,
  sessionMap: Map<string, Session>
) => {
  const lineage: Session[] = []
  let session: Session | undefined = currentSession
  const seenIds = new Set<string>()

  while (session != null && session.id !== '' && !seenIds.has(session.id)) {
    lineage.push(session)
    seenIds.add(session.id)

    const sourceSessionId = session.messageBranchSourceSessionId
    if (sourceSessionId == null || sourceSessionId === '') {
      break
    }
    session = sessionMap.get(sourceSessionId)
  }

  return lineage
}

export const resolveSelectedVariant = (
  orderedVariants: MessageBranchVariant[],
  lineage: Session[]
) => {
  const variantIds = new Set(orderedVariants.map(variant => variant.sessionId))
  return lineage.find(session => variantIds.has(session.id))
}

export const isAnchorRetainedInCurrentTimeline = ({
  anchorIndex,
  currentSession,
  selectedVariant,
  sessionMap
}: {
  anchorIndex: number
  currentSession: Session
  selectedVariant?: Session
  sessionMap: Map<string, Session>
}) => {
  if (selectedVariant == null) {
    return false
  }

  let session: Session | undefined = currentSession
  const seenIds = new Set<string>()

  while (session != null && session.id !== '' && session.id !== selectedVariant.id && !seenIds.has(session.id)) {
    seenIds.add(session.id)

    const branchBaseIndex = session.messageBranchBaseMessageIndex
    if (
      branchBaseIndex != null &&
      Number.isInteger(branchBaseIndex) &&
      branchBaseIndex <= anchorIndex
    ) {
      return false
    }

    const sourceSessionId = session.messageBranchSourceSessionId
    if (sourceSessionId == null || sourceSessionId === '') {
      return false
    }
    session = sessionMap.get(sourceSessionId)
  }

  return session?.id === selectedVariant.id
}

export const buildBranchGroups = (sessions: Session[]) => {
  const branchesByGroup = new Map<string, Session[]>()

  for (const session of sessions) {
    if (!isNavigableMessageBranch(session)) {
      continue
    }

    const groupId = session.messageBranchGroupId
    if (groupId == null || groupId === '') {
      continue
    }

    const branches = branchesByGroup.get(groupId) ?? []
    branches.push(session)
    branchesByGroup.set(groupId, branches)
  }

  return branchesByGroup
}
