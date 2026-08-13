import type { ChannelMemoryRow } from '#~/db/index.js'

export interface ChannelMemoryBudget {
  maxItems: number
  maxTokens: number
}

export interface ChannelMemoryGroupBudget {
  maxItemsPerGroup?: number
  maxTokensPerGroup?: number
}

export const extractMemoryKeywords = (value: string) => [
  ...new Set(value.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])
]

export const estimateMemoryTokens = (value: string) => Math.ceil(value.length / 4)

export const scoreChannelMemory = (memory: ChannelMemoryRow, query: string[], now: number) => {
  const overlap = memory.keywords.filter(keyword => query.includes(keyword.toLowerCase())).length /
    Math.max(1, query.length)
  const recency = Math.max(0, 1 - (now - memory.updatedAt) / (1000 * 60 * 60 * 24 * 180))
  return overlap * .4 + memory.importance * .25 + recency * .15 + memory.confidence * .15
}

export const rankChannelMemories = (memories: ChannelMemoryRow[], query: string[], now: number) =>
  [...memories]
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
      const scoreDifference = scoreChannelMemory(right, query, now) - scoreChannelMemory(left, query, now)
      return scoreDifference || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
    })

export const selectChannelMemoryBudget = (memories: ChannelMemoryRow[], budget: ChannelMemoryBudget) => {
  const selected: ChannelMemoryRow[] = []
  let tokenCount = 0
  for (const memory of memories) {
    const tokenCost = estimateMemoryTokens(memory.content)
    if (selected.length >= budget.maxItems || tokenCount + tokenCost > budget.maxTokens) continue
    selected.push(memory)
    tokenCount += tokenCost
  }
  const selectedOrder = new Map(memories.map((memory, index) => [memory.id, index]))
  selected.sort((left, right) => (selectedOrder.get(left.id) ?? 0) - (selectedOrder.get(right.id) ?? 0))
  return { selected, tokenCount }
}

const normalizeVisibilityValues = (values: string[] | undefined) => (
  values == null ? ['*'] : [...values].sort()
)

export const resolveChannelMemoryGroupKey = (memory: ChannelMemoryRow) => {
  const visibility = memory.visibility
  return [
    `conversationTypes=${normalizeVisibilityValues(visibility?.conversationTypes).join(',')}`,
    `entities=${normalizeVisibilityValues(visibility?.entities).join(',')}`,
    `orgs=${normalizeVisibilityValues(visibility?.orgs).join(',')}`,
    `rooms=${normalizeVisibilityValues(visibility?.rooms).join(',')}`,
    `channels=${normalizeVisibilityValues(visibility?.channels).join(',')}`
  ].join('|')
}

export const selectChannelMemoryCandidates = (
  memories: ChannelMemoryRow[],
  maxCandidates: number | undefined
) => {
  if (maxCandidates == null || maxCandidates >= memories.length) return memories
  if (maxCandidates <= 0) return []

  const groups = new Map<string, ChannelMemoryRow[]>()
  for (const memory of memories) {
    const key = resolveChannelMemoryGroupKey(memory)
    groups.set(key, [...(groups.get(key) ?? []), memory])
  }

  const selectedIds = new Set<string>()
  let offset = 0
  while (selectedIds.size < maxCandidates) {
    let added = false
    for (const entries of groups.values()) {
      const memory = entries[offset]
      if (memory == null) continue
      selectedIds.add(memory.id)
      added = true
      if (selectedIds.size >= maxCandidates) break
    }
    if (!added) break
    offset += 1
  }

  return memories.filter(memory => selectedIds.has(memory.id))
}

export const selectChannelMemoryGroupBudget = (
  memories: ChannelMemoryRow[],
  budget: ChannelMemoryBudget,
  groupBudget: ChannelMemoryGroupBudget = {}
) => {
  const groups = new Map<string, ChannelMemoryRow[]>()
  for (const memory of memories) {
    const key = resolveChannelMemoryGroupKey(memory)
    groups.set(key, [...(groups.get(key) ?? []), memory])
  }
  if (groups.size <= 1) return selectChannelMemoryBudget(memories, budget)

  const selected: ChannelMemoryRow[] = []
  const selectedIds = new Set<string>()
  let tokenCount = 0
  const fairItems = groupBudget.maxItemsPerGroup ?? Math.max(1, Math.floor(budget.maxItems / groups.size))
  const fairTokens = groupBudget.maxTokensPerGroup ?? Math.max(1, Math.floor(budget.maxTokens / groups.size))

  for (const entries of groups.values()) {
    const selection = selectChannelMemoryBudget(entries, {
      maxItems: Math.min(fairItems, budget.maxItems - selected.length),
      maxTokens: Math.min(fairTokens, budget.maxTokens - tokenCount)
    })
    for (const memory of selection.selected) {
      selected.push(memory)
      selectedIds.add(memory.id)
    }
    tokenCount += selection.tokenCount
  }

  for (const memory of memories) {
    if (selectedIds.has(memory.id)) continue
    const tokenCost = estimateMemoryTokens(memory.content)
    if (selected.length >= budget.maxItems || tokenCount + tokenCost > budget.maxTokens) continue
    selected.push(memory)
    selectedIds.add(memory.id)
    tokenCount += tokenCost
  }
  return { selected, tokenCount }
}
