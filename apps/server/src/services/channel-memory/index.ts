import { getDb } from '#~/db/index.js'
import type { ChannelMemoryRow } from '#~/db/index.js'

import { syncChannelFileMemories } from './file-sync.js'
import { filterChannelMemoryCandidates } from './filter.js'
import type { ChannelMemoryResolverScope } from './filter.js'
import { extractMemoryKeywords, rankChannelMemories, selectChannelMemoryBudget } from './ranking.js'
import type { ChannelMemoryBudget } from './ranking.js'

export interface ChannelMemoryResolveInput extends ChannelMemoryResolverScope {
  budget?: ChannelMemoryBudget
  childRunId?: string
  conversationStateId?: string
  query: string
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
  const filterResult = filterChannelMemoryCandidates(candidates, input, now)
  const ranked = rankChannelMemories(filterResult.filtered, extractMemoryKeywords(input.query), now)
  const selection = selectChannelMemoryBudget(ranked, input.budget ?? DEFAULT_BUDGET)
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
    selectedMemoryIds: selection.selected.map(memory => memory.id)
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
    tokenCount: selection.tokenCount
  }
}

export const renderChannelMemorySnapshot = (snapshot: ChannelMemorySnapshot) =>
  snapshot.selectedMemories.length === 0
    ? undefined
    : [
      '<channel-memory>',
      ...snapshot.selectedMemories.map(memory => `- [${memory.subjectType}] ${memory.content}`),
      '</channel-memory>'
    ].join('\n')

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
export { extractMemoryKeywords, rankChannelMemories, selectChannelMemoryBudget } from './ranking.js'
