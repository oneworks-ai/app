import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRoomChannelConnection } from '@oneworks/core'
import type { ChannelInboundEvent } from '@oneworks/core/channel'

import {
  bridgeInboundGroupMessageToAgentRooms,
  shouldProcessAgentRoomChannelMessage
} from '#~/channels/agent-room-bridge.js'
import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'

const state = vi.hoisted(() => ({ db: undefined as unknown as SqliteDb }))

vi.mock('#~/db/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('#~/db/index.js')>()
  return { ...original, getDb: () => state.db }
})
vi.mock('#~/services/client-events.js', () => ({ publishClientEvent: vi.fn() }))

const connection = (
  roomId: string,
  overrides: Partial<AgentRoomChannelConnection> = {}
): AgentRoomChannelConnection => ({
  channelId: 'oc_shared',
  channelKey: 'lark:product',
  channelLinkName: 'shared-product',
  channelType: 'lark',
  conversationKind: 'group',
  createdAt: Date.now(),
  entity: 'product',
  label: '共享产品群',
  memberKey: 'product',
  muted: true,
  receiveId: 'oc_shared',
  receiveIdType: 'chat_id',
  requireMention: false,
  roomId,
  status: 'active',
  updatedAt: Date.now(),
  ...overrides
})

const inbound = (overrides: Partial<ChannelInboundEvent> = {}): ChannelInboundEvent => ({
  channelId: 'oc_shared',
  channelType: 'lark',
  displayText: '@产品 请记录本周风险',
  mentionedBot: false,
  messageId: 'om_shared_1',
  replyTo: { receiveId: 'oc_shared', receiveIdType: 'chat_id' },
  raw: {},
  senderId: 'ou_sender',
  sessionType: 'group',
  text: '<at user_id="ou_product">产品</at> 请记录本周风险',
  ...overrides
})

describe('agent room external channel bridge', () => {
  beforeEach(() => {
    state.db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
    for (const roomId of ['room-a', 'room-b']) {
      state.db.createAgentRoom({ id: roomId, title: roomId })
      state.db.saveAgentRoomMember({
        activeRunCount: 0,
        key: 'product',
        kind: 'entity',
        label: 'Product',
        pendingCount: 0,
        roomId,
        status: 'idle'
      })
      state.db.saveAgentRoomChannelConnection(connection(roomId))
    }
  })

  afterEach(() => state.db.close())

  it('observes one provider message once in every connected room without waking muted members', async () => {
    const event = inbound()
    const input = {
      ctx: {
        actor: {
          account: {
            accountId: 'ou_sender',
            accountKey: 'ou_sender',
            avatarUrl: null,
            channelType: 'lark',
            createdAt: 1,
            displayName: null,
            issuerKey: 'lark:product',
            metadata: null,
            updatedAt: 1
          },
          user: { createdAt: 1, displayName: '群成员', id: 'user-sender', updatedAt: 1 }
        },
        channelKey: 'lark:product',
        config: { title: 'Product bot', type: 'lark' },
        inbound: event
      },
      states: []
    }

    await expect(bridgeInboundGroupMessageToAgentRooms(input)).resolves.toBe(true)
    await expect(bridgeInboundGroupMessageToAgentRooms(input)).resolves.toBe(true)

    for (const roomId of ['room-a', 'room-b']) {
      expect(state.db.getAgentRoomDetail(roomId)?.messages).toEqual([
        expect.objectContaining({
          content: '@产品 请记录本周风险',
          origin: expect.objectContaining({ providerMessageId: 'om_shared_1', senderDisplayName: '群成员' }),
          payload: expect.objectContaining({ deliveries: [], deliveryState: 'observed' })
        })
      ])
    }
  })

  it('separates receipt from processing with mute, mention, and prefix policies', () => {
    const base = connection('room-a', { muted: false })
    expect(shouldProcessAgentRoomChannelMessage(base, inbound(), '普通群消息')).toBe(true)
    expect(shouldProcessAgentRoomChannelMessage({ ...base, muted: true }, inbound(), '普通群消息')).toBe(false)
    expect(shouldProcessAgentRoomChannelMessage(
      { ...base, requireMention: true },
      inbound({ mentionedBot: false }),
      '普通群消息'
    )).toBe(false)
    expect(shouldProcessAgentRoomChannelMessage(
      { ...base, requireMention: true },
      inbound({ mentionedBot: true }),
      '普通群消息'
    )).toBe(true)
    expect(shouldProcessAgentRoomChannelMessage(
      { ...base, commandPrefix: '/ow' },
      inbound(),
      '普通群消息'
    )).toBe(false)
    expect(shouldProcessAgentRoomChannelMessage(
      { ...base, commandPrefix: '/ow' },
      inbound(),
      ' /ow 处理这条消息'
    )).toBe(true)
  })

  it('lets only the owning channel bridge rooms when provider bots share one conversation', async () => {
    state.db.saveAgentRoomChannelConnection(connection('room-b', { status: 'removed' }))
    state.db.saveAgentRoomChannelConnection(connection('room-b', {
      channelKey: 'lark:testing',
      channelLinkName: 'shared-testing',
      memberKey: 'product'
    }))
    const baseInput = {
      ctx: {
        channelKey: 'lark:non-owner',
        config: { title: 'Non owner', type: 'lark' },
        inbound: inbound({ messageId: 'om_owner_routing' })
      },
      states: []
    }

    await expect(bridgeInboundGroupMessageToAgentRooms(baseInput)).resolves.toBe(false)
    await expect(bridgeInboundGroupMessageToAgentRooms({
      ...baseInput,
      ctx: { ...baseInput.ctx, channelKey: 'lark:product' }
    })).resolves.toBe(true)

    expect(state.db.getAgentRoomDetail('room-a')?.messages).toEqual([
      expect.objectContaining({
        origin: expect.objectContaining({ channelKey: 'lark:product', channelLinkName: 'shared-product' })
      })
    ])
    expect(state.db.getAgentRoomDetail('room-b')?.messages).toEqual([])

    await expect(bridgeInboundGroupMessageToAgentRooms({
      ...baseInput,
      ctx: { ...baseInput.ctx, channelKey: 'lark:testing' }
    })).resolves.toBe(true)
    expect(state.db.getAgentRoomDetail('room-b')?.messages).toEqual([
      expect.objectContaining({
        origin: expect.objectContaining({ channelKey: 'lark:testing', channelLinkName: 'shared-testing' })
      })
    ])
  })

  it('merges bot-specific mention decisions into one room message without duplicate member delivery', async () => {
    state.db.saveAgentRoomMember({
      activeRunCount: 0,
      key: 'product',
      kind: 'task',
      label: 'Product',
      pendingCount: 0,
      roomId: 'room-a',
      status: 'idle'
    })
    state.db.saveAgentRoomChannelConnection(connection('room-a', {
      muted: false,
      requireMention: true
    }))
    state.db.saveAgentRoomMember({
      activeRunCount: 0,
      key: 'testing',
      kind: 'task',
      label: 'Testing',
      pendingCount: 0,
      roomId: 'room-a',
      status: 'idle'
    })
    state.db.saveAgentRoomChannelConnection(connection('room-a', {
      channelKey: 'lark:testing',
      channelLinkName: 'shared-testing',
      memberKey: 'testing',
      muted: false,
      requireMention: true
    }))
    const testingMention = inbound({ mentionedBot: true, messageId: 'om_secondary_copy' })

    await expect(bridgeInboundGroupMessageToAgentRooms({
      ctx: {
        channelKey: 'lark:testing',
        config: { title: 'Testing bot', type: 'lark' },
        inbound: testingMention
      },
      states: []
    })).resolves.toBe(true)
    expect(state.db.getAgentRoomDetail('room-a')?.messages).toEqual([
      expect.objectContaining({
        origin: expect.objectContaining({ channelKey: 'lark:testing' }),
        payload: expect.objectContaining({
          attemptedMemberKeys: ['testing'],
          deliveries: [],
          deliveryErrors: [{ error: 'Agent Room member is unavailable.', memberKey: 'testing' }],
          deliveryState: 'failed'
        })
      })
    ])

    await expect(bridgeInboundGroupMessageToAgentRooms({
      ctx: {
        channelKey: 'lark:product',
        config: { title: 'Product bot', type: 'lark' },
        inbound: { ...testingMention, mentionedBot: false }
      },
      states: []
    })).resolves.toBe(true)
    expect(state.db.getAgentRoomDetail('room-a')?.messages).toHaveLength(1)
    expect(state.db.getAgentRoomDetail('room-a')?.messages[0]?.payload).toEqual(expect.objectContaining({
      attemptedMemberKeys: ['testing']
    }))

    const productMention = inbound({ mentionedBot: true, messageId: 'om_product_copy' })
    await expect(bridgeInboundGroupMessageToAgentRooms({
      ctx: {
        channelKey: 'lark:product',
        config: { title: 'Product bot', type: 'lark' },
        inbound: productMention
      },
      states: []
    })).resolves.toBe(true)
    await expect(bridgeInboundGroupMessageToAgentRooms({
      ctx: {
        channelKey: 'lark:testing',
        config: { title: 'Testing bot', type: 'lark' },
        inbound: { ...productMention, mentionedBot: false }
      },
      states: []
    })).resolves.toBe(true)
    expect(state.db.getAgentRoomDetail('room-a')?.messages[1]?.payload).toEqual(expect.objectContaining({
      attemptedMemberKeys: ['product']
    }))
  })
})
