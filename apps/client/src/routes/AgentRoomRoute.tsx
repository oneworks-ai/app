/* eslint-disable max-lines -- agent room route owns detail loading, empty state, and room actions together. */
import './AgentRoomRoute.scss'

import { App, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'

import {
  getAgentRoom,
  getApiErrorMessage,
  respondAgentRoomInteraction,
  sendAgentRoomMessage,
  updateAgentRoomMetadata
} from '#~/api'
import type { AgentRoomMessageView, AgentRoomRunView } from '#~/components/agent-room'
import { RouteErrorState } from '#~/components/error-state'
import { useDesktopWorkspaceStartupReady } from '#~/components/layout/desktop-workspace-startup-ready'

import { ChatRouteStatusShell } from './ChatRouteStatusShell'
import { ChatRouteView } from './ChatRouteView'
import { buildAgentRoomRouteHeaderItems } from './agent-room-route-header-items'
import { buildAgentRoomRouteViewModel } from './agent-room-route-view-model'
import {
  buildAgentRoomArchiveExitTarget,
  buildAgentRoomPath,
  buildAgentRoomSessionPath
} from './agent-room-session-paths'

export const AGENT_ROOM_DETAIL_REFRESH_INTERVAL_MS = 300_000
export const AGENT_ROOM_IDLE_DETAIL_REFRESH_INTERVAL_MS = 300_000

export const getAgentRoomDetailCacheKey = (roomId: string) => `/api/agent-rooms/${roomId}`

const AGENT_ROOM_SESSION_MODE_QUERY = 'agentRoomMode'
const AGENT_ROOM_SESSION_MODE_VALUE = 'session'

const buildSearchString = (searchParams: URLSearchParams) =>
  searchParams.toString() === '' ? '' : `?${searchParams.toString()}`

export const agentRoomDetailRevalidateOptions = {
  dedupingInterval: 3000,
  refreshInterval: (detail?: Awaited<ReturnType<typeof getAgentRoom>>) =>
    detail?.room.status === 'active'
      ? AGENT_ROOM_DETAIL_REFRESH_INTERVAL_MS
      : AGENT_ROOM_IDLE_DETAIL_REFRESH_INTERVAL_MS,
  refreshWhenHidden: false,
  revalidateOnFocus: true
} as const

export function AgentRoomRoute() {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { roomId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const {
    data: roomDetail,
    isLoading,
    mutate
  } = useSWR(
    roomId == null ? null : getAgentRoomDetailCacheKey(roomId),
    () => getAgentRoom(roomId ?? ''),
    agentRoomDetailRevalidateOptions
  )
  const isRoomNotFound = roomId != null && !isLoading && roomDetail == null
  useDesktopWorkspaceStartupReady(isRoomNotFound)

  if (roomId == null || isLoading) {
    return (
      <ChatRouteStatusShell isReady={false}>
        <div className='chat-route__loading-state'>
          <Spin size='large' />
        </div>
      </ChatRouteStatusShell>
    )
  }

  if (roomDetail == null) {
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
              onClick: () => void mutate()
            }
          ]}
          description={t('errorState.roomNotFoundDescription')}
          details={{
            copyText: `${t('errorState.roomId')}: ${roomId ?? 'n/a'}`,
            items: [{ label: t('errorState.roomId'), mono: true, value: roomId ?? 'n/a' }],
            title: t('errorState.diagnostics')
          }}
          mobileDescription={t('common.roomNotFound')}
          severity='info'
          title={t('common.roomNotFound')}
        />
      </ChatRouteStatusShell>
    )
  }

  const roomView = buildAgentRoomRouteViewModel(roomDetail)
  const isRoomFavorited = roomDetail.room.favoritedAt != null
  const isRoomArchived = roomDetail.room.archivedAt != null
  const handleToggleRoomFavorite = async () => {
    try {
      await updateAgentRoomMetadata(roomId, { isFavorited: !isRoomFavorited })
      void message.success(
        isRoomFavorited ? t('agentRoom.sidebar.unfavoriteRoom') : t('agentRoom.sidebar.favoriteRoom')
      )
      await mutate()
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('common.operationFailed')))
    }
  }
  const handleToggleRoomArchive = async () => {
    const nextIsArchived = !isRoomArchived
    try {
      await updateAgentRoomMetadata(roomId, { isArchived: nextIsArchived })
      void message.success(nextIsArchived ? t('agentRoom.sidebar.archiveRoom') : t('agentRoom.sidebar.unarchiveRoom'))
      if (nextIsArchived) {
        void mutate()
        void navigate(buildAgentRoomArchiveExitTarget(searchParams), { replace: true })
        return
      }

      await mutate()
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('common.operationFailed')))
    }
  }
  const headerMoreItems = buildAgentRoomRouteHeaderItems({
    isRoomArchived,
    isRoomFavorited,
    messageApi: message,
    onToggleRoomArchive: () => void handleToggleRoomArchive(),
    onToggleRoomFavorite: () => void handleToggleRoomFavorite(),
    roomId,
    t
  })
  const buildOpenRunPath = (sessionId: string) =>
    `${buildAgentRoomSessionPath(roomId, sessionId)}${buildSearchString(new URLSearchParams(searchParams))}`
  const handleOpenRun = (run: AgentRoomRunView) => void navigate(buildOpenRunPath(run.sessionId))
  const handleOpenHostSession = () => {
    if (roomDetail.room.hostSessionId == null || roomDetail.room.hostSessionId === '') return

    const nextParams = new URLSearchParams(searchParams)
    nextParams.set(AGENT_ROOM_SESSION_MODE_QUERY, AGENT_ROOM_SESSION_MODE_VALUE)
    void navigate({
      pathname: `/session/${encodeURIComponent(roomDetail.room.hostSessionId)}`,
      search: buildSearchString(nextParams)
    })
  }
  const handleOpenRoom = () => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete(AGENT_ROOM_SESSION_MODE_QUERY)
    void navigate({
      pathname: buildAgentRoomPath(roomId),
      search: buildSearchString(nextParams)
    })
  }

  return (
    <ChatRouteView
      agentRoomTranscript={{
        room: roomView,
        roomIconStatus: roomDetail.room.status,
        members: roomView.members,
        workspaceSessionId: roomDetail.room.hostSessionId,
        onOpenHostSession: handleOpenHostSession,
        onOpenRun: handleOpenRun,
        onReplyToRun: (message: AgentRoomMessageView) => {
          if (message.run == null) return
          void navigate(buildOpenRunPath(message.run.sessionId))
        },
        onRespondInteraction: async (interactionId, data) => {
          try {
            await respondAgentRoomInteraction(roomId, interactionId, { data })
            await mutate()
          } catch (error) {
            void message.error(getApiErrorMessage(error, t('common.operationFailed')))
            throw error
          }
        },
        onSubmitMessage: async (request) => {
          await sendAgentRoomMessage(roomId, {
            content: request.content,
            ...(request.target != null ? { target: request.target } : {})
          })
          await mutate()
        }
      }}
      headerMoreItems={headerMoreItems}
      modeSwitch={roomDetail.room.hostSessionId == null || roomDetail.room.hostSessionId === ''
        ? undefined
        : {
          mode: 'room',
          onOpenRoom: handleOpenRoom,
          onOpenSession: handleOpenHostSession
        }}
    />
  )
}
