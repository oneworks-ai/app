import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'
import { createAgentRoomService } from '#~/services/agent-room/index.js'

describe('agent room external routing', () => {
  let db: SqliteDb

  beforeEach(() => {
    db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
  })
  afterEach(() => db.close())

  it('lets a leader reply through the member that contributed the source channel', async () => {
    const createSessionWithInitialMessage = vi.fn(async (options) => {
      const sessionId = 'session-leader-external'
      db.createSession('Leader external', sessionId, 'running')
      await options.beforeStart?.(sessionId)
      return db.getSession(sessionId)!
    })
    const service = createAgentRoomService(db, {
      createSessionWithInitialMessage,
      getSessionInteraction: vi.fn(),
      handleInteractionResponse: vi.fn(() => true),
      notifySessionUpdated: vi.fn(),
      processUserMessage: vi.fn(async () => undefined)
    })
    const room = service.createRoom({ id: 'room-leader', leaderEntity: 'leader', title: 'Leader room' })
    service.upsertMember(room.id, { key: 'leader', kind: 'entity', label: 'Leader' })
    service.upsertMember(room.id, { key: 'product', kind: 'entity', label: 'Product' })
    db.saveAgentRoomChannelConnection({
      channelId: 'oc_shared',
      channelKey: 'lark:product',
      channelLinkName: 'product-lark',
      channelType: 'lark',
      conversationKind: 'group',
      entity: 'product',
      label: '产品群',
      memberKey: 'product',
      muted: false,
      receiveId: 'oc_shared',
      receiveIdType: 'chat_id',
      requireMention: false,
      roomId: room.id,
      status: 'active'
    })

    const result = await service.ingestExternalMessage(room.id, '请处理产品群消息', {
      channelId: 'oc_shared',
      channelKey: 'lark:product',
      channelType: 'lark',
      conversationKind: 'group',
      providerMessageId: 'om_leader'
    }, {
      channelId: 'oc_shared',
      channelKey: 'lark:product',
      channelType: 'lark',
      messageId: 'om_leader',
      replyReceiveId: 'oc_shared',
      replyReceiveIdType: 'chat_id',
      sessionType: 'group'
    }, ['product'])

    expect(result.payload).toEqual(expect.objectContaining({
      deliveryState: 'delivered',
      deliveries: [expect.objectContaining({ target: { memberKey: 'leader', runKey: 'session-leader-external' } })]
    }))
    expect(createSessionWithInitialMessage).toHaveBeenCalledWith(expect.objectContaining({
      channelContext: expect.objectContaining({
        channelLinkName: 'product-lark',
        entity: 'leader',
        executionContext: expect.objectContaining({
          defaultReplyTarget: expect.objectContaining({ channelLinkName: 'product-lark', receiveId: 'oc_shared' }),
          room: expect.objectContaining({ memberKey: 'leader' })
        })
      }),
      promptName: 'leader'
    }))
  })

  it('does not reconstruct room messages from session transcripts', () => {
    db.createSession('Host', 'host-session', 'running')
    db.saveMessage('host-session', {
      message: {
        content: 'This stays in the host session.',
        createdAt: Date.now(),
        id: 'host-message',
        role: 'assistant'
      },
      type: 'message'
    })
    const service = createAgentRoomService(db)
    const room = service.createRoom({ id: 'room-1', title: 'Build room', hostSessionId: 'host-session' })

    expect(service.getDetail(room.id)?.messages).toEqual([])
  })

  it('records a terminal failure when external delivery throws and does not retry it', async () => {
    const createSessionWithInitialMessage = vi.fn(async () => {
      throw new Error('adapter failed before session start')
    })
    const service = createAgentRoomService(db, {
      createSessionWithInitialMessage,
      getSessionInteraction: vi.fn(),
      handleInteractionResponse: vi.fn(() => true),
      notifySessionUpdated: vi.fn(),
      processUserMessage: vi.fn(async () => undefined)
    })
    const room = service.createRoom({ id: 'room-failed', title: 'Failed room' })
    service.upsertMember(room.id, { key: 'product', kind: 'entity', label: 'Product' })
    const origin = {
      channelId: 'oc_shared',
      channelKey: 'lark:product',
      channelType: 'lark',
      conversationKind: 'group' as const,
      providerMessageId: 'om_failed'
    }
    const external = {
      channelId: 'oc_shared',
      channelKey: 'lark:product',
      channelType: 'lark',
      messageId: 'om_failed',
      replyReceiveId: 'oc_shared',
      replyReceiveIdType: 'chat_id',
      sessionType: 'group'
    }

    await expect(
      service.ingestExternalMessage(room.id, '处理失败消息', origin, external, ['product'])
    ).resolves.toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        deliveries: [],
        deliveryErrors: [{ error: 'adapter failed before session start', memberKey: 'product' }],
        deliveryState: 'failed'
      })
    }))
    await expect(
      service.ingestExternalMessage(room.id, '处理失败消息', origin, external, ['product'])
    ).rejects.toThrow('Agent room message delivery previously failed')

    expect(createSessionWithInitialMessage).toHaveBeenCalledTimes(1)
    expect(db.listRecentChannelChildSessionRuns(1)).toEqual([
      expect.objectContaining({ error: 'adapter failed before session start', status: 'failed' })
    ])
    expect(service.getDetail(room.id)?.messages).toEqual([
      expect.objectContaining({
        content: '处理失败消息',
        payload: expect.objectContaining({ deliveries: [], deliveryState: 'failed' })
      })
    ])
  })

  it('attempts every target once when one external member delivery fails', async () => {
    const createSessionWithInitialMessage = vi.fn(async (options) => {
      if (options.promptName === 'product') throw new Error('product adapter failed')
      const sessionId = `session-${options.promptName}`
      db.createSession(options.promptName ?? 'Member', sessionId, 'running')
      await options.beforeStart?.(sessionId)
      return db.getSession(sessionId)!
    })
    const service = createAgentRoomService(db, {
      createSessionWithInitialMessage,
      getSessionInteraction: vi.fn(),
      handleInteractionResponse: vi.fn(() => true),
      notifySessionUpdated: vi.fn(),
      processUserMessage: vi.fn(async () => undefined)
    })
    const room = service.createRoom({ id: 'room-fanout', title: 'Fanout room' })
    service.upsertMember(room.id, { key: 'product', kind: 'entity', label: 'Product' })
    service.upsertMember(room.id, { key: 'testing', kind: 'entity', label: 'Testing' })

    const result = await service.ingestExternalMessage(room.id, '处理群消息', {
      channelId: 'oc_shared',
      channelKey: 'lark:product',
      channelType: 'lark',
      conversationKind: 'group',
      providerMessageId: 'om_fanout'
    }, {
      channelId: 'oc_shared',
      channelKey: 'lark:product',
      channelType: 'lark',
      messageId: 'om_fanout',
      replyReceiveId: 'oc_shared',
      replyReceiveIdType: 'chat_id',
      sessionType: 'group'
    }, ['product', 'testing'])

    expect(result.payload).toEqual(expect.objectContaining({
      deliveries: [expect.objectContaining({ target: { memberKey: 'testing', runKey: 'session-testing' } })],
      deliveryErrors: [{ error: 'product adapter failed', memberKey: 'product' }],
      deliveryState: 'failed'
    }))
    expect(createSessionWithInitialMessage).toHaveBeenCalledTimes(2)
  })

  it('terminalizes an existing-session child run when delivery throws', async () => {
    const processUserMessage = vi.fn(async () => {
      throw new Error('existing session delivery failed')
    })
    const service = createAgentRoomService(db, {
      createSessionWithInitialMessage: vi.fn(),
      getSessionInteraction: vi.fn(),
      handleInteractionResponse: vi.fn(() => true),
      notifySessionUpdated: vi.fn(),
      processUserMessage
    })
    const room = service.createRoom({ id: 'room-existing-failed', title: 'Existing failed room' })
    service.upsertMember(room.id, { key: 'product', kind: 'entity', label: 'Product' })
    db.createSession('Product', 'session-product-existing', 'running')
    db.saveAgentRoomRun({
      key: 'run-product-existing',
      memberKey: 'product',
      roomId: room.id,
      sessionId: 'session-product-existing',
      status: 'running',
      title: 'Product'
    })

    const result = await service.ingestExternalMessage(room.id, '处理已有会话消息', {
      channelId: 'oc_shared',
      channelKey: 'lark:product',
      channelType: 'lark',
      conversationKind: 'group',
      providerMessageId: 'om_existing_failed'
    }, {
      channelId: 'oc_shared',
      channelKey: 'lark:product',
      channelType: 'lark',
      messageId: 'om_existing_failed',
      replyReceiveId: 'oc_shared',
      replyReceiveIdType: 'chat_id',
      sessionType: 'group'
    }, ['product'])

    expect(result.payload).toEqual(expect.objectContaining({
      deliveryErrors: [{ error: 'existing session delivery failed', memberKey: 'product' }],
      deliveryState: 'failed'
    }))
    expect(db.listRecentChannelChildSessionRuns(1)).toEqual([
      expect.objectContaining({
        error: 'existing session delivery failed',
        sessionId: 'session-product-existing',
        status: 'failed'
      })
    ])
  })
})
