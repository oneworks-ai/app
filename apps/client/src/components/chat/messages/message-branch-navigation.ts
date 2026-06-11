import type { ChatMessage, Session } from '@oneworks/core'

import {
  buildBranchGroups,
  byCreatedAt,
  byVariantCreatedAt,
  getSessionLineage,
  isAnchorRetainedInCurrentTimeline,
  mergeSessions,
  resolveSelectedVariant
} from './message-branch-navigation-lineage'
import type { MessageBranchVariant } from './message-branch-navigation-lineage'

export interface MessageBranchNavigation {
  current: number
  total: number
  previousSessionId?: string
  nextSessionId?: string
}

const resolveCurrentMessageId = ({
  anchorIndex,
  messages,
  selectedVariant,
  sourceMessageId,
  sourceSessionId
}: {
  anchorIndex: number
  messages: ChatMessage[]
  selectedVariant: Session
  sourceMessageId: string
  sourceSessionId: string
}) => {
  if (selectedVariant.id === sourceSessionId) {
    return messages.some(message => message.id === sourceMessageId) ? sourceMessageId : undefined
  }

  if (!Number.isInteger(anchorIndex) || anchorIndex < 0) {
    return undefined
  }

  const message = messages[anchorIndex]
  return message?.role === 'user' ? message.id : undefined
}

export const buildMessageBranchNavigationMap = ({
  currentSession,
  messages,
  sessions
}: {
  currentSession?: Session
  messages: ChatMessage[]
  sessions: Session[]
}) => {
  const navigationMap = new Map<string, MessageBranchNavigation>()
  if (currentSession == null || currentSession.id === '') {
    return navigationMap
  }

  const allSessions = mergeSessions(sessions, currentSession)
  const sessionMap = new Map(allSessions.map(session => [session.id, session]))
  const lineage = getSessionLineage(currentSession, sessionMap)
  const branchesByGroup = buildBranchGroups(allSessions)

  for (const branches of branchesByGroup.values()) {
    const sortedBranches = [...branches].sort(byCreatedAt)
    const sourceBranch = sortedBranches[0]
    const sourceSessionId = sourceBranch?.messageBranchSourceSessionId
    const sourceMessageId = sourceBranch?.messageBranchSourceMessageId
    const sourceMessageIndex = sourceBranch?.messageBranchBaseMessageIndex
    if (
      sourceSessionId == null ||
      sourceSessionId === '' ||
      sourceMessageId == null ||
      sourceMessageId === '' ||
      sourceMessageIndex == null ||
      !Number.isInteger(sourceMessageIndex) ||
      sourceMessageIndex < 0
    ) {
      continue
    }
    const sourceSession = sessionMap.get(sourceSessionId)
    const variants: MessageBranchVariant[] = []
    if (sourceSession != null) {
      variants.push({
        sessionId: sourceSession.id,
        createdAt: sourceSession.createdAt
      })
    }

    for (const branch of sortedBranches) {
      variants.push({
        sessionId: branch.id,
        createdAt: branch.createdAt
      })
    }

    const orderedVariants = variants.sort(byVariantCreatedAt)
    const selectedVariant = resolveSelectedVariant(orderedVariants, lineage)
    if (selectedVariant == null) {
      continue
    }

    const currentIndex = orderedVariants.findIndex(variant => variant.sessionId === selectedVariant.id)
    if (orderedVariants.length <= 1 || currentIndex < 0) {
      continue
    }

    const selectedSession = sessionMap.get(selectedVariant.id)
    if (selectedSession == null) {
      continue
    }

    const anchorIndex = selectedSession.id === sourceSessionId
      ? sourceMessageIndex
      : selectedSession.messageBranchBaseMessageIndex
    if (
      anchorIndex == null ||
      !Number.isInteger(anchorIndex) ||
      anchorIndex < 0 ||
      !isAnchorRetainedInCurrentTimeline({
        anchorIndex,
        currentSession,
        selectedVariant: selectedSession,
        sessionMap
      })
    ) {
      continue
    }

    const messageId = resolveCurrentMessageId({
      anchorIndex,
      messages,
      selectedVariant: selectedSession,
      sourceMessageId,
      sourceSessionId
    })
    if (messageId == null) {
      continue
    }

    navigationMap.set(messageId, {
      current: currentIndex + 1,
      total: orderedVariants.length,
      previousSessionId: currentIndex > 0 ? orderedVariants[currentIndex - 1]?.sessionId : undefined,
      nextSessionId: currentIndex < orderedVariants.length - 1
        ? orderedVariants[currentIndex + 1]?.sessionId
        : undefined
    })
  }

  return navigationMap
}
