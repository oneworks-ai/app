/* eslint-disable max-lines -- room-scoped session route owns room/session lookup and not-found actions together. */
import './ChatRoute.scss'

import { Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'

import type { Session } from '@oneworks/core'

import { getAgentRoom, getApiErrorMessage, getSession, getSessionCacheKey } from '#~/api'
import type { AgentRoomMemberView } from '#~/components/agent-room'
import { RouteErrorState } from '#~/components/error-state'
import { useDesktopWorkspaceStartupReady } from '#~/components/layout/desktop-workspace-startup-ready'

import { ChatRouteStatusShell } from './ChatRouteStatusShell'
import { ChatRouteView } from './ChatRouteView'
import { buildAgentRoomPath } from './agent-room-session-paths'

const getAgentRoomSessionDetailCacheKey = (roomId: string) => `/api/agent-rooms/${roomId}`
const AGENT_ROOM_SESSION_MODE_QUERY = 'agentRoomMode'

const buildSearchString = (searchParams: URLSearchParams) => {
  const search = searchParams.toString()
  return search === '' ? '' : `?${search}`
}

const getAgentRoomSessionSourceMembers = (
  detail: NonNullable<Awaited<ReturnType<typeof getAgentRoom>>>
): AgentRoomMemberView[] => {
  const runsByMemberKey = new Map<string, AgentRoomMemberView['runs']>()
  for (const run of detail.runs) {
    const runs = runsByMemberKey.get(run.memberKey) ?? []
    runs.push({
      runKey: run.key,
      memberKey: run.memberKey,
      sessionId: run.sessionId,
      title: run.title,
      status: run.status
    })
    runsByMemberKey.set(run.memberKey, runs)
  }

  return detail.members.map(member => ({
    memberKey: member.key,
    kind: member.kind,
    label: member.label,
    subtitle: member.subtitle,
    avatarLabel: member.avatar,
    status: member.status,
    pendingCount: member.pendingCount,
    activeRunCount: member.activeRunCount,
    latestSummary: member.latestSummary,
    runs: runsByMemberKey.get(member.key) ?? []
  }))
}

function AgentRoomSessionNotFound({
  description,
  diagnostics,
  onBack,
  onRetry
}: {
  description: string
  diagnostics: {
    roomId?: string
    sessionId?: string
    message: string
  }
  onBack: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()

  return (
    <ChatRouteStatusShell title={description}>
      <RouteErrorState
        actions={[
          {
            kind: 'home',
            label: t('agentRoom.actions.backToRoom'),
            onClick: onBack
          },
          {
            kind: 'retry',
            onClick: onRetry
          }
        ]}
        description={t('errorState.sessionNotFoundDescription')}
        details={{
          copyText: [
            `${t('errorState.roomId')}: ${diagnostics.roomId ?? 'n/a'}`,
            `${t('errorState.sessionId')}: ${diagnostics.sessionId ?? 'n/a'}`,
            `${t('errorState.diagnostics')}: ${diagnostics.message}`
          ].join('\n'),
          items: [
            { label: t('errorState.roomId'), mono: true, value: diagnostics.roomId ?? 'n/a' },
            { label: t('errorState.sessionId'), mono: true, value: diagnostics.sessionId ?? 'n/a' },
            { label: t('errorState.diagnostics'), value: diagnostics.message }
          ],
          title: t('errorState.diagnostics')
        }}
        mobileDescription={description}
        severity='info'
        title={description}
      />
    </ChatRouteStatusShell>
  )
}

export function AgentRoomSessionRoute() {
  const { t } = useTranslation()
  const { roomId, sessionId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const backToRoom = () => {
    if (roomId == null) {
      void navigate('/')
      return
    }

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete(AGENT_ROOM_SESSION_MODE_QUERY)
    void navigate({
      pathname: buildAgentRoomPath(roomId),
      search: buildSearchString(nextParams)
    })
  }
  const {
    data: roomDetail,
    error: roomError,
    isLoading: isRoomLoading,
    mutate: mutateRoom
  } = useSWR(
    roomId == null ? null : getAgentRoomSessionDetailCacheKey(roomId),
    () => getAgentRoom(roomId ?? '')
  )
  const {
    data: sessionDetail,
    error: sessionError,
    isLoading: isSessionLoading,
    mutate: mutateSession
  } = useSWR<{ session: Session }>(
    sessionId == null ? null : getSessionCacheKey(sessionId),
    () => getSession(sessionId ?? '')
  )
  const isRoomNotFound = roomId != null && !isRoomLoading && (roomDetail == null || roomError != null)
  const session = sessionDetail?.session
  const roomRun = roomDetail?.runs.find(run => run.sessionId === sessionId)
  const isSessionNotFound = roomId != null && sessionId != null && !isRoomLoading && !isSessionLoading &&
    !isRoomNotFound &&
    (roomRun == null || session == null || sessionError != null)
  useDesktopWorkspaceStartupReady(isRoomNotFound || isSessionNotFound)

  if (roomId == null || sessionId == null) {
    return (
      <ChatRouteStatusShell>
        <div className='chat-route__loading-state'>
          <Spin size='large' />
        </div>
      </ChatRouteStatusShell>
    )
  }

  if (isRoomLoading || isSessionLoading) {
    return (
      <ChatRouteStatusShell isReady={false}>
        <div className='chat-route__loading-state'>
          <Spin size='large' />
        </div>
      </ChatRouteStatusShell>
    )
  }

  if (roomDetail == null || roomError != null) {
    return (
      <ChatRouteStatusShell title={t('common.roomNotFound')}>
        <RouteErrorState
          actions={[
            {
              kind: 'home',
              onClick: () => void navigate('/')
            },
            {
              kind: 'retry',
              onClick: () => void mutateRoom()
            }
          ]}
          description={t('errorState.roomNotFoundDescription')}
          details={{
            copyText: [
              `${t('errorState.roomId')}: ${roomId}`,
              `${t('errorState.diagnostics')}: ${getApiErrorMessage(roomError, 'n/a')}`
            ].join('\n'),
            items: [
              { label: t('errorState.roomId'), mono: true, value: roomId },
              { label: t('errorState.diagnostics'), value: getApiErrorMessage(roomError, 'n/a') }
            ],
            title: t('errorState.diagnostics')
          }}
          mobileDescription={t('common.roomNotFound')}
          severity='info'
          title={t('common.roomNotFound')}
        />
      </ChatRouteStatusShell>
    )
  }

  if (roomRun == null || session == null || sessionError != null) {
    return (
      <AgentRoomSessionNotFound
        diagnostics={{
          message: getApiErrorMessage(sessionError, 'n/a'),
          roomId,
          sessionId
        }}
        description={t('common.sessionNotFound')}
        onBack={backToRoom}
        onRetry={() => void mutateSession()}
      />
    )
  }

  return (
    <ChatRouteView
      headerBreadcrumb={{
        backLabel: t('agentRoom.actions.backToRoom'),
        parentTitle: roomDetail.room.title,
        onBack: backToRoom
      }}
      isAgentRoomSession
      agentRoomSourceMembers={getAgentRoomSessionSourceMembers(roomDetail)}
      modeSwitch={{
        mode: 'session',
        onOpenRoom: backToRoom,
        onOpenSession: () => undefined
      }}
      session={session}
    />
  )
}
