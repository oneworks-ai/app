import { describe, expect, it, vi } from 'vitest'

import type { ChannelContext } from '#~/channels/middleware/@types/index.js'
import { createT, defineMessages } from '#~/channels/middleware/i18n.js'
import { ingressGateMiddleware } from '#~/channels/middleware/ingress-gate.js'

const makeCtx = (overrides: Partial<ChannelContext> = {}): ChannelContext => ({
  channelKey: 'lark-main',
  inbound: {
    channelType: 'lark',
    channelId: 'oc_123',
    sessionType: 'group',
    messageId: 'om_1',
    senderId: 'ou_1',
    text: '路过闲聊',
    raw: {}
  } as any,
  connection: undefined,
  config: { type: 'lark' } as any,
  channelLink: {
    channelKey: 'lark-main',
    entity: 'owo-demo',
    external: { type: 'chat', chatId: 'oc_123' },
    ingress: {
      ambientRouting: false,
      createOnCommand: true,
      createOnMention: true,
      createOnPendingIntent: true,
      createOnReplyToBot: true
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
  commandText: '路过闲聊',
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

describe('ingressGateMiddleware', () => {
  it('blocks ordinary group messages when ambient routing is disabled', async () => {
    const next = vi.fn()

    await ingressGateMiddleware(makeCtx(), next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('still blocks ordinary group messages for an existing bound session', async () => {
    const next = vi.fn()

    await ingressGateMiddleware(makeCtx({ sessionId: 'sess-1' }), next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('allows group messages without a channel link', async () => {
    const next = vi.fn().mockResolvedValue(undefined)

    await ingressGateMiddleware(makeCtx({ channelLink: undefined }), next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('allows direct messages even when ambient routing is disabled', async () => {
    const next = vi.fn().mockResolvedValue(undefined)

    await ingressGateMiddleware(
      makeCtx({
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
      }),
      next
    )

    expect(next).toHaveBeenCalledOnce()
  })

  it('allows slash commands', async () => {
    const next = vi.fn().mockResolvedValue(undefined)

    await ingressGateMiddleware(
      makeCtx({
        inbound: { ...makeCtx().inbound, text: '/status' } as any,
        commandText: '/status'
      }),
      next
    )

    expect(next).toHaveBeenCalledOnce()
  })

  it('blocks group slash commands when structured metadata targets another bot', async () => {
    const next = vi.fn().mockResolvedValue(undefined)

    await ingressGateMiddleware(
      makeCtx({
        inbound: { ...makeCtx().inbound, mentionedBot: false, text: '/status' } as any,
        commandText: '/status'
      }),
      next
    )

    expect(next).toHaveBeenCalledOnce()
  })

  it('allows messages that explicitly mention the bot with a leading at tag', async () => {
    const next = vi.fn().mockResolvedValue(undefined)

    await ingressGateMiddleware(
      makeCtx({
        inbound: {
          ...makeCtx().inbound,
          text: '[ou_1]:\n<at type="lark" user_id="ou_bot">OWO</at> 帮我看看'
        } as any,
        commandText: '帮我看看'
      }),
      next
    )

    expect(next).toHaveBeenCalledOnce()
  })

  it('blocks leading at tags that structured metadata identifies as another bot', async () => {
    const next = vi.fn().mockResolvedValue(undefined)

    await ingressGateMiddleware(
      makeCtx({
        inbound: {
          ...makeCtx().inbound,
          mentionedBot: false,
          text: '[ou_1]:\n<at type="lark" user_id="ou_other">Other</at> 帮我看看'
        } as any,
        commandText: '帮我看看'
      }),
      next
    )

    expect(next).toHaveBeenCalledOnce()
  })

  it('blocks structured mentions of another bot even when ambient routing is enabled', async () => {
    const next = vi.fn().mockResolvedValue(undefined)

    await ingressGateMiddleware(
      makeCtx({
        channelLink: {
          ...makeCtx().channelLink!,
          ingress: {
            ambientRouting: true,
            createOnCommand: true,
            createOnMention: true,
            createOnPendingIntent: true,
            createOnReplyToBot: true
          }
        },
        inbound: {
          ...makeCtx().inbound,
          mentionedBot: false,
          text: '<at type="lark" user_id="ou_other">Other</at> 帮我看看'
        } as any
      }),
      next
    )

    expect(next).toHaveBeenCalledOnce()
  })

  it('allows a structured mention of the current bot without relying on rendered text', async () => {
    const next = vi.fn().mockResolvedValue(undefined)

    await ingressGateMiddleware(
      makeCtx({
        inbound: {
          ...makeCtx().inbound,
          mentionedBot: true,
          text: '平台未渲染 at 标签'
        } as any,
        commandText: '平台未渲染 at 标签'
      }),
      next
    )

    expect(next).toHaveBeenCalledOnce()
  })

  it('allows configured mention patterns for platforms without structured at tags', async () => {
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx()

    await ingressGateMiddleware(
      makeCtx({
        channelLink: {
          ...ctx.channelLink!,
          ingress: {
            ambientRouting: false,
            createOnCommand: true,
            createOnMention: true,
            createOnPendingIntent: true,
            createOnReplyToBot: true,
            mentionPatterns: ['@OWO']
          }
        },
        inbound: { ...ctx.inbound, text: '@OWO 帮我看看' } as any,
        commandText: '@OWO 帮我看看'
      }),
      next
    )

    expect(next).toHaveBeenCalledOnce()
  })

  it('allows ordinary group messages when ambient routing is enabled', async () => {
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx()

    await ingressGateMiddleware(
      makeCtx({
        channelLink: {
          ...ctx.channelLink!,
          ingress: {
            ambientRouting: true,
            createOnCommand: true,
            createOnMention: true,
            createOnPendingIntent: true,
            createOnReplyToBot: true
          }
        }
      }),
      next
    )

    expect(next).toHaveBeenCalledOnce()
  })
})
