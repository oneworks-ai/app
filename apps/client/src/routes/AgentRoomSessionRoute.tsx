import './ChatRoute.scss'

import { Button, Empty, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'

import type { Session } from '@oneworks/core'

import { getAgentRoom, getSession, getSessionCacheKey } from '#~/api'
import type { AgentRoomMemberView } from '#~/components/agent-room'
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
  onBack
}: {
  description: string
  onBack: () => void
}) {
  const { t } = useTranslation()

  return (
    <ChatRouteStatusShell title={description}>
      <div className='chat-route__empty-state'>
        <Empty description={description} />
        <Button type='primary' onClick={onBack}>{t('agentRoom.actions.backToRoom')}</Button>
      </div>
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
    isLoading: isRoomLoading
  } = useSWR(
    roomId == null ? null : getAgentRoomSessionDetailCacheKey(roomId),
    () => getAgentRoom(roomId ?? '')
  )
  const {
    data: sessionDetail,
    error: sessionError,
    isLoading: isSessionLoading
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
        <div className='chat-route__empty-state'>
          <Empty description={t('common.roomNotFound')} />
          <Button type='primary' onClick={() => void navigate('/')}>{t('common.backToHome')}</Button>
        </div>
      </ChatRouteStatusShell>
    )
  }

  if (roomRun == null || session == null || sessionError != null) {
    return (
      <AgentRoomSessionNotFound
        description={t('common.sessionNotFound')}
        onBack={backToRoom}
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
