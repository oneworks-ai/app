import './ChatHistoryTimeline.scss'

import type { CSSProperties } from 'react'
import { useMemo } from 'react'

import { ChatHistoryBranchGraphItem } from './ChatHistoryBranchGraphItem'
import { getChatHistoryTimelineNodeAriaLabel, getChatHistoryTimelineNodeStatusClassName } from './node-status'
import {
  buildChatHistoryTimelineGraphPaths,
  buildChatHistoryTimelineGraphRows,
  getChatHistoryTimelineLaneCount,
  getChatHistoryTimelinePathNodes,
  timelineGraphLaneWidth
} from './timeline-graph'
import {
  buildChatHistoryTimelineGraphCenterYByNodeId,
  buildChatHistoryTimelineGraphRowLayouts,
  isChatHistoryTimelineMultilineNode
} from './timeline-graph-layout'
import type { ChatHistoryTimelineNode, ChatHistoryTimelineSelectHandler } from './types'
import { useSelectedTimelineGraphScroll } from './useSelectedTimelineGraphScroll'

export interface ChatHistoryBranchGraphProps {
  activeNodeIds?: Set<string>
  className?: string
  itemNodes?: ChatHistoryTimelineNode[]
  nodes: ChatHistoryTimelineNode[]
  onSelectNode?: ChatHistoryTimelineSelectHandler
  pathNodes?: ChatHistoryTimelineNode[]
  selectedNodeId?: string
}

const nodeClassNameByKind = {
  answer: 'is-answer',
  question: 'is-question'
} as const

export function ChatHistoryBranchGraph({
  activeNodeIds: activeNodeIdsProp,
  className,
  itemNodes: itemNodesProp,
  nodes,
  onSelectNode,
  pathNodes: pathNodesProp,
  selectedNodeId
}: ChatHistoryBranchGraphProps) {
  const { bodyElementRef, registerItemElement, registerNodeElement } = useSelectedTimelineGraphScroll(selectedNodeId)
  const pathNodes = useMemo(
    () => pathNodesProp ?? getChatHistoryTimelinePathNodes(nodes, selectedNodeId),
    [nodes, pathNodesProp, selectedNodeId]
  )
  const graphRows = useMemo(() => buildChatHistoryTimelineGraphRows(nodes), [nodes])
  const graphNodes = useMemo(
    () => Array.from(new Map(graphRows.flatMap(row => row.nodes).map(node => [node.id, node])).values()),
    [graphRows]
  )
  const activeNodeIds = useMemo(
    () => activeNodeIdsProp ?? new Set(pathNodes.map(node => node.id)),
    [activeNodeIdsProp, pathNodes]
  )
  const itemNodes = itemNodesProp ?? pathNodes
  const itemNodeByDepth = useMemo(
    () => new Map(itemNodes.map(node => [node.info.graph.depth, node])),
    [itemNodes]
  )
  const rowLayouts = useMemo(
    () => buildChatHistoryTimelineGraphRowLayouts(graphRows, itemNodeByDepth),
    [itemNodeByDepth, graphRows]
  )
  const rowIndexByNodeId = useMemo(
    () =>
      new Map(
        graphRows.flatMap((row, rowIndex) => row.nodes.map(node => [node.id, rowIndex] as const))
      ),
    [graphRows]
  )
  const centerYByNodeId = useMemo(
    () => buildChatHistoryTimelineGraphCenterYByNodeId(graphRows, rowLayouts),
    [graphRows, rowLayouts]
  )
  const graphPaths = useMemo(
    () =>
      buildChatHistoryTimelineGraphPaths(
        graphNodes,
        rowIndexByNodeId,
        activeNodeIds,
        centerYByNodeId
      ),
    [activeNodeIds, centerYByNodeId, graphNodes, rowIndexByNodeId]
  )
  const laneCount = useMemo(() => getChatHistoryTimelineLaneCount(graphNodes), [graphNodes])
  const graphWidth = laneCount * timelineGraphLaneWidth
  const graphHeight = rowLayouts.reduce((total, layout) => total + layout.spanHeight, 0)
  const rowGridStyle = {
    gridTemplateColumns: `repeat(${laneCount}, ${timelineGraphLaneWidth}px) minmax(0, 1fr)`
  }
  const classes = ['chat-history-branch-graph', className].filter(Boolean).join(' ')

  return (
    <section className={classes} aria-label='Chat history branch graph'>
      <div ref={bodyElementRef} className='chat-history-branch-graph__body'>
        <svg
          className='chat-history-branch-graph__links'
          width={graphWidth}
          height={graphHeight}
          viewBox={`0 0 ${graphWidth} ${graphHeight}`}
          aria-hidden='true'
        >
          {graphPaths.map(path => (
            <path key={path.key} className={path.active ? 'is-active' : 'is-side'} d={path.d} fill='none' />
          ))}
        </svg>

        <div className='chat-history-branch-graph__rows'>
          {graphRows.map((row, rowIndex) => {
            const displayNode = itemNodeByDepth.get(row.depth)
            const rowStyle = {
              ...rowGridStyle,
              '--chat-history-branch-graph-row-min-height': `${rowLayouts[rowIndex]?.contentHeight}px`
            } as CSSProperties
            const multiline = isChatHistoryTimelineMultilineNode(displayNode)

            return (
              <div
                key={row.key}
                className={[
                  'chat-history-branch-graph__row',
                  row.nodes.some(node => activeNodeIds.has(node.id))
                    ? 'is-active-path'
                    : 'is-side-path'
                ].join(' ')}
                style={rowStyle}
              >
                {row.nodes.map(node => (
                  <div
                    key={node.id}
                    className='chat-history-branch-graph__node-cell'
                    style={{ gridColumn: node.info.graph.lane + 1 } as CSSProperties}
                  >
                    <button
                      ref={element => registerNodeElement(node.id, element)}
                      type='button'
                      className={[
                        'chat-history-branch-graph__node',
                        selectedNodeId === node.id ? 'is-selected' : '',
                        nodeClassNameByKind[node.info.kind],
                        (node.info.graph.forkCount ?? 0) > 0 ? 'has-fork' : '',
                        getChatHistoryTimelineNodeStatusClassName(node)
                      ].filter(Boolean).join(' ')}
                      aria-label={getChatHistoryTimelineNodeAriaLabel(node)}
                      onClick={() => onSelectNode?.(node.id, { node, source: 'graph' })}
                    >
                      <span />
                    </button>
                  </div>
                ))}

                {displayNode != null && (
                  <ChatHistoryBranchGraphItem
                    active={activeNodeIds.has(displayNode.id)}
                    multiline={multiline}
                    node={displayNode}
                    onSelectNode={onSelectNode}
                    registerElement={registerItemElement}
                    selected={selectedNodeId === displayNode.id}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
