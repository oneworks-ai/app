import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AgentRoomChannelLink,
  AgentRoomEventMember,
  AgentRoomEventRun,
  AgentRoomMessageOrigin
} from '@oneworks/core'

import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'
import { createAgentRoomService } from '#~/services/agent-room/index.js'
import type { AgentRoomSessionDelivery } from '#~/services/agent-room/index.js'

const member: AgentRoomEventMember = {
  key: 'architect',
  kind: 'entity',
  label: 'Architect'
}

const run = (key: string): AgentRoomEventRun => ({
  key,
  sessionId: `session-${key}`,
  title: `Run ${key}`
})

const larkOrigin: AgentRoomMessageOrigin = {
  accountId: 'lark:product',
  accountLabel: 'Product bot',
  channelId: 'oc_brainstorm',
  channelKey: 'lark:product',
  channelLinkName: 'brainstorm-product',
  channelType: 'lark',
  conversationKind: 'group',
  conversationLabel: 'Wan Ke Brainstorm',
  providerMessageId: 'om_1'
}

describe('agent room service', () => {
  let db: SqliteDb
  let delivery: AgentRoomSessionDelivery
  let resolvedChannelLinks: Map<string, Omit<AgentRoomChannelLink, 'createdAt' | 'roomId'>>
  let service: ReturnType<typeof createAgentRoomService>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-24T00:00:00.000Z'))
    db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
    delivery = {
      processUserMessage: vi.fn(async () => undefined),
      handleInteractionResponse: vi.fn(() => true),
      getSessionInteraction: vi.fn(() => undefined),
      notifySessionUpdated: vi.fn()
    }
    resolvedChannelLinks = new Map()
    service = createAgentRoomService(db, delivery, {
      resolveChannelLink: async (channelLinkName) => {
        const link = resolvedChannelLinks.get(channelLinkName)
        if (link == null) throw new Error(`ChannelLink not found: ${channelLinkName}`)
        return link
      }
    })
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  it('persists the local owner and applies runtime events to room state', async () => {
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      owner: { type: 'local', accountId: 'owner-1', nodeId: 'node-1' },
      leaderEntity: 'project-manager'
    })

    await service.executeCommand(room.id, {
      idempotencyKey: 'event-schema-started',
      type: 'apply_event',
      event: {
        type: 'assignment_sent',
        member,
        run: run('schema-plan'),
        summary: 'Architect is planning the schema.'
      }
    })

    expect(service.getOwnerSnapshot(room.id)).toEqual(expect.objectContaining({
      room: expect.objectContaining({
        owner: { type: 'local', accountId: 'owner-1', nodeId: 'node-1' },
        leaderEntity: 'project-manager',
        lastMessage: 'Architect is planning the schema.'
      }),
      members: [expect.objectContaining({ key: 'architect', activeRunCount: 1 })],
      runs: [expect.objectContaining({ key: 'schema-plan', status: 'running' })],
      messages: [expect.objectContaining({
        content: 'Architect is planning the schema.',
        eventType: 'assignment_sent',
        sequence: 1
      })]
    }))
  })

  it('keeps duplicate commands and event ids idempotent', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    const command = {
      idempotencyKey: 'event-schema-started',
      type: 'apply_event' as const,
      event: {
        id: 'event-1',
        type: 'assignment_sent' as const,
        member,
        run: run('schema-plan'),
        summary: 'Schema work started.'
      }
    }

    const first = await service.executeCommand(room.id, command)
    const second = await service.executeCommand(room.id, command)
    service.applyEvent(room.id, command.event)

    expect(second).toEqual(first)
    expect(service.getDetail(room.id)?.messages).toHaveLength(1)
    expect(service.getDetail(room.id)?.runs).toHaveLength(1)
  })

  it('stores inbound channel messages once with immutable provenance and sequence', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    const command = {
      idempotencyKey: 'lark:lark:product:om_1',
      type: 'ingest_channel_message' as const,
      message: {
        content: 'Start a product review.',
        memberKey: 'product',
        origin: larkOrigin
      }
    }

    await service.executeCommand(room.id, command)
    await service.executeCommand(room.id, command)

    expect(service.getDetail(room.id)?.messages).toEqual([
      expect.objectContaining({
        content: 'Start a product review.',
        idempotencyKey: 'lark:lark:product:om_1',
        memberKey: 'product',
        origin: larkOrigin,
        role: 'user',
        sequence: 1
      })
    ])
  })

  it('records each Agent channel delivery as one idempotent Room message', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    const command = {
      idempotencyKey: 'channel-delivery:lark:lark:product:om_out',
      type: 'record_channel_delivery' as const,
      delivery: {
        content: 'The release is ready.',
        memberKey: 'entity:release-manager',
        navigation: { appHomeUrl: 'https://www.feishu.cn/messenger/', embeddable: false },
        providerMessageId: 'om_out',
        status: 'sent' as const,
        target: {
          accountLabel: 'Release bot',
          channelId: 'oc_release',
          channelKey: 'lark:product',
          channelType: 'lark',
          conversationKind: 'group' as const,
          label: 'Release room',
          receiveId: 'oc_release',
          receiveIdType: 'chat_id'
        }
      }
    }

    await service.executeCommand(room.id, command)
    await service.executeCommand(room.id, command)

    expect(service.getDetail(room.id)?.messages).toEqual([
      expect.objectContaining({
        content: 'The release is ready.',
        deliveries: [expect.objectContaining({
          providerMessageId: 'om_out',
          status: 'sent',
          target: expect.objectContaining({ channelKey: 'lark:product' })
        })],
        memberKey: 'entity:release-manager',
        role: 'agent'
      })
    ])
  })

  it('preserves the provider error on a failed Agent channel delivery', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })

    await service.executeCommand(room.id, {
      idempotencyKey: 'channel-delivery:failed:1',
      type: 'record_channel_delivery',
      delivery: {
        content: 'The release is ready.',
        error: 'provider unavailable',
        memberKey: 'entity:release-manager',
        status: 'failed',
        target: {
          channelId: 'oc_release',
          channelKey: 'lark:product',
          channelType: 'lark',
          conversationKind: 'group',
          label: 'Release room',
          receiveId: 'oc_release',
          receiveIdType: 'chat_id'
        }
      }
    })

    expect(service.getDetail(room.id)?.messages[0]?.deliveries).toEqual([
      expect.objectContaining({ error: 'provider unavailable', status: 'failed' })
    ])
  })

  it('attaches multiple channel accounts to one room without collapsing their identities', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    const makeLink = (channelKey: string, channelLinkName: string, label: string) => ({
      accountLabel: label,
      channelId: 'conversation-1',
      channelKey,
      channelLinkName,
      channelType: channelKey.split(':')[0]!,
      conversationKind: 'group' as const,
      entity: 'owo',
      label,
      receiveId: 'conversation-1',
      receiveIdType: 'chat_id'
    })
    resolvedChannelLinks.set('brainstorm-lark', makeLink('lark:product', 'brainstorm-lark', 'Lark product bot'))
    resolvedChannelLinks.set(
      'brainstorm-wechat',
      makeLink('wechat:service', 'brainstorm-wechat', 'WeChat service bot')
    )

    await service.executeCommand(room.id, {
      idempotencyKey: 'attach-lark',
      type: 'attach_channel',
      link: { channelLinkName: 'brainstorm-lark' }
    })
    await service.executeCommand(room.id, {
      idempotencyKey: 'attach-wechat',
      type: 'attach_channel',
      link: { channelLinkName: 'brainstorm-wechat' }
    })

    expect(service.getDetail(room.id)?.channelLinks).toEqual([
      expect.objectContaining({ channelKey: 'lark:product', entity: 'owo' }),
      expect.objectContaining({ channelKey: 'wechat:service', entity: 'owo' })
    ])
  })

  it('rejects attaching one provider conversation to multiple rooms', async () => {
    const firstRoom = service.createRoom({ id: 'room-1', title: 'First room' })
    const secondRoom = service.createRoom({ id: 'room-2', title: 'Second room' })
    const link = {
      channelId: 'conversation-1',
      channelKey: 'lark:product',
      channelLinkName: 'brainstorm-lark',
      channelType: 'lark',
      conversationKind: 'group' as const,
      entity: 'owo',
      label: 'Lark product bot',
      receiveId: 'conversation-1',
      receiveIdType: 'chat_id'
    }
    resolvedChannelLinks.set('brainstorm-lark', link)

    await service.executeCommand(firstRoom.id, {
      idempotencyKey: 'attach-first',
      type: 'attach_channel',
      link: { channelLinkName: 'brainstorm-lark' }
    })

    await expect(service.executeCommand(secondRoom.id, {
      idempotencyKey: 'attach-second',
      type: 'attach_channel',
      link: { channelLinkName: 'brainstorm-lark' }
    })).rejects.toThrow('Channel conversation is already attached to agent room room-1')
    expect(service.getDetail(firstRoom.id)?.channelLinks).toHaveLength(1)
    expect(service.getDetail(secondRoom.id)?.channelLinks).toEqual([])
  })

  it('rejects an unknown ChannelLink instead of persisting caller-authored delivery fields', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })

    await expect(service.executeCommand(room.id, {
      idempotencyKey: 'attach-unknown',
      type: 'attach_channel',
      link: { channelLinkName: 'missing-link' }
    })).rejects.toThrow('ChannelLink not found: missing-link')
    expect(service.getDetail(room.id)?.channelLinks).toEqual([])
  })

  it('creates and revokes finite Room shares without copying transcript content', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    await service.executeCommand(room.id, {
      idempotencyKey: 'share-1',
      type: 'create_share',
      share: {
        grants: [{
          principalId: 'user-2',
          principalType: 'user',
          permissions: ['view', 'send']
        }]
      }
    })

    expect(service.getDetail(room.id)?.shares).toEqual([
      expect.objectContaining({
        id: 'share-1',
        status: 'active',
        grants: [expect.objectContaining({ principalId: 'user-2', permissions: ['view', 'send'] })]
      })
    ])

    await service.executeCommand(room.id, {
      idempotencyKey: 'revoke-share-1',
      type: 'revoke_share',
      shareId: 'share-1'
    })

    expect(service.getDetail(room.id)?.shares[0]).toEqual(expect.objectContaining({ status: 'revoked' }))
    expect(service.getDetail(room.id)?.messages).toEqual([])
  })

  it('rolls back Relay owner binding when atomic share creation fails', async () => {
    const room = service.createRoom({ id: 'room-atomic-share', title: 'Atomic share room' })
    db.createAgentRoomShare({ grants: [], id: 'share-conflict', roomId: room.id })

    await expect(service.executeCommand(room.id, {
      idempotencyKey: 'share-conflict',
      type: 'create_share',
      share: { grants: [] }
    }, {
      bindOwner: {
        accountId: 'relay-account',
        nodeId: 'relay-node',
        sourceId: 'relay:source'
      }
    })).rejects.toThrow()

    expect(service.getDetail(room.id)?.room.owner).toEqual({ type: 'local' })
    expect(db.getAgentRoomEventByIdempotencyKey(room.id, 'share-conflict')).toBeUndefined()
  })

  it('delivers a targeted local message and persists its source channel', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    db.createSession('Schema plan', 'session-schema-plan', 'running', 'host-session')
    service.applyEvent(room.id, {
      type: 'assignment_sent',
      member,
      run: run('schema-plan'),
      summary: 'Schema work started.'
    })

    await service.executeCommand(room.id, {
      idempotencyKey: 'room-message-1',
      type: 'append_message',
      message: {
        content: 'Please continue.',
        origin: larkOrigin,
        target: { memberKey: 'architect', runKey: 'schema-plan' }
      }
    })

    expect(delivery.processUserMessage).toHaveBeenCalledWith('session-schema-plan', 'Please continue.')
    expect(service.getDetail(room.id)?.messages.at(-1)).toEqual(expect.objectContaining({
      idempotencyKey: 'room-message-1',
      origin: larkOrigin,
      payload: expect.objectContaining({
        delivery: expect.objectContaining({ sessionId: 'session-schema-plan' }),
        target: { memberKey: 'architect', runKey: 'schema-plan' }
      })
    }))
  })

  it('coalesces concurrent append commands before delivering externally', async () => {
    let releaseDelivery: (() => void) | undefined
    delivery.processUserMessage = vi.fn(() =>
      new Promise<void>((resolve) => {
        releaseDelivery = resolve
      })
    )
    service = createAgentRoomService(db, delivery)
    const room = service.createRoom({ id: 'room-1', title: 'Build room', hostSessionId: 'host-session' })
    db.createSession('Host', 'host-session', 'running')
    const command = {
      idempotencyKey: 'room-message-concurrent',
      type: 'append_message' as const,
      message: { content: 'Only send this once.' }
    }

    const first = service.executeCommand(room.id, command)
    const second = service.executeCommand(room.id, command)
    await vi.waitFor(() => expect(delivery.processUserMessage).toHaveBeenCalledTimes(1))
    releaseDelivery?.()

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(secondResult).toEqual(firstResult)
    expect(service.getDetail(room.id)?.messages).toEqual([
      expect.objectContaining({
        content: 'Only send this once.',
        payload: expect.objectContaining({ deliveryState: 'delivered' })
      })
    ])
  })

  it('does not redeliver an unresolved claimed message after a delivery failure', async () => {
    delivery.processUserMessage = vi.fn(async () => {
      throw new Error('connection lost after send')
    })
    service = createAgentRoomService(db, delivery)
    const room = service.createRoom({ id: 'room-1', title: 'Build room', hostSessionId: 'host-session' })
    db.createSession('Host', 'host-session', 'running')
    const command = {
      idempotencyKey: 'room-message-uncertain',
      type: 'append_message' as const,
      message: { content: 'Do not duplicate this.' }
    }

    await expect(service.executeCommand(room.id, command)).rejects.toThrow('connection lost after send')
    await expect(service.executeCommand(room.id, command)).rejects.toThrow(
      'Agent room message delivery outcome is unresolved'
    )

    expect(delivery.processUserMessage).toHaveBeenCalledTimes(1)
    expect(service.getDetail(room.id)?.messages).toEqual([
      expect.objectContaining({
        content: 'Do not duplicate this.',
        payload: expect.objectContaining({ deliveryState: 'pending' })
      })
    ])
  })

  it('does not reconstruct Room messages from host or child session transcripts', () => {
    db.createSession('Host', 'host-session', 'running')
    db.saveMessage('host-session', {
      type: 'message',
      message: {
        id: 'host-message',
        role: 'assistant',
        content: 'This stays in the host session.',
        createdAt: Date.now()
      }
    })
    const room = service.createRoom({
      id: 'room-1',
      title: 'Build room',
      hostSessionId: 'host-session'
    })

    expect(service.getDetail(room.id)?.messages).toEqual([])
  })

  it('answers pending run interactions through the existing session delivery boundary', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    db.createSession('Schema plan', 'session-schema-plan', 'waiting_input', 'host-session')
    service.applyEvent(room.id, {
      type: 'attention_requested',
      member,
      run: run('schema-plan'),
      interactionId: 'child-approval',
      requestKind: 'confirmation',
      summary: 'Need child approval.',
      options: [{ label: 'Approve', value: 'approve' }]
    })

    await expect(service.respondInteraction(room.id, 'child-approval', ['approve'])).resolves.toBe(true)
    expect(delivery.handleInteractionResponse).toHaveBeenCalledWith(
      'session-schema-plan',
      'child-approval',
      ['approve']
    )
  })

  it('persists archive and favorite metadata without deleting Room state', async () => {
    const room = service.createRoom({ id: 'room-1', title: 'Build room' })
    await service.executeCommand(room.id, {
      idempotencyKey: 'channel-message-1',
      type: 'ingest_channel_message',
      message: { content: 'Keep this transcript.', origin: larkOrigin }
    })

    vi.setSystemTime(new Date('2026-04-24T00:00:01.000Z'))
    service.updateRoomMetadata(room.id, { isFavorited: true })
    vi.setSystemTime(new Date('2026-04-24T00:00:02.000Z'))
    service.updateRoomMetadata(room.id, { isArchived: true })

    expect(service.listRooms('active')).toEqual([])
    expect(service.listRooms('archived')).toEqual([
      expect.objectContaining({ id: room.id, archivedAt: Date.now(), favoritedAt: expect.any(Number) })
    ])
    expect(service.getDetail(room.id)?.messages).toEqual([
      expect.objectContaining({ content: 'Keep this transcript.' })
    ])
  })
})
