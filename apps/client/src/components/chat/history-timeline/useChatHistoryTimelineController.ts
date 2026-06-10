import { useCallback, useEffect, useMemo, useState } from 'react'

import { getChatHistoryTimelinePathNodes } from './timeline-graph'
import type { ChatHistoryTimelineNode, ChatHistoryTimelineSelectHandler } from './types'

export interface UseChatHistoryTimelineControllerOptions {
  defaultGraphExpanded?: boolean
  graphExpanded?: boolean
  initialNodeId?: string
  nodes: ChatHistoryTimelineNode[]
  onGraphExpandedChange?: (expanded: boolean) => void
  onSelectedNodeIdChange?: (nodeId: string) => void
  selectedNodeId?: string
}

const getFallbackNodeId = (
  nodes: ChatHistoryTimelineNode[],
  initialNodeId?: string
) => {
  if (initialNodeId != null && nodes.some(node => node.id === initialNodeId)) {
    return initialNodeId
  }

  return nodes[0]?.id ?? ''
}

export function useChatHistoryTimelineController({
  defaultGraphExpanded = false,
  graphExpanded,
  initialNodeId,
  nodes,
  onGraphExpandedChange,
  onSelectedNodeIdChange,
  selectedNodeId
}: UseChatHistoryTimelineControllerOptions) {
  const fallbackNodeId = getFallbackNodeId(nodes, initialNodeId)
  const [uncontrolledSelectedNodeId, setUncontrolledSelectedNodeId] = useState(fallbackNodeId)
  const [pathAnchorNodeId, setPathAnchorNodeId] = useState(fallbackNodeId)
  const [scrollTargetNodeId, setScrollTargetNodeId] = useState<string | null>(null)
  const [uncontrolledGraphExpanded, setUncontrolledGraphExpanded] = useState(defaultGraphExpanded)
  const resolvedSelectedNodeId = selectedNodeId ?? uncontrolledSelectedNodeId
  const resolvedGraphExpanded = graphExpanded ?? uncontrolledGraphExpanded
  const nodeIds = useMemo(() => new Set(nodes.map(node => node.id)), [nodes])

  useEffect(() => {
    if (fallbackNodeId === '') {
      if (selectedNodeId == null) {
        setUncontrolledSelectedNodeId('')
      }
      setPathAnchorNodeId('')
      return
    }

    if (selectedNodeId == null && !nodeIds.has(uncontrolledSelectedNodeId)) {
      setUncontrolledSelectedNodeId(fallbackNodeId)
    }

    if (!nodeIds.has(pathAnchorNodeId)) {
      setPathAnchorNodeId(fallbackNodeId)
    }
  }, [fallbackNodeId, nodeIds, pathAnchorNodeId, selectedNodeId, uncontrolledSelectedNodeId])

  const activePathNodes = useMemo(
    () => getChatHistoryTimelinePathNodes(nodes, pathAnchorNodeId || resolvedSelectedNodeId),
    [nodes, pathAnchorNodeId, resolvedSelectedNodeId]
  )
  const activeNodeIds = useMemo(
    () => new Set(activePathNodes.map(node => node.id)),
    [activePathNodes]
  )
  const scrollSpyNodeIds = useMemo(
    () =>
      new Set(
        activePathNodes
          .filter(node => node.info.rail?.marker ?? true)
          .map(node => node.id)
      ),
    [activePathNodes]
  )

  const setGraphExpanded = useCallback((nextExpanded: boolean) => {
    if (graphExpanded == null) {
      setUncontrolledGraphExpanded(nextExpanded)
    }

    onGraphExpandedChange?.(nextExpanded)
  }, [graphExpanded, onGraphExpandedChange])

  const setSelectedNode = useCallback((nodeId: string) => {
    if (selectedNodeId == null) {
      setUncontrolledSelectedNodeId(nodeId)
    }

    onSelectedNodeIdChange?.(nodeId)
  }, [onSelectedNodeIdChange, selectedNodeId])

  const selectNode = useCallback((nodeId: string) => {
    setSelectedNode(nodeId)
    setScrollTargetNodeId(nodeId)
  }, [setSelectedNode])

  const selectTimelineNode = useCallback<ChatHistoryTimelineSelectHandler>((nodeId, detail) => {
    if (detail.source === 'graph' && !activeNodeIds.has(nodeId)) {
      setPathAnchorNodeId(nodeId)
    }

    selectNode(nodeId)
  }, [activeNodeIds, selectNode])

  const setActiveNodeFromScroll = useCallback((nodeId: string) => {
    setSelectedNode(nodeId)
  }, [setSelectedNode])

  return {
    activeNodeIds,
    activePathNodes,
    graphExpanded: resolvedGraphExpanded,
    pathAnchorNodeId,
    scrollSpyNodeIds,
    scrollTargetNodeId,
    selectNode,
    selectTimelineNode,
    selectedNodeId: resolvedSelectedNodeId,
    setActiveNodeFromScroll,
    setGraphExpanded,
    setPathAnchorNodeId
  }
}
