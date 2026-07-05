import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router-dom'

import type { Session } from '@oneworks/core'

import {
  INTERACTION_PANEL_SESSION_FOCUS_QUERY_PARAM,
  INTERACTION_PANEL_SESSION_QUERY_PARAM
} from '#~/components/chat/interaction-panel/interaction-panel-session-query'
import type { SidebarRoomItem } from '#~/components/sidebar/conversation-items'
import { CHAT_ROUTE_SENDER_FOCUS_QUERY_PARAM } from '#~/routes/chat-route-query'
import { sidebarWidthAtom } from '#~/store'

import { SESSION_ROUTE_PATTERN, getActiveSidebarIdFromPath } from './sidebar-navigation-paths'

const AGENT_ROOM_MODE_QUERY = 'agentRoomMode'

const createSenderFocusRequestId = () => (
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
)

export function buildSidebarNavigationTarget(
  pathname: string,
  currentSearch: string,
  options: { focusRequestId?: string } = {}
) {
  const nextParams = new URLSearchParams(currentSearch)
  nextParams.delete(AGENT_ROOM_MODE_QUERY)
  nextParams.delete(INTERACTION_PANEL_SESSION_QUERY_PARAM)
  nextParams.delete(INTERACTION_PANEL_SESSION_FOCUS_QUERY_PARAM)
  nextParams.delete(CHAT_ROUTE_SENDER_FOCUS_QUERY_PARAM)
  if (options.focusRequestId != null && options.focusRequestId.trim() !== '') {
    nextParams.set(CHAT_ROUTE_SENDER_FOCUS_QUERY_PARAM, options.focusRequestId.trim())
  }
  const search = nextParams.toString()
  return {
    pathname,
    search: search === '' ? '' : `?${search}`
  }
}

export function buildSidebarChildSessionNavigationTarget(
  parentSessionId: string,
  childSessionId: string,
  currentSearch: string,
  options: { focusRequestId?: string } = {}
) {
  const nextParams = new URLSearchParams(currentSearch)
  nextParams.delete(AGENT_ROOM_MODE_QUERY)
  nextParams.delete(CHAT_ROUTE_SENDER_FOCUS_QUERY_PARAM)
  nextParams.delete(INTERACTION_PANEL_SESSION_FOCUS_QUERY_PARAM)
  nextParams.set(INTERACTION_PANEL_SESSION_QUERY_PARAM, childSessionId)
  if (options.focusRequestId != null && options.focusRequestId.trim() !== '') {
    nextParams.set(INTERACTION_PANEL_SESSION_FOCUS_QUERY_PARAM, options.focusRequestId.trim())
  }
  nextParams.set('terminal', 'true')
  const search = nextParams.toString()
  return {
    pathname: `/session/${parentSessionId}`,
    search: search === '' ? '' : `?${search}`
  }
}

export function useSidebarNavigation() {
  const navigate = useNavigate()
  const location = useLocation()
  const sidebarWidth = useAtomValue(sidebarWidthAtom)
  const sessionMatch = matchPath({ path: SESSION_ROUTE_PATTERN, end: true }, location.pathname)
  const activeSessionId = sessionMatch?.params.sessionId
  const queryPanelSessionId = new URLSearchParams(location.search).get(INTERACTION_PANEL_SESSION_QUERY_PARAM)?.trim()
  const activeSidebarId = queryPanelSessionId != null && queryPanelSessionId !== ''
    ? queryPanelSessionId
    : getActiveSidebarIdFromPath(location.pathname)
  const showSidebar = true

  const getNavigationTarget = useCallback(
    (pathname: string, options: { focusRequestId?: string } = {}) =>
      buildSidebarNavigationTarget(pathname, location.search, options),
    [location.search]
  )

  const handleSelectSession = useCallback((session: Session, _isNew?: boolean) => {
    if (session.parentSessionId != null && session.parentSessionId !== '') {
      void navigate(buildSidebarChildSessionNavigationTarget(session.parentSessionId, session.id, location.search, {
        focusRequestId: createSenderFocusRequestId()
      }))
      return
    }

    void navigate(getNavigationTarget(session.id === '' ? '/' : `/session/${session.id}`))
  }, [getNavigationTarget, location.search, navigate])

  const handleSelectRoom = useCallback((room: SidebarRoomItem) => {
    void navigate(getNavigationTarget(`/rooms/${room.id}`))
  }, [getNavigationTarget, navigate])

  const handleDeletedSession = useCallback((deletedId: string, nextId?: string) => {
    if (activeSessionId !== deletedId) return
    void navigate(getNavigationTarget(nextId ? `/session/${nextId}` : '/'))
  }, [activeSessionId, getNavigationTarget, navigate])

  return {
    activeSidebarId,
    handleDeletedSession,
    handleSelectRoom,
    handleSelectSession,
    showSidebar,
    sidebarWidth
  }
}
