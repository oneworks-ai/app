import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentRoomsRouter } from '#~/routes/agent-rooms.js'
import { createAgentRoomService } from '#~/services/agent-room/index.js'

vi.mock('#~/services/agent-room/index.js', () => ({
  createAgentRoomService: vi.fn()
}))

const findRouteHandler = (path: string, method: string) => {
  const router = agentRoomsRouter() as any
  const layer = router.stack.find((item: any) => item.path === path && item.methods.includes(method))
  if (layer == null) {
    throw new Error(`Route ${method} ${path} not found`)
  }
  return layer.stack[0] as (ctx: any) => Promise<void> | void
}

describe('agentRoomsRouter', () => {
  const service = {
    appendUserMessage: vi.fn(),
    applyEvent: vi.fn(),
    createRoom: vi.fn(),
    deleteRoom: vi.fn(),
    ensureRoomForHostSession: vi.fn(),
    getDetail: vi.fn(),
    listRooms: vi.fn(),
    respondInteraction: vi.fn(),
    updateRoomMetadata: vi.fn(),
    upsertMember: vi.fn(),
    upsertRun: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createAgentRoomService).mockReturnValue(service as any)
  })

  it('returns list and detail API responses from the service layer', async () => {
    service.listRooms.mockReturnValue([{ id: 'room-1', title: 'Room' }])
    service.getDetail.mockReturnValue({
      room: { id: 'room-1', title: 'Room' },
      members: [],
      runs: [],
      messages: []
    })

    const listHandler = findRouteHandler('/', 'GET')
    const listCtx = { body: undefined }
    await listHandler(listCtx)
    expect(listCtx.body).toEqual({ rooms: [{ id: 'room-1', title: 'Room' }] })

    const detailHandler = findRouteHandler('/:id', 'GET')
    const detailCtx = { params: { id: 'room-1' }, body: undefined }
    await detailHandler(detailCtx)
    expect(detailCtx.body).toEqual({
      room: { id: 'room-1', title: 'Room' },
      members: [],
      runs: [],
      messages: []
    })
  })

  it('returns archived room list from the service layer', async () => {
    service.listRooms.mockReturnValue([{ id: 'room-archived', title: 'Archived', archivedAt: 1 }])

    const handler = findRouteHandler('/archived', 'GET')
    const ctx = { body: undefined }
    await handler(ctx)

    expect(service.listRooms).toHaveBeenCalledWith('archived')
    expect(ctx.body).toEqual({ rooms: [{ id: 'room-archived', title: 'Archived', archivedAt: 1 }] })
  })

  it('updates room archive and favorite metadata through the service layer', async () => {
    const room = {
      id: 'room-1',
      title: 'Room',
      archivedAt: 1
    }
    service.updateRoomMetadata.mockReturnValue(room)

    const handler = findRouteHandler('/:id', 'PATCH')
    const ctx = {
      params: { id: 'room-1' },
      request: {
        body: {
          isArchived: true,
          isFavorited: false
        }
      },
      body: undefined
    }

    await handler(ctx)

    expect(service.updateRoomMetadata).toHaveBeenCalledWith('room-1', {
      isArchived: true,
      isFavorited: false
    })
    expect(ctx.body).toEqual({ room })
  })

  it('writes room events through the service layer', async () => {
    const message = {
      id: 'event-1',
      roomId: 'room-1',
      role: 'agent',
      content: 'Done',
      createdAt: 1
    }
    const event = {
      id: 'event-1',
      type: 'run_completed',
      member: { key: 'architect', kind: 'entity', label: 'Architect' },
      run: { key: 'schema-plan', sessionId: 'session-1', title: 'Schema plan' },
      summary: 'Done'
    }
    service.applyEvent.mockReturnValue(message)

    const handler = findRouteHandler('/:id/events', 'POST')
    const ctx = {
      params: { id: 'room-1' },
      request: {
        body: {
          type: 'room_event',
          event
        }
      },
      body: undefined
    }

    await handler(ctx)

    expect(service.applyEvent).toHaveBeenCalledWith('room-1', event)
    expect(ctx.body).toEqual({ message })
  })

  it('writes user messages with explicit targets', async () => {
    const message = {
      id: 'message-1',
      roomId: 'room-1',
      role: 'user',
      content: 'Please continue',
      createdAt: 1
    }
    service.appendUserMessage.mockReturnValue(message)

    const handler = findRouteHandler('/:id/messages', 'POST')
    const ctx = {
      params: { id: 'room-1' },
      request: {
        body: {
          content: '  Please continue  ',
          target: { memberKey: 'architect', runKey: 'schema-plan' }
        }
      },
      body: undefined
    }

    await handler(ctx)

    expect(service.appendUserMessage).toHaveBeenCalledWith('room-1', 'Please continue', {
      memberKey: 'architect',
      runKey: 'schema-plan'
    })
    expect(ctx.body).toEqual({ message })
  })

  it('writes room interaction responses through the service layer', async () => {
    service.respondInteraction.mockReturnValue(true)

    const handler = findRouteHandler('/:id/interactions/:interactionId/responses', 'POST')
    const ctx = {
      params: { id: 'room-1', interactionId: 'approval-1' },
      request: {
        body: {
          data: 'allow_once'
        }
      },
      body: undefined
    }

    await handler(ctx)

    expect(service.respondInteraction).toHaveBeenCalledWith('room-1', 'approval-1', 'allow_once')
    expect(ctx.body).toEqual({ ok: true })
  })

  it('returns conflict for stale room interaction responses', async () => {
    service.respondInteraction.mockReturnValue(false)

    const handler = findRouteHandler('/:id/interactions/:interactionId/responses', 'POST')
    const ctx = {
      params: { id: 'room-1', interactionId: 'approval-1' },
      request: {
        body: {
          data: ['allow_once']
        }
      },
      body: undefined
    }

    await expect(handler(ctx)).rejects.toMatchObject({
      status: 409,
      code: 'agent_room_interaction_not_pending'
    })
  })
})
