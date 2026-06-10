import './ChatHistoryTimeline.scss'

import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'

import { ChatHistoryBranchGraph } from './ChatHistoryBranchGraph'
import { ChatHistoryTimelineRail } from './ChatHistoryTimelineRail'
import type { ChatHistoryTimelineRailPreviewContext } from './ChatHistoryTimelineRail'
import { getChatHistoryTimelinePathNodes } from './timeline-graph'
import type { ChatHistoryTimelineNode, ChatHistoryTimelineSelectHandler } from './types'

export interface ChatHistoryTimelineViewProps {
  activeBranchLabel?: string
  activeNodeIds?: Set<string>
  branchGraphClassName?: string
  className?: string
  collapseThreshold?: number
  defaultGraphExpanded?: boolean
  getNodePreview?: (context: ChatHistoryTimelineRailPreviewContext) => ReactNode
  graphAction?: ReactNode
  graphExpanded?: boolean
  graphToggleLabels?: {
    collapse: string
    expand: string
  }
  markerFilter?: (node: ChatHistoryTimelineNode) => boolean
  nodes: ChatHistoryTimelineNode[]
  onGraphExpandedChange?: (expanded: boolean) => void
  onSelectNode?: ChatHistoryTimelineSelectHandler
  pathNodes?: ChatHistoryTimelineNode[]
  railClassName?: string
  selectedNodeId?: string
  showGraphToggle?: boolean
}

const getDefaultActiveBranchLabel = (
  activePathNodes: ChatHistoryTimelineNode[],
  selectedNodeId?: string
) =>
  activePathNodes.find(node => node.id === selectedNodeId)?.info.graph.branchId ??
    activePathNodes.at(-1)?.info.graph.branchId ??
    'main'

const defaultGraphToggleLabels = {
  collapse: 'Collapse graph mode',
  expand: 'Expand graph mode'
}

export function ChatHistoryTimelineView({
  activeBranchLabel,
  activeNodeIds,
  branchGraphClassName,
  className,
  collapseThreshold,
  defaultGraphExpanded = false,
  getNodePreview,
  graphAction,
  graphExpanded,
  graphToggleLabels = defaultGraphToggleLabels,
  markerFilter,
  nodes,
  onGraphExpandedChange,
  onSelectNode,
  pathNodes,
  railClassName,
  selectedNodeId,
  showGraphToggle = true
}: ChatHistoryTimelineViewProps) {
  const [uncontrolledGraphExpanded, setUncontrolledGraphExpanded] = useState(defaultGraphExpanded)
  const resolvedGraphExpanded = graphExpanded ?? uncontrolledGraphExpanded
  const activePathNodes = useMemo(
    () => pathNodes ?? getChatHistoryTimelinePathNodes(nodes, selectedNodeId),
    [nodes, pathNodes, selectedNodeId]
  )
  const resolvedActiveNodeIds = useMemo(
    () => activeNodeIds ?? new Set(activePathNodes.map(node => node.id)),
    [activeNodeIds, activePathNodes]
  )
  const resolvedActiveBranchLabel = activeBranchLabel ??
    getDefaultActiveBranchLabel(activePathNodes, selectedNodeId)
  const resolvedMarkerFilter = useMemo(
    () =>
      markerFilter ??
        ((node: ChatHistoryTimelineNode) => resolvedActiveNodeIds.has(node.id) && (node.info.rail?.marker ?? true)),
    [markerFilter, resolvedActiveNodeIds]
  )

  const setGraphExpanded = useCallback((nextExpanded: boolean) => {
    if (graphExpanded == null) {
      setUncontrolledGraphExpanded(nextExpanded)
    }

    onGraphExpandedChange?.(nextExpanded)
  }, [graphExpanded, onGraphExpandedChange])

  const defaultGraphAction = showGraphToggle
    ? (
      <button
        type='button'
        className={[
          'chat-history-timeline-view__graph-action',
          resolvedGraphExpanded ? 'is-expanded' : ''
        ].filter(Boolean).join(' ')}
        aria-label={resolvedGraphExpanded ? graphToggleLabels.collapse : graphToggleLabels.expand}
        aria-expanded={resolvedGraphExpanded}
        title={resolvedGraphExpanded ? graphToggleLabels.collapse : graphToggleLabels.expand}
        onClick={() => setGraphExpanded(!resolvedGraphExpanded)}
      >
        <MaterialSymbol
          name='account_tree'
          className='chat-history-timeline-view__graph-action-icon'
        />
      </button>
    )
    : undefined
  const classes = [
    'chat-history-timeline-view',
    resolvedGraphExpanded ? 'is-graph-expanded' : '',
    className
  ].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <div
        className='chat-history-timeline-view__graph-drawer'
        aria-hidden={!resolvedGraphExpanded}
      >
        <ChatHistoryBranchGraph
          className={[
            'chat-history-timeline-view__branch-graph',
            branchGraphClassName
          ].filter(Boolean).join(' ')}
          nodes={nodes}
          activeNodeIds={resolvedActiveNodeIds}
          pathNodes={activePathNodes}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      </div>
      <ChatHistoryTimelineRail
        className={[
          'chat-history-timeline-view__rail',
          railClassName
        ].filter(Boolean).join(' ')}
        activeBranchLabel={resolvedActiveBranchLabel}
        collapseThreshold={collapseThreshold}
        topAction={graphAction ?? defaultGraphAction}
        nodes={nodes}
        markerFilter={resolvedMarkerFilter}
        selectedNodeId={selectedNodeId}
        getNodePreview={getNodePreview}
        onSelectNode={onSelectNode}
      />
    </div>
  )
}
