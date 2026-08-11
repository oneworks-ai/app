import type { ChannelMemoryRow } from '#~/db/index.js'

export interface ChannelMemoryBudget {
  maxItems: number
  maxTokens: number
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
  return { selected, tokenCount }
}
