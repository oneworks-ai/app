import { Tooltip } from 'antd'
import type { ReactNode } from 'react'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'

import { getChatHistoryTimelineNodeAriaLabel, getChatHistoryTimelineNodeStatusClassName } from './node-status'
import type { TimelineRailEntry } from './rail-collapse'
import type {
  ChatHistoryTimelineNode,
  ChatHistoryTimelineRailRenderMode,
  ChatHistoryTimelineSelectHandler
} from './types'

export interface ChatHistoryTimelineRailPreviewContext {
  index: number
  label: string
  node: ChatHistoryTimelineNode
}

export interface ChatHistoryTimelineRailForkDisclosure {
  controlsId: string
  expanded: boolean
}

function DefaultTimelineRailNodePreview({
  label,
  node
}: ChatHistoryTimelineRailPreviewContext) {
  const forkCount = node.info.graph.forkCount ?? 0
  const statusLabel = node.info.status?.state === 'complete'
    ? undefined
    : node.info.status?.label ?? node.info.status?.state

  return (
    <div className='chat-history-timeline-rail-preview'>
      <div className='chat-history-timeline-rail-preview__meta'>
        <span>{label}</span>
        <span>{node.info.kind === 'question' ? 'Q' : 'A'}</span>
        {node.timestamp != null && <span>{node.timestamp}</span>}
        <span>{node.info.graph.branchId}</span>
        {forkCount > 0 && (
          <span className='chat-history-timeline-rail-preview__fork'>
            <MaterialSymbol name='call_split' />
            {forkCount}
          </span>
        )}
        {statusLabel != null && <span>{statusLabel}</span>}
      </div>
      <strong>{node.title ?? node.messageId}</strong>
      {node.description != null && <p>{node.description}</p>}
    </div>
  )
}

export function ChatHistoryTimelineRailEntry({
  entry,
  forkDisclosure,
  getNodePreview,
  onExpandFork,
  onSelectNode,
  renderMode,
  registerMarkerElement,
  selectedNodeId
}: {
  entry: TimelineRailEntry
  forkDisclosure?: ChatHistoryTimelineRailForkDisclosure
  getNodePreview?: (context: ChatHistoryTimelineRailPreviewContext) => ReactNode
  onExpandFork?: (node: ChatHistoryTimelineNode) => void
  onSelectNode?: ChatHistoryTimelineSelectHandler
  renderMode: ChatHistoryTimelineRailRenderMode
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
        placement='right'
        mouseEnterDelay={0.2}
        classNames={{ root: 'chat-history-timeline-rail-tooltip' }}
      >
        {ellipsisMarker}
      </Tooltip>
    )
  }

  const { index, label, node } = entry
  const forkCount = node.info.graph.forkCount ?? 0
  const previewContext = { index, label, node }
  const preview = getNodePreview != null
    ? getNodePreview(previewContext)
    : renderMode === 'event-line'
    ? <DefaultTimelineRailNodePreview {...previewContext} />
    : null
  const exposesForkDisclosure = renderMode === 'event-line' && forkCount > 0 && forkDisclosure != null
  const canExpandFork = exposesForkDisclosure && onExpandFork != null
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
      aria-controls={exposesForkDisclosure ? forkDisclosure.controlsId : undefined}
      aria-expanded={exposesForkDisclosure ? forkDisclosure.expanded : undefined}
      aria-keyshortcuts={canExpandFork ? 'Shift+Enter' : undefined}
      aria-label={getChatHistoryTimelineNodeAriaLabel(node)}
      onClick={() => onSelectNode?.(node.id, { node, source: 'rail' })}
      onDoubleClick={canExpandFork ? () => onExpandFork(node) : undefined}
      onKeyDown={canExpandFork
        ? event => {
          if (event.key !== 'Enter' || !event.shiftKey) return

          event.preventDefault()
          onSelectNode?.(node.id, { node, source: 'rail' })
          onExpandFork(node)
        }
        : undefined}
    >
      {renderMode === 'event-line'
        ? <span className='chat-history-timeline-rail__event-line' aria-hidden='true' />
        : <span className='chat-history-timeline-rail__marker-dot' aria-hidden='true' />}
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
      placement='right'
      mouseEnterDelay={0.2}
      classNames={{ root: 'chat-history-timeline-rail-tooltip' }}
    >
      {marker}
    </Tooltip>
  )
}
