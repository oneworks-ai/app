import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRoom, Session } from '@oneworks/core'

import { ChatRoute } from '#~/routes/ChatRoute'

const mocks = vi.hoisted(() => ({
  chatRouteView: vi.fn((_props?: unknown) => null),
  getConfig: vi.fn(),
  getSession: vi.fn(),
  listAgentRooms: vi.fn(),
  listSessions: vi.fn(),
  navigate: vi.fn(),
  params: {} as { sessionId?: string },
  search: '',
  useSWR: vi.fn()
}))

vi.mock('react', async (importActual) => {
  const actual = await importActual<typeof import('react')>()
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      void effect()
    }
  }
})

vi.mock('swr', () => ({
  default: mocks.useSWR
}))

vi.mock('jotai', async (importActual) => {
  const actual = await importActual<typeof import('jotai')>()
  return {
    ...actual,
    useAtomValue: () => ({})
  }
})

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
  getConfig: mocks.getConfig,
  getSession: mocks.getSession,
  getSessionCacheKey: (id: string) => `/api/sessions/${encodeURIComponent(id)}`,
  listAgentRooms: mocks.listAgentRooms,
  listSessions: mocks.listSessions
}))

vi.mock('../src/routes/ChatRouteView', () => ({
  ChatRouteView: mocks.chatRouteView
}))

vi.mock('../src/routes/use-message-branch-lineage', () => ({
  useMessageBranchLineage: ({ branchSession }: { branchSession?: Session }) => ({
    branchSession,
    isLoading: false,
    sessions: []
  })
}))

vi.mock('../src/routes/use-active-message-branch-session', () => ({
  useActiveMessageBranchSession: ({ queryBranchSession }: { queryBranchSession?: Session }) => queryBranchSession
}))

const createSession = (id: string, overrides: Partial<Session> = {}): Session => ({
  id,
  title: `${id} title`,
  status: 'running',
  createdAt: 1,
  ...overrides
} as Session)

const createRoom = (id: string, hostSessionId?: string): AgentRoom => ({
  id,
  title: `${id} title`,
  ...(hostSessionId == null ? {} : { hostSessionId }),
  status: 'active',
  createdAt: 1,
  updatedAt: 2
})

const setupSWR = ({
  agentRoomEnabled,
  archivedSessions = [],
  archivedSessionsLoading = false,
  sessionTimelineEnabled,
  sessions = [],
  sessionById = {},
  rooms = []
}: {
  agentRoomEnabled?: boolean
  archivedSessions?: Session[]
  archivedSessionsLoading?: boolean
  sessionTimelineEnabled?: boolean
  sessions?: Session[]
  sessionById?: Record<string, Session>
  rooms?: AgentRoom[]
} = {}) => {
  mocks.useSWR.mockImplementation((key: string | null) => {
    if (key == null) {
      return { data: undefined, isLoading: false }
    }

    if (key === '/api/config') {
      return {
        data: {
          sources: {
            merged: {
              experiments: {
                ...(agentRoomEnabled == null ? {} : { agentRoom: agentRoomEnabled }),
                ...(sessionTimelineEnabled == null ? {} : { sessionTimeline: sessionTimelineEnabled })
              }
            }
          }
        },
        isLoading: false
      }
    }

    if (key === '/api/sessions') {
      return {
        data: { sessions },
        isLoading: false
      }
    }

    if (key === '/api/sessions/archived') {
      if (archivedSessionsLoading) {
        return {
          data: undefined,
          isLoading: true
        }
      }

      return {
        data: { sessions: archivedSessions },
        isLoading: false
      }
    }

    if (key.startsWith('/api/sessions/')) {
      const sessionId = decodeURIComponent(key.slice('/api/sessions/'.length))
      return {
        data: { session: sessionById[sessionId] ?? createSession(sessionId) },
        isLoading: false
      }
    }

    if (key === '/api/agent-rooms') {
      return {
        data: { rooms },
        isLoading: false
      }
    }

    return { data: undefined, isLoading: false }
  })
}

describe('chat route agent room mode', () => {
  beforeEach(() => {
    mocks.chatRouteView.mockClear()
    mocks.getConfig.mockReset()
    mocks.getSession.mockReset()
    mocks.listAgentRooms.mockReset()
    mocks.listSessions.mockReset()
    mocks.navigate.mockReset()
    mocks.params.sessionId = undefined
    mocks.search = ''
    mocks.useSWR.mockReset()
    setupSWR()
  })

  it('keeps the new session entry as a normal session route without requesting rooms', () => {
    renderToStaticMarkup(<ChatRoute />)

    expect(mocks.useSWR.mock.calls.map(call => call[0])).toEqual([
      '/api/config',
      null,
      null,
      null,
      null,
      null
    ])
    expect(mocks.listAgentRooms).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.chatRouteView).toHaveBeenCalledWith(
      expect.objectContaining({
        modeSwitch: undefined,
        session: undefined
      }),
      {}
    )
  })

  it('auto switches /session/:id to the associated room only when hostSessionId matches', () => {
    mocks.params.sessionId = 'host-session'
    mocks.search = 'debug=true&agentRoomMode=room'
    setupSWR({
      agentRoomEnabled: true,
      rooms: [createRoom('room-1', 'host-session')]
    })

    renderToStaticMarkup(<ChatRoute />)

    expect(mocks.navigate).toHaveBeenCalledWith({
      pathname: '/rooms/room-1',
      search: '?debug=true'
    }, { replace: true })
  })

  it('does not auto switch or expose room controls when the Agent Room experiment is disabled by default', () => {
    mocks.params.sessionId = 'host-session'
    mocks.search = 'debug=true'
    setupSWR({
      rooms: [createRoom('room-1', 'host-session')]
    })

    renderToStaticMarkup(<ChatRoute />)

    expect(mocks.useSWR.mock.calls.map(call => call[0])).toEqual([
      '/api/config',
      '/api/sessions/host-session',
      '/api/sessions',
      null,
      null,
      null
    ])
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.chatRouteView).toHaveBeenCalledWith(
      expect.objectContaining({
        headerBreadcrumb: undefined,
        modeSwitch: undefined,
        session: expect.objectContaining({ id: 'host-session' })
      }),
      {}
    )
  })

  it('renders an archived root session without a branch query', () => {
    mocks.params.sessionId = 'archived-root'
    const archivedRoot = createSession('archived-root', { isArchived: true })
    setupSWR({
      archivedSessions: [archivedRoot],
      sessionById: { 'archived-root': archivedRoot }
    })

    renderToStaticMarkup(<ChatRoute />)

    expect(mocks.useSWR.mock.calls.map(call => call[0])).toContain('/api/sessions/archived')
    expect(mocks.chatRouteView).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          id: 'archived-root',
          isArchived: true
        }),
        sessions: expect.arrayContaining([
          expect.objectContaining({ id: 'archived-root' })
        ])
      }),
      {}
    )
  })

  it('waits for archived branch metadata before rendering an archived root session', () => {
    mocks.params.sessionId = 'archived-root'
    const archivedRoot = createSession('archived-root', { isArchived: true })
    setupSWR({
      archivedSessionsLoading: true,
      sessionById: { 'archived-root': archivedRoot }
    })

    renderToStaticMarkup(<ChatRoute />)

    expect(mocks.useSWR.mock.calls.map(call => call[0])).toContain('/api/sessions/archived')
    expect(mocks.chatRouteView).not.toHaveBeenCalled()
  })

  it('passes the session timeline experiment through to the chat route view', () => {
    mocks.params.sessionId = 'session-with-timeline'
    setupSWR({
      sessionTimelineEnabled: true
    })

    renderToStaticMarkup(<ChatRoute />)

    expect(mocks.chatRouteView).toHaveBeenCalledWith(
      expect.objectContaining({
        enableTimelineView: true,
        session: expect.objectContaining({ id: 'session-with-timeline' })
      }),
      {}
    )
  })

  it('does not auto switch when agentRoomMode=session is present and keeps header room switch available', () => {
    mocks.params.sessionId = 'host-session'
    mocks.search = 'agentRoomMode=session&debug=true'
    setupSWR({
      agentRoomEnabled: true,
      rooms: [createRoom('room-1', 'host-session')]
    })

    renderToStaticMarkup(<ChatRoute />)

    expect(mocks.navigate).not.toHaveBeenCalled()
    const props = mocks.chatRouteView.mock.calls.at(0)?.[0] as unknown as {
      headerBreadcrumb: {
        backLabel: string
        parentTitle: string
        onBack: () => void
      }
      modeSwitch: {
        mode: string
        onOpenRoom: () => void
      }
    }
    expect(props.headerBreadcrumb).toMatchObject({
      backLabel: 'agentRoom.actions.backToRoom',
      parentTitle: 'room-1 title'
    })
    expect(props.modeSwitch.mode).toBe('session')

    props.modeSwitch.onOpenRoom()
    expect(mocks.navigate).toHaveBeenCalledWith({
      pathname: '/rooms/room-1',
      search: '?debug=true'
    })
  })

  it('does not auto switch or render a mode switch for unrelated rooms', () => {
    mocks.params.sessionId = 'host-session'
    setupSWR({
      agentRoomEnabled: true,
      rooms: [
        createRoom('room-other', 'other-session'),
        createRoom('room-unbound')
      ]
    })

    renderToStaticMarkup(<ChatRoute />)

    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.chatRouteView).toHaveBeenCalledWith(
      expect.objectContaining({
        modeSwitch: undefined,
        session: expect.objectContaining({ id: 'host-session' })
      }),
      {}
    )
  })
})
