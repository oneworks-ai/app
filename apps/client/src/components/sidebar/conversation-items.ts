/* eslint-disable max-lines -- sidebar item derivation keeps session grouping, room rows, and plugin matchers together. */
import type { AgentRoom, AgentRoomDetailResponse, Session } from '@oneworks/core'

import type { SidebarSessionSortOrder } from '#~/hooks/use-sidebar-query-state'
import type { PluginContributionSessionGroup } from '#~/plugins/plugin-manifest'

export const ROOM_SIDEBAR_ID_PREFIX = 'room:'

export interface SidebarRoomItem extends AgentRoom {
  activeRunCount: number
  pendingCount: number
  sessionIds: string[]
}

export type SidebarConversationItem =
  | {
    id: string
    kind: 'session'
    session: Session
    depth: number
    hasChildren: boolean
  }
  | {
    id: string
    kind: 'group'
    group: SidebarConversationGroup
    isCollapsed: boolean
    sessionCount: number
    depth: 0
    hasChildren: boolean
  }
  | {
    id: string
    kind: 'room'
    room: SidebarRoomItem
    depth: 0
    hasChildren: false
  }

export type SidebarConversationGroup = PluginContributionSessionGroup & {
  pluginScope: string
}

export const getRoomSidebarId = (roomId: string) => `${ROOM_SIDEBAR_ID_PREFIX}${roomId}`

export const resolveConversationItemPath = (item: SidebarConversationItem) => (
  item.kind === 'room' ? `/rooms/${item.room.id}` : item.kind === 'session' ? `/session/${item.session.id}` : ''
)

export const toSidebarRoomItem = (
  room: AgentRoom,
  detail?: AgentRoomDetailResponse
): SidebarRoomItem => {
  const runSessionIds = detail?.runs.map(run => run.sessionId) ?? []
  return {
    ...room,
    activeRunCount: detail?.members.reduce((count, member) => count + member.activeRunCount, 0) ?? 0,
    pendingCount: detail?.members.reduce((count, member) => count + member.pendingCount, 0) ?? 0,
    sessionIds: [
      ...(room.hostSessionId != null ? [room.hostSessionId] : []),
      ...runSessionIds
    ]
  }
}

const getSessionTimestamp = (session: Session) => session.createdAt ?? 0
const getRoomTimestamp = (room: SidebarRoomItem) => room.updatedAt ?? room.createdAt ?? 0
const isFavoriteConversationItem = (item: SidebarConversationItem) => (
  item.kind === 'room' ? item.room.favoritedAt != null : item.kind === 'session' && item.session.isStarred === true
)
const getConversationItemTimestamp = (item: SidebarConversationItem) => (
  item.kind === 'room'
    ? getRoomTimestamp(item.room)
    : item.kind === 'session'
    ? getSessionTimestamp(item.session)
    : 0
)

const compareConversationItems = (
  left: SidebarConversationItem,
  right: SidebarConversationItem,
  sortOrder: SidebarSessionSortOrder
) => {
  const favoriteDelta = Number(isFavoriteConversationItem(right)) - Number(isFavoriteConversationItem(left))
  if (favoriteDelta !== 0) return favoriteDelta

  const leftTimestamp = getConversationItemTimestamp(left)
  const rightTimestamp = getConversationItemTimestamp(right)
  const delta = leftTimestamp - rightTimestamp
  return sortOrder === 'asc' ? delta : -delta
}

export function getCollapsibleSidebarSessionIds({
  rooms,
  sessions
}: {
  rooms: SidebarRoomItem[]
  sessions: Session[]
}) {
  const roomSessionIds = new Set(rooms.flatMap(room => room.sessionIds))
  const visibleSessions = sessions.filter(session => !roomSessionIds.has(session.id))
  const visibleSessionIds = new Set(visibleSessions.map(session => session.id))
  const collapsibleSessionIds = new Set<string>()

  for (const session of visibleSessions) {
    if (session.parentSessionId != null && visibleSessionIds.has(session.parentSessionId)) {
      collapsibleSessionIds.add(session.parentSessionId)
    }
  }

  return collapsibleSessionIds
}

export function buildSidebarConversationItems({
  collapsedIds,
  rooms,
  sessions,
  sortOrder
}: {
  collapsedIds: Set<string>
  rooms: SidebarRoomItem[]
  sessions: Session[]
  sortOrder: SidebarSessionSortOrder
}): SidebarConversationItem[] {
  const roomSessionIds = new Set(rooms.flatMap(room => room.sessionIds))
  const visibleSessions = sessions.filter(session => !roomSessionIds.has(session.id))
  const sessionMap = new Map(visibleSessions.map((session) => [session.id, session]))
  const childrenMap = new Map<string, Session[]>()
  for (const session of visibleSessions) {
    if (session.parentSessionId) {
      const list = childrenMap.get(session.parentSessionId) ?? []
      list.push(session)
      childrenMap.set(session.parentSessionId, list)
    }
  }

  const roots: SidebarConversationItem[] = visibleSessions
    .filter((session) => {
      if (!session.parentSessionId) return true
      return !sessionMap.has(session.parentSessionId)
    })
    .map((session) => ({
      id: session.id,
      kind: 'session',
      session,
      depth: 0,
      hasChildren: (childrenMap.get(session.id) ?? []).length > 0
    }))

  roots.push(...rooms.map(room => ({
    id: getRoomSidebarId(room.id),
    kind: 'room' as const,
    room,
    depth: 0 as const,
    hasChildren: false as const
  })))
  roots.sort((left, right) => compareConversationItems(left, right, sortOrder))

  const result: SidebarConversationItem[] = []
  const visited = new Set<string>()

  const walkSession = (session: Session, depth: number) => {
    if (visited.has(session.id)) return
    visited.add(session.id)
    const children = childrenMap.get(session.id) ?? []
    result.push({
      id: session.id,
      kind: 'session',
      session,
      depth,
      hasChildren: children.length > 0
    })
    if (collapsedIds.has(session.id)) return
    const sortedChildren = [...children].sort((left, right) => getSessionTimestamp(right) - getSessionTimestamp(left))
    for (const child of sortedChildren) {
      walkSession(child, depth + 1)
    }
  }

  for (const item of roots) {
    if (item.kind === 'room') {
      result.push(item)
    } else if (item.kind === 'session') {
      walkSession(item.session, 0)
    }
  }

  return result
}

const hasAllValues = (candidates: string[], requiredValues: string[] | undefined) => {
  if (requiredValues == null || requiredValues.length === 0) return true
  const candidateSet = new Set(candidates.map(value => value.trim()).filter(Boolean))
  return requiredValues.map(value => value.trim()).filter(Boolean).every(value => candidateSet.has(value))
}

const hasAnyValue = (candidates: string[], requiredValues: string[] | undefined) => {
  const normalizedRequiredValues = (requiredValues ?? []).map(value => value.trim()).filter(Boolean)
  if (normalizedRequiredValues.length === 0) return true
  const candidateSet = new Set(candidates.map(value => value.trim()).filter(Boolean))
  return normalizedRequiredValues.some(value => candidateSet.has(value))
}

const hasNoValues = (candidates: string[], excludedValues: string[] | undefined) => {
  const normalizedExcludedValues = (excludedValues ?? []).map(value => value.trim()).filter(Boolean)
  if (normalizedExcludedValues.length === 0) return true
  const candidateSet = new Set(candidates.map(value => value.trim()).filter(Boolean))
  return normalizedExcludedValues.every(value => !candidateSet.has(value))
}

const hasAnyPrefix = (candidates: string[], prefixes: string[] | undefined) => {
  const normalizedPrefixes = (prefixes ?? []).map(prefix => prefix.trim()).filter(Boolean)
  if (normalizedPrefixes.length === 0) return false
  return candidates.some(candidate => normalizedPrefixes.some(prefix => candidate.startsWith(prefix)))
}

const hasNoPrefixes = (candidates: string[], prefixes: string[] | undefined) => {
  const normalizedPrefixes = (prefixes ?? []).map(prefix => prefix.trim()).filter(Boolean)
  if (normalizedPrefixes.length === 0) return true
  return candidates.every(candidate => normalizedPrefixes.every(prefix => !candidate.startsWith(prefix)))
}

const matchesConversationGroupMatch = (
  match: NonNullable<SidebarConversationGroup['match']>,
  input: {
    accounts: string[]
    adapters: string[]
    tags: string[]
  }
): boolean => {
  if (match == null) return false
  const hasMatcher = (match.tags?.length ?? 0) > 0 ||
    (match.anyTags?.length ?? 0) > 0 ||
    (match.excludedTags?.length ?? 0) > 0 ||
    (match.tagPrefixes?.length ?? 0) > 0 ||
    (match.excludedTagPrefixes?.length ?? 0) > 0 ||
    (match.adapters?.length ?? 0) > 0 ||
    (match.accounts?.length ?? 0) > 0 ||
    (match.anyOf?.length ?? 0) > 0
  if (!hasMatcher) return false

  return (
    hasAllValues(input.tags, match.tags) &&
    hasAnyValue(input.tags, match.anyTags) &&
    hasNoValues(input.tags, match.excludedTags) &&
    (match.tagPrefixes == null || match.tagPrefixes.length === 0 || hasAnyPrefix(input.tags, match.tagPrefixes)) &&
    hasNoPrefixes(input.tags, match.excludedTagPrefixes) &&
    hasAllValues(input.adapters, match.adapters) &&
    hasAllValues(input.accounts, match.accounts) &&
    (
      match.anyOf == null ||
      match.anyOf.length === 0 ||
      match.anyOf.some(childMatch => matchesConversationGroupMatch(childMatch, input))
    )
  )
}

const matchesConversationGroup = (session: Session, group: SidebarConversationGroup) => {
  const match = group.match
  if (match == null) return false

  const tags = (session.tags ?? []).map(tag => tag.trim()).filter(Boolean)
  const adapters = session.adapter == null ? [] : [session.adapter.trim()].filter(Boolean)
  const accounts = session.account == null ? [] : [session.account.trim()].filter(Boolean)

  return matchesConversationGroupMatch(match, {
    accounts,
    adapters,
    tags
  })
}

const resolveConversationGroupKey = (group: SidebarConversationGroup) => `${group.pluginScope}/${group.id}`
export const getSidebarConversationGroupId = (group: SidebarConversationGroup) =>
  `group:${resolveConversationGroupKey(group)}`

const indentConversationGroupItems = (items: SidebarConversationItem[]): SidebarConversationItem[] =>
  items.map(item =>
    item.kind === 'session'
      ? {
        ...item,
        depth: item.depth + 1
      }
      : item
  )

export function buildGroupedSidebarConversationItems({
  collapsedIds,
  collapsedGroupIds,
  groups,
  rooms,
  sessions,
  sortOrder
}: {
  collapsedIds: Set<string>
  collapsedGroupIds?: Set<string>
  groups: SidebarConversationGroup[]
  rooms: SidebarRoomItem[]
  sessions: Session[]
  sortOrder: SidebarSessionSortOrder
}): SidebarConversationItem[] {
  if (groups.length === 0) {
    return buildSidebarConversationItems({ collapsedIds, rooms, sessions, sortOrder })
  }

  const groupBySessionId = new Map<string, SidebarConversationGroup>()
  const sessionMap = new Map(sessions.map(session => [session.id, session]))
  for (const session of sessions) {
    const matchedGroup = groups.find(group => matchesConversationGroup(session, group))
    if (matchedGroup != null) {
      groupBySessionId.set(session.id, matchedGroup)
    }
  }

  let changed = true
  while (changed) {
    changed = false
    for (const session of sessions) {
      if (groupBySessionId.has(session.id) || session.parentSessionId == null) continue
      const parent = sessionMap.get(session.parentSessionId)
      const parentGroup = parent == null ? undefined : groupBySessionId.get(parent.id)
      if (parentGroup == null) continue
      groupBySessionId.set(session.id, parentGroup)
      changed = true
    }
  }

  const result: SidebarConversationItem[] = []
  const groupedSessionIds = new Set<string>()
  for (const group of groups) {
    const groupSessions = sessions.filter(session => groupBySessionId.get(session.id) === group)
    groupSessions.forEach(session => groupedSessionIds.add(session.id))
    if (groupSessions.length === 0 && group.showWhenEmpty !== true) continue

    const groupId = getSidebarConversationGroupId(group)
    const isCollapsed = collapsedGroupIds?.has(groupId) === true
    result.push({
      id: groupId,
      kind: 'group',
      group,
      isCollapsed,
      sessionCount: groupSessions.length,
      depth: 0,
      hasChildren: groupSessions.length > 0
    })
    if (isCollapsed) continue
    result.push(...indentConversationGroupItems(buildSidebarConversationItems({
      collapsedIds,
      rooms: [],
      sessions: groupSessions,
      sortOrder
    })))
  }

  const ungroupedSessions = sessions.filter(session => !groupedSessionIds.has(session.id))
  result.push(...buildSidebarConversationItems({
    collapsedIds,
    rooms,
    sessions: ungroupedSessions,
    sortOrder
  }))

  return result
}
