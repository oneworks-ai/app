import type { ChatHistoryTimelineNode } from './types'

export interface TimelineRailMarkerEntry {
  index: number
  kind: 'marker'
  label: string
  node: ChatHistoryTimelineNode
}

export interface TimelineRailEllipsisEntry {
  firstHiddenEntry: TimelineRailMarkerEntry
  hiddenCount: number
  key: string
  kind: 'ellipsis'
}

export type TimelineRailEntry = TimelineRailEllipsisEntry | TimelineRailMarkerEntry

export const defaultCollapseThreshold = 10
const minimumMarkerClusterSize = 5

const getTargetMarkerCount = (entriesLength: number, collapseThreshold: number) =>
  Math.min(
    entriesLength,
    Math.max(
      minimumMarkerClusterSize,
      Math.floor((collapseThreshold * minimumMarkerClusterSize) / (minimumMarkerClusterSize + 1))
    )
  )

const hasPriorityStatus = (node: ChatHistoryTimelineNode) =>
  node.info.status != null && node.info.status.state !== 'complete'

const hasMarks = (node: ChatHistoryTimelineNode) =>
  node.info.marks?.pinned === true || node.info.marks?.starred === true

const getMarkerKeepScore = (
  entry: TimelineRailMarkerEntry,
  lastIndex: number,
  selectedIndex: number
) => {
  if (entry.index === 0 || entry.index === lastIndex) return 1000
  if (entry.index === selectedIndex) return 900
  if (selectedIndex >= 0 && Math.abs(entry.index - selectedIndex) === 1) return 800
  if ((entry.node.info.graph.forkCount ?? 0) > 0) return 700
  if (hasPriorityStatus(entry.node)) return 650
  if (hasMarks(entry.node)) return 600

  return 0
}

const addEvenlySpacedKeepIndexes = (
  keepIndexes: Set<number>,
  lastIndex: number,
  targetMarkerCount: number
) => {
  if (targetMarkerCount <= keepIndexes.size) return

  const remainingCount = targetMarkerCount - keepIndexes.size
  const clusterCount = Math.max(1, Math.floor(remainingCount / minimumMarkerClusterSize))
  const clusterRadius = Math.floor(minimumMarkerClusterSize / 2)

  for (let slot = 0; slot < clusterCount && keepIndexes.size < targetMarkerCount; slot += 1) {
    const centerIndex = Math.round(((slot + 1) * lastIndex) / (clusterCount + 1))
    for (let offset = -clusterRadius; offset <= clusterRadius && keepIndexes.size < targetMarkerCount; offset += 1) {
      keepIndexes.add(Math.min(lastIndex, Math.max(0, centerIndex + offset)))
    }
  }
}

const addInteriorClusterContext = (keepIndexes: Set<number>, lastIndex: number) => {
  let changed = true

  while (changed) {
    changed = false
    const sortedIndexes = Array.from(keepIndexes).sort((left, right) => left - right)
    let cursor = 0

    while (cursor < sortedIndexes.length) {
      const start = sortedIndexes[cursor]
      let end = start

      while (cursor + 1 < sortedIndexes.length && sortedIndexes[cursor + 1] === end + 1) {
        cursor += 1
        end = sortedIndexes[cursor]
      }

      const clusterSize = end - start + 1
      if (start > 0 && end < lastIndex && clusterSize < minimumMarkerClusterSize) {
        if (start > 1) {
          keepIndexes.add(start - 1)
          changed = true
        }
        if (end < lastIndex - 1 && end - start + 1 < minimumMarkerClusterSize) {
          keepIndexes.add(end + 1)
          changed = true
        }
      }

      cursor += 1
    }
  }
}

export const buildCollapsedRailEntries = (
  entries: TimelineRailMarkerEntry[],
  selectedNodeId: string | undefined,
  collapseThreshold: number
): TimelineRailEntry[] => {
  if (entries.length <= collapseThreshold) return entries

  const lastIndex = entries.length - 1
  const selectedIndex = entries.findIndex(({ node }) => node.id === selectedNodeId)
  const targetMarkerCount = getTargetMarkerCount(entries.length, collapseThreshold)
  const keepIndexes = new Set<number>()

  entries
    .map(entry => ({
      entry,
      score: getMarkerKeepScore(entry, lastIndex, selectedIndex)
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score

      if (selectedIndex >= 0) {
        return Math.abs(left.entry.index - selectedIndex) - Math.abs(right.entry.index - selectedIndex)
      }

      return left.entry.index - right.entry.index
    })
    .slice(0, targetMarkerCount)
    .forEach(({ entry }) => keepIndexes.add(entry.index))

  keepIndexes.add(0)
  keepIndexes.add(lastIndex)
  addEvenlySpacedKeepIndexes(keepIndexes, lastIndex, targetMarkerCount)
  addInteriorClusterContext(keepIndexes, lastIndex)

  const collapsedEntries: TimelineRailEntry[] = []
  let cursor = 0

  while (cursor < entries.length) {
    if (keepIndexes.has(cursor)) {
      collapsedEntries.push(entries[cursor])
      cursor += 1
      continue
    }

    const hiddenStart = cursor

    while (cursor < entries.length && !keepIndexes.has(cursor)) {
      cursor += 1
    }

    const hiddenEntries = entries.slice(hiddenStart, cursor)

    if (hiddenEntries.length === 1) {
      collapsedEntries.push(hiddenEntries[0])
      continue
    }

    collapsedEntries.push({
      firstHiddenEntry: hiddenEntries[0],
      hiddenCount: hiddenEntries.length,
      key: `hidden-${hiddenEntries[0].node.id}-${hiddenEntries[hiddenEntries.length - 1].node.id}`,
      kind: 'ellipsis'
    })
  }

  return collapsedEntries
}
