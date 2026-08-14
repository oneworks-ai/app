import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveAgentRoomConnectionsForInbound } from '#~/channels/agent-room-bridge-connections.js'
import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'

const state = vi.hoisted(() => ({ db: undefined as unknown as SqliteDb }))

vi.mock('@oneworks/definition-loader', () => ({
  DefinitionLoader: class {
    loadDefaultEntities = async () => [{
      attributes: { description: 'Quality assurance', name: 'qa' },
      body: '',
      path: '/entities/qa/README.md',
      resolvedName: 'qa'
    }]
  }
}))

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

  it('adds newly discovered entities to every Team Chat already mapped to the external group', async () => {
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

    const connections = await resolveAgentRoomConnectionsForInbound({
      inbound: {
        channelId: 'oc_group',
        channelType: 'lark',
        messageId: 'om_new_entity',
        raw: {},
        sessionType: 'group',
        text: 'hello'
      },
      states: [{
        channelLinks: [{
          address: { id: 'oc_group', kind: 'group' },
          channelKey: 'lark:qa',
          definition: {
            attributes: { channel: 'lark:qa', entity: 'qa', external: { type: 'lark' }, name: 'qa-group' },
            body: '',
            path: '/channel-links/qa-group.md'
          },
          entity: 'qa',
          external: { receiveIdType: 'chat_id', type: 'lark' },
          ingress: {
            ambientRouting: false,
            createOnCommand: true,
            createOnMention: true,
            createOnPendingIntent: true,
            createOnReplyToBot: true,
            room: { muted: true }
          },
          name: 'qa-group',
          path: '/channel-links/qa-group.md',
          routing: { accounts: {}, default: {}, modes: {}, users: {} }
        }],
        config: { title: 'QA bot', type: 'lark' },
        key: 'lark:qa',
        status: 'connected',
        type: 'lark'
      }]
    })

    expect(state.db.getAgentRoomMember('room-a', 'qa')).toEqual(expect.objectContaining({
      kind: 'entity',
      label: 'qa'
    }))
    expect(connections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channelLinkName: 'qa-group',
        memberKey: 'qa',
        muted: true,
        roomId: 'room-a',
        status: 'active'
      })
    ]))
  })
})
