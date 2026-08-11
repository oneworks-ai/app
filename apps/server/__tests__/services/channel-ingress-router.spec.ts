import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChannelContext } from '#~/channels/middleware/@types/index.js'
import { ingressRouterMiddleware } from '#~/channels/middleware/ingress-router.js'

import {
  routeInboundChannelMessage,
  setChannelIngressGlobalRouteResolverForTests,
  setRouterModelInvokerForTests
} from '#~/services/channel-ingress-router/index.js'
import { resolveChannelIngressRoute } from '#~/services/channel-ingress-router/route.js'

const db = vi.hoisted(() => ({
  createChannelIngressRouterRun: vi.fn(input => ({ ...input, id: 'router-run-1' })),
  appendChannelConversationTurn: vi.fn(),
  ensureChannelConversationState: vi.fn(() => ({ id: 'ambient-state' })),
  getChannelConversationStateByLastBotReply: vi.fn(),
  getChannelConversationStateByThread: vi.fn(),
  listRecentChannelConversationTurns: vi.fn(() => []),
  listOpenChannelPendingIntents: vi.fn<
    () => Array<
      {
        approverUserIds: string[]
        channelId: string
        entity: string
        expiresAt: number
        ownerAccountId: string
        ownerUserId: string | null
      }
    >
  >(() => [])
}))

vi.mock('#~/db/index.js', () => ({ getDb: () => db }))

const makeContext = (overrides: Partial<ChannelContext> = {}): ChannelContext => ({
  channelAdapter: undefined,
  channelEffort: undefined,
  channelKey: 'issuer-a',
  channelPermissionMode: undefined,
  channelLink: {
    channelKey: 'issuer-a',
    definition: {} as never,
    entity: 'bot',
    external: { type: 'group' },
    ingress: {
      ambientRouting: false,
      createOnCommand: true,
      createOnMention: true,
      createOnPendingIntent: true,
      createOnReplyToBot: true
    },
    name: 'link',
    path: '/workspace/.oo/channels/link/channel.json',
    routing: {
      accounts: {},
      default: { adapter: 'gemini', model: 'gemini-2.5', visibility: 'public' },
      modes: {},
      users: {}
    }
  },
  commandText: 'hello',
  config: { commandPrefix: '/', type: 'lark' },
  connection: undefined,
  contentItems: undefined,
  defineMessages: vi.fn(),
  getBoundSession: vi.fn(),
  bindSession: vi.fn(() => ({ alreadyBound: false })),
  getChannelAdapterPreference: vi.fn(),
  getChannelEffortPreference: vi.fn(),
  getChannelPermissionModePreference: vi.fn(),
  inbound: {
    channelId: 'chat-1',
    channelType: 'lark',
    messageId: 'message-1',
    raw: {},
    senderId: 'account-1',
    sessionType: 'group',
    text: 'hello'
  },
  pushFollowUps: vi.fn(),
  reply: vi.fn(),
  resetSession: vi.fn(),
  resolveSessionWorkspace: vi.fn(),
  restartSession: vi.fn(),
  searchSessions: vi.fn(() => []),
  sessionId: undefined,
  setChannelAdapterPreference: vi.fn(),
  setChannelEffortPreference: vi.fn(),
  setChannelPermissionModePreference: vi.fn(),
  stopSession: vi.fn(),
  t: vi.fn(),
  unbindSession: vi.fn(),
  updateSession: vi.fn(),
  ...overrides
})

describe('channel ingress router', () => {
  afterEach(() => {
    db.createChannelIngressRouterRun.mockClear()
    db.appendChannelConversationTurn.mockClear()
    db.getChannelConversationStateByLastBotReply.mockReset()
    db.getChannelConversationStateByThread.mockReset()
    db.getChannelConversationStateByThread.mockReturnValue(undefined)
    db.listOpenChannelPendingIntents.mockReset()
    db.listOpenChannelPendingIntents.mockReturnValue([])
    setChannelIngressGlobalRouteResolverForTests(undefined)
    setRouterModelInvokerForTests(undefined)
  })

  it('enforces route precedence without accepting unverified or cross-issuer account overrides', () => {
    setChannelIngressGlobalRouteResolverForTests(() => ({
      adapter: 'global',
      model: 'global-model',
      visibility: 'none'
    }))
    const context = makeContext({
      actor: {
        account: { accountId: 'same-id', issuerKey: 'issuer-a' },
        identityLink: { status: 'verified' },
        user: { id: 'user-1' }
      } as ChannelContext['actor'],
      channelLink: {
        ...makeContext().channelLink!,
        routing: {
          accounts: { 'issuer-a': { 'same-id': { adapter: 'account', model: 'account-model' } } },
          default: { adapter: 'default', model: 'default-model' },
          modes: { reply: { model: 'mode-model', visibility: 'dm' } },
          users: { 'user-1': { adapter: 'user', model: 'user-model' } }
        }
      }
    })
    expect(resolveChannelIngressRoute(context, 'reply')).toMatchObject({
      adapter: 'account',
      model: 'account-model',
      mode: 'reply',
      visibility: 'dm'
    })

    const unverified = makeContext({
      actor: {
        account: { accountId: 'same-id', issuerKey: 'issuer-a' },
        identityLink: { status: 'pending' },
        user: { id: 'user-1' }
      } as ChannelContext['actor'],
      channelLink: context.channelLink
    })
    expect(resolveChannelIngressRoute(unverified, 'reply')).toMatchObject({
      adapter: 'account',
      model: 'account-model'
    })

    const otherIssuer = makeContext({
      actor: {
        account: { accountId: 'same-id', issuerKey: 'issuer-b' },
        identityLink: { status: 'verified' },
        user: { id: 'user-1' }
      } as ChannelContext['actor'],
      channelLink: context.channelLink
    })
    expect(resolveChannelIngressRoute(otherIssuer, 'reply')).toMatchObject({ adapter: 'user', model: 'user-model' })
  })

  it('covers deterministic mention, reply, pending intent, command, and direct-message semantics', async () => {
    await expect(
      routeInboundChannelMessage(makeContext({ inbound: { ...makeContext().inbound, mentionedBot: false } }))
    )
      .resolves.toMatchObject({ decision: { decision: 'ignore', reason: 'mentioned_other_bot' } })
    await expect(routeInboundChannelMessage(makeContext({ inbound: { ...makeContext().inbound, mentionedBot: true } })))
      .resolves.toMatchObject({ decision: { decision: 'create_child', reason: 'current_bot_mention' } })

    db.getChannelConversationStateByLastBotReply.mockReturnValue({ entity: 'bot' })
    await expect(
      routeInboundChannelMessage(makeContext({ inbound: { ...makeContext().inbound, replyMessageId: 'bot-message' } }))
    )
      .resolves.toMatchObject({ decision: { decision: 'create_child', reason: 'reply_to_current_bot' } })

    db.getChannelConversationStateByLastBotReply.mockReturnValue(undefined)
    db.listOpenChannelPendingIntents.mockReturnValue([{
      approverUserIds: [],
      channelId: 'chat-1',
      entity: 'bot',
      expiresAt: Date.now() + 1_000,
      ownerAccountId: 'account-1',
      ownerUserId: null
    }])
    await expect(routeInboundChannelMessage(makeContext())).resolves.toMatchObject({
      decision: { decision: 'create_child', reason: 'owned_pending_intent' }
    })

    db.listOpenChannelPendingIntents.mockReturnValue([])
    await expect(routeInboundChannelMessage(makeContext({ commandText: '/status' }))).resolves.toMatchObject({
      decision: { decision: 'create_child', reason: 'channel_command' }
    })
    await expect(routeInboundChannelMessage(makeContext({
      inbound: { ...makeContext().inbound, sessionType: 'direct' }
    }))).resolves.toMatchObject({ decision: { decision: 'create_child', reason: 'direct_message' } })
  })

  it('fails closed for expired or raw approver-only pending intents and model privileged modes', async () => {
    db.listOpenChannelPendingIntents.mockReturnValue([
      {
        approverUserIds: [],
        channelId: 'chat-1',
        entity: 'bot',
        expiresAt: Date.now() - 1,
        ownerAccountId: 'account-1',
        ownerUserId: null
      },
      {
        approverUserIds: ['account-1'],
        channelId: 'chat-1',
        entity: 'bot',
        expiresAt: Date.now() + 1_000,
        ownerAccountId: 'other',
        ownerUserId: null
      }
    ])
    await expect(routeInboundChannelMessage(makeContext())).resolves.toMatchObject({
      decision: { decision: 'observe', reason: 'ambient_routing_disabled' }
    })

    setRouterModelInvokerForTests({
      invoke: vi.fn().mockResolvedValue({
        latencyMs: 1,
        ok: true,
        output: { confidence: 1, decision: 'create_child', mode: 'admin', reason: 'unsafe' }
      })
    })
    const ambientContext = makeContext({
      channelLink: {
        ...makeContext().channelLink!,
        ingress: { ...makeContext().channelLink!.ingress, ambientRouting: true },
        routing: { ...makeContext().channelLink!.routing, modes: { admin: { model: 'gemini-2.5' } } }
      }
    })
    await expect(routeInboundChannelMessage(ambientContext)).resolves.toMatchObject({
      decision: { decision: 'observe', reason: 'router_mode_not_authorized' }
    })
  })

  it('uses a dedicated router adapter without changing the child-session route', async () => {
    const invoke = vi.fn().mockResolvedValue({
      latencyMs: 1,
      ok: true,
      output: { confidence: 0.9, decision: 'create_child', mode: 'reply', reason: 'ambient_request' }
    })
    setRouterModelInvokerForTests({ invoke })
    const context = makeContext({
      channelLink: {
        ...makeContext().channelLink!,
        ingress: {
          ...makeContext().channelLink!.ingress,
          ambientRouting: true,
          routerAdapter: 'gemini',
          routerModel: 'gemini-2.5-flash'
        },
        routing: {
          ...makeContext().channelLink!.routing,
          default: { adapter: 'codex', model: 'gpt-5.6-luna' }
        }
      }
    })

    await expect(routeInboundChannelMessage(context)).resolves.toMatchObject({
      decision: { decision: 'create_child' },
      route: { adapter: 'codex', model: 'gpt-5.6-luna' }
    })
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'gemini',
      model: 'gemini-2.5-flash'
    }))
  })

  it('audits every pipeline decision and only continues create_child', async () => {
    const next = vi.fn().mockResolvedValue(undefined)

    await ingressRouterMiddleware(makeContext({ inbound: { ...makeContext().inbound, mentionedBot: false } }), next)
    await ingressRouterMiddleware(makeContext(), next)
    await ingressRouterMiddleware(makeContext({ inbound: { ...makeContext().inbound, mentionedBot: true } }), next)

    setRouterModelInvokerForTests({
      invoke: vi.fn().mockResolvedValue({
        latencyMs: 1,
        ok: true,
        output: { confidence: 1, decision: 'defer', reason: 'later' }
      })
    })
    await ingressRouterMiddleware(
      makeContext({
        channelLink: {
          ...makeContext().channelLink!,
          ingress: { ...makeContext().channelLink!.ingress, ambientRouting: true }
        }
      }),
      next
    )

    expect(next).toHaveBeenCalledTimes(1)
    expect(db.createChannelIngressRouterRun.mock.calls.map(([input]) => input.decision))
      .toEqual(['ignore', 'observe', 'create_child', 'defer'])
    expect(db.appendChannelConversationTurn).toHaveBeenCalledTimes(2)
  })

  it('fails closed for an unbound direct message but preserves unbound group handling', async () => {
    const next = vi.fn().mockResolvedValue(undefined)

    await ingressRouterMiddleware(
      makeContext({
        channelLink: undefined,
        inbound: { ...makeContext().inbound, sessionType: 'direct' }
      }),
      next
    )
    expect(next).not.toHaveBeenCalled()

    await ingressRouterMiddleware(makeContext({ channelLink: undefined }), next)
    expect(next).toHaveBeenCalledOnce()
  })
})
