import './Sidebar.scss'

import type { MenuProps } from 'antd'
import { useAtomValue, useSetAtom } from 'jotai'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import type { AgentRoomListResponse, Session, UpdateAgentRoomMetadataRequest } from '@oneworks/core'
import type { ConfigResponse } from '@oneworks/types'

import { deleteSession, getAgentRoom, listAgentRooms, updateSession, updateSessionTitle } from '#~/api'
import { renderIconAsset } from '#~/components/icons/IconAsset'
import { InteractionList } from '#~/components/interaction-list'
import type {
  InteractionListAction,
  InteractionListItemRenderContext,
  InteractionListSelectionRenderContext
} from '#~/components/interaction-list'
import { useRouteSidebar } from '#~/components/layout/route-sidebar-context'
import { MobileAwareSelect } from '#~/components/mobile-aware-select/MobileAwareSelect'
import { buildNavRailMoreMenuItems } from '#~/components/nav-rail-more-menu'
import type { NavRailMoreMenuSection } from '#~/components/nav-rail-more-menu'
import { SidebarGroupedList } from '#~/components/sidebar-list/SidebarGroupedList'
import {
  SidebarListCollapsedActionButton,
  SidebarListCollapsedActions
} from '#~/components/sidebar-list/SidebarListHeader'
import { addDesktopViewShortcutListener } from '#~/desktop/view-shortcuts'
import {
  markOptimisticSessionDiscarded,
  mergeOptimisticSessions,
  optimisticSessionCreationsAtom,
  removeSessionFromList
} from '#~/hooks/chat/optimistic-session-creation'
import type { PendingSessionCreationContext } from '#~/hooks/chat/session-creation-context'
import { pendingSessionCreationContextAtom } from '#~/hooks/chat/session-creation-context'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import { useSidebarQueryState } from '#~/hooks/use-sidebar-query-state'
import type { SidebarSessionSortOrder } from '#~/hooks/use-sidebar-query-state'
import { useGlobalShortcut } from '#~/hooks/useGlobalShortcut'
import { useQueryParams } from '#~/hooks/useQueryParams'
import { getAdapterDisplay } from '#~/resources/adapters.js'
import {
  INTERACTION_STRUCTURE_BASE_PATH,
  buildInteractionStructureNavigationTarget,
  filterInteractionStructureItems,
  getInteractionStructureFilterConfigs,
  getInteractionStructureFilterQueryKeys,
  getInteractionStructureItems,
  getInteractionStructureRouteBehavior,
  getInteractionStructureRoutes,
  resolveInteractionStructureRouteKey
} from '#~/routes/dev/interaction-structure-model'
import type { InteractionStructureItem, InteractionStructureRouteKey } from '#~/routes/dev/interaction-structure-model'
import { isSidebarResizingAtom } from '#~/store/index'

import { SessionList } from './sidebar/SessionList'
import { SidebarHeader } from './sidebar/SidebarHeader'
import type { SidebarRoomItem } from './sidebar/conversation-items'
import { ROOM_SIDEBAR_ID_PREFIX, getRoomSidebarId, toSidebarRoomItem } from './sidebar/conversation-items'
import { matchesAnyFilterPattern } from './sidebar/filter-utils'
import { updateSidebarRoomMetadata } from './sidebar/room-metadata-actions'
import { getVisibleSidebarSessionTags } from './sidebar/session-tags'
import { isSidebarVisibleSession } from './sidebar/session-visibility'

const sortSessionsByOrder = (sessions: Session[], sortOrder: SidebarSessionSortOrder) => {
  return [...sessions].sort((left, right) => {
    const starredDelta = Number(right.isStarred === true) - Number(left.isStarred === true)
    if (starredDelta !== 0) return starredDelta

    const createdDelta = (left.createdAt ?? 0) - (right.createdAt ?? 0)
    return sortOrder === 'asc' ? createdDelta : -createdDelta
  })
}

const isRoomSelectionId = (id: string) => id.startsWith(ROOM_SIDEBAR_ID_PREFIX)
const getRoomIdFromSelectionId = (id: string) => id.slice(ROOM_SIDEBAR_ID_PREFIX.length)
const lastOpenedSessionStorageKey = 'oneworks.sidebar.lastOpenedSessionId'

const splitPathSegments = (path: string) => path.split('/').filter(Boolean)

const readLastOpenedSessionId = () => {
  try {
    const value = window.localStorage.getItem(lastOpenedSessionStorageKey)?.trim()
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

const writeLastOpenedSessionId = (id: string) => {
  try {
    window.localStorage.setItem(lastOpenedSessionStorageKey, id)
  } catch {
    // Ignore storage failures; the in-memory value still works for this render.
  }
}

const splitInteractionStructureQueryValues = (raw: string, allowedValues: Set<string>) => (
  Array.from(
    new Set(
      raw
        .split(',')
        .map(value => value.trim())
        .filter(value => value !== '' && allowedValues.has(value))
    )
  )
)
const joinInteractionStructureQueryValues = (values: string[]) => (
  Array.from(new Set(values.map(value => value.trim()).filter(Boolean))).join(',')
)
type InteractionStructureQueryValues = Record<string, string>
const flattenInteractionStructureItemKeys = (items: InteractionStructureItem[]): string[] => (
  items.flatMap(item => [
    ...(item.itemType === 'groupTitle' ? [] : [item.key]),
    ...flattenInteractionStructureItemKeys((item.children ?? []) as InteractionStructureItem[])
  ])
)

const mapInteractionStructureItems = (
  items: InteractionStructureItem[],
  mapper: (item: InteractionStructureItem) => InteractionStructureItem | null
): InteractionStructureItem[] => (
  items.flatMap((item) => {
    const mappedItem = mapper(item)
    if (mappedItem == null) return []

    return [{
      ...mappedItem,
      children: mapInteractionStructureItems((mappedItem.children ?? []) as InteractionStructureItem[], mapper)
    }]
  })
)

export function Sidebar({
  activeId,
  embeddedInNavRail = false,
  isCompactLayout = false,
  isMobileOpen = false,
  onRequestClose,
  onSelectRoom,
  onSelectSession,
  onDeletedSession,
  width
}: {
  activeId?: string
  embeddedInNavRail?: boolean
  isCompactLayout?: boolean
  isMobileOpen?: boolean
  onRequestClose?: () => void
  onSelectRoom: (room: SidebarRoomItem) => void
  onSelectSession: (session: Session, isNew?: boolean) => void
  onDeletedSession?: (id: string, nextId?: string) => void
  width: number
}) {
  const {
    adapterFilters,
    hasActiveFilterConditions,
    hasActiveSearchControls,
    isSidebarCollapsed,
    searchQuery,
    setSortOrder,
    setAdapterFilters,
    setSearchQuery,
    setSidebarCollapsed,
    setTagFilters,
    sortOrder,
    sortSelection,
    tagFilters
  } = useSidebarQueryState()
  const { routeSidebar } = useRouteSidebar()
  const isResizing = useAtomValue(isSidebarResizingAtom)
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set<string>())
  const [interactionBatchMode, setInteractionBatchMode] = useState(false)
  const [interactionHiddenKeys, setInteractionHiddenKeys] = useState(() => new Set<string>())
  const [interactionSelectedKeys, setInteractionSelectedKeys] = useState(() => new Set<string>())
  const [interactionDoneKeys, setInteractionDoneKeys] = useState(() => new Set<string>())
  const [interactionStarredKeys, setInteractionStarredKeys] = useState(() => new Set<string>())
  const [interactionHiddenRouteKeys, setInteractionHiddenRouteKeys] = useState(() =>
    new Set<InteractionStructureRouteKey>()
  )
  const [lastOpenedSessionId, setLastOpenedSessionId] = useState(readLastOpenedSessionId)
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { isTouchInteraction } = useResponsiveLayout()
  const isMac = navigator.platform.includes('Mac')
  const optimisticCreations = useAtomValue(optimisticSessionCreationsAtom)
  const setOptimisticCreations = useSetAtom(optimisticSessionCreationsAtom)
  const setPendingSessionCreationContext = useSetAtom(pendingSessionCreationContextAtom)
  const isInteractionStructureRoute = import.meta.env.DEV && (
    location.pathname === INTERACTION_STRUCTURE_BASE_PATH ||
    location.pathname.startsWith(`${INTERACTION_STRUCTURE_BASE_PATH}/`)
  )
  const interactionRouteKey = resolveInteractionStructureRouteKey(
    location.pathname.slice(INTERACTION_STRUCTURE_BASE_PATH.length + 1).split('/')[0]
  )
  const interactionRoutes = useMemo(() => getInteractionStructureRoutes(t), [t])
  const interactionRouteConfig = useMemo(
    () => interactionRoutes.find(route => route.key === interactionRouteKey) ?? interactionRoutes[0],
    [interactionRouteKey, interactionRoutes]
  )
  const interactionVisibleRoutes = useMemo(
    () => interactionRoutes.filter(route => !interactionHiddenRouteKeys.has(route.key)),
    [interactionHiddenRouteKeys, interactionRoutes]
  )
  const interactionRouteBehavior = useMemo(
    () => getInteractionStructureRouteBehavior(interactionRouteKey, t),
    [interactionRouteKey, t]
  )
  const interactionFilterConfigs = useMemo(
    () => getInteractionStructureFilterConfigs(interactionRouteKey, t),
    [interactionRouteKey, t]
  )
  const interactionFilterQueryKeys = useMemo(() => getInteractionStructureFilterQueryKeys(), [])
  const interactionQueryKeys = useMemo(
    () => ['q', 'filterPanel', 'item', ...interactionFilterQueryKeys],
    [interactionFilterQueryKeys]
  )
  const interactionQueryDefaults = useMemo(
    () => Object.fromEntries(interactionQueryKeys.map(key => [key, ''])) as InteractionStructureQueryValues,
    [interactionQueryKeys]
  )
  const interactionQueryOmit = useMemo(
    () =>
      interactionQueryKeys.reduce((acc, key) => {
        acc[key] = key === 'filterPanel'
          ? value => value !== 'open'
          : key === 'q'
          ? value => value.trim() === ''
          : value => value === ''
        return acc
      }, {} as Partial<Record<string, (value: string) => boolean>>),
    [interactionQueryKeys]
  )
  const { values: interactionQueryValues, update: updateInteractionQuery } = useQueryParams<
    InteractionStructureQueryValues
  >({
    defaults: interactionQueryDefaults,
    keys: interactionQueryKeys,
    omit: interactionQueryOmit
  })
  const interactionFilterOptionValues = useMemo(
    () =>
      new Map(
        interactionFilterConfigs.map(config => [
          config.queryKey,
          new Set(config.options.map(option => option.value))
        ])
      ),
    [interactionFilterConfigs]
  )
  const interactionFilters = useMemo(
    () =>
      interactionFilterConfigs.reduce((acc, config) => {
        const allowedValues = interactionFilterOptionValues.get(config.queryKey) ?? new Set<string>()
        acc[config.queryKey] = splitInteractionStructureQueryValues(
          interactionQueryValues[config.queryKey] ?? '',
          allowedValues
        )
        return acc
      }, {} as Record<string, string[]>),
    [interactionFilterConfigs, interactionFilterOptionValues, interactionQueryValues]
  )
  const interactionSearchExpanded = interactionQueryValues.filterPanel === 'open'
  const interactionSearchQuery = interactionQueryValues.q
  const interactionBaseItems = useMemo(
    () => getInteractionStructureItems(interactionRouteKey, t),
    [interactionRouteKey, t]
  )
  const interactionDecoratedItems = useMemo(() =>
    mapInteractionStructureItems(interactionBaseItems, (item) => {
      if (interactionHiddenKeys.has(item.key)) return null

      const isStarred = interactionStarredKeys.has(item.key)
      return {
        ...item,
        badge: isStarred ? t('interactionStructure.itemState.starred') : item.badge,
        filter: interactionDoneKeys.has(item.key) ? 'done' : item.filter,
        iconFilled: isStarred || item.iconFilled === true,
        tags: [
          ...(item.tags ?? []),
          ...(isStarred ? [t('interactionStructure.itemState.starred')] : [])
        ]
      }
    }), [interactionBaseItems, interactionDoneKeys, interactionHiddenKeys, interactionStarredKeys, t])
  const interactionFilteredItems = useMemo(() =>
    filterInteractionStructureItems({
      filterConfigs: interactionFilterConfigs,
      filters: interactionFilters,
      items: interactionDecoratedItems,
      query: interactionSearchQuery
    }), [interactionDecoratedItems, interactionFilterConfigs, interactionFilters, interactionSearchQuery])
  const interactionSelectableKeys = useMemo(
    () => flattenInteractionStructureItemKeys(interactionFilteredItems),
    [interactionFilteredItems]
  )
  const interactionActiveKey = interactionSelectableKeys.includes(interactionQueryValues.item)
    ? interactionQueryValues.item
    : undefined

  const {
    data: sessionsRes,
    isLoading: isSessionsLoading,
    mutate: mutateSessions
  } = useSWR<{ sessions: Session[] }>(
    `/api/sessions`
  )
  const {
    data: roomsRes,
    isLoading: isRoomsLoading,
    mutate: mutateRooms
  } = useSWR<AgentRoomListResponse>('/api/agent-rooms', listAgentRooms, {
    refreshInterval: 3000,
    revalidateOnFocus: true
  })
  const roomDetailKey = roomsRes?.rooms.map(room => room.id).sort().join('|')
  const { data: roomDetails } = useSWR(
    roomDetailKey == null || roomDetailKey === '' ? null : ['agent-room-details', roomDetailKey],
    () => Promise.all((roomsRes?.rooms ?? []).map(room => getAgentRoom(room.id))),
    {
      refreshInterval: 3000,
      revalidateOnFocus: true
    }
  )
  const sessions: Session[] = useMemo(
    () => mergeOptimisticSessions(sessionsRes?.sessions ?? [], optimisticCreations),
    [optimisticCreations, sessionsRes?.sessions]
  )
  const sidebarSessions = useMemo(() => sessions.filter(isSidebarVisibleSession), [sessions])
  const rooms: SidebarRoomItem[] = useMemo(() => {
    const detailMap = new Map((roomDetails ?? []).map(detail => [detail.room.id, detail]))
    return (roomsRes?.rooms ?? []).map(room => toSidebarRoomItem(room, detailMap.get(room.id)))
  }, [roomDetails, roomsRes?.rooms])
  const { data: configRes } = useSWR<ConfigResponse>('/api/config')

  const newSessionShortcut = configRes?.sources?.merged?.shortcuts?.newSession
  const showSessionCardMessage = configRes?.sources?.merged?.conversation?.showSessionCardMessage === true
  const resolvedNewSessionShortcut = newSessionShortcut != null && newSessionShortcut.trim() !== ''
    ? newSessionShortcut
    : 'mod+k'
  const availableTags = useMemo(() => {
    return Array.from(
      new Set(
        sidebarSessions.flatMap(session => getVisibleSidebarSessionTags(session.tags))
      )
    ).sort((left, right) => left.localeCompare(right))
  }, [sidebarSessions])
  const availableAdapters = useMemo(() => {
    return Array.from(
      new Set(
        sidebarSessions
          .map((session) => session.adapter?.trim() ?? '')
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right))
  }, [sidebarSessions])

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const visibleSessions = sidebarSessions.filter((s: Session) => {
      if (!matchesAnyFilterPattern(s.tags ?? [], tagFilters)) return false

      const adapterCandidates = [
        s.adapter ?? '',
        s.adapter != null && s.adapter !== '' ? getAdapterDisplay(s.adapter).title : ''
      ].filter(Boolean)
      if (!matchesAnyFilterPattern(adapterCandidates, adapterFilters)) return false

      if (!query) return true
      return (
        (s.title ?? '').toLowerCase().includes(query) ||
        (s.lastMessage ?? '').toLowerCase().includes(query) ||
        (s.lastUserMessage ?? '').toLowerCase().includes(query) ||
        s.id.toLowerCase().includes(query) ||
        (s.tags ?? []).some((tag: string) => tag.toLowerCase().includes(query)) ||
        adapterCandidates.some((candidate) => candidate.toLowerCase().includes(query))
      )
    })
    return sortSessionsByOrder(visibleSessions, sortOrder)
  }, [adapterFilters, searchQuery, sidebarSessions, sortOrder, tagFilters])
  const filteredRooms = useMemo(() => {
    if (adapterFilters.length > 0 || tagFilters.length > 0) {
      return []
    }

    const query = searchQuery.trim().toLowerCase()
    return rooms.filter((room) => {
      if (!query) return true
      return (
        room.title.toLowerCase().includes(query) ||
        room.id.toLowerCase().includes(query) ||
        (room.lastMessage ?? '').toLowerCase().includes(query)
      )
    })
  }, [adapterFilters, rooms, searchQuery, tagFilters])
  const selectableIds = useMemo(() => [
    ...filteredRooms.map(room => getRoomSidebarId(room.id)),
    ...filteredSessions.map(session => session.id)
  ], [filteredRooms, filteredSessions])
  const selectedConversationIds = useMemo(() => {
    const roomIds: string[] = []
    const sessionIds: string[] = []

    for (const id of selectedIds) {
      if (isRoomSelectionId(id)) {
        roomIds.push(getRoomIdFromSelectionId(id))
      } else {
        sessionIds.push(id)
      }
    }

    return { roomIds, sessionIds }
  }, [selectedIds])

  useEffect(() => {
    if (!isInteractionStructureRoute) {
      setInteractionBatchMode(false)
      setInteractionSelectedKeys((current) => current.size === 0 ? current : new Set())
      return
    }

    const selectableKeys = new Set(interactionSelectableKeys)
    setInteractionSelectedKeys((current) => {
      const next = new Set(Array.from(current).filter(key => selectableKeys.has(key)))
      return next.size === current.size ? current : next
    })
  }, [interactionSelectableKeys, isInteractionStructureRoute])

  useEffect(() => {
    if (!isInteractionStructureRoute) return
    const patch: Partial<InteractionStructureQueryValues> = {}
    const activeFilterQueryKeys = new Set(interactionFilterConfigs.map(config => config.queryKey))

    interactionFilterConfigs.forEach((config) => {
      const normalizedFilters = joinInteractionStructureQueryValues(interactionFilters[config.queryKey])
      if (interactionQueryValues[config.queryKey] !== normalizedFilters) {
        patch[config.queryKey] = normalizedFilters
      }
    })

    interactionFilterQueryKeys.forEach((queryKey) => {
      if (activeFilterQueryKeys.has(queryKey)) return
      if (interactionQueryValues[queryKey] !== '') {
        patch[queryKey] = ''
      }
    })

    if (Object.keys(patch).length === 0) return
    updateInteractionQuery(patch)
  }, [
    interactionFilterConfigs,
    interactionFilterQueryKeys,
    interactionFilters,
    interactionQueryValues,
    isInteractionStructureRoute,
    updateInteractionQuery
  ])

  async function handleCreateSession(context?: PendingSessionCreationContext) {
    setPendingSessionCreationContext(context)
    onRequestClose?.()
    onSelectSession({ id: '' } as Session, true)
  }

  function discardOptimisticSession(id: string) {
    markOptimisticSessionDiscarded(id)
    setOptimisticCreations((prev) => {
      if (prev[id] == null) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    void mutateSessions((prev) => {
      if (prev?.sessions == null) return prev
      return {
        ...prev,
        sessions: removeSessionFromList(prev.sessions, id)
      }
    }, false)
  }

  async function handleArchiveSession(id: string) {
    // 先计算下一个要跳转的 ID
    let nextId: string | undefined
    const currentIndex = filteredSessions.findIndex(s => s.id === id)
    if (currentIndex !== -1) {
      if (currentIndex + 1 < filteredSessions.length) {
        nextId = filteredSessions[currentIndex + 1].id
      } else if (currentIndex - 1 >= 0) {
        nextId = filteredSessions[currentIndex - 1].id
      }
    }

    if (optimisticCreations[id] != null) {
      discardOptimisticSession(id)
      if (activeId === id) onDeletedSession?.(id, nextId)
      return
    }

    try {
      await updateSession(id, { isArchived: true })
      await mutateSessions()
      // 传递 nextId 给 onDeletedSession
      onDeletedSession?.(id, nextId)
    } catch (err) {
      console.error('Failed to archive session:', err)
    }
  }

  async function handleDeleteSession(id: string) {
    // 先计算下一个要跳转的 ID
    let nextId: string | undefined
    const currentIndex = filteredSessions.findIndex(s => s.id === id)
    if (currentIndex !== -1) {
      if (currentIndex + 1 < filteredSessions.length) {
        nextId = filteredSessions[currentIndex + 1].id
      } else if (currentIndex - 1 >= 0) {
        nextId = filteredSessions[currentIndex - 1].id
      }
    }

    if (optimisticCreations[id] != null) {
      discardOptimisticSession(id)
      if (activeId === id) onDeletedSession?.(id, nextId)
      return
    }

    try {
      await deleteSession(id)
      await mutateSessions()
      if (activeId === id) onDeletedSession?.(id, nextId)
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  async function handleStarSession(id: string, isStarred: boolean) {
    if (optimisticCreations[id] != null) {
      setOptimisticCreations((prev) => {
        const current = prev[id]
        if (current == null) return prev
        return {
          ...prev,
          [id]: {
            ...current,
            session: {
              ...current.session,
              isStarred
            }
          }
        }
      })
      return
    }

    try {
      await updateSession(id, { isStarred })
      await mutateSessions()
    } catch (err) {
      console.error('Failed to star session:', err)
    }
  }

  async function handleUpdateRoomMetadata(id: string, request: UpdateAgentRoomMetadataRequest) {
    try {
      await updateSidebarRoomMetadata({
        roomId: id,
        request,
        mutateRooms
      })
      return true
    } catch (err) {
      console.error('Failed to update room metadata:', err)
      return false
    }
  }

  async function handleArchiveRoom(id: string, isArchived: boolean) {
    const didUpdate = await handleUpdateRoomMetadata(id, { isArchived })
    if (didUpdate && isArchived && activeId === getRoomSidebarId(id)) {
      onSelectSession({ id: '' } as Session, true)
    }
  }

  async function handleFavoriteRoom(id: string, isFavorited: boolean) {
    await handleUpdateRoomMetadata(id, { isFavorited })
  }

  async function handleRenameSession(id: string, title: string) {
    if (optimisticCreations[id] != null) {
      setOptimisticCreations((prev) => {
        const current = prev[id]
        if (current == null) return prev
        return {
          ...prev,
          [id]: {
            ...current,
            session: {
              ...current.session,
              title
            }
          }
        }
      })
      return
    }

    await updateSessionTitle(id, title)
    await mutateSessions()
  }

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev: Set<string>) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      setSelectedIds(new Set(selectableIds))
    } else {
      setSelectedIds(new Set())
    }
  }

  const handleBatchArchive = async () => {
    try {
      const { roomIds, sessionIds } = selectedConversationIds
      await Promise.all([
        ...sessionIds.map(async (id: string) => updateSession(id, { isArchived: true })),
        ...roomIds.map(async (id: string) => handleUpdateRoomMetadata(id, { isArchived: true }))
      ])
      if (sessionIds.length > 0) {
        await mutateSessions()
      }

      // Calculate nextId if active session is archived
      if (activeId && isRoomSelectionId(activeId) && selectedIds.has(activeId)) {
        onSelectSession({ id: '' } as Session, true)
      } else if (activeId && selectedIds.has(activeId)) {
        let nextId: string | undefined
        // Find the first session that is NOT in the selectedIds list
        const nextSession = filteredSessions.find(s => !selectedIds.has(s.id))
        if (nextSession) {
          nextId = nextSession.id
        }
        onDeletedSession?.(activeId, nextId)
      }

      setSelectedIds(new Set<string>())
      setIsBatchMode(false)
    } catch (err) {
      console.error('Failed to batch archive sessions:', err)
    }
  }

  const handleBatchDelete = async () => {
    try {
      const { sessionIds } = selectedConversationIds
      await Promise.all(sessionIds.map(async (id: string) => deleteSession(id)))
      if (sessionIds.length > 0) {
        await mutateSessions()
      }

      if (activeId && !isRoomSelectionId(activeId) && selectedIds.has(activeId)) {
        const nextSession = filteredSessions.find(s => !selectedIds.has(s.id))
        onDeletedSession?.(activeId, nextSession?.id)
      }

      setSelectedIds(new Set<string>())
      setIsBatchMode(false)
    } catch (err) {
      console.error('Failed to batch delete sessions:', err)
    }
  }

  const handleBatchStar = async (isStarred: boolean) => {
    try {
      const { roomIds, sessionIds } = selectedConversationIds
      await Promise.all([
        ...sessionIds.map(async (id: string) => updateSession(id, { isStarred })),
        ...roomIds.map(async (id: string) => handleUpdateRoomMetadata(id, { isFavorited: isStarred }))
      ])
      if (sessionIds.length > 0) {
        await mutateSessions()
      }
    } catch (err) {
      console.error('Failed to batch update star status:', err)
    }
  }

  const toggleBatchMode = () => {
    setIsBatchMode((prev: boolean) => !prev)
    setSelectedIds(new Set<string>())
  }

  const isNewSessionRoute = location.pathname === '/'
  const isSessionRoute = location.pathname.startsWith('/session/')
  const locationSearchParams = new URLSearchParams(location.search)
  const automationRuleId = locationSearchParams.get('rule')?.trim() ?? ''
  const isAutomationRoute = location.pathname === '/automation'
  const automationEntryMode = isAutomationRoute
    ? locationSearchParams.get('mode') === 'create' || automationRuleId === ''
      ? 'creating'
      : 'item'
    : 'list'
  const pluginPathSegments = splitPathSegments(location.pathname)
  const isPluginPath = pluginPathSegments[0] === 'plugins'
  const pluginEntryMode = isPluginPath
    ? pluginPathSegments.length === 1
      ? locationSearchParams.get('mode') === 'create'
        ? 'creating'
        : 'marketplace'
      : pluginPathSegments.length === 2
      ? 'item'
      : 'list'
    : 'list'
  const sessionEntryMode = isNewSessionRoute ? 'creating' : isSessionRoute ? 'session' : 'list'
  const isCreatingSession = sessionEntryMode === 'creating'
  const effectiveSidebarCollapsed = isCompactLayout || embeddedInNavRail ? false : isSidebarCollapsed
  const resolveTooltipTitle = (title: string) => isTouchInteraction ? undefined : title

  const createBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isSessionRoute || activeId == null || activeId === '' || isRoomSelectionId(activeId)) {
      return
    }
    if (!sidebarSessions.some(session => session.id === activeId)) {
      return
    }

    setLastOpenedSessionId(activeId)
    writeLastOpenedSessionId(activeId)
  }, [activeId, isSessionRoute, sidebarSessions])

  const openLastSessionOrNewSession = React.useCallback(() => {
    const lastSession = lastOpenedSessionId == null
      ? undefined
      : sidebarSessions.find(session => session.id === lastOpenedSessionId)
    if (lastSession != null) {
      onRequestClose?.()
      onSelectSession(lastSession)
      return
    }

    void handleCreateSession()
  }, [lastOpenedSessionId, onRequestClose, onSelectSession, sidebarSessions])
  const setInteractionSearchQuery = React.useCallback((query: string) => {
    updateInteractionQuery({ q: query })
  }, [updateInteractionQuery])
  const setInteractionSearchExpanded = React.useCallback((expanded: boolean) => {
    updateInteractionQuery({ filterPanel: expanded ? 'open' : '' })
  }, [updateInteractionQuery])
  const getInteractionNavigationActions = React.useCallback((routeKey: string) => {
    if (routeKey !== interactionRouteKey) return undefined

    return [
      {
        icon: {
          operations: 'play_arrow',
          requests: 'add_task',
          resources: 'sync'
        }[routeKey] ?? 'play_arrow',
        key: 'route-primary',
        label: {
          operations: t('interactionStructure.actions.runOperation'),
          requests: t('interactionStructure.actions.createFollowUp'),
          resources: t('interactionStructure.actions.syncResource')
        }[routeKey] ?? t('common.moreActions'),
        onSelect: () => {
          setInteractionSearchExpanded(true)
        }
      },
      {
        icon: 'tune',
        key: 'route-filter',
        label: t('common.searchActions'),
        onSelect: () => {
          setInteractionSearchExpanded(!interactionSearchExpanded)
        }
      }
    ]
  }, [interactionRouteKey, interactionSearchExpanded, setInteractionSearchExpanded, t])
  const setInteractionRouteVisibility = React.useCallback((
    routeKey: InteractionStructureRouteKey,
    visible: boolean
  ) => {
    setInteractionHiddenRouteKeys((current) => {
      const next = new Set(current)
      if (visible) {
        next.delete(routeKey)
      } else {
        const visibleCount = interactionRoutes.filter(route => !current.has(route.key)).length
        if (visibleCount <= 1) return current
        next.add(routeKey)
      }
      return next
    })
  }, [interactionRoutes])
  const hideInteractionRoute = React.useCallback((routeKey: InteractionStructureRouteKey) => {
    const visibleRoutes = interactionRoutes.filter(route => !interactionHiddenRouteKeys.has(route.key))
    if (visibleRoutes.length <= 1) return

    setInteractionRouteVisibility(routeKey, false)
    if (routeKey === interactionRouteKey) {
      const nextRoute = visibleRoutes.find(route => route.key !== routeKey)
      if (nextRoute != null) {
        void navigate(buildInteractionStructureNavigationTarget(nextRoute.key, location.search))
      }
    }
  }, [
    interactionHiddenRouteKeys,
    interactionRouteKey,
    interactionRoutes,
    location.search,
    navigate,
    setInteractionRouteVisibility
  ])
  const interactionNavigationItems = useMemo(() =>
    interactionVisibleRoutes.map(route => ({
      actions: getInteractionNavigationActions(route.key),
      activeLabel: route.activeLabel,
      icon: route.icon,
      isActive: route.key === interactionRouteKey,
      key: route.key,
      label: route.label,
      onSelect: () => {
        void navigate(buildInteractionStructureNavigationTarget(route.key, location.search))
      }
    })), [getInteractionNavigationActions, interactionRouteKey, interactionVisibleRoutes, location.search, navigate])
  const interactionNavigationContextMenuItems = React.useCallback(({
    item
  }: {
    item?: { activeLabel?: React.ReactNode; key: string; label?: React.ReactNode }
  }): MenuProps['items'] => {
    const targetRouteKey = item?.key as InteractionStructureRouteKey | undefined
    const targetRoute = targetRouteKey == null
      ? undefined
      : interactionRoutes.find(route => route.key === targetRouteKey)
    const visibleCount = interactionRoutes.filter(route => !interactionHiddenRouteKeys.has(route.key)).length
    const targetRouteLabel = typeof item?.activeLabel === 'string'
      ? item.activeLabel
      : typeof item?.label === 'string'
      ? item.label
      : targetRoute?.label

    const sections: NavRailMoreMenuSection[] = [
      {
        items: [
          {
            children: interactionRoutes.map((route) => {
              const isVisible = !interactionHiddenRouteKeys.has(route.key)
              const routeMenuLabel = route.key === interactionRouteKey
                ? route.activeLabel ?? route.label
                : route.label
              return {
                active: isVisible,
                activeIcon: 'check_box',
                disabled: isVisible && visibleCount <= 1,
                icon: isVisible ? 'check_box' : 'check_box_outline_blank',
                key: `toggle-route:${route.key}`,
                label: routeMenuLabel,
                onSelect: () => setInteractionRouteVisibility(route.key, !isVisible)
              }
            }),
            icon: 'view_column',
            key: 'visible-routes',
            label: t('interactionStructure.navigationMenu.visibleEntries')
          }
        ],
        key: 'visible-routes'
      },
      ...(targetRoute == null
        ? []
        : [
          {
            items: [
              {
                disabled: visibleCount <= 1,
                icon: 'visibility_off',
                key: `hide-route:${targetRoute.key}`,
                label: t('interactionStructure.navigationMenu.hideEntry', {
                  entry: targetRouteLabel
                }),
                onSelect: () => hideInteractionRoute(targetRoute.key)
              }
            ],
            key: `target-route:${targetRoute.key}`
          }
        ]),
      ...(interactionHiddenRouteKeys.size > 0
        ? [
          {
            items: [
              {
                icon: 'select_all',
                key: 'show-all-routes',
                label: t('interactionStructure.navigationMenu.showAllEntries'),
                onSelect: () => setInteractionHiddenRouteKeys(new Set())
              }
            ],
            key: 'restore-routes'
          }
        ]
        : [])
    ]

    return buildNavRailMoreMenuItems({
      closeMenu: () => {},
      isMac,
      sections
    })
  }, [
    hideInteractionRoute,
    interactionHiddenRouteKeys,
    interactionRouteKey,
    interactionRoutes,
    isMac,
    setInteractionRouteVisibility,
    t
  ])
  const setInteractionFilters = React.useCallback((queryKey: string, filters: string[]) => {
    const allowedValues = interactionFilterOptionValues.get(queryKey) ?? new Set<string>()
    const normalizedFilters = filters.filter(filter => allowedValues.has(filter))
    updateInteractionQuery({
      [queryKey]: joinInteractionStructureQueryValues(normalizedFilters)
    } as Partial<InteractionStructureQueryValues>)
  }, [interactionFilterOptionValues, updateInteractionQuery])
  const toggleInteractionBatchMode = React.useCallback(() => {
    setInteractionBatchMode((current) => {
      if (current) setInteractionSelectedKeys(new Set())
      return !current
    })
  }, [])
  const toggleInteractionSelectedKey = React.useCallback((key: string) => {
    setInteractionSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])
  const setInteractionSelection = React.useCallback((keys: Set<string>) => {
    setInteractionSelectedKeys(new Set(keys))
  }, [])
  const runInteractionContextAction = React.useCallback((actionKey: string, item: InteractionStructureItem) => {
    if (actionKey.includes('copy')) {
      void navigator.clipboard?.writeText(String(item.title))
    }
  }, [])
  const renderInteractionSelectionActions = React.useCallback(({
    clearSelection,
    isAllSelected,
    selectAll,
    selectedCount,
    selectedItems,
    totalCount
  }: InteractionListSelectionRenderContext<InteractionStructureItem>) => {
    const actionDisabled = selectedCount === 0
    const selectedItemKeys = selectedItems.map(item => item.key)
    const handleBatchStar = () => {
      if (selectedItemKeys.length === 0) return
      setInteractionStarredKeys((current) => {
        const next = new Set(current)
        selectedItemKeys.forEach(key => next.add(key))
        return next
      })
      clearSelection()
    }
    const handleBatchDone = () => {
      if (selectedItemKeys.length === 0) return
      setInteractionDoneKeys((current) => {
        const next = new Set(current)
        selectedItemKeys.forEach(key => next.add(key))
        return next
      })
      clearSelection()
    }
    const handleBatchArchive = () => {
      if (selectedItemKeys.length === 0) return
      setInteractionHiddenKeys((current) => {
        const next = new Set(current)
        selectedItemKeys.forEach(key => next.add(key))
        return next
      })
      clearSelection()
    }

    return (
      <div className='interaction-structure-selection-actions'>
        <button
          type='button'
          className='interaction-structure-selection-actions__summary'
          aria-label={isAllSelected ? t('common.deselectAll') : t('common.selectAll')}
          title={isAllSelected ? t('common.deselectAll') : t('common.selectAll')}
          onClick={isAllSelected ? clearSelection : selectAll}
        >
          <span className='material-symbols-rounded'>
            {isAllSelected ? 'remove_done' : 'select_all'}
          </span>
          <span>
            {t('interactionStructure.selection.selectedTotal', {
              selected: selectedCount,
              total: totalCount
            })}
          </span>
        </button>
        <button
          type='button'
          className='interaction-structure-selection-actions__button'
          disabled={actionDisabled}
          aria-label={interactionRouteBehavior.favoriteAction.label}
          title={interactionRouteBehavior.favoriteAction.label}
          onClick={handleBatchStar}
        >
          {renderIconAsset({
            active: false,
            className: 'interaction-structure-action-icon',
            icon: interactionRouteBehavior.favoriteAction.activeIcon ?? interactionRouteBehavior.favoriteAction.icon
          })}
        </button>
        <button
          type='button'
          className='interaction-structure-selection-actions__button'
          disabled={actionDisabled}
          aria-label={interactionRouteBehavior.primaryAction.label}
          title={interactionRouteBehavior.primaryAction.label}
          onClick={handleBatchDone}
        >
          {renderIconAsset({
            active: false,
            className: 'interaction-structure-action-icon',
            icon: interactionRouteBehavior.primaryAction.icon
          })}
        </button>
        <button
          type='button'
          className='interaction-structure-selection-actions__button'
          disabled={actionDisabled}
          aria-label={interactionRouteBehavior.archiveAction.label}
          title={interactionRouteBehavior.archiveAction.label}
          onClick={handleBatchArchive}
        >
          {renderIconAsset({
            active: false,
            className: 'interaction-structure-action-icon',
            icon: interactionRouteBehavior.archiveAction.icon
          })}
        </button>
      </div>
    )
  }, [interactionRouteBehavior, t])
  const interactionFilterPanel = (
    <div
      className={['interaction-structure-filter', interactionBatchMode ? 'is-batch-mode' : ''].filter(Boolean).join(
        ' '
      )}
    >
      <button
        type='button'
        className='interaction-structure-filter__batch-toggle'
        aria-label={interactionBatchMode ? t('common.cancelBatch') : t('common.batchMode')}
        aria-pressed={interactionBatchMode}
        title={interactionBatchMode ? t('common.cancelBatch') : t('common.batchMode')}
        onClick={toggleInteractionBatchMode}
      >
        <span className='material-symbols-rounded'>
          {interactionBatchMode ? 'close' : 'checklist'}
        </span>
      </button>
      <div className='interaction-structure-filter__controls'>
        {interactionFilterConfigs.map(config => (
          <div key={config.queryKey} className='interaction-structure-filter__control'>
            <span className='material-symbols-rounded interaction-structure-filter__leading-icon'>
              {config.icon}
            </span>
            <MobileAwareSelect
              className='interaction-structure-filter__select'
              mode='multiple'
              placeholder={config.placeholder}
              options={config.options}
              value={interactionFilters[config.queryKey]}
              maxTagCount={1}
              allowClear
              menuItemSelectedIcon={
                <span className='material-symbols-rounded interaction-structure-filter__option-check'>check</span>
              }
              suffixIcon={
                <span className='material-symbols-rounded interaction-structure-filter__chevron'>expand_more</span>
              }
              mobileTitle={config.label}
              onChange={(value) => {
                setInteractionFilters(config.queryKey, Array.isArray(value) ? value.map(String) : [])
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
  const getInteractionActions = React.useCallback((item: InteractionStructureItem): InteractionListAction<
    InteractionStructureItem
  >[] => {
    const isStarred = interactionStarredKeys.has(item.key)
    const isDone = interactionDoneKeys.has(item.key) || item.filter === 'done'
    return [
      {
        icon: isStarred
          ? interactionRouteBehavior.favoriteAction.activeIcon ?? interactionRouteBehavior.favoriteAction.icon
          : interactionRouteBehavior.favoriteAction.icon,
        key: 'favorite',
        label: isStarred
          ? interactionRouteBehavior.favoriteAction.activeLabel ?? interactionRouteBehavior.favoriteAction.label
          : interactionRouteBehavior.favoriteAction.label,
        onSelect: selectedItem =>
          setInteractionStarredKeys((current) => {
            const next = new Set(current)
            if (next.has(selectedItem.key)) {
              next.delete(selectedItem.key)
            } else {
              next.add(selectedItem.key)
            }
            return next
          })
      },
      {
        disabled: isDone,
        icon: interactionRouteBehavior.primaryAction.icon,
        key: 'primary',
        label: interactionRouteBehavior.primaryAction.label,
        onSelect: selectedItem => setInteractionDoneKeys((current) => new Set(current).add(selectedItem.key))
      },
      {
        icon: '',
        key: 'divider-main',
        label: '',
        type: 'divider'
      },
      ...interactionRouteBehavior.contextActions.map(action => ({
        confirmLabel: action.confirmLabel,
        danger: action.danger,
        icon: action.icon,
        key: action.key ?? action.label,
        label: action.label,
        onSelect: (selectedItem: InteractionStructureItem) =>
          runInteractionContextAction(action.key ?? action.label, selectedItem)
      })),
      ...(interactionRouteBehavior.contextActions.length > 0
        ? [{
          icon: '',
          key: 'divider-archive',
          label: '',
          type: 'divider' as const
        }]
        : []),
      {
        confirmLabel: t('common.confirmAction', { action: interactionRouteBehavior.archiveAction.label }),
        icon: interactionRouteBehavior.archiveAction.icon,
        key: 'archive',
        label: interactionRouteBehavior.archiveAction.label,
        onSelect: selectedItem => setInteractionHiddenKeys((current) => new Set(current).add(selectedItem.key))
      }
    ]
  }, [interactionDoneKeys, interactionRouteBehavior, interactionStarredKeys, runInteractionContextAction, t])
  const renderInteractionItemContent = React.useCallback(({
    item
  }: InteractionListItemRenderContext<InteractionStructureItem>) => {
    if (item.variant === 'compact') return null

    if (item.variant === 'metrics') {
      return (
        <div className='interaction-structure-row-metrics'>
          {item.metrics?.map(metric => (
            <span key={`${metric.label}:${metric.value}`} className='interaction-structure-row-metric'>
              <span className='interaction-structure-row-metric__label'>{metric.label}</span>
              <strong className='interaction-structure-row-metric__value'>{metric.value}</strong>
            </span>
          ))}
        </div>
      )
    }

    if (item.variant === 'checkpoint') {
      const progress = Math.min(100, Math.max(0, item.progress ?? 0))

      return (
        <div className='interaction-structure-row-checkpoint'>
          <div className='interaction-structure-row-checkpoint__line'>
            {item.status != null && (
              <span className='interaction-structure-row-checkpoint__status'>{item.status}</span>
            )}
            {item.description != null && (
              <span className='interaction-structure-row-checkpoint__detail'>{item.description}</span>
            )}
          </div>
          <div className='interaction-structure-row-progress' aria-hidden='true'>
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      )
    }

    if (item.variant === 'activity') {
      return (
        <div className='interaction-structure-row-activity'>
          {item.status != null && (
            <span className='interaction-structure-row-activity__status'>{item.status}</span>
          )}
          {item.detail != null && (
            <span className='interaction-structure-row-activity__detail'>{item.detail}</span>
          )}
        </div>
      )
    }

    return (
      <div className='interaction-structure-row-summary'>
        {item.description != null && (
          <span className='interaction-structure-row-summary__description'>{item.description}</span>
        )}
        {(item.tags?.length ?? 0) > 0 && (
          <span className='interaction-structure-row-tags'>
            {item.tags?.map((tag, index) => (
              <span key={index} className='interaction-structure-row-tag'>{tag}</span>
            ))}
          </span>
        )}
      </div>
    )
  }, [])
  const selectConversationById = React.useCallback((id: string) => {
    if (isRoomSelectionId(id)) {
      const room = filteredRooms.find(item => item.id === getRoomIdFromSelectionId(id))
      if (room != null) onSelectRoom(room)
      return
    }

    const session = filteredSessions.find(item => item.id === id)
    if (session != null) onSelectSession(session)
  }, [filteredRooms, filteredSessions, onSelectRoom, onSelectSession])
  const navigateAdjacentConversation = React.useCallback((direction: -1 | 1) => {
    if (selectableIds.length === 0) {
      return
    }

    const currentIndex = activeId == null ? -1 : selectableIds.indexOf(activeId)
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : selectableIds.length - 1
      : (currentIndex + direction + selectableIds.length) % selectableIds.length
    const nextId = selectableIds[nextIndex]
    if (nextId != null) selectConversationById(nextId)
  }, [activeId, selectableIds, selectConversationById])

  useEffect(() =>
    addDesktopViewShortcutListener((action) => {
      if (action === 'previous-chat') {
        navigateAdjacentConversation(-1)
        return
      }

      if (action === 'next-chat') {
        navigateAdjacentConversation(1)
      }
    }), [navigateAdjacentConversation])

  useGlobalShortcut({
    shortcut: resolvedNewSessionShortcut,
    isMac,
    onTrigger: (event) => {
      event.preventDefault()
      if (isCreatingSession) return
      if (createBtnRef.current) {
        createBtnRef.current.classList.add('active-scale')
        setTimeout(() => {
          createBtnRef.current?.classList.remove('active-scale')
        }, 200)
      }
      void handleCreateSession()
    }
  })

  return (
    <div
      className={[
        'sidebar-container',
        effectiveSidebarCollapsed ? 'collapsed' : '',
        isResizing ? 'is-resizing' : '',
        isCompactLayout ? 'sidebar-container--compact' : '',
        embeddedInNavRail ? 'sidebar-container--nav-embedded' : '',
        isMobileOpen ? 'is-mobile-open' : ''
      ].filter(Boolean).join(' ')}
      style={isCompactLayout || embeddedInNavRail
        ? undefined
        : {
          width: effectiveSidebarCollapsed ? 0 : width,
          minWidth: effectiveSidebarCollapsed ? 0 : undefined,
          transition: isResizing ? 'none' : 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          borderRight: effectiveSidebarCollapsed ? 'none' : undefined
        }}
    >
      <div
        className='sidebar-content'
        style={isCompactLayout || embeddedInNavRail
          ? undefined
          : {
            width,
            transition: isResizing ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            transform: effectiveSidebarCollapsed ? `translateX(-${width}px)` : 'translateX(0)'
          }}
      >
        <SidebarHeader
          adapterFilters={adapterFilters}
          availableAdapters={availableAdapters}
          hasActiveSearchControls={isInteractionStructureRoute ? false : hasActiveSearchControls}
          hideSearchRow={isInteractionStructureRoute}
          hideSideAction={embeddedInNavRail}
          isCompactLayout={isCompactLayout}
          isSidebarCollapsed={effectiveSidebarCollapsed}
          navigationContextMenuItems={isInteractionStructureRoute ? interactionNavigationContextMenuItems : undefined}
          navigationItems={isInteractionStructureRoute ? interactionNavigationItems : undefined}
          automationEntryMode={automationEntryMode}
          pluginEntryMode={pluginEntryMode}
          newSessionShortcut={resolvedNewSessionShortcut}
          routeSearch={routeSidebar == null
            ? undefined
            : {
              placeholder: routeSidebar.search.placeholder ?? t('common.search'),
              suffix: routeSidebar.search.suffix,
              value: routeSidebar.search.value,
              onChange: routeSidebar.search.onChange
            }}
          sessionEntryMode={sessionEntryMode}
          searchQuery={searchQuery}
          sortOrder={sortOrder}
          sortSelection={sortSelection}
          onSearchChange={setSearchQuery}
          availableTags={availableTags}
          tagFilters={tagFilters}
          onSortOrderChange={setSortOrder}
          onAdapterFilterChange={setAdapterFilters}
          onTagFilterChange={setTagFilters}
          isBatchMode={isBatchMode}
          onToggleBatchMode={toggleBatchMode}
          onToggleSidebarCollapsed={() => setSidebarCollapsed(!isSidebarCollapsed)}
          onCloseSidebar={onRequestClose}
          selectedCount={selectedIds.size}
          sessionCount={isInteractionStructureRoute
            ? interactionSelectableKeys.length
            : sidebarSessions.length + rooms.length}
          totalCount={isInteractionStructureRoute ? interactionSelectableKeys.length : selectableIds.length}
          canBatchDelete={selectedConversationIds.roomIds.length === 0}
          onSelectAll={handleSelectAll}
          onBatchArchive={() => {
            void handleBatchArchive()
          }}
          onBatchDelete={() => {
            void handleBatchDelete()
          }}
          onBatchStar={() => {
            void handleBatchStar(true)
          }}
          onCreateSession={() => {
            void handleCreateSession()
          }}
          onOpenSessionList={openLastSessionOrNewSession}
        />
        {isInteractionStructureRoute
          ? (
            <InteractionList<InteractionStructureItem>
              actions={getInteractionActions}
              activeKey={interactionActiveKey}
              className='interaction-structure-list'
              emptyText={t('interactionStructure.empty')}
              isTouchInteraction={isTouchInteraction}
              items={interactionFilteredItems}
              selectedKeys={interactionSelectedKeys}
              selectionMode={interactionBatchMode}
              search={{
                expanded: interactionSearchExpanded,
                filterPanel: interactionFilterPanel,
                filterToggleIcon: (
                  <span className='material-symbols-rounded interaction-structure-filter-panel-icon'>
                    expand_more
                  </span>
                ),
                placeholder: interactionRouteConfig?.searchPlaceholder ?? t('interactionStructure.searchPlaceholder'),
                value: interactionSearchQuery,
                onChange: setInteractionSearchQuery,
                onExpandedChange: setInteractionSearchExpanded
              }}
              renderItemAction={({ isActionPending, item, runAction }) => {
                const isDone = interactionDoneKeys.has(item.key) || item.filter === 'done'
                const actionKey = isDone ? 'archive' : 'primary'
                const actionConfig = isDone
                  ? interactionRouteBehavior.archiveAction
                  : interactionRouteBehavior.primaryAction

                return (
                  <button
                    type='button'
                    className={[
                      'interaction-structure-row-action',
                      isDone ? 'is-done' : '',
                      isActionPending(actionKey) ? 'is-confirming' : ''
                    ].filter(Boolean).join(' ')}
                    aria-label={actionConfig.label}
                    title={actionConfig.label}
                    onClick={(event) => {
                      event.stopPropagation()
                      runAction(actionKey)
                    }}
                  >
                    {renderIconAsset({
                      active: false,
                      className: 'interaction-structure-action-icon',
                      icon: isActionPending(actionKey) ? 'check' : actionConfig.icon
                    })}
                  </button>
                )
              }}
              renderItemContent={renderInteractionItemContent}
              renderSelectionActions={renderInteractionSelectionActions}
              onSelectionChange={setInteractionSelection}
              onToggleSelect={toggleInteractionSelectedKey}
              onSelect={(item) => {
                updateInteractionQuery({ item: item.key })
                onRequestClose?.()
              }}
            />
          )
          : routeSidebar != null
          ? (
            <SidebarGroupedList
              activeKey={routeSidebar.activeKey}
              contextMenuItems={routeSidebar.contextMenuItems}
              emptyText={routeSidebar.emptyText ?? t('common.noResults')}
              groups={routeSidebar.groups}
              onSelect={(item) => {
                routeSidebar.onSelectItem(item)
                onRequestClose?.()
              }}
            />
          )
          : (
            <SessionList
              hasActiveFilters={hasActiveFilterConditions}
              isLoading={isSessionsLoading || isRoomsLoading}
              rooms={filteredRooms}
              sessions={filteredSessions}
              activeId={activeId}
              isBatchMode={isBatchMode}
              isCompactLayout={isCompactLayout}
              selectedIds={selectedIds}
              isTouchInteraction={isTouchInteraction}
              showSessionCardMessage={showSessionCardMessage}
              sortOrder={sortOrder}
              searchQuery={searchQuery}
              onArchiveRoom={handleArchiveRoom}
              onFavoriteRoom={handleFavoriteRoom}
              onSelectRoom={onSelectRoom}
              onCreateSession={handleCreateSession}
              onSelectSession={onSelectSession}
              onArchiveSession={handleArchiveSession}
              onDeleteSession={handleDeleteSession}
              onRenameSession={handleRenameSession}
              onStarSession={handleStarSession}
              onToggleSelect={handleToggleSelect}
            />
          )}
      </div>
      {!embeddedInNavRail && !isCompactLayout && isSidebarCollapsed && (
        <SidebarListCollapsedActions>
          <SidebarListCollapsedActionButton
            buttonRef={createBtnRef as React.Ref<HTMLAnchorElement | HTMLButtonElement>}
            active={isCreatingSession}
            disabled={!!isCreatingSession}
            filled={isCreatingSession}
            icon={isCreatingSession ? 'chat_bubble' : 'send'}
            tooltip={resolveTooltipTitle(isCreatingSession ? t('common.alreadyInNewChat') : t('common.newChat'))}
            ariaLabel={isCreatingSession ? t('common.alreadyInNewChat') : t('common.newChat')}
            onClick={() => {
              void handleCreateSession()
            }}
          />
          <SidebarListCollapsedActionButton
            icon='dock_to_right'
            tooltip={resolveTooltipTitle(t('common.expand'))}
            ariaLabel={t('common.expand')}
            onClick={() => setSidebarCollapsed(false)}
          />
        </SidebarListCollapsedActions>
      )}
    </div>
  )
}
