import './ChatHistoryTimeline.scss'

import { useRef } from 'react'
import type { ReactNode } from 'react'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'

import { ChatHistoryTimelineRailEntry } from './ChatHistoryTimelineRailEntry'
import type {
  ChatHistoryTimelineRailForkDisclosure,
  ChatHistoryTimelineRailPreviewContext
} from './ChatHistoryTimelineRailEntry'
import { TimelineMarks } from './TimelineMarks'
import { buildCollapsedRailEntries, defaultCollapseThreshold } from './rail-collapse'
import type { TimelineRailMarkerEntry } from './rail-collapse'
import type {
  ChatHistoryTimelineNode,
  ChatHistoryTimelineRailRenderMode,
  ChatHistoryTimelineSelectHandler
} from './types'
import { useTimelineRailCollapseThreshold } from './useTimelineRailCollapseThreshold'
import { useTimelineRailSelectionCursor } from './useTimelineRailSelectionCursor'

export type { ChatHistoryTimelineRailPreviewContext }

export interface ChatHistoryTimelineRailProps {
  activeBranchLabel?: string
  className?: string
  footerAction?: ReactNode
  forkDisclosure?: ChatHistoryTimelineRailForkDisclosure
  getNodePreview?: (context: ChatHistoryTimelineRailPreviewContext) => ReactNode
  markerFilter?: (node: ChatHistoryTimelineNode) => boolean
  nodes: ChatHistoryTimelineNode[]
  onExpandFork?: (node: ChatHistoryTimelineNode) => void
  onSelectNode?: ChatHistoryTimelineSelectHandler
  renderMode?: ChatHistoryTimelineRailRenderMode
  collapseThreshold?: number
  selectedNodeId?: string
  showHeader?: boolean
  showSelectionPreview?: boolean
  topAction?: ReactNode
}

const defaultMarkerFilter = (node: ChatHistoryTimelineNode) =>
  node.info.graph.isOnActivePath && (node.info.rail?.marker ?? true)

const labelPrefixByKind = {
  answer: 'A',
  question: 'Q'
} as const

export function ChatHistoryTimelineRail({
  activeBranchLabel = 'main',
  className,
  collapseThreshold = defaultCollapseThreshold,
  footerAction,
  forkDisclosure,
  getNodePreview,
  markerFilter = defaultMarkerFilter,
  nodes,
  onExpandFork,
  onSelectNode,
  renderMode = 'node',
  selectedNodeId,
  showHeader = false,
  showSelectionPreview = false,
  topAction
}: ChatHistoryTimelineRailProps) {
  const bodyElementRef = useRef<HTMLDivElement | null>(null)
  const resolvedCollapseThreshold = useTimelineRailCollapseThreshold({
    bodyElementRef,
    minimumThreshold: collapseThreshold
  })
  const markers = nodes.filter(markerFilter)
  const markerLabelCounts = {
    answer: 0,
    question: 0
  }
  const markersWithLabels: TimelineRailMarkerEntry[] = markers.map((node, index) => {
    const kindIndex = markerLabelCounts[node.info.kind] + 1
    markerLabelCounts[node.info.kind] = kindIndex

    return {
      index,
      kind: 'marker',
      label: node.label ?? `${labelPrefixByKind[node.info.kind]}${kindIndex}`,
      node
    }
  })
  const railEntries = renderMode === 'event-line'
    ? markersWithLabels
    : buildCollapsedRailEntries(markersWithLabels, selectedNodeId, resolvedCollapseThreshold)
  const selectedNode = nodes.find(node => node.id === selectedNodeId) ?? markers[0] ?? nodes[0]
  const selectedMarkerNodeId = markers.some(marker => marker.id === selectedNode?.id)
    ? selectedNode?.id
    : undefined
  const railEntryKey = railEntries
    .map(entry => entry.kind === 'ellipsis' ? entry.key : entry.node.id)
    .join('|')
  const {
    canScrollDown,
    canScrollUp,
    registerMarkerElement,
    selectionCursorStyle,
    selectionCursorVisible
  } = useTimelineRailSelectionCursor({
    bodyElementRef,
    keepSelectedMarkerVisible: renderMode === 'event-line',
    layoutKey: railEntryKey,
    selectedMarkerNodeId
  })
  const classes = [
    'chat-history-timeline-rail',
    `is-${renderMode}-mode`,
    canScrollDown ? 'can-scroll-down' : '',
    canScrollUp ? 'can-scroll-up' : '',
    footerAction != null ? 'has-footer-action' : '',
    topAction != null ? 'has-top-action' : '',
    className
  ].filter(Boolean).join(' ')

  return (
    <nav className={classes} aria-label='Chat history timeline'>
      {showHeader && (
        <header className='chat-history-timeline-rail__header'>
          <span className='chat-history-timeline-rail__title'>
            <MaterialSymbol name='schedule' className='chat-history-timeline-rail__title-icon' />
            <span>Timeline</span>
          </span>
          <span className='chat-history-timeline-rail__branch'>{activeBranchLabel}</span>
        </header>
      )}

      {topAction != null && (
        <div className='chat-history-timeline-rail__top-action'>
          {topAction}
        </div>
      )}

      <div ref={bodyElementRef} className='chat-history-timeline-rail__body'>
        <div className='chat-history-timeline-rail__track' />
        <span
          className={[
            'chat-history-timeline-rail__selection-cursor',
            selectionCursorVisible ? 'is-visible' : ''
          ].filter(Boolean).join(' ')}
          style={selectionCursorStyle}
          aria-hidden='true'
        />
        {railEntries.map(entry => (
          <ChatHistoryTimelineRailEntry
            key={entry.kind === 'ellipsis' ? entry.key : entry.node.id}
            entry={entry}
            forkDisclosure={forkDisclosure}
            getNodePreview={getNodePreview}
            onExpandFork={onExpandFork}
            onSelectNode={onSelectNode}
            renderMode={renderMode}
            registerMarkerElement={registerMarkerElement}
            selectedNodeId={selectedNode?.id}
          />
        ))}
      </div>

      {footerAction != null && (
        <div className='chat-history-timeline-rail__footer-action'>
          {footerAction}
        </div>
      )}

      {showSelectionPreview && selectedNode != null && (
        <footer className='chat-history-timeline-rail__selection'>
          <span className='chat-history-timeline-rail__selection-time'>
            {selectedNode.timestamp ?? selectedNode.messageId}
          </span>
          <strong>{selectedNode.title ?? selectedNode.messageId}</strong>
          <span>{selectedNode.info.graph.branchId}</span>
          <TimelineMarks marks={selectedNode.info.marks} />
        </footer>
      )}
    </nav>
  )
}
