import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import { adapterSessionStartStore, getWorkspaceActivitySnapshot } from '#~/services/session/index.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

describe('session workspace activity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adapterSessionStartStore.clear()
  })

  it('reports the workspace idle when no sessions are active', () => {
    vi.mocked(getDb).mockReturnValue({
      getSession: vi.fn(() => undefined),
      getSessions: vi.fn(() => [])
    } as any)

    expect(getWorkspaceActivitySnapshot()).toEqual({
      activeSessionCount: 0,
      activeSessions: [],
      idle: true
    })
  })

  it('reports running and waiting sessions as workspace activity', () => {
    vi.mocked(getDb).mockReturnValue({
      getSession: vi.fn((sessionId: string) => ({
        id: sessionId,
        status: sessionId === 'starting-1' ? 'running' : 'completed',
        title: sessionId
      })),
      getSessions: vi.fn(() => [
        { id: 'completed-1', status: 'completed', title: 'Done' },
        { id: 'waiting-1', status: 'waiting_input', title: 'Waiting' }
      ])
    } as any)
    adapterSessionStartStore.set('starting-1', Promise.resolve({} as any))

    expect(getWorkspaceActivitySnapshot()).toEqual({
      activeSessionCount: 2,
      activeSessions: [
        { id: 'waiting-1', status: 'waiting_input', title: 'Waiting' },
        { id: 'starting-1', status: 'running', title: 'starting-1' }
      ],
      idle: false
    })
  })
})
