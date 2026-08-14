import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'
import { claimAgentRoomExternalDelegation } from '#~/services/agent-room/external-delegation-claim.js'
import {
  AGENT_ROOM_EXTERNAL_DELEGATION_TTL_MS,
  createPendingAgentRoomExternalDelegation,
  expirePendingAgentRoomExternalDelegations,
  failClaimedAgentRoomExternalDelegation
} from '#~/services/agent-room/external-delegation.js'

describe('agent room external delegation', () => {
  let db: SqliteDb

  beforeEach(() => {
    db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
  })
  afterEach(() => db.close())

  const createFixture = (options: { threadId?: string } = {}) => {
    const room = db.createAgentRoom({
      hostSessionId: 'host-session',
      id: 'room-auto',
      leaderEntity: 'oneworks:auto-leader',
      title: 'Automatic room'
    })
    const member = db.saveAgentRoomMember({
      activeRunCount: 0,
      key: 'product',
      kind: 'entity',
      label: 'Product',
      pendingCount: 0,
      roomId: room.id,
      status: 'idle'
    })
    db.saveAgentRoomChannelConnection({
      channelId: 'oc_shared',
      channelKey: 'lark:product',
      channelLinkName: 'product-lark',
      channelType: 'lark',
      conversationKind: 'group',
      entity: 'product',
      label: '产品群',
      memberKey: member.key,
      muted: false,
      receiveId: 'oc_shared',
      receiveIdType: 'chat_id',
      requireMention: false,
      roomId: room.id,
      status: 'active'
    })
    const executionContext = {
      availableDeliveryTargets: [],
      entity: { id: member.key, label: member.label },
      room: { id: room.id, memberKey: member.key, title: room.title },
      source: {
        channelKey: 'lark:product',
        channelLinkName: 'product-lark',
        channelType: 'lark',
        conversation: { id: 'oc_shared', kind: 'group' as const },
        message: { id: 'om_external' }
      }
    }
    const delegation = createPendingAgentRoomExternalDelegation({
      executionContext,
      external: {
        channelId: 'oc_shared',
        channelKey: 'lark:product',
        channelType: 'lark',
        messageId: 'om_external',
        replyReceiveId: 'oc_shared',
        replyReceiveIdType: 'chat_id',
        sessionType: 'group',
        ...(options.threadId == null ? {} : { threadId: options.threadId })
      },
      hostSessionId: 'host-session',
      member,
      room
    }, db)
    return { delegation, executionContext, member, room }
  }

  it('atomically binds a one-time delegation to the owning entity session', async () => {
    const { delegation } = createFixture()
    const writeContext = vi.fn(async () => undefined)

    await expect(claimAgentRoomExternalDelegation(
      {
        metadata: {
          createdAt: 1,
          entity: 'product',
          hostSessionId: 'host-session',
          memberKey: 'product',
          memberKind: 'entity',
          operationId: delegation.operationId,
          parentSessionId: 'host-session',
          roomId: 'room-auto',
          sessionId: 'session-product'
        },
        operationId: delegation.operationId
      },
      db,
      { writeContext }
    )).resolves.toEqual(expect.objectContaining({
      channelContext: expect.objectContaining({
        executionContext: expect.objectContaining({
          defaultReplyTarget: expect.objectContaining({ channelLinkName: 'product-lark' })
        })
      }),
      run: expect.objectContaining({
        id: delegation.operationId,
        sessionId: 'session-product',
        status: 'running'
      })
    }))

    expect(writeContext).toHaveBeenCalledWith(
      'session-product',
      expect.objectContaining({
        childRunId: delegation.operationId,
        entity: 'product',
        executionContext: expect.objectContaining({
          defaultReplyTarget: expect.objectContaining({ channelLinkName: 'product-lark' }),
          room: expect.objectContaining({ memberKey: 'product' })
        })
      })
    )
    await expect(claimAgentRoomExternalDelegation(
      {
        metadata: {
          createdAt: 1,
          entity: 'product',
          hostSessionId: 'host-session',
          memberKey: 'product',
          operationId: delegation.operationId,
          parentSessionId: 'host-session',
          roomId: 'room-auto',
          sessionId: 'session-product'
        },
        operationId: delegation.operationId
      },
      db,
      { writeContext }
    )).resolves.toEqual(expect.objectContaining({
      channelContext: expect.objectContaining({ childRunId: delegation.operationId }),
      run: expect.objectContaining({ status: 'running' })
    }))
    expect(writeContext).toHaveBeenCalledTimes(2)
    await expect(claimAgentRoomExternalDelegation(
      {
        metadata: {
          createdAt: 1,
          entity: 'product',
          hostSessionId: 'host-session',
          memberKey: 'product',
          operationId: delegation.operationId,
          parentSessionId: 'host-session',
          roomId: 'room-auto',
          sessionId: 'session-product-copy'
        },
        operationId: delegation.operationId
      },
      db,
      { writeContext }
    )).rejects.toThrow('already claimed')
    failClaimedAgentRoomExternalDelegation({
      error: new Error('consumer failed before spawn'),
      operationId: delegation.operationId,
      sessionId: 'session-product'
    }, db)
    expect(db.getChannelChildSessionRun(delegation.operationId)).toEqual(expect.objectContaining({
      error: 'consumer failed before spawn',
      status: 'failed'
    }))
  })

  it('rejects a copied delegation for another member or session', async () => {
    const { delegation } = createFixture()

    await expect(claimAgentRoomExternalDelegation(
      {
        metadata: {
          createdAt: 1,
          entity: 'testing',
          hostSessionId: 'host-session',
          memberKey: 'testing',
          operationId: delegation.operationId,
          parentSessionId: 'host-session',
          roomId: 'room-auto',
          sessionId: 'session-testing'
        },
        operationId: delegation.operationId
      },
      db,
      { writeContext: vi.fn() }
    )).rejects.toThrow('target is invalid')
    expect(db.getChannelChildSessionRun(delegation.operationId)).toEqual(expect.objectContaining({
      sessionId: null,
      status: 'started'
    }))
  })

  it('rebuilds context after an atomic claim crash and preserves the original reply thread', async () => {
    const { delegation, member, room } = createFixture({ threadId: 'thread-a' })
    expect(db.claimChannelChildSessionDelegation(delegation.operationId, 'session-product').claimed).toBe(true)
    db.saveAgentRoomChannelConnection({
      channelId: 'oc_shared',
      channelKey: 'lark:product',
      channelLinkName: 'product-lark',
      channelType: 'lark',
      conversationKind: 'group',
      entity: 'product',
      label: '产品群',
      memberKey: member.key,
      muted: false,
      receiveId: 'oc_shared',
      receiveIdType: 'chat_id',
      requireMention: false,
      roomId: room.id,
      status: 'active',
      threadId: 'thread-b'
    })
    const writeContext = vi.fn(async () => undefined)

    await expect(claimAgentRoomExternalDelegation(
      {
        metadata: {
          createdAt: 1,
          entity: 'product',
          hostSessionId: 'host-session',
          memberKey: 'product',
          operationId: delegation.operationId,
          parentSessionId: 'host-session',
          roomId: 'room-auto',
          sessionId: 'session-product'
        },
        operationId: delegation.operationId
      },
      db,
      { writeContext }
    )).resolves.toEqual(expect.objectContaining({
      channelContext: expect.objectContaining({
        executionContext: expect.objectContaining({
          defaultReplyTarget: expect.objectContaining({ threadId: 'thread-a' })
        }),
        threadId: 'thread-a'
      }),
      run: expect.objectContaining({ status: 'running' })
    }))
    expect(writeContext).toHaveBeenCalledOnce()
  })

  it('fails closed for an unknown delegation and expires unused pending grants', async () => {
    const { delegation } = createFixture()
    const metadata = {
      createdAt: 1,
      entity: 'product',
      hostSessionId: 'host-session',
      memberKey: 'product',
      operationId: 'missing-delegation',
      parentSessionId: 'host-session',
      roomId: 'room-auto',
      sessionId: 'session-product'
    }

    await expect(claimAgentRoomExternalDelegation(
      {
        metadata,
        operationId: 'missing-delegation'
      },
      db,
      { writeContext: vi.fn() }
    )).rejects.toThrow('invalid or unavailable')
    expect(expirePendingAgentRoomExternalDelegations(
      Date.now() + AGENT_ROOM_EXTERNAL_DELEGATION_TTL_MS + 1,
      db
    )).toBe(1)
    expect(db.getChannelChildSessionRun(delegation.operationId)).toEqual(expect.objectContaining({
      error: 'Delegation expired before use.',
      status: 'expired'
    }))
  })

  it('does not rebind an existing entity session to a different pending delegation', async () => {
    const { delegation: first, executionContext, member, room } = createFixture()
    const second = createPendingAgentRoomExternalDelegation({
      executionContext,
      external: {
        channelId: 'oc_shared',
        channelKey: 'lark:product',
        channelType: 'lark',
        messageId: 'om_external_second',
        replyReceiveId: 'oc_shared',
        replyReceiveIdType: 'chat_id',
        sessionType: 'group',
        threadId: 'thread-second'
      },
      hostSessionId: 'host-session',
      member,
      room
    }, db)

    await expect(claimAgentRoomExternalDelegation(
      {
        metadata: {
          createdAt: 1,
          entity: 'product',
          hostSessionId: 'host-session',
          memberKey: 'product',
          operationId: first.operationId,
          parentSessionId: 'host-session',
          roomId: 'room-auto',
          sessionId: 'session-product'
        },
        operationId: second.operationId
      },
      db,
      { writeContext: vi.fn() }
    )).rejects.toThrow('does not match the session metadata')
    expect(db.getChannelChildSessionRun(second.operationId)).toEqual(expect.objectContaining({
      sessionId: null,
      status: 'started'
    }))
  })
})
