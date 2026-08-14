import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { updateAgentRoomConnectionAvailability } from '#~/channels/agent-room-connection-status.js'
import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'

const state = vi.hoisted(() => ({ db: undefined as unknown as SqliteDb }))
const publishClientEvent = vi.hoisted(() => vi.fn())

vi.mock('#~/db/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('#~/db/index.js')>()
  return { ...original, getDb: () => state.db }
})
vi.mock('#~/services/client-events.js', () => ({ publishClientEvent }))

describe('agent room channel connection availability', () => {
  beforeEach(() => {
    state.db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
    state.db.createAgentRoom({ id: 'room-a', title: 'Room A' })
    state.db.saveAgentRoomMember({
      activeRunCount: 0,
      key: 'product',
      kind: 'entity',
      label: 'Product',
      pendingCount: 0,
      roomId: 'room-a',
      status: 'idle'
    })
    state.db.saveAgentRoomChannelConnection({
      channelId: 'oc_group',
      channelKey: 'lark:product',
      channelLinkName: 'product-group',
      channelType: 'lark',
      conversationKind: 'group',
      entity: 'product',
      label: '产品群',
      memberKey: 'product',
      muted: false,
      receiveId: 'oc_group',
      receiveIdType: 'chat_id',
      requireMention: false,
      roomId: 'room-a',
      status: 'active'
    })
  })

  afterEach(() => state.db.close())

  it('marks only the connection unavailable and preserves its room member', () => {
    expect(updateAgentRoomConnectionAvailability('lark:product', {
      channelId: 'oc_group',
      channelType: 'lark',
      reason: 'bot removed',
      status: 'unavailable'
    })).toBe(1)

    expect(state.db.getAgentRoomMember('room-a', 'product')).toBeDefined()
    expect(state.db.listAgentRoomChannelConnections('room-a')).toEqual([
      expect.objectContaining({ lastError: 'bot removed', status: 'unavailable' })
    ])
    expect(publishClientEvent).toHaveBeenCalledWith('agent-rooms', {
      roomId: 'room-a',
      type: 'agent_room_updated'
    })
  })
})
