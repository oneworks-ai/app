import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveAgentRoomConnectionsForInbound } from '#~/channels/agent-room-bridge-connections.js'
import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'

const state = vi.hoisted(() => ({ db: undefined as unknown as SqliteDb }))

vi.mock('#~/db/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('#~/db/index.js')>()
  return { ...original, getDb: () => state.db }
})

describe('agent room bridge connection resolution', () => {
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
      status: 'removed'
    })
  })

  afterEach(() => state.db.close())

  it('does not reactivate or auto-provision a removed connection on later inbound messages', async () => {
    await expect(resolveAgentRoomConnectionsForInbound({
      inbound: {
        channelId: 'oc_group',
        channelType: 'lark',
        messageId: 'om_after_remove',
        raw: {},
        sessionType: 'group',
        text: 'later message'
      },
      states: []
    })).resolves.toEqual([])

    expect(state.db.listAgentRooms('all')).toHaveLength(1)
    expect(state.db.listAgentRoomChannelConnections('room-a')).toEqual([
      expect.objectContaining({ status: 'removed' })
    ])
  })
})
