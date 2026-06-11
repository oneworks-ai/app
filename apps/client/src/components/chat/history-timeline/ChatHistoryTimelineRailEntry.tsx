import { Tooltip } from 'antd'
import type { ReactNode } from 'react'

import { getChatHistoryTimelineNodeAriaLabel, getChatHistoryTimelineNodeStatusClassName } from './node-status'
import type { TimelineRailEntry } from './rail-collapse'
import type { ChatHistoryTimelineNode, ChatHistoryTimelineSelectHandler } from './types'

export interface ChatHistoryTimelineRailPreviewContext {
  index: number
  label: string
  node: ChatHistoryTimelineNode
}

export function ChatHistoryTimelineRailEntry({
  entry,
  getNodePreview,
  onSelectNode,
  registerMarkerElement,
  selectedNodeId
}: {
  entry: TimelineRailEntry
  getNodePreview?: (context: ChatHistoryTimelineRailPreviewContext) => ReactNode
  onSelectNode?: ChatHistoryTimelineSelectHandler
  registerMarkerElement: (nodeId: string) => (element: HTMLButtonElement | null) => void
  selectedNodeId?: string
}) {
  if (entry.kind === 'ellipsis') {
    const targetNode = entry.firstHiddenEntry.node
    const ellipsisMarker = (
      <button
        type='button'
        className='chat-history-timeline-rail__marker is-ellipsis'
        aria-label={`${entry.hiddenCount} hidden timeline nodes, jump to ${targetNode.title ?? targetNode.messageId}`}
        onClick={() => onSelectNode?.(targetNode.id, { node: targetNode, source: 'rail' })}
      >
        <span className='chat-history-timeline-rail__ellipsis-dot' aria-hidden='true' />
      </button>
    )

    return (
      <Tooltip
        title={`Jump to ${targetNode.title ?? targetNode.messageId}`}
        placement='left'
        mouseEnterDelay={0.2}
        classNames={{ root: 'chat-history-timeline-rail-tooltip' }}
      >
        {ellipsisMarker}
      </Tooltip>
    )
  }

  const { index, label, node } = entry
  const forkCount = node.info.graph.forkCount ?? 0
  const preview = getNodePreview?.({ index, label, node })
  const marker = (
    <button
      type='button'
      ref={registerMarkerElement(node.id)}
      className={[
        'chat-history-timeline-rail__marker',
        node.id === selectedNodeId ? 'is-selected' : '',
        node.info.kind === 'question' ? 'is-question' : 'is-answer',
        forkCount > 0 ? 'has-fork' : '',
        getChatHistoryTimelineNodeStatusClassName(node)
      ].filter(Boolean).join(' ')}
      aria-label={getChatHistoryTimelineNodeAriaLabel(node)}
      onClick={() => onSelectNode?.(node.id, { node, source: 'rail' })}
    >
      <span className='chat-history-timeline-rail__marker-dot' />
      {forkCount > 0 && (
        <span className='chat-history-timeline-rail__fork-count'>
          {forkCount}
        </span>
      )}
    </button>
  )

  if (preview == null) return marker

  return (
    <Tooltip
      title={preview}
      placement='left'
      mouseEnterDelay={0.2}
      classNames={{ root: 'chat-history-timeline-rail-tooltip' }}
    >
      {marker}
    </Tooltip>
  )
}
