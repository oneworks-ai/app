import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRoomDetailResponse } from '@oneworks/core'

import {
  AGENT_ROOM_DETAIL_REFRESH_INTERVAL_MS,
  AgentRoomRoute,
  agentRoomDetailRevalidateOptions,
  getAgentRoomDetailCacheKey
} from '#~/routes/AgentRoomRoute'
import { buildAgentRoomArchiveExitTarget } from '#~/routes/agent-room-session-paths'

const mocks = vi.hoisted(() => ({
  chatRouteView: vi.fn((_props?: unknown) => null),
  getAgentRoom: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  mutateRoom: vi.fn(),
  navigate: vi.fn(),
  params: {
    roomId: 'room-live'
  } as { roomId?: string },
  search: '',
  sendAgentRoomMessage: vi.fn(),
  updateAgentRoomMetadata: vi.fn(),
  useSWR: vi.fn()
}))

vi.mock('swr', () => ({
  default: mocks.useSWR
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params,
  useSearchParams: () => [new URLSearchParams(mocks.search)]
}))

vi.mock('antd', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    App: {
      useApp: () => ({
        message: {
          error: mocks.messageError,
          success: mocks.messageSuccess
        }
      })
    },
    Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) =>
      React.createElement('button', { onClick, type: 'button' }, children),
    Empty: ({ description }: { description?: ReactNode }) => React.createElement('div', null, description)
  }
})

vi.mock('#~/api', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  getAgentRoom: mocks.getAgentRoom,
  sendAgentRoomMessage: mocks.sendAgentRoomMessage,
  updateAgentRoomMetadata: mocks.updateAgentRoomMetadata
}))

vi.mock('../src/routes/ChatRouteView', () => ({
  ChatRouteView: mocks.chatRouteView
}))

const roomDetail: AgentRoomDetailResponse = {
  room: {
    id: 'room-live',
    title: 'Live room',
    hostSessionId: 'host-session',
    status: 'active',
    createdAt: 1,
    updatedAt: 2
  },
  members: [],
  runs: [],
  messages: []
}

describe('agent room route detail refresh', () => {
  beforeEach(() => {
    mocks.chatRouteView.mockClear()
    mocks.getAgentRoom.mockReset()
    mocks.messageError.mockReset()
    mocks.messageSuccess.mockReset()
    mocks.mutateRoom.mockReset()
    mocks.navigate.mockReset()
    mocks.params.roomId = 'room-live'
    mocks.search = ''
    mocks.sendAgentRoomMessage.mockReset()
    mocks.updateAgentRoomMetadata.mockReset()
    mocks.useSWR.mockReset()
    mocks.useSWR.mockReturnValue({
      data: roomDetail,
      isLoading: false,
      mutate: mocks.mutateRoom
    })
  })

  it('polls the active room detail so appended room events refresh the transcript and side panels', () => {
    renderToStaticMarkup(<AgentRoomRoute />)

    expect(mocks.useSWR).toHaveBeenCalledWith(
      getAgentRoomDetailCacheKey('room-live'),
      expect.any(Function),
      agentRoomDetailRevalidateOptions
    )
    expect(agentRoomDetailRevalidateOptions.refreshInterval).toBe(AGENT_ROOM_DETAIL_REFRESH_INTERVAL_MS)
    expect(agentRoomDetailRevalidateOptions.refreshInterval).toBeGreaterThan(0)
    expect(agentRoomDetailRevalidateOptions.revalidateOnFocus).toBe(true)
    expect(mocks.chatRouteView).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRoomTranscript: expect.objectContaining({
          room: expect.objectContaining({
            id: 'room-live',
            title: 'Live room'
          }),
          members: []
        })
      }),
      {}
    )
  })

  it('opens child runs through the room-scoped session route while preserving query params', () => {
    mocks.search = 'senderHeader=collapsed&sidebar=collapsed'
    renderToStaticMarkup(<AgentRoomRoute />)

    const props = mocks.chatRouteView.mock.calls.at(0)?.[0] as unknown as {
      agentRoomTranscript: {
        onOpenHostSession: () => void
        onOpenRun: (run: {
          memberKey: string
          runKey: string
          sessionId: string
          status: string
          title: string
        }) => void
        onReplyToRun: (message: {
          content: string
          id: string
          kind: string
          role: string
          run: {
            memberKey: string
            runKey: string
            sessionId: string
            status: string
            title: string
          }
        }) => void
      }
    }
    props.agentRoomTranscript.onOpenHostSession()
    props.agentRoomTranscript.onOpenRun({
      runKey: 'run-child',
      memberKey: 'member-child',
      sessionId: 'child-session',
      title: 'Child session',
      status: 'running'
    })
    props.agentRoomTranscript.onReplyToRun({
      id: 'message-child',
      role: 'agent',
      kind: 'reply',
      content: 'Reply',
      run: {
        runKey: 'run-reply',
        memberKey: 'member-child',
        sessionId: 'reply-session',
        title: 'Reply session',
        status: 'running'
      }
    })

    expect(mocks.navigate).toHaveBeenCalledWith({
      pathname: '/session/host-session',
      search: '?senderHeader=collapsed&sidebar=collapsed&agentRoomMode=session'
    })
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/rooms/room-live/sessions/child-session?senderHeader=collapsed&sidebar=collapsed'
    )
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/rooms/room-live/sessions/reply-session?senderHeader=collapsed&sidebar=collapsed'
    )
  })

  it('provides a header mode switch between room and host session', () => {
    renderToStaticMarkup(<AgentRoomRoute />)

    const props = mocks.chatRouteView.mock.calls.at(0)?.[0] as unknown as {
      modeSwitch: {
        mode: string
        onOpenRoom: () => void
        onOpenSession: () => void
      }
    }
    expect(props.modeSwitch.mode).toBe('room')

    props.modeSwitch.onOpenSession()
    props.modeSwitch.onOpenRoom()

    expect(mocks.navigate).toHaveBeenCalledWith({
      pathname: '/session/host-session',
      search: '?agentRoomMode=session'
    })
    expect(mocks.navigate).toHaveBeenCalledWith({
      pathname: '/rooms/room-live',
      search: ''
    })
  })

  it('preserves existing query params while switching between room and host session modes', () => {
    mocks.search = 'debug=true&agentRoomMode=session'
    renderToStaticMarkup(<AgentRoomRoute />)

    const props = mocks.chatRouteView.mock.calls.at(0)?.[0] as unknown as {
      modeSwitch: {
        onOpenRoom: () => void
        onOpenSession: () => void
      }
    }

    props.modeSwitch.onOpenSession()
    props.modeSwitch.onOpenRoom()

    expect(mocks.navigate).toHaveBeenCalledWith({
      pathname: '/session/host-session',
      search: '?debug=true&agentRoomMode=session'
    })
    expect(mocks.navigate).toHaveBeenCalledWith({
      pathname: '/rooms/room-live',
      search: '?debug=true'
    })
  })

  it('builds the new-session target after archiving the current room', () => {
    expect(buildAgentRoomArchiveExitTarget(
      new URLSearchParams('senderHeader=expanded&agentRoomMode=session&sidebar=collapsed')
    )).toEqual({
      pathname: '/',
      search: '?senderHeader=expanded&sidebar=collapsed'
    })
  })

  it('navigates to the new-session page after archiving the current room from the header menu', async () => {
    mocks.search = 'senderHeader=expanded&agentRoomMode=session'
    mocks.updateAgentRoomMetadata.mockResolvedValue({
      room: {
        ...roomDetail.room,
        archivedAt: 30
      }
    })

    renderToStaticMarkup(<AgentRoomRoute />)

    const props = mocks.chatRouteView.mock.calls.at(0)?.[0] as unknown as {
      headerMoreItems: Array<{
        key?: string
        onClick?: () => void
      }>
    }
    props.headerMoreItems.find(item => item.key === 'archive-room')?.onClick?.()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mocks.updateAgentRoomMetadata).toHaveBeenCalledWith('room-live', { isArchived: true })
    expect(mocks.navigate).toHaveBeenCalledWith({
      pathname: '/',
      search: '?senderHeader=expanded'
    }, { replace: true })
    expect(mocks.mutateRoom).toHaveBeenCalledTimes(1)
  })
})
