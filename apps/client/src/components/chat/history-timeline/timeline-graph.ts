import type { ChatHistoryTimelineNode } from './types'

interface TimelineGraphEdge {
  from: string
  to: string
}

export interface TimelineGraphPath {
  active: boolean
  d: string
  key: string
}

export interface TimelineGraphRow {
  depth: number
  key: string
  nodes: ChatHistoryTimelineNode[]
}

export const timelineGraphLaneWidth = 24
export const timelineGraphPathEndpointInset = 2
export const timelineGraphRowContentHeight = 48
export const timelineGraphRowGap = 10
export const timelineGraphRowHeight = timelineGraphRowContentHeight + timelineGraphRowGap
export const timelineGraphTopOffset = timelineGraphRowContentHeight / 2

export const buildChatHistoryTimelineNodeMap = (
  nodes: ChatHistoryTimelineNode[]
) => new Map(nodes.map(node => [node.id, node]))

export const getChatHistoryTimelineLaneCount = (
  nodes: ChatHistoryTimelineNode[]
) => Math.max(1, ...nodes.map(node => node.info.graph.lane + 1))

export const getChatHistoryTimelineEdges = (
  nodes: ChatHistoryTimelineNode[]
): TimelineGraphEdge[] =>
  nodes.flatMap(node => node.info.graph.childIds.map(childId => ({ from: node.id, to: childId })))

const sortGraphNodes = (
  leftNode: ChatHistoryTimelineNode,
  rightNode: ChatHistoryTimelineNode
) => leftNode.info.graph.lane - rightNode.info.graph.lane

export const buildChatHistoryTimelineGraphRows = (
  nodes: ChatHistoryTimelineNode[],
  pathNodes?: ChatHistoryTimelineNode[]
): TimelineGraphRow[] => {
  const rowByDepth = new Map<number, ChatHistoryTimelineNode[]>()

  if (pathNodes == null) {
    for (const node of nodes) {
      const rowNodes = rowByDepth.get(node.info.graph.depth) ?? []

      rowNodes.push(node)
      rowByDepth.set(node.info.graph.depth, rowNodes)
    }
  } else {
    for (const pathNode of pathNodes) {
      rowByDepth.set(
        pathNode.info.graph.depth,
        nodes.filter(node =>
          node.info.graph.depth === pathNode.info.graph.depth &&
          node.info.graph.parentId === pathNode.info.graph.parentId
        )
      )
    }
  }

  return Array.from(rowByDepth.entries())
    .sort(([leftDepth], [rightDepth]) => leftDepth - rightDepth)
    .map(([depth, rowNodes]) => ({
      depth,
      key: String(depth),
      nodes: rowNodes.sort(sortGraphNodes)
    }))
}

export const getChatHistoryTimelinePathNodes = (
  nodes: ChatHistoryTimelineNode[],
  selectedNodeId?: string
): ChatHistoryTimelineNode[] => {
  const nodeMap = buildChatHistoryTimelineNodeMap(nodes)
  const fallbackNode = nodes.find(node => node.info.graph.parentId == null && node.info.graph.isOnActivePath) ??
    nodes[0]
  const selectedNode = selectedNodeId == null ? fallbackNode : nodeMap.get(selectedNodeId) ?? fallbackNode

  if (selectedNode == null) return []

  const pathNodes: ChatHistoryTimelineNode[] = []
  const seenNodeIds = new Set<string>()
  let parentCursor: ChatHistoryTimelineNode | undefined = selectedNode

  while (parentCursor != null && !seenNodeIds.has(parentCursor.id)) {
    pathNodes.unshift(parentCursor)
    seenNodeIds.add(parentCursor.id)
    parentCursor = parentCursor.info.graph.parentId == null
      ? undefined
      : nodeMap.get(parentCursor.info.graph.parentId)
  }

  let childCursor = selectedNode

  while (childCursor.info.graph.activeChildId != null) {
    const nextChild = nodeMap.get(childCursor.info.graph.activeChildId)

    if (nextChild == null || seenNodeIds.has(nextChild.id)) break

    pathNodes.push(nextChild)
    seenNodeIds.add(nextChild.id)
    childCursor = nextChild
  }

  return pathNodes
}

const getGraphPoint = (
  node: ChatHistoryTimelineNode,
  rowIndex: number,
  laneCount: number,
  centerYByNodeId?: Map<string, number>
) => ({
  x: (laneCount - node.info.graph.lane - 0.5) * timelineGraphLaneWidth,
  y: centerYByNodeId?.get(node.id) ??
    rowIndex * timelineGraphRowHeight + timelineGraphTopOffset
})

export const buildChatHistoryTimelineGraphPaths = (
  nodes: ChatHistoryTimelineNode[],
  rowIndexByNodeId?: Map<string, number>,
  activeNodeIds?: Set<string>,
  centerYByNodeId?: Map<string, number>
): TimelineGraphPath[] => {
  const nodeMap = buildChatHistoryTimelineNodeMap(nodes)
  const laneCount = getChatHistoryTimelineLaneCount(nodes)
  const pointMap = new Map(
    nodes.map((node, index) => [
      node.id,
      getGraphPoint(
        node,
        rowIndexByNodeId?.get(node.id) ?? index,
        laneCount,
        centerYByNodeId
      )
    ])
  )

  return getChatHistoryTimelineEdges(nodes).flatMap(edge => {
    const fromNode = nodeMap.get(edge.from)
    const toNode = nodeMap.get(edge.to)
    const from = pointMap.get(edge.from)
    const to = pointMap.get(edge.to)

    if (from == null || to == null || fromNode == null || toNode == null) return []

    const xDiff = Math.abs(from.x - to.x)
    const midY = from.y + (to.y - from.y) / 2
    const d = xDiff === 0
      ? `M ${from.x} ${from.y + timelineGraphPathEndpointInset} L ${to.x} ${to.y - timelineGraphPathEndpointInset}`
      : `M ${from.x} ${from.y + timelineGraphPathEndpointInset} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${
        to.y - timelineGraphPathEndpointInset
      }`

    return [{
      active: activeNodeIds == null
        ? fromNode.info.graph.isOnActivePath && toNode.info.graph.isOnActivePath
        : activeNodeIds.has(fromNode.id) && activeNodeIds.has(toNode.id),
      d,
      key: `${edge.from}-${edge.to}`
    }]
  })
}
