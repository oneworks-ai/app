import { timelineGraphRowContentHeight, timelineGraphRowGap, timelineGraphTopOffset } from './timeline-graph'
import type { TimelineGraphRow } from './timeline-graph'
import type { ChatHistoryTimelineNode } from './types'

export interface TimelineGraphRowLayout {
  centerY: number
  contentHeight: number
  multiline: boolean
  spanHeight: number
}

const timelineGraphMultilineRowContentHeight = 78
const timelineGraphStatusRowContentHeight = 52

export const isChatHistoryTimelineMultilineNode = (
  node?: ChatHistoryTimelineNode
) => node?.description?.includes('\n') ?? false

export const buildChatHistoryTimelineGraphRowLayouts = (
  rows: TimelineGraphRow[],
  itemNodeByDepth: Map<number, ChatHistoryTimelineNode>
): TimelineGraphRowLayout[] => {
  let offsetY = 0

  return rows.map(row => {
    const itemNode = itemNodeByDepth.get(row.depth)
    const multiline = isChatHistoryTimelineMultilineNode(itemNode)
    const contentHeight = multiline
      ? timelineGraphMultilineRowContentHeight
      : itemNode?.info.status?.label != null
      ? timelineGraphStatusRowContentHeight
      : timelineGraphRowContentHeight
    const layout = {
      centerY: offsetY + contentHeight / 2,
      contentHeight,
      multiline,
      spanHeight: contentHeight + timelineGraphRowGap
    }

    offsetY += layout.spanHeight
    return layout
  })
}

export const buildChatHistoryTimelineGraphCenterYByNodeId = (
  rows: TimelineGraphRow[],
  rowLayouts: TimelineGraphRowLayout[]
) =>
  new Map(
    rows.flatMap((row, rowIndex) =>
      row.nodes.map(node => [node.id, rowLayouts[rowIndex]?.centerY ?? timelineGraphTopOffset] as const)
    )
  )
