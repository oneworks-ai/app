import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelContext } from '#~/channels/middleware/@types/index.js'
import { invokeChannelCommandTool, listChannelCommandTools } from '#~/channels/middleware/commands/index.js'
import { createT, defineMessages } from '#~/channels/middleware/i18n.js'

const commandRunSequence = vi.hoisted(() => ({ value: 0 }))
const createChannelCommandRun = vi.hoisted(() =>
  vi.fn((_input: { metadata?: Record<string, unknown> }) => ({
    id: `command-run-${++commandRunSequence.value}`
  }))
)
const finishChannelCommandRun = vi.hoisted(() => vi.fn())
const updateChannelCommandRunMetadata = vi.hoisted(() => vi.fn())
const getChannelCommandRun = vi.hoisted(() =>
  vi.fn((id: string) => ({
    id,
    metadata: {
      effect: { effect: 'external-write', operation: 'channel.send', risk: 'medium' }
    }
  }))
)
const claimChannelOutboundOperation = vi.hoisted(() =>
  vi.fn((input: {
    channelKey: string
    channelType: string
    operationId: string
    payloadHash: string
    target: unknown
  }) => ({
    claimed: true,
    operation: {
      ...input,
      createdAt: 1,
      error: null,
      navigation: null,
      providerMessageId: null,
      status: 'pending',
      updatedAt: 1
    }
  }))
)
const finishChannelOutboundOperation = vi.hoisted(() => vi.fn())
const executeRoomCommand = vi.hoisted(() => vi.fn())

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn(() => ({
    claimChannelOutboundOperation,
    createChannelCommandRun,
    finishChannelCommandRun,
    finishChannelOutboundOperation,
    getChannelCommandRun,
    updateChannelCommandRunMetadata
  }))
}))
vi.mock('#~/services/agent-room/owner.js', () => ({
  createAgentRoomOwner: vi.fn(() => ({ execute: executeRoomCommand }))
}))

const makeContext = (
  sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_1' }),
  overrides: Partial<ChannelContext> = {}
) => ({
  channelKey: 'lark:product',
  config: { type: 'lark' },
  configSource: 'project',
  inbound: {
    channelType: 'lark',
    channelId: 'oc_product',
    messageId: 'om_inbound',
    replyTo: { receiveId: 'oc_reply', receiveIdType: 'chat_id' },
    senderId: 'ou_owner',
    sessionType: 'group'
  },
  connection: { sendMessage },
  commandText: '',
  contentItems: undefined,
  defineMessages,
  getBoundSession: vi.fn(),
  getChannelAdapterPreference: vi.fn(),
  getChannelEffortPreference: vi.fn(),
  getChannelPermissionModePreference: vi.fn(),
  pushFollowUps: vi.fn(),
  reply: vi.fn(),
  resetSession: vi.fn(),
  resolveSessionWorkspace: vi.fn(),
  restartSession: vi.fn(),
  searchSessions: vi.fn(() => []),
  sessionId: 'session-1',
  setChannelAdapterPreference: vi.fn(),
  setChannelEffortPreference: vi.fn(),
  setChannelPermissionModePreference: vi.fn(),
  stopSession: vi.fn(),
  t: createT('en'),
  unbindSession: vi.fn(),
  updateSession: vi.fn(),
  ...overrides
} as unknown as ChannelContext)

describe('channel.send command kernel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    commandRunSequence.value = 0
    executeRoomCommand.mockResolvedValue(undefined)
  })

  it('declares one external-write effect in the typed command registry', () => {
    const tool = listChannelCommandTools().find(item => item.name === 'channel.send')

    expect(tool).toMatchObject({
      actorAuthority: 'sender',
      effect: {
        effect: 'external-write',
        operation: 'channel.send',
        risk: 'medium'
      },
      inputSchema: expect.objectContaining({ required: ['message'] })
    })
  })

  it('uses the default reply target and can send repeatedly in one child session', async () => {
    const sendMessage = vi.fn().mockResolvedValueOnce({ messageId: 'om_1' }).mockResolvedValueOnce({
      messageId: 'om_2'
    })
    const ctx = makeContext(sendMessage)

    await invokeChannelCommandTool(ctx, 'channel.send', { message: 'same' })
    await invokeChannelCommandTool(ctx, 'channel.send', { message: 'same' })

    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      receiveId: 'oc_reply',
      receiveIdType: 'chat_id',
      text: 'same'
    })
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      receiveId: 'oc_reply',
      receiveIdType: 'chat_id',
      text: 'same'
    })
    expect(createChannelCommandRun).toHaveBeenCalledTimes(2)
    expect(claimChannelOutboundOperation).toHaveBeenCalledTimes(2)
    expect(finishChannelOutboundOperation).toHaveBeenCalledTimes(2)
    expect(claimChannelOutboundOperation.mock.calls[0]?.[0]?.operationId).not.toBe(
      claimChannelOutboundOperation.mock.calls[1]?.[0]?.operationId
    )
    expect(finishChannelCommandRun).toHaveBeenCalledWith('command-run-1', { status: 'success' })
    expect(createChannelCommandRun).toHaveBeenLastCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        authorization: { status: 'allow', strategy: 'sender-permission' },
        effect: expect.objectContaining({ effect: 'external-write', operation: 'channel.send', risk: 'medium' })
      })
    }))
    expect(createChannelCommandRun.mock.calls[1]?.[0]?.metadata).not.toHaveProperty('approval')
  })

  it('reuses one persistent operation for retries of the same command invocation', async () => {
    const operations = new Map<string, {
      channelKey: string
      channelType: string
      createdAt: number
      error: null
      navigation: null
      operationId: string
      payloadHash: string
      providerMessageId: null
      status: string
      target: unknown
      updatedAt: number
    }>()
    claimChannelOutboundOperation.mockImplementation(input => {
      const existing = operations.get(input.operationId)
      if (existing != null) return { claimed: false, operation: existing }
      const operation = {
        ...input,
        createdAt: 1,
        error: null,
        navigation: null,
        providerMessageId: null,
        status: 'pending',
        updatedAt: 1
      }
      operations.set(input.operationId, operation)
      return { claimed: true, operation }
    })
    finishChannelOutboundOperation.mockImplementation((operationId, update) => {
      const current = operations.get(operationId)!
      const operation = { ...current, status: update.status, updatedAt: 2 }
      operations.set(operationId, operation)
      return operation
    })
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_1' })
    const ctx = makeContext(sendMessage, { commandInvocationId: 'invocation-1' })

    await invokeChannelCommandTool(ctx, 'channel.send', { message: 'same' })
    await invokeChannelCommandTool(ctx, 'channel.send', { message: 'same' })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(claimChannelOutboundOperation).toHaveBeenCalledTimes(2)
    expect(claimChannelOutboundOperation.mock.calls[0]?.[0]?.operationId).toBe(
      claimChannelOutboundOperation.mock.calls[1]?.[0]?.operationId
    )
    expect(finishChannelCommandRun).toHaveBeenLastCalledWith('command-run-2', { status: 'success' })
  })

  it('uses an explicit same-account target and rejects implicit cross-account delivery', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_1' })
    const ctx = makeContext(sendMessage)

    await invokeChannelCommandTool(ctx, 'channel.send', {
      message: { text: 'to release room' },
      target: {
        channelId: 'oc_release',
        channelKey: 'lark:product',
        channelType: 'lark',
        receiveId: 'oc_release',
        receiveIdType: 'chat_id'
      }
    })

    expect(sendMessage).toHaveBeenCalledWith({
      receiveId: 'oc_release',
      receiveIdType: 'chat_id',
      text: 'to release room'
    })

    await expect(invokeChannelCommandTool(ctx, 'channel.send', {
      message: 'do not fan out',
      target: {
        channelId: 'wx_group',
        channelKey: 'wechat:service',
        channelType: 'wechat',
        receiveId: 'wx_group',
        receiveIdType: 'chatroom'
      }
    })).rejects.toThrow('Cross-channel delivery')
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('uses only an explicitly selected cross-account target from the Room snapshot', async () => {
    const larkSend = vi.fn().mockResolvedValue({ messageId: 'om_lark' })
    const navigation = { appHomeUrl: 'https://wechat.example.test', embeddable: false }
    const wechatSend = vi.fn().mockResolvedValue({ messageId: 'wx_1', navigation })
    const wechatTarget = {
      accountLabel: 'WeChat service bot',
      channelId: 'wx_group',
      channelKey: 'wechat:service',
      channelLinkName: 'brainstorm-wechat',
      channelType: 'wechat',
      conversationKind: 'group' as const,
      label: 'Product experience',
      receiveId: 'wx_group',
      receiveIdType: 'chatroom'
    }
    const ctx = makeContext(larkSend, {
      executionContext: {
        availableDeliveryTargets: [wechatTarget],
        entity: { id: 'owo', label: 'OWO' },
        room: { id: 'room-1', title: 'Brainstorm' },
        source: {
          channelKey: 'lark:product',
          channelType: 'lark',
          conversation: { id: 'oc_product', kind: 'group' },
          message: { id: 'om_inbound' }
        }
      },
      resolveOutboundChannel: vi.fn((channelKey: string) =>
        channelKey === 'wechat:service'
          ? {
            config: { type: 'wechat' },
            connection: { sendMessage: wechatSend },
            key: channelKey,
            status: 'connected' as const,
            type: 'wechat'
          }
          : undefined
      )
    })

    await invokeChannelCommandTool(ctx, 'channel.send', {
      message: 'Send this to WeChat.',
      target: { channelKey: 'wechat:service', receiveId: 'wx_group' }
    })

    expect(wechatSend).toHaveBeenCalledWith({
      receiveId: 'wx_group',
      receiveIdType: 'chatroom',
      text: 'Send this to WeChat.'
    })
    expect(larkSend).not.toHaveBeenCalled()
    expect(updateChannelCommandRunMetadata).toHaveBeenCalledWith(
      'command-run-1',
      expect.objectContaining({
        deliveryTarget: wechatTarget,
        effect: expect.objectContaining({
          destinations: ['wechat:wechat:service:chatroom:wx_group:']
        })
      })
    )
    expect(claimChannelOutboundOperation.mock.invocationCallOrder[0]).toBeLessThan(
      wechatSend.mock.invocationCallOrder[0]!
    )
    expect(executeRoomCommand).toHaveBeenCalledWith('room-1', {
      idempotencyKey: expect.stringMatching(/^channel-send:/u),
      type: 'record_channel_delivery',
      delivery: {
        content: 'Send this to WeChat.',
        memberKey: 'entity:owo',
        navigation,
        providerMessageId: 'wx_1',
        status: 'sent',
        target: wechatTarget
      }
    })

    await expect(invokeChannelCommandTool(ctx, 'channel.send', {
      message: 'Do not send this.',
      target: { channelKey: 'discord:other', receiveId: 'channel-2' }
    })).rejects.toThrow('not available to the current entity in this Room')
    expect(wechatSend).toHaveBeenCalledTimes(1)
  })

  it('records a failed external delivery in the Room before returning the error', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('provider unavailable'))
    const target = {
      accountLabel: 'Product bot',
      channelId: 'oc_product',
      channelKey: 'lark:product',
      channelLinkName: 'product-lark',
      channelType: 'lark',
      conversationKind: 'group' as const,
      label: 'Product room',
      receiveId: 'oc_product',
      receiveIdType: 'chat_id'
    }
    const ctx = makeContext(sendMessage, {
      executionContext: {
        availableDeliveryTargets: [target],
        defaultReplyTarget: target,
        entity: { id: 'owo', label: 'OWO' },
        room: { id: 'room-1', title: 'Brainstorm' },
        source: {
          channelKey: 'lark:product',
          channelType: 'lark',
          conversation: { id: 'oc_product', kind: 'group' },
          message: { id: 'om_inbound' }
        }
      }
    })

    await expect(invokeChannelCommandTool(ctx, 'channel.send', {
      message: 'Ship the update.'
    })).rejects.toThrow('provider unavailable')

    expect(executeRoomCommand).toHaveBeenCalledWith('room-1', {
      idempotencyKey: expect.stringMatching(/^channel-send:/u),
      type: 'record_channel_delivery',
      delivery: {
        content: 'Ship the update.',
        error: 'provider unavailable',
        memberKey: 'entity:owo',
        status: 'failed',
        target
      }
    })
    expect(finishChannelOutboundOperation).toHaveBeenCalledWith(
      expect.stringMatching(/^channel-send:/u),
      { error: 'provider unavailable', status: 'failed' }
    )
  })

  it('does not call the provider again when a durable operation is already pending', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_duplicate' })
    claimChannelOutboundOperation.mockReturnValueOnce({
      claimed: false,
      operation: {
        channelKey: 'lark:product',
        channelType: 'lark',
        createdAt: 1,
        error: null,
        navigation: null,
        operationId: 'channel-send:pending',
        payloadHash: 'hash',
        providerMessageId: null,
        status: 'pending',
        target: {
          channelType: 'lark',
          channelKey: 'lark:product',
          receiveId: 'oc_reply',
          receiveIdType: 'chat_id'
        },
        updatedAt: 1
      }
    })

    await expect(invokeChannelCommandTool(makeContext(sendMessage), 'channel.send', {
      message: 'indeterminate delivery'
    })).rejects.toThrow('already pending')

    expect(sendMessage).not.toHaveBeenCalled()
    expect(finishChannelOutboundOperation).not.toHaveBeenCalled()
  })
})
