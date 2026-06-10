/* eslint-disable max-lines -- route coordinates session, room, branch, and optimistic navigation state. */
import './ChatRoute.scss'

import { Button, Empty, Spin } from 'antd'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'

import type { AgentRoomListResponse, Session } from '@oneworks/core'
import type { ConfigResponse } from '@oneworks/types'

import { getConfig, getSession, getSessionCacheKey, listAgentRooms, listSessions } from '#~/api'
import { useDesktopWorkspaceStartupReady } from '#~/components/layout/desktop-workspace-startup-ready'
import {
  clearOptimisticSessionDiscarded,
  isOptimisticSessionResolvedBySession,
  optimisticSessionCreationsAtom
} from '#~/hooks/chat/optimistic-session-creation'
import {
  MESSAGE_BRANCH_SESSION_QUERY,
  isMessageBranchSession,
  resolveMessageBranchRootSessionId
} from '#~/utils/message-branch-session'

import { ChatRouteStatusShell } from './ChatRouteStatusShell'
import { ChatRouteView } from './ChatRouteView'
import { buildAgentRoomPath, buildSearchString } from './agent-room-session-paths'
import { mergeChatRouteSessions } from './chat-route-session-context'
import { useActiveMessageBranchSession } from './use-active-message-branch-session'
import { useMessageBranchLineage } from './use-message-branch-lineage'

const AGENT_ROOM_SESSION_MODE_QUERY = 'agentRoomMode'
const AGENT_ROOM_SESSION_MODE_VALUE = 'session'

const isAgentRoomExperimentEnabled = (configRes?: ConfigResponse) => (
  configRes?.sources?.merged?.experiments?.agentRoom === true
)

const isSessionTimelineExperimentEnabled = (configRes?: ConfigResponse) => (
  configRes?.sources?.merged?.experiments?.sessionTimeline === true
)

export function ChatRoute() {
  const { t } = useTranslation()
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const branchSessionId = searchParams.get(MESSAGE_BRANCH_SESSION_QUERY)?.trim() || undefined
  const optimisticCreations = useAtomValue(optimisticSessionCreationsAtom)
  const setOptimisticCreations = useSetAtom(optimisticSessionCreationsAtom)
  const { data: configRes } = useSWR<ConfigResponse>('/api/config', getConfig)
  const isAgentRoomEnabled = isAgentRoomExperimentEnabled(configRes)
  const enableTimelineView = configRes == null
    ? undefined
    : isSessionTimelineExperimentEnabled(configRes)
  const { data: sessionRes, error: sessionError, isLoading } = useSWR<{ session: Session }>(
    sessionId ? getSessionCacheKey(sessionId) : null,
    () => getSession(sessionId ?? '')
  )
  const { data: sessionsRes } = useSWR<{ sessions: Session[] }>(
    sessionId ? '/api/sessions' : null,
    () => listSessions('active')
  )
  const {
    data: branchSessionRes,
    error: branchSessionError,
    isLoading: isBranchSessionLoading,
    isValidating: isBranchSessionValidating
  } = useSWR<{ session: Session }>(
    branchSessionId != null && branchSessionId !== sessionId ? getSessionCacheKey(branchSessionId) : null,
    () => getSession(branchSessionId ?? '')
  )
  const { data: roomsRes } = useSWR<AgentRoomListResponse>(
    isAgentRoomEnabled && sessionId != null ? '/api/agent-rooms' : null,
    listAgentRooms,
    {
      refreshInterval: 1000,
      revalidateOnFocus: true
    }
  )
  const optimisticCreation = sessionId == null ? undefined : optimisticCreations[sessionId]
  const isOptimisticResolved = isOptimisticSessionResolvedBySession(optimisticCreation, sessionRes?.session)
  const session = sessionId == null
    ? undefined
    : isOptimisticResolved
    ? sessionRes?.session
    : optimisticCreation?.session ?? sessionRes?.session
  const { data: archivedSessionsRes, error: archivedSessionsError } = useSWR<{ sessions: Session[] }>(
    session?.isArchived === true || branchSessionId != null ? '/api/sessions/archived' : null,
    () => listSessions('archived')
  )
  const branchSession = branchSessionId != null && branchSessionRes?.session?.id === branchSessionId
    ? branchSessionRes.session
    : undefined
  const {
    branchSession: branchContextSession,
    isLoading: isBranchLineageLoading,
    sessions: branchLineageSessions
  } = useMessageBranchLineage({
    branchSession,
    branchSessionId,
    session,
    sessions: sessionsRes?.sessions
  })
  const sessions = useMemo(
    () =>
      mergeChatRouteSessions(
        sessionsRes?.sessions,
        archivedSessionsRes?.sessions,
        [session, branchContextSession, ...branchLineageSessions]
      ),
    [archivedSessionsRes?.sessions, branchContextSession, branchLineageSessions, session, sessionsRes?.sessions]
  )
  const routeRootSessionId = resolveMessageBranchRootSessionId(session, sessions)
  const queryBranchSession = branchSessionId == null
    ? undefined
    : sessions.find(item => item.id === branchSessionId) ?? branchSession
  const activeBranchSession = useActiveMessageBranchSession({
    branchLineageLoading: isBranchLineageLoading,
    branchSessionId,
    branchSessionLoading: branchSessionId != null &&
      branchSessionId !== sessionId &&
      branchSessionError == null &&
      (branchSession == null || isBranchSessionLoading || isBranchSessionValidating),
    queryBranchSession,
    rootSessionId: sessionId,
    sessions
  })
  const activeSession = activeBranchSession ?? session
  const shouldWaitForMessageBranchContext =
    ((session?.isArchived === true || branchSessionId != null) && archivedSessionsRes == null &&
      archivedSessionsError == null) ||
    (branchSessionId != null && activeBranchSession == null && branchSessionError == null &&
      branchSessionId !== sessionId &&
      (branchSession == null || isBranchSessionLoading || isBranchSessionValidating))
  const roomForSession = useMemo(
    () => (
      isAgentRoomEnabled && sessionId != null
        ? roomsRes?.rooms.find(room => room.hostSessionId === sessionId)
        : undefined
    ),
    [isAgentRoomEnabled, roomsRes?.rooms, sessionId]
  )
  const openRoom = () => {
    if (roomForSession == null) return
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete(AGENT_ROOM_SESSION_MODE_QUERY)
    void navigate({
      pathname: buildAgentRoomPath(roomForSession.id),
      search: buildSearchString(nextParams)
    })
  }
  const openSession = () => {
    if (sessionId == null) return
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set(AGENT_ROOM_SESSION_MODE_QUERY, AGENT_ROOM_SESSION_MODE_VALUE)
    void navigate({
      pathname: `/session/${encodeURIComponent(sessionId)}`,
      search: buildSearchString(nextParams)
    })
  }
  const isExplicitAgentRoomSessionMode =
    searchParams.get(AGENT_ROOM_SESSION_MODE_QUERY) === AGENT_ROOM_SESSION_MODE_VALUE
  const isSessionNotFound = sessionId != null && session == null && (sessionError != null || !isLoading)
  useDesktopWorkspaceStartupReady(isSessionNotFound)

  useEffect(() => {
    if (sessionId == null || !isOptimisticResolved) {
      return
    }

    setOptimisticCreations((current) => {
      if (current[sessionId] == null) return current
      const next = { ...current }
      delete next[sessionId]
      return next
    })
    clearOptimisticSessionDiscarded(sessionId)
  }, [isOptimisticResolved, sessionId, setOptimisticCreations])

  useEffect(() => {
    if (roomForSession == null || isExplicitAgentRoomSessionMode) {
      return
    }

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete(AGENT_ROOM_SESSION_MODE_QUERY)
    void navigate({
      pathname: buildAgentRoomPath(roomForSession.id),
      search: buildSearchString(nextParams)
    }, { replace: true })
  }, [isExplicitAgentRoomSessionMode, navigate, roomForSession, searchParams])

  useEffect(() => {
    if (session == null || !isMessageBranchSession(session)) {
      return
    }
    if (routeRootSessionId == null || routeRootSessionId === session.id) {
      return
    }

    const nextParams = new URLSearchParams(searchParams)
    nextParams.set(MESSAGE_BRANCH_SESSION_QUERY, session.id)
    void navigate({
      pathname: `/session/${encodeURIComponent(routeRootSessionId)}`,
      search: buildSearchString(nextParams)
    }, { replace: true })
  }, [navigate, routeRootSessionId, searchParams, session])

  if (
    sessionId != null &&
    ((isLoading && optimisticCreation == null) || shouldWaitForMessageBranchContext)
  ) {
    return (
      <ChatRouteStatusShell isReady={false}>
        <div className='chat-route__loading-state'>
          <Spin size='large' />
        </div>
      </ChatRouteStatusShell>
    )
  }
  if (isSessionNotFound) {
    return (
      <ChatRouteStatusShell title={t('common.sessionNotFound')}>
        <div className='chat-route__empty-state'>
          <Empty description={t('common.sessionNotFound')} />
          <Button type='primary' onClick={() => void navigate('/')}>{t('common.backToHome')}</Button>
        </div>
      </ChatRouteStatusShell>
    )
  }

  return (
    <ChatRouteView
      headerBreadcrumb={roomForSession == null
        ? undefined
        : {
          backLabel: t('agentRoom.actions.backToRoom'),
          parentTitle: roomForSession.title,
          onBack: openRoom
        }}
      modeSwitch={roomForSession == null
        ? undefined
        : {
          mode: 'session',
          onOpenRoom: openRoom,
          onOpenSession: openSession
        }}
      isAgentRoomSession={roomForSession != null}
      enableTimelineView={enableTimelineView}
      canonicalSessionId={routeRootSessionId ?? session?.id}
      projectWorkspaceFolder={configRes?.meta?.workspaceFolder}
      session={activeSession}
      sessions={sessions}
    />
  )
}
