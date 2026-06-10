import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRoom } from '@oneworks/core'

import { listArchivedAgentRooms, updateAgentRoomMetadata } from '#~/api/agent-rooms'
import { updateSidebarRoomMetadata } from '#~/components/sidebar/room-metadata-actions'

vi.mock('#~/runtime-config.js', () => ({
  createServerUrl: (path: string) => {
    const relativePath = path.replace(/^\/+/, '')
    return new URL(relativePath, 'http://api.example.com:8787/').toString()
  },
  getServerBaseUrl: () => 'http://api.example.com:8787'
}))

const makeJsonResponse = (body: unknown) => {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

const room: AgentRoom = {
  id: 'room-ops',
  title: 'Room operations',
  status: 'active',
  createdAt: 10,
  updatedAt: 20
}

describe('agent room sidebar operations', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('patches archive and favorite metadata through the room endpoint', async () => {
    fetchMock.mockResolvedValue(makeJsonResponse({
      room: {
        ...room,
        archivedAt: 30
      }
    }))

    await expect(updateAgentRoomMetadata('room ops', {
      isArchived: true,
      isFavorited: false
    })).resolves.toEqual({
      room: {
        ...room,
        archivedAt: 30
      }
    })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://api.example.com:8787/api/agent-rooms/room%20ops')
    expect(init).toMatchObject({
      method: 'PATCH',
      credentials: 'include',
      body: JSON.stringify({
        isArchived: true,
        isFavorited: false
      })
    })
    expect((init?.headers as Headers).get('content-type')).toBe('application/json')
  })

  it('exposes the archived room list endpoint without adding it to the primary sidebar UI', async () => {
    fetchMock.mockResolvedValue(makeJsonResponse({
      rooms: [
        {
          ...room,
          archivedAt: 30
        }
      ]
    }))

    await expect(listArchivedAgentRooms()).resolves.toEqual({
      rooms: [
        {
          ...room,
          archivedAt: 30
        }
      ]
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://api.example.com:8787/api/agent-rooms/archived')
  })

  it('revalidates the active room list after a metadata update', async () => {
    const updateMetadata = vi.fn().mockResolvedValue({
      room: {
        ...room,
        favoritedAt: 40
      }
    })
    const mutateRooms = vi.fn().mockResolvedValue({
      rooms: [
        {
          ...room,
          favoritedAt: 40
        }
      ]
    })

    await updateSidebarRoomMetadata({
      roomId: room.id,
      request: { isFavorited: true },
      updateMetadata,
      mutateRooms
    })

    expect(updateMetadata).toHaveBeenCalledWith(room.id, { isFavorited: true })
    expect(mutateRooms).toHaveBeenCalledTimes(1)
    const updateCallOrder = updateMetadata.mock.invocationCallOrder[0]
    const mutateCallOrder = mutateRooms.mock.invocationCallOrder[0]
    expect(updateCallOrder).toBeDefined()
    expect(mutateCallOrder).toBeDefined()
    expect(updateCallOrder ?? 0).toBeLessThan(mutateCallOrder ?? 0)
  })
})
