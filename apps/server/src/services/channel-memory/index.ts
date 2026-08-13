import { getDb } from '#~/db/index.js'
import type { ChannelMemoryRow } from '#~/db/index.js'
import type { EntityMemoryPolicy } from '@oneworks/types'

import { syncChannelFileMemories } from './file-sync.js'
import { filterChannelMemoryCandidates } from './filter.js'
import type { ChannelMemoryResolverScope } from './filter.js'
import {
  extractMemoryKeywords,
  rankChannelMemories,
  resolveChannelMemoryGroupKey,
  selectChannelMemoryCandidates,
  selectChannelMemoryGroupBudget
} from './ranking.js'
import type { ChannelMemoryBudget, ChannelMemoryGroupBudget } from './ranking.js'

export interface ChannelMemoryResolveInput extends ChannelMemoryResolverScope {
  budget?: ChannelMemoryBudget
  maxCandidates?: number
  groupBudget?: ChannelMemoryGroupBudget
  childRunId?: string
  conversationStateId?: string
  query: string
  memoryPolicy?: EntityMemoryPolicy
  now?: number
  senderId?: string
  sourceMessageId?: string
}

export interface ChannelMemorySnapshot {
  conflicts: string[]
  filteredCounts: Record<'expired' | 'scope' | 'sensitive' | 'visibility', number>
  id: string
  itemCount: number
  selectedMemories: ChannelMemoryRow[]
  selectedGroups: Array<{ key: string; memoryIds: string[] }>
  tokenCount: number
}

const DEFAULT_BUDGET: ChannelMemoryBudget = { maxItems: 20, maxTokens: 3000 }
const DEFAULT_WORKSPACE_MEMORY_ORG_SCOPE = 'workspace-local'

let workspaceMemoryOrgScopeResolver = () => DEFAULT_WORKSPACE_MEMORY_ORG_SCOPE

export const resolveWorkspaceMemoryOrgScope = () => workspaceMemoryOrgScopeResolver()

export const setWorkspaceMemoryOrgScopeResolverForTests = (resolver: (() => string) | undefined) => {
  workspaceMemoryOrgScopeResolver = resolver ?? (() => DEFAULT_WORKSPACE_MEMORY_ORG_SCOPE)
}

const resolveConflicts = (memories: ChannelMemoryRow[]) => {
  const bySubject = new Map<string, ChannelMemoryRow[]>()
  for (const memory of memories) {
    const key = `${memory.subjectType}:${memory.subjectId}`
    bySubject.set(key, [...(bySubject.get(key) ?? []), memory])
  }
  return [...bySubject.entries()].filter(([, entries]) => entries.length > 1).map(([key]) => key)
}

export const resolveChannelMemorySnapshot = (input: ChannelMemoryResolveInput): ChannelMemorySnapshot => {
  const now = input.now ?? Date.now()
  syncChannelFileMemories(input)
  const candidates = getDb().listChannelMemoryCandidates({
    accountId: input.accountId,
    canonicalUserId: input.canonicalUserId,
    channelId: input.channelId,
    channelKey: input.channelKey,
    channelType: input.channelType,
    entity: input.entity,
    issuer: input.issuer,
    now,
    orgId: input.orgId,
    roomId: input.roomId,
    threadKey: input.threadKey
  })
  const filterResult = filterChannelMemoryCandidates(candidates, input, now, {
    allowSensitive: input.memoryPolicy?.allowSensitive === true
  })
  const rankedMemories = rankChannelMemories(
    filterResult.filtered,
    extractMemoryKeywords(input.query),
    now
  )
  const ranked = selectChannelMemoryCandidates(rankedMemories, input.maxCandidates)
  const selection = selectChannelMemoryGroupBudget(ranked, input.budget ?? DEFAULT_BUDGET, input.groupBudget)
  const selectedGroups = [...selection.selected.reduce((groups, memory) => {
    const key = resolveChannelMemoryGroupKey(memory)
    groups.set(key, [...(groups.get(key) ?? []), memory.id])
    return groups
  }, new Map<string, string[]>())].map(([key, memoryIds]) => ({ key, memoryIds }))
  const snapshotData = {
    conflicts: resolveConflicts(selection.selected),
    filteredCounts: filterResult.filteredCounts,
    budget: input.budget ?? DEFAULT_BUDGET,
    sections: Object.fromEntries(
      ['account', 'canonical_user', 'channel', 'conversation', 'entity', 'room'].map(subjectType => [
        subjectType,
        selection.selected.filter(memory => memory.subjectType === subjectType).map(memory => memory.id)
      ])
    ),
    selectedMemoryIds: selection.selected.map(memory => memory.id),
    selectedGroups
  }
  const id = getDb().saveChannelMemorySnapshot({
    accountId: input.accountId,
    canonicalUserId: input.canonicalUserId,
    channelId: input.channelId,
    channelKey: input.channelKey,
    channelType: input.channelType,
    childRunId: input.childRunId,
    entity: input.entity,
    itemCount: selection.selected.length,
    roomId: input.roomId,
    snapshot: snapshotData,
    threadKey: input.threadKey,
    tokenCount: selection.tokenCount
  })
  return {
    conflicts: snapshotData.conflicts,
    filteredCounts: filterResult.filteredCounts,
    id,
    itemCount: selection.selected.length,
    selectedMemories: selection.selected,
    selectedGroups,
    tokenCount: selection.tokenCount
  }
}

const renderPromptJson = (value: unknown) =>
  (JSON.stringify(value) ?? 'null')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')

export const renderChannelMemorySnapshot = (snapshot: ChannelMemorySnapshot) => {
  if (snapshot.selectedMemories.length === 0) return undefined
  const memoriesById = new Map(snapshot.selectedMemories.map(memory => [memory.id, memory]))
  return [
    '<channel-memory>',
    ...snapshot.selectedGroups.flatMap(group => [
      '<memory-group>',
      `visibility-group: ${renderPromptJson(group.key)}`,
      ...group.memoryIds.flatMap(memoryId => {
        const memory = memoriesById.get(memoryId)
        return memory == null ? [] : [renderPromptJson({
          content: memory.content,
          id: memory.id,
          source: memory.source,
          subject: { id: memory.subjectId, type: memory.subjectType },
          visibility: memory.visibility
        })]
      }),
      '</memory-group>'
    ]),
    '</channel-memory>'
  ].join('\n')
}

export const recordTerminalMemoryAudit = (
  childRunId: string,
  status: string,
  changedMemoryIds: string[]
) => {
  const id = getDb().createPendingChannelMemoryWriteback({
    childRunId,
    patch: {
      changedMemoryIds,
      kind: 'terminal_check',
      result: changedMemoryIds.length === 0 ? 'no_change' : 'committed',
      status
    },
    patchKey: `terminal-check:${status}`
  })
  getDb().commitChannelMemoryWriteback(id)
  return id
}

export { syncChannelFileMemories } from './file-sync.js'
export { filterChannelMemoryCandidates } from './filter.js'
export {
  extractMemoryKeywords,
  rankChannelMemories,
  resolveChannelMemoryGroupKey,
  selectChannelMemoryBudget,
  selectChannelMemoryCandidates,
  selectChannelMemoryGroupBudget
} from './ranking.js'
