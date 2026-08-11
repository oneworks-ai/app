import type { ChannelMemoryRow } from '#~/db/index.js'

export interface ChannelMemoryResolverScope {
  accountId: string
  canonicalUserId?: string
  channelId: string
  channelKey: string
  channelType: string
  entity?: string
  issuer: string
  orgId: string
  roomId?: string
  sessionType: string
  threadKey: string
}

export interface ChannelMemoryFilterResult {
  filtered: ChannelMemoryRow[]
  filteredCounts: Record<'expired' | 'scope' | 'sensitive' | 'visibility', number>
}

const includesRequired = (values: string[] | undefined, value: string | undefined) =>
  value != null && values?.includes(value) === true

const includesWhenRestricted = (values: string[] | undefined, value: string | undefined) =>
  values == null || includesRequired(values, value)

export const filterChannelMemoryCandidates = (
  memories: ChannelMemoryRow[],
  scope: ChannelMemoryResolverScope,
  now: number
): ChannelMemoryFilterResult => {
  const filteredCounts = { expired: 0, scope: 0, sensitive: 0, visibility: 0 }
  const filtered = memories.filter(memory => {
    if (memory.expiresAt != null && memory.expiresAt <= now) {
      filteredCounts.expired += 1
      return false
    }
    if (memory.sensitivity !== 'normal') {
      filteredCounts.sensitive += 1
      return false
    }
    if (memory.source == null || memory.source.org !== scope.orgId) {
      filteredCounts.scope += 1
      return false
    }
    if (memory.subjectType === 'entity' && memory.entity !== scope.entity) {
      filteredCounts.scope += 1
      return false
    }
    if (memory.subjectType === 'canonical_user' && memory.canonicalUserId !== scope.canonicalUserId) {
      filteredCounts.scope += 1
      return false
    }
    if (
      (memory.subjectType === 'canonical_user' || memory.subjectType === 'account') &&
      memory.source.sessionType === 'direct' &&
      scope.sessionType === 'group'
    ) {
      filteredCounts.scope += 1
      return false
    }
    if (memory.subjectType === 'account' && memory.accountId !== scope.accountId) {
      filteredCounts.scope += 1
      return false
    }
    if (memory.subjectType === 'room' && memory.roomId !== scope.roomId) {
      filteredCounts.scope += 1
      return false
    }
    if (
      memory.subjectType === 'channel' &&
      (memory.channelKey !== scope.channelKey || memory.channelId !== scope.channelId)
    ) {
      filteredCounts.scope += 1
      return false
    }
    if (
      memory.subjectType === 'conversation' &&
      (memory.threadKey !== scope.threadKey || memory.channelKey !== scope.channelKey ||
        memory.channelId !== scope.channelId)
    ) {
      filteredCounts.scope += 1
      return false
    }
    const visible = memory.visibility
    if (
      visible == null ||
      !includesRequired(visible.orgs, scope.orgId) ||
      !includesWhenRestricted(visible.entities, scope.entity) ||
      !includesWhenRestricted(visible.rooms, scope.roomId) ||
      !includesWhenRestricted(visible.channels, `${scope.channelType}:${scope.channelKey}:${scope.channelId}`) ||
      !includesWhenRestricted(visible.conversationTypes, scope.sessionType)
    ) {
      filteredCounts.visibility += 1
      return false
    }
    return true
  })
  return { filtered, filteredCounts }
}
