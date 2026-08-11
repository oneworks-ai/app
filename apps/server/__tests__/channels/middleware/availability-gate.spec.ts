import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelContext } from '#~/channels/middleware/@types/index.js'
import {
  availabilityGateMiddleware,
  clearAvailabilityGateStateForTests,
  isWithinAvailabilityWorkHours,
  setAvailabilityNowProviderForTests
} from '#~/channels/middleware/availability-gate.js'
import { createT, defineMessages } from '#~/channels/middleware/i18n.js'
import { getDb } from '#~/db/index.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

const appendChannelOffhourBacklog = vi.fn()
const consumeChannelReplyThrottle = vi.fn(() => true)
const getChannelAvailabilityOverride = vi.fn()

const makeCtx = (overrides: Partial<ChannelContext> = {}): ChannelContext => ({
  channelKey: 'lark-main',
  inbound: {
    channelType: 'lark',
    channelId: 'oc_123',
    sessionType: 'group',
    messageId: 'om_1',
    senderId: 'ou_1',
    text: '普通闲聊',
    raw: {}
  } as any,
  connection: undefined,
  config: { type: 'lark' } as any,
  channelLink: {
    availability: {
      timezone: 'Asia/Shanghai',
      workHours: [
        { days: [1], start: '10:00', end: '19:00' }
      ],
      offHours: {
        replyText: '我现在下班啦。',
        replyThrottleMs: 20 * 60 * 1000
      }
    },
    channelKey: 'lark-main',
    entity: 'owo-demo',
    external: { type: 'chat', chatId: 'oc_123' },
    ingress: {
      ambientRouting: false,
      createOnCommand: true,
      createOnMention: true,
      createOnPendingIntent: true,
      createOnReplyToBot: true,
      mentionPatterns: ['@OWO']
    },
    name: 'wan-ke-chat',
    path: '/workspace/.oo/channels/wan-ke-chat/channel.json',
    routing: { accounts: {}, default: {}, modes: {}, users: {} },
    definition: {} as never
  },
  sessionId: undefined,
  channelAdapter: undefined,
  channelPermissionMode: undefined,
  channelEffort: undefined,
  contentItems: undefined,
  commandText: '普通闲聊',
  defineMessages,
  t: createT(undefined),
  reply: vi.fn().mockResolvedValue(undefined),
  pushFollowUps: vi.fn().mockResolvedValue(undefined),
  getBoundSession: vi.fn(),
  searchSessions: vi.fn(() => []),
  bindSession: vi.fn(() => ({ alreadyBound: false })),
  unbindSession: vi.fn(() => ({})),
  resetSession: vi.fn(),
  stopSession: vi.fn(),
  restartSession: vi.fn().mockResolvedValue(undefined),
  resolveSessionWorkspace: vi.fn().mockResolvedValue(undefined),
  updateSession: vi.fn(),
  getChannelAdapterPreference: vi.fn(),
  setChannelAdapterPreference: vi.fn(),
  getChannelPermissionModePreference: vi.fn(),
  setChannelPermissionModePreference: vi.fn(),
  getChannelEffortPreference: vi.fn(),
  setChannelEffortPreference: vi.fn(),
  ...overrides
})

beforeEach(() => {
  appendChannelOffhourBacklog.mockReset()
  consumeChannelReplyThrottle.mockReset()
  consumeChannelReplyThrottle.mockReturnValue(true)
  getChannelAvailabilityOverride.mockReset()
  getChannelAvailabilityOverride.mockReturnValue(undefined)
  vi.mocked(getDb).mockReturnValue({
    appendChannelOffhourBacklog,
    consumeChannelReplyThrottle,
    getChannelAvailabilityOverride
  } as any)
})

afterEach(() => {
  clearAvailabilityGateStateForTests()
  vi.clearAllMocks()
})

describe('availabilityGateMiddleware', () => {
  it('treats configured work hours as available in the configured timezone', () => {
    expect(isWithinAvailabilityWorkHours(
      {
        timezone: 'Asia/Shanghai',
        workHours: [
          { days: [1], start: '10:00', end: '19:00' }
        ]
      },
      new Date('2026-06-15T02:30:00.000Z')
    )).toBe(true)
    expect(isWithinAvailabilityWorkHours(
      {
        timezone: 'Asia/Shanghai',
        workHours: [
          { days: [1], start: '10:00', end: '19:00' }
        ]
      },
      new Date('2026-06-15T13:30:00.000Z')
    )).toBe(false)
  })

  it('allows messages during work hours', async () => {
    setAvailabilityNowProviderForTests(() => new Date('2026-06-15T02:30:00.000Z'))
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx()

    await availabilityGateMiddleware(ctx, next)

    expect(next).toHaveBeenCalledOnce()
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it('drops ordinary group messages after hours without a public notice', async () => {
    setAvailabilityNowProviderForTests(() => new Date('2026-06-15T13:30:00.000Z'))
    const next = vi.fn()
    const ctx = makeCtx()

    await availabilityGateMiddleware(ctx, next)

    expect(next).not.toHaveBeenCalled()
    expect(ctx.reply).not.toHaveBeenCalled()
    expect(appendChannelOffhourBacklog).toHaveBeenCalledWith(expect.objectContaining({
      channelLinkName: 'wan-ke-chat',
      channelType: 'lark',
      channelId: 'oc_123',
      sessionType: 'group',
      senderId: 'ou_1',
      text: '普通闲聊'
    }))
  })

  it('replies once for explicit group mentions after hours and throttles repeats', async () => {
    setAvailabilityNowProviderForTests(() => new Date('2026-06-15T13:30:00.000Z'))
    consumeChannelReplyThrottle
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
    const next = vi.fn()
    const ctx = makeCtx({
      inbound: {
        ...makeCtx().inbound,
        text: '@OWO 帮我看看'
      } as any,
      commandText: '@OWO 帮我看看'
    })

    await availabilityGateMiddleware(ctx, next)
    await availabilityGateMiddleware(ctx, next)

    expect(next).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledTimes(1)
    expect(ctx.reply).toHaveBeenCalledWith('我现在下班啦。')
    expect(appendChannelOffhourBacklog).toHaveBeenCalledTimes(2)
    expect(consumeChannelReplyThrottle).toHaveBeenCalledWith(expect.objectContaining({
      throttleKey: expect.stringContaining('off-hours'),
      policyType: 'off_hours_notice',
      channelLinkName: 'wan-ke-chat',
      actorAccountId: 'ou_1',
      windowMs: 20 * 60 * 1000
    }))
  })

  it('replies for direct messages after hours without creating a session', async () => {
    setAvailabilityNowProviderForTests(() => new Date('2026-06-15T13:30:00.000Z'))
    const next = vi.fn()
    const ctx = makeCtx({
      inbound: {
        channelType: 'lark',
        channelId: 'ou_1',
        sessionType: 'direct',
        messageId: 'om_1',
        senderId: 'ou_1',
        text: 'hi',
        raw: {}
      } as any,
      commandText: 'hi'
    })

    await availabilityGateMiddleware(ctx, next)

    expect(next).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith('我现在下班啦。')
    expect(appendChannelOffhourBacklog).toHaveBeenCalledWith(expect.objectContaining({
      channelType: 'lark',
      channelId: 'ou_1',
      sessionType: 'direct',
      text: 'hi'
    }))
  })

  it('lets configured bypass senders work after hours', async () => {
    setAvailabilityNowProviderForTests(() => new Date('2026-06-15T13:30:00.000Z'))
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      actor: {
        account: {
          issuerKey: 'lark:default',
          channelType: 'lark',
          accountId: 'ou_1',
          accountKey: 'lark:default:ou_1',
          displayName: null,
          avatarUrl: null,
          metadata: null,
          createdAt: 1,
          updatedAt: 1
        }
      },
      channelLink: {
        ...makeCtx().channelLink!,
        availability: {
          ...makeCtx().channelLink!.availability,
          bypassSenders: [{ accountId: 'ou_1', issuerKey: 'lark:default' }]
        }
      }
    })

    await availabilityGateMiddleware(ctx, next)

    expect(next).toHaveBeenCalledOnce()
    expect(ctx.reply).not.toHaveBeenCalled()
    expect(appendChannelOffhourBacklog).not.toHaveBeenCalled()
  })

  it('lets configured canonical users work after hours', async () => {
    setAvailabilityNowProviderForTests(() => new Date('2026-06-15T13:30:00.000Z'))
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      actor: {
        account: {
          issuerKey: 'lark:default',
          channelType: 'lark',
          accountId: 'ou_1',
          accountKey: 'lark:ou_1',
          displayName: null,
          avatarUrl: null,
          metadata: null,
          createdAt: 1,
          updatedAt: 1
        },
        user: {
          id: 'user-yijie',
          displayName: '一介',
          createdAt: 1,
          updatedAt: 1
        },
        identityLink: {
          issuerKey: 'lark:default',
          channelType: 'lark',
          accountId: 'ou_1',
          userId: 'user-1',
          status: 'verified',
          source: null,
          createdAt: 1,
          updatedAt: 1
        }
      },
      channelLink: {
        ...makeCtx().channelLink!,
        availability: {
          ...makeCtx().channelLink!.availability,
          bypassUsers: ['user-yijie']
        }
      }
    })

    await availabilityGateMiddleware(ctx, next)

    expect(next).toHaveBeenCalledOnce()
    expect(ctx.reply).not.toHaveBeenCalled()
    expect(appendChannelOffhourBacklog).not.toHaveBeenCalled()
  })

  it('does not treat a matching raw account id from another issuer as an availability bypass', async () => {
    setAvailabilityNowProviderForTests(() => new Date('2026-06-15T13:30:00.000Z'))
    const next = vi.fn()
    const ctx = makeCtx({
      actor: {
        account: {
          issuerKey: 'lark:other',
          channelType: 'lark',
          accountId: 'ou_1',
          accountKey: 'lark:other:ou_1',
          displayName: null,
          avatarUrl: null,
          metadata: null,
          createdAt: 1,
          updatedAt: 1
        }
      },
      channelLink: {
        ...makeCtx().channelLink!,
        availability: {
          ...makeCtx().channelLink!.availability,
          bypassAccounts: [{ accountId: 'ou_1', issuerKey: 'lark:default' }]
        }
      }
    })

    await availabilityGateMiddleware(ctx, next)

    expect(next).not.toHaveBeenCalled()
  })

  it('lets slash commands pass after hours', async () => {
    setAvailabilityNowProviderForTests(() => new Date('2026-06-15T13:30:00.000Z'))
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      inbound: { ...makeCtx().inbound, text: '/availability status' } as any,
      commandText: '/availability status'
    })

    await availabilityGateMiddleware(ctx, next)

    expect(next).toHaveBeenCalledOnce()
    expect(ctx.reply).not.toHaveBeenCalled()
    expect(appendChannelOffhourBacklog).not.toHaveBeenCalled()
  })

  it("does not let another bot's slash command bypass off-hours handling", async () => {
    setAvailabilityNowProviderForTests(() => new Date('2026-06-15T13:30:00.000Z'))
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      inbound: {
        ...makeCtx().inbound,
        mentionedBot: false,
        text: '<at type="lark" user_id="ou_other">Other</at> /availability status'
      } as any,
      commandText: '/availability status'
    })

    await availabilityGateMiddleware(ctx, next)

    expect(next).not.toHaveBeenCalled()
    expect(ctx.reply).not.toHaveBeenCalled()
    expect(appendChannelOffhourBacklog).not.toHaveBeenCalled()
  })
})
