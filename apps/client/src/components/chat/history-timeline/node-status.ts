import type { ChatHistoryTimelineNode } from './types'

export const getChatHistoryTimelineNodeStatusClassName = (
  node: ChatHistoryTimelineNode
) => {
  const state = node.info.status?.state

  if (state == null || state === 'complete') return undefined

  return `is-status-${state}`
}

export const getChatHistoryTimelineNodeAriaLabel = (
  node: ChatHistoryTimelineNode
) => {
  const label = node.title ?? node.messageId
  const statusLabel = node.info.status?.label

  if (statusLabel == null || statusLabel.length === 0) return label

  return `${label}, ${statusLabel}`
}
