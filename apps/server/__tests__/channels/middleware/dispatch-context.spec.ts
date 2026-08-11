import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelContext } from '#~/channels/middleware/@types/index.js'
import { resolveTarget } from '#~/channels/middleware/commands/send-target.js'
import { buildChannelExecutionContext, projectInboundMessageToRoom } from '#~/channels/middleware/dispatch/context.js'
import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'

const state = vi.hoisted(() => ({ db: undefined as unknown as SqliteDb }))

vi.mock('#~/db/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('#~/db/index.js')>()
  return { ...original, getDb: () => state.db }
})

const link = (
  channelKey: string,
  channelLinkName: string,
  channelType: string,
  label: string,
  receiveId: string,
  entity = 'owo'
) => ({
  accountLabel: `${label} account`,
  channelId: receiveId,
  channelKey,
  channelLinkName,
  channelType,
  conversationKind: 'group' as const,
  entity,
  label,
  receiveId,
  receiveIdType: channelType === 'wechat' ? 'chatroom' : 'chat_id',
  roomId: 'room-1'
})

const makeContext = (): ChannelContext => ({
  actor: {
    account: { accountId: 'ou_sender', channelKey: 'lark:product', channelType: 'lark' },
    user: { id: 'user-1', displayName: 'Owner' }
  },
  channelKey: 'lark:product',
  channelLink: { entity: 'owo', name: 'brainstorm-lark' } as ChannelContext['channelLink'],
  commandText: 'Start the review.',
  config: { title: 'Lark product bot', type: 'lark' },
  configSource: 'project',
  contentItems: undefined,
  inbound: {
    channelId: 'oc_brainstorm',
    channelType: 'lark',
    messageId: 'om_1',
    replyTo: { receiveId: 'oc_brainstorm', receiveIdType: 'chat_id' },
    senderId: 'ou_sender',
    sessionType: 'group',
    text: 'Start the review.'
  },
  sessionId: undefined
} as unknown as ChannelContext)

describe('channel execution context', () => {
  beforeEach(() => {
    state.db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
    state.db.createAgentRoom({
      id: 'room-1',
      title: 'Brainstorm',
      owner: { type: 'local', nodeId: 'node-1' }
    })
    state.db.saveAgentRoomChannelLink(link(
      'lark:product',
      'brainstorm-lark',
      'lark',
      'Lark brainstorm',
      'oc_brainstorm'
    ))
    state.db.saveAgentRoomChannelLink(link(
      'wechat:service',
      'brainstorm-wechat',
      'wechat',
      'WeChat brainstorm',
      'wx_brainstorm'
    ))
  })

  afterEach(() => {
    state.db.close()
  })

  it('captures Room targets once and projects each provider message exactly once', async () => {
    const ctx = makeContext()
    const executionContext = buildChannelExecutionContext(ctx)

    expect(executionContext).toEqual(expect.objectContaining({
      actor: expect.objectContaining({ canonicalUserId: 'user-1', externalAccountId: 'ou_sender' }),
      entity: { id: 'owo', label: 'owo' },
      room: { id: 'room-1', ownerNodeId: 'node-1', title: 'Brainstorm' },
      source: expect.objectContaining({
        channelKey: 'lark:product',
        channelType: 'lark',
        conversation: expect.objectContaining({ id: 'oc_brainstorm', kind: 'group' }),
        message: { id: 'om_1' }
      })
    }))
    expect(executionContext.availableDeliveryTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ channelKey: 'lark:product', receiveId: 'oc_brainstorm' }),
      expect.objectContaining({ channelKey: 'wechat:service', receiveId: 'wx_brainstorm' })
    ]))
    expect(Object.isFrozen(executionContext)).toBe(true)
    expect(Object.isFrozen(executionContext.availableDeliveryTargets)).toBe(true)

    state.db.saveAgentRoomChannelLink(link(
      'discord:community',
      'brainstorm-discord',
      'discord',
      'Discord brainstorm',
      'discord-room'
    ))
    expect(executionContext.availableDeliveryTargets).toHaveLength(2)

    await projectInboundMessageToRoom(ctx, executionContext, 'Start the review.')
    await projectInboundMessageToRoom(ctx, executionContext, 'Start the review.')

    expect(state.db.getAgentRoomDetail('room-1')?.messages).toEqual([
      expect.objectContaining({
        content: 'Start the review.',
        idempotencyKey: 'channel:lark:lark:product:om_1',
        memberKey: 'user:user-1',
        origin: expect.objectContaining({
          channelKey: 'lark:product',
          channelType: 'lark',
          providerMessageId: 'om_1'
        }),
        sequence: 1
      })
    ])
  })

  it("does not make another entity's Room account available for delivery", () => {
    state.db.saveAgentRoomChannelLink(link(
      'lark:research',
      'brainstorm-research',
      'lark',
      'Research analyst',
      'oc_research',
      'analyst'
    ))

    const executionContext = buildChannelExecutionContext(makeContext())

    expect(executionContext.availableDeliveryTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ channelKey: 'lark:product', receiveId: 'oc_brainstorm' }),
      expect.objectContaining({ channelKey: 'wechat:service', receiveId: 'wx_brainstorm' })
    ]))
    expect(executionContext.availableDeliveryTargets).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ channelKey: 'lark:research', receiveId: 'oc_research' })
    ]))
    expect(() =>
      resolveTarget({ ...makeContext(), executionContext }, {
        channelKey: 'lark:research',
        receiveId: 'oc_research'
      })
    ).toThrow('not available to the current entity in this Room')
  })
})
