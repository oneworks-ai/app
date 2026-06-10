import { describe, expect, it } from 'vitest'

import { buildCollapsedRailEntries } from '#~/components/chat/history-timeline/rail-collapse'
import type { TimelineRailEntry } from '#~/components/chat/history-timeline/rail-collapse'
import {
  buildChatHistoryTimelineGraphPaths,
  buildChatHistoryTimelineGraphRows,
  timelineGraphPathEndpointInset
} from '#~/components/chat/history-timeline/timeline-graph'
import {
  buildChatHistoryTimelineGraphCenterYByNodeId,
  buildChatHistoryTimelineGraphRowLayouts
} from '#~/components/chat/history-timeline/timeline-graph-layout'
import type { ChatHistoryTimelineNode, ChatHistoryTimelineNodeKind } from '#~/components/chat/history-timeline/types'
import { getTimelineRailCollapseThresholdForHeight } from '#~/components/chat/history-timeline/useTimelineRailCollapseThreshold'

const createTimelineNode = ({
  childIds = [],
  depth,
  id,
  kind,
  parentId,
  status
}: {
  childIds?: string[]
  depth: number
  id: string
  kind: ChatHistoryTimelineNodeKind
  parentId?: string
  status?: { label: string; state: 'running' | 'permission' }
}): ChatHistoryTimelineNode => ({
  id,
  info: {
    graph: {
      branchId: 'main',
      childIds,
      depth,
      isOnActivePath: true,
      lane: 0,
      parentId,
      siblingCount: 1,
      siblingIndex: 0
    },
    kind,
    status
  },
  messageId: id,
  timestamp: '10:00',
  title: id
})

const readFinalLineY = (path: string) => {
  const match = path.match(/L [\d.]+ ([\d.]+)$/)

  if (match == null) {
    throw new Error(`Expected a straight graph path, received: ${path}`)
  }

  return Number(match[1])
}

const getMarkerRunsBetweenEllipses = (entries: TimelineRailEntry[]) => {
  const runs: number[] = []
  let cursor = 0

  while (cursor < entries.length) {
    if (entries[cursor]?.kind === 'ellipsis') {
      const markerStart = cursor + 1
      let markerEnd = markerStart

      while (markerEnd < entries.length && entries[markerEnd]?.kind === 'marker') {
        markerEnd += 1
      }

      if (entries[markerEnd]?.kind === 'ellipsis') {
        runs.push(markerEnd - markerStart)
      }

      cursor = markerEnd
      continue
    }

    cursor += 1
  }

  return runs
}

describe('chat history timeline graph layout', () => {
  it('raises the rail collapse threshold when the viewport is taller', () => {
    const compactThreshold = getTimelineRailCollapseThresholdForHeight({
      bodyHeight: 300,
      minimumThreshold: 10,
      paddingBottom: 18,
      paddingTop: 18
    })
    const tallThreshold = getTimelineRailCollapseThresholdForHeight({
      bodyHeight: 900,
      minimumThreshold: 10,
      paddingBottom: 18,
      paddingTop: 18
    })

    expect(compactThreshold).toBe(10)
    expect(tallThreshold).toBe(24)
    expect(tallThreshold).toBeGreaterThan(compactThreshold)
  })

  it('fills available rail height with ordinary timeline markers', () => {
    const entries = Array.from({ length: 80 }, (_, index) => {
      const node = createTimelineNode({
        depth: index,
        id: `node-${index}`,
        kind: index % 2 === 0 ? 'question' : 'answer'
      })

      return {
        index,
        kind: 'marker' as const,
        label: String(index),
        node
      }
    })

    const compactEntries = buildCollapsedRailEntries(entries, 'node-40', 10)
    const tallEntries = buildCollapsedRailEntries(entries, 'node-40', 24)
    const compactMarkers = compactEntries.filter(entry => entry.kind === 'marker').length
    const tallMarkers = tallEntries.filter(entry => entry.kind === 'marker').length

    expect(compactMarkers).toBeGreaterThan(3)
    expect(tallMarkers).toBeGreaterThan(compactMarkers)
    expect(tallEntries.length).toBeGreaterThan(compactEntries.length)
    expect(tallEntries.length).toBeLessThanOrEqual(28)
    expect(getMarkerRunsBetweenEllipses(tallEntries).every(count => count >= 5)).toBe(true)
  })

  it('keeps status rows and final rail paths visually attached', () => {
    const nodes: ChatHistoryTimelineNode[] = [
      createTimelineNode({
        childIds: ['answer'],
        depth: 0,
        id: 'question',
        kind: 'question'
      }),
      createTimelineNode({
        childIds: ['selection'],
        depth: 1,
        id: 'answer',
        kind: 'answer',
        parentId: 'question',
        status: { label: 'Running', state: 'running' }
      }),
      createTimelineNode({
        childIds: ['final'],
        depth: 2,
        id: 'selection',
        kind: 'question',
        parentId: 'answer'
      }),
      createTimelineNode({
        depth: 3,
        id: 'final',
        kind: 'question',
        parentId: 'selection',
        status: { label: 'Running', state: 'running' }
      })
    ]

    const rows = buildChatHistoryTimelineGraphRows(nodes)
    const rowLayouts = buildChatHistoryTimelineGraphRowLayouts(
      rows,
      new Map(rows.map(row => [row.depth, row.nodes[0]]))
    )
    const centerYByNodeId = buildChatHistoryTimelineGraphCenterYByNodeId(rows, rowLayouts)
    const rowIndexByNodeId = new Map(
      rows.flatMap((row, rowIndex) => row.nodes.map(node => [node.id, rowIndex] as const))
    )
    const paths = buildChatHistoryTimelineGraphPaths(
      nodes,
      rowIndexByNodeId,
      new Set(nodes.map(node => node.id)),
      centerYByNodeId
    )
    const finalPath = paths.find(path => path.key === 'selection-final')

    expect(rowLayouts.map(layout => layout.contentHeight)).toEqual([48, 52, 48, 52])
    expect(finalPath).toBeDefined()
    expect((centerYByNodeId.get('final') ?? 0) - readFinalLineY(finalPath?.d ?? '')).toBe(
      timelineGraphPathEndpointInset
    )
    expect(timelineGraphPathEndpointInset).toBeLessThanOrEqual(2)
  })
})
