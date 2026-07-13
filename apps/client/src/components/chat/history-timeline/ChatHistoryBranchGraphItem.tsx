import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'

import { TimelineMarks } from './TimelineMarks'
import { getChatHistoryTimelineNodeStatusClassName } from './node-status'
import type { ChatHistoryTimelineNode, ChatHistoryTimelineSelectHandler } from './types'

const nodeLabelByKind = {
  answer: 'A',
  question: 'Q'
} as const

export function ChatHistoryBranchGraphItem({
  active,
  multiline,
  node,
  onSelectNode,
  registerElement,
  selected
}: {
  active: boolean
  multiline: boolean
  node: ChatHistoryTimelineNode
  onSelectNode?: ChatHistoryTimelineSelectHandler
  registerElement: (nodeId: string, element: HTMLButtonElement | null) => void
  selected: boolean
}) {
  const statusClassName = getChatHistoryTimelineNodeStatusClassName(node)

  return (
    <button
      ref={element => registerElement(node.id, element)}
      type='button'
      className={[
        'chat-history-branch-graph-item',
        multiline ? 'has-message-preview' : '',
        selected ? 'is-selected' : '',
        active ? 'is-active-path' : 'is-side-path',
        statusClassName
      ].filter(Boolean).join(' ')}
      style={{ gridColumn: '-2 / -1' }}
      onClick={() => onSelectNode?.(node.id, { node, source: 'graph' })}
    >
      <span className='chat-history-branch-graph-item__meta'>
        <span>{node.timestamp ?? node.messageId}</span>
        <span>{nodeLabelByKind[node.info.kind]}</span>
        <span>{node.info.graph.branchId}</span>
        {(node.info.graph.forkCount ?? 0) > 0 && (
          <span className='chat-history-branch-graph-item__fork'>
            <MaterialSymbol name='call_split' className='chat-history-branch-graph-item__fork-icon' />
            {node.info.graph.forkCount}
          </span>
        )}
        <TimelineMarks marks={node.info.marks} />
        {statusClassName != null && (
          <span className={['chat-history-branch-graph-item__status', statusClassName].join(' ')}>
            {node.info.status?.label ?? node.info.status?.state}
          </span>
        )}
      </span>
      <span className='chat-history-branch-graph-item__title'>
        {node.title ?? node.messageId}
      </span>
      {multiline && (
        <span className='chat-history-branch-graph-item__message'>
          {node.description}
        </span>
      )}
    </button>
  )
}
