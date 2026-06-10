import type { SessionStatus } from '@oneworks/core'

import type { MessageRenderItem } from '../messages/message-render-types'
import type { MessageTurn } from '../messages/message-turns'
import { createTimelineDescription, createTimelineTitle, formatTimelineTimestamp } from './message-timeline-content'
import type { ChatHistoryTimelineNode, ChatHistoryTimelineNodeKind, ChatHistoryTimelineNodeStatus } from './types'

interface TimelineMessageAnchor {
  description?: string
  forkCount?: number
  item: MessageRenderItem
  kind: ChatHistoryTimelineNodeKind
  title: string
}

export interface ChatHistoryTimelineCurrentStatus {
  label?: string
  state: ChatHistoryTimelineNodeStatus
}

export interface BuildChatHistoryTimelineFromMessageTurnsOptions {
  activeBranchLabel?: string
  currentStatus?: ChatHistoryTimelineCurrentStatus
  getForkCount?: (messageId: string) => number | undefined
  turns: MessageTurn[]
}

export interface ChatHistoryTimelineMessageProjection {
  anchorIdByNodeId: Map<string, string>
  initialNodeId?: string
  nodes: ChatHistoryTimelineNode[]
}

const defaultBranchLabel = 'main'

const isMessageItem = (item: MessageTurn['items'][number]): item is MessageRenderItem => item.type === 'message'

const getTurnTimelineItems = (turn: MessageTurn) => {
  const messageItems = turn.items.filter(isMessageItem)
  const userItems = messageItems.filter(item => item.originalMessage.role === 'user')
  const finalAssistantItem = [...messageItems].reverse()
    .find(item => item.originalMessage.role === 'assistant')

  if (userItems.length === 0) {
    return finalAssistantItem == null ? [] : [finalAssistantItem]
  }

  if (finalAssistantItem == null) {
    return userItems
  }

  return userItems.some(item => item.anchorId === finalAssistantItem.anchorId)
    ? userItems
    : [...userItems, finalAssistantItem]
}

const resolveCurrentStatus = (
  sessionStatus?: SessionStatus,
  status?: ChatHistoryTimelineCurrentStatus
) => {
  if (status != null) return status
  if (sessionStatus === 'running') return { state: 'running' as const }
  if (sessionStatus === 'waiting_input') return { state: 'waiting' as const }
  if (sessionStatus === 'failed') return { state: 'error' as const }
  return undefined
}

export const buildChatHistoryTimelineCurrentStatus = ({
  interactionKind,
  labels,
  sessionStatus
}: {
  interactionKind?: 'permission' | 'question'
  labels?: {
    failed?: string
    permission?: string
    running?: string
    terminated?: string
    waiting?: string
  }
  sessionStatus?: SessionStatus
}): ChatHistoryTimelineCurrentStatus | undefined => {
  if (sessionStatus === 'running') {
    return { label: labels?.running, state: 'running' }
  }
  if (sessionStatus === 'waiting_input') {
    return interactionKind === 'permission'
      ? { label: labels?.permission, state: 'permission' }
      : { label: labels?.waiting, state: 'ask-user' }
  }
  if (sessionStatus === 'failed') {
    return { label: labels?.failed, state: 'error' }
  }
  if (sessionStatus === 'terminated') {
    return { label: labels?.terminated, state: 'complete' }
  }

  return undefined
}

export const buildChatHistoryTimelineFromMessageTurns = ({
  activeBranchLabel = defaultBranchLabel,
  currentStatus,
  getForkCount,
  turns
}: BuildChatHistoryTimelineFromMessageTurnsOptions): ChatHistoryTimelineMessageProjection => {
  const seenAnchorIds = new Set<string>()
  const anchors: TimelineMessageAnchor[] = []

  for (const turn of turns) {
    for (const item of getTurnTimelineItems(turn)) {
      if (seenAnchorIds.has(item.anchorId)) {
        continue
      }

      seenAnchorIds.add(item.anchorId)

      const title = createTimelineTitle(item)
      const forkCount = getForkCount?.(item.originalMessage.id)

      anchors.push({
        description: createTimelineDescription(item, title),
        forkCount: forkCount != null && forkCount > 1 ? forkCount : undefined,
        item,
        kind: item.originalMessage.role === 'assistant' ? 'answer' : 'question',
        title
      })
    }
  }

  const nodes = anchors.map((anchor, index): ChatHistoryTimelineNode => {
    const previousAnchor = anchors[index - 1]
    const nextAnchor = anchors[index + 1]
    const isLastNode = index === anchors.length - 1
    const nodeStatus = isLastNode ? resolveCurrentStatus(undefined, currentStatus) : undefined

    return {
      description: anchor.description,
      id: anchor.item.anchorId,
      info: {
        graph: {
          activeChildId: nextAnchor?.item.anchorId,
          branchId: activeBranchLabel,
          childIds: nextAnchor == null ? [] : [nextAnchor.item.anchorId],
          depth: index,
          forkCount: anchor.forkCount,
          isOnActivePath: true,
          lane: 0,
          parentId: previousAnchor?.item.anchorId,
          siblingCount: 1,
          siblingIndex: 0
        },
        kind: anchor.kind,
        rail: {
          marker: true
        },
        status: nodeStatus
      },
      messageId: anchor.item.originalMessage.id,
      timestamp: formatTimelineTimestamp(anchor.item.originalMessage.createdAt),
      title: anchor.title
    }
  })

  return {
    anchorIdByNodeId: new Map(nodes.map(node => [node.id, node.id])),
    initialNodeId: nodes.at(-1)?.id,
    nodes
  }
}
