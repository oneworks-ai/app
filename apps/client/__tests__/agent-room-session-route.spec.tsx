import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRoomDetailResponse, Session } from '@oneworks/core'

import { AgentRoomSessionRoute } from '#~/routes/AgentRoomSessionRoute'

const mocks = vi.hoisted(() => ({
  chatRouteView: vi.fn((_props?: unknown) => null),
  getAgentRoom: vi.fn(),
  getSession: vi.fn(),
  navigate: vi.fn(),
  params: {
    roomId: 'room-1',
    sessionId: 'child-session'
  } as { roomId?: string; sessionId?: string },
  search: '',
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

vi.mock('#~/api', () => ({
  getAgentRoom: mocks.getAgentRoom,
  getSessionCacheKey: (id: string) => `/api/sessions/${encodeURIComponent(id)}`,
  getSession: mocks.getSession
}))

vi.mock('../src/routes/ChatRouteView', () => ({
  ChatRouteView: mocks.chatRouteView
}))

const roomDetail: AgentRoomDetailResponse = {
  room: {
    id: 'room-1',
    title: 'Room one',
    status: 'active',
    createdAt: 1,
    updatedAt: 2
  },
  members: [],
  runs: [
    {
      roomId: 'room-1',
      key: 'run-child',
      memberKey: 'agent',
      sessionId: 'child-session',
      title: 'Child run',
      status: 'completed',
      createdAt: 1,
      updatedAt: 2
    }
  ],
  messages: []
}

const childSession = {
  id: 'child-session',
  title: 'Child session',
  status: 'completed',
  createdAt: 1
} as Session

describe('agent room session route', () => {
  beforeEach(() => {
    mocks.chatRouteView.mockClear()
    mocks.getAgentRoom.mockReset()
    mocks.getSession.mockReset()
    mocks.navigate.mockReset()
    mocks.params.roomId = 'room-1'
    mocks.params.sessionId = 'child-session'
    mocks.search = ''
    mocks.useSWR.mockReset()
  })

  it('renders the child session with a room breadcrumb when the session belongs to the room', () => {
    mocks.useSWR.mockImplementation((key: string | null) => {
      if (key === '/api/agent-rooms/room-1') {
        return { data: roomDetail, isLoading: false }
      }
      if (key === '/api/sessions/child-session') {
        return { data: { session: childSession }, isLoading: false }
      }
      return { data: undefined, isLoading: false }
    })

    renderToStaticMarkup(<AgentRoomSessionRoute />)

    expect(mocks.chatRouteView).toHaveBeenCalledWith(
      expect.objectContaining({
        headerBreadcrumb: expect.objectContaining({
          backLabel: 'agentRoom.actions.backToRoom',
          parentTitle: 'Room one'
        }),
        session: childSession
      }),
      {}
    )

    const props = mocks.chatRouteView.mock.calls.at(0)?.[0] as unknown as {
      headerBreadcrumb: { onBack: () => void }
      modeSwitch: {
        mode: string
        onOpenRoom: () => void
        onOpenSession: () => void
      }
    }
    expect(props.modeSwitch.mode).toBe('session')
    props.headerBreadcrumb.onBack()
    expect(mocks.navigate).toHaveBeenCalledWith({
      pathname: '/rooms/room-1',
      search: ''
    })
  })

  it('uses the default thinking fallback for room child sessions without output yet', () => {
    const startingRoomDetail: AgentRoomDetailResponse = {
      ...roomDetail,
      runs: [{
        ...roomDetail.runs[0]!,
        status: 'running'
      }]
    }
    mocks.useSWR.mockImplementation((key: string | null) => {
      if (key === '/api/agent-rooms/room-1') {
        return { data: startingRoomDetail, isLoading: false }
      }
      if (key === '/api/sessions/child-session') {
        return {
          data: {
            session: {
              ...childSession,
              createdAt: Date.now(),
              status: 'running',
              messageCount: 0
            }
          },
          isLoading: false
        }
      }
      return { data: undefined, isLoading: false }
    })

    renderToStaticMarkup(<AgentRoomSessionRoute />)

    const props = mocks.chatRouteView.mock.calls.at(0)?.[0] as unknown as {
      sessionActivityLabel?: string
    }
    expect(props.sessionActivityLabel).toBeUndefined()
  })

  it('does not surface completed child run status as the activity label', () => {
    const completedRunRoomDetail: AgentRoomDetailResponse = {
      ...roomDetail,
      runs: [{
        ...roomDetail.runs[0]!,
        status: 'completed'
      }]
    }
    mocks.useSWR.mockImplementation((key: string | null) => {
      if (key === '/api/agent-rooms/room-1') {
        return { data: completedRunRoomDetail, isLoading: false }
      }
      if (key === '/api/sessions/child-session') {
        return {
          data: {
            session: {
              ...childSession,
              createdAt: Date.now(),
              status: 'running',
              messageCount: 0
            }
          },
          isLoading: false
        }
      }
      return { data: undefined, isLoading: false }
    })

    renderToStaticMarkup(<AgentRoomSessionRoute />)

    const props = mocks.chatRouteView.mock.calls.at(0)?.[0] as unknown as {
      sessionActivityLabel?: string
    }
    expect(props.sessionActivityLabel).toBeUndefined()
  })

  it('lets child session details switch back to room mode while preserving non-mode query params', () => {
    mocks.search = 'debug=true&agentRoomMode=session'
    mocks.useSWR.mockImplementation((key: string | null) => {
      if (key === '/api/agent-rooms/room-1') {
        return { data: roomDetail, isLoading: false }
      }
      if (key === '/api/sessions/child-session') {
        return { data: { session: childSession }, isLoading: false }
      }
      return { data: undefined, isLoading: false }
    })

    renderToStaticMarkup(<AgentRoomSessionRoute />)

    const props = mocks.chatRouteView.mock.calls.at(0)?.[0] as unknown as {
      modeSwitch: {
        mode: string
        onOpenRoom: () => void
        onOpenSession: () => void
      }
    }
    expect(props.modeSwitch.mode).toBe('session')

    props.modeSwitch.onOpenSession()
    props.modeSwitch.onOpenRoom()

    expect(mocks.navigate).toHaveBeenCalledTimes(1)
    expect(mocks.navigate).toHaveBeenCalledWith({
      pathname: '/rooms/room-1',
      search: '?debug=true'
    })
  })

  it('rejects sessions that are not part of the room runs', () => {
    mocks.params.sessionId = 'other-session'
    mocks.useSWR.mockImplementation((key: string | null) => {
      if (key === '/api/agent-rooms/room-1') {
        return { data: roomDetail, isLoading: false }
      }
      if (key === '/api/sessions/other-session') {
        return {
          data: {
            session: {
              ...childSession,
              id: 'other-session'
            }
          },
          isLoading: false
        }
      }
      return { data: undefined, isLoading: false }
    })

    const html = renderToStaticMarkup(<AgentRoomSessionRoute />)

    expect(mocks.chatRouteView).not.toHaveBeenCalled()
    expect(html).toContain('common.sessionNotFound')
  })
})
