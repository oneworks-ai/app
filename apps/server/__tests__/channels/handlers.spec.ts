import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleInboundEvent, handleSessionEvent } from '#~/channels/handlers.js'
import { buildInteractionText } from '#~/channels/interaction.js'
import { buildChannelSessionStopEvent } from '#~/channels/session-delivery.js'
import { consumePendingUnack, deleteBinding, setBinding, setPendingUnack } from '#~/channels/state.js'
import { getDb } from '#~/db/index.js'
import {
  ensureChannelAuthorizationRequestForInteraction,
  markChannelAuthorizationRequestDelivered,
  releaseChannelAuthorizationRequestDelivery,
  reserveChannelAuthorizationRequestDelivery
} from '#~/services/channel-authorizations/index.js'
import { evaluateInboundPolicy } from '#~/services/channel-policy/index.js'
import { startAdapterSession } from '#~/services/session/index.js'
import {
  clearSessionInteraction,
  getSessionInteraction,
  setSessionInteraction
} from '#~/services/session/interaction.js'
import { createSessionConnectionState, externalSessionStore } from '#~/services/session/runtime.js'

const listChannelAccountsForUser = vi.hoisted(() => vi.fn())
const getChannelSession = vi.hoisted(() => vi.fn())
const createChannelCommandRun = vi.hoisted(() => vi.fn(() => ({ id: 'cmd-run-1' })))
const createChannelIngressRouterRun = vi.hoisted(() => vi.fn(input => ({ ...input, id: 'router-run-1' })))
const bridgeInboundGroupMessageToAgentRooms = vi.hoisted(() => vi.fn().mockResolvedValue(false))

vi.mock('#~/channels/agent-room-bridge.js', () => ({
  bridgeInboundGroupMessageToAgentRooms
}))

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn(() => ({
    createChannelCommandRun,
    createChannelIngressRouterRun,
    consumeChannelReplyThrottle: vi.fn(() => true),
    deleteChannelMessagesSeenBefore: vi.fn(),
    appendChannelConversationTurn: vi.fn(),
    ensureChannelConversationState: vi.fn(() => ({ id: 'conversation-1' })),
    finishChannelCommandRun: vi.fn(),
    forgetChannelMessage: vi.fn(),
    getChannelConversationStateByLastBotReply: vi.fn(),
    getChannelConversationStateByThread: vi.fn(),
    getChannelAvailabilityOverride: vi.fn(),
    getChannelIdentityLink: vi.fn(),
    getChannelPreference: vi.fn(),
    getChannelSession,
    getSession: vi.fn(),
    getChannelChildSessionRunBySessionId: vi.fn(),
    getSessionRuntimeState: vi.fn(),
    rememberChannelMessage: vi.fn(() => true),
    listOpenChannelPendingIntents: vi.fn(() => []),
    listChannelAccountsForUser,
    listRecentChannelConversationTurns: vi.fn(() => []),
    resolveCanonicalUserByChannelAccount: vi.fn(),
    updateSessionArchivedWithChildren: vi.fn(() => []),
    deleteChannelSessionBySessionId: vi.fn(),
    upsertChannelPreference: vi.fn(),
    updateSession: vi.fn(),
    upsertChannelAccount: vi.fn(input => ({
      ...input,
      accountKey: `${input.channelType}:${input.accountId}`,
      createdAt: 1,
      updatedAt: 1
    }))
  }))
}))

vi.mock('#~/services/session/index.js', () => ({
  killSession: vi.fn(),
  processUserMessage: vi.fn(),
  startAdapterSession: vi.fn()
}))

vi.mock('#~/services/channel-authorizations/index.js', () => ({
  ensureChannelAuthorizationRequestForInteraction: vi.fn(),
  markChannelAuthorizationRequestDelivered: vi.fn(),
  releaseChannelAuthorizationRequestDelivery: vi.fn(),
  reserveChannelAuthorizationRequestDelivery: vi.fn(() => ({ reservedAt: 1_000 }))
}))

vi.mock('#~/services/channel-policy/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('#~/services/channel-policy/index.js')>(),
  evaluateInboundPolicy: vi.fn()
}))

vi.mock('#~/services/session/runtime.js', async () => {
  const actual = await vi.importActual<typeof import('#~/services/session/runtime.js')>(
    '#~/services/session/runtime.js'
  )
  return {
    ...actual,
    notifySessionUpdated: vi.fn()
  }
})

vi.mock('#~/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  },
  getSessionLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn()
  }))
}))

const bindTestSession = (overrides: Record<string, unknown> = {}) => {
  setBinding('sess-1', {
    channelType: 'lark',
    channelKey: 'test',
    channelId: 'chat_1',
    sessionType: 'direct',
    replyReceiveId: 'chat_1',
    replyReceiveIdType: 'chat_id',
    ...overrides
  })
}

const makeRuntimeState = (
  input: {
    channelLinks?: unknown[]
    channelType?: string
    sendMessage?: ReturnType<typeof vi.fn>
    sendPrivateMessage?: ReturnType<typeof vi.fn>
    updateMessage?: ReturnType<typeof vi.fn>
    pushFollowUps?: ReturnType<typeof vi.fn>
    language?: 'zh' | 'en'
  } = {}
) =>
  new Map([
    ['test', {
      key: 'test',
      type: input.channelType ?? 'lark',
      status: 'connected',
      config: {
        type: input.channelType ?? 'lark',
        language: input.language ?? 'zh'
      },
      connection: {
        sendMessage: input.sendMessage ?? vi.fn().mockResolvedValue({ messageId: 'om_default' }),
        sendPrivateMessage: input.sendPrivateMessage,
        updateMessage: input.updateMessage,
        pushFollowUps: input.pushFollowUps ?? vi.fn().mockResolvedValue(undefined)
      },
      channelLinks: input.channelLinks
    } as any]
  ])

const makeGroupChannelLink = (ingress: Record<string, unknown>) => ({
  channelKey: 'test',
  definition: {} as never,
  entity: 'owo-demo',
  external: { type: 'chat', chatId: 'chat_1' },
  ingress,
  name: 'wan-ke-chat',
  path: '/workspace/.oo/channels/wan-ke-chat/channel.json'
})

const makeInteractionRequestEvent = (
  payload: Record<string, unknown>,
  id = 'interaction-1'
) =>
  ({
    type: 'interaction_request',
    id,
    payload: {
      sessionId: 'sess-1',
      ...payload
    }
  }) as any

const makeMessageEvent = (
  role: 'assistant' | 'user',
  content: any,
  id = `msg_${Math.random().toString(36).slice(2)}`
) =>
  ({
    type: 'message',
    message: {
      id,
      role,
      content,
      createdAt: Date.now()
    }
  }) as any

const makeErrorEvent = (
  input: {
    message?: string
    code?: string
    fatal?: boolean
  } = {}
) =>
  ({
    type: 'error',
    data: {
      message: input.message ?? 'Invalid proxy metadata: upstreamBaseUrl must be a valid URL',
      code: input.code,
      fatal: input.fatal
    },
    message: input.message
  }) as any

const expectActionUrl = async (
  input: {
    url: string
    action: 'tool-call-detail' | 'tool-call-export'
    claims: Record<string, unknown>
  }
) => {
  const { verifyChannelActionToken } = await import('#~/channels/action-token.js')
  const parsed = new URL(input.url)
  expect(`${parsed.origin}${parsed.pathname}`).toBe(`http://localhost:8787/channels/actions/${input.action}`)
  expect(verifyChannelActionToken(parsed.searchParams.get('token') ?? '', input.action)).toEqual({
    ok: true,
    claims: expect.objectContaining(input.claims)
  })
}

describe('channel handlers', () => {
  it.each(
    [
      [
        'en',
        'Permission is required to use write_file.',
        'Always allow in Kiro (persistent)',
        'Kiro option: Ask Kiro'
      ],
      [
        'zh',
        '使用 write_file 需要权限。',
        '在 Kiro 中始终允许（持久）',
        'Kiro 原生选项：Ask Kiro'
      ]
    ] as const
  )('localizes structured Kiro permission semantics for %s channels', (
    language,
    question,
    persistentLabel,
    unknownLabel
  ) => {
    const text = buildInteractionText(language, {
      sessionId: 'sess-kiro',
      kind: 'permission',
      question: 'write_file',
      permissionContext: { adapter: 'kiro', subjectLabel: 'write_file' },
      options: [
        {
          label: 'Always allow',
          value: 'native-allow-always',
          permission: { adapterLabel: 'Kiro', semantic: 'allow_persistent' }
        },
        {
          label: 'Ask Kiro',
          value: 'native-future',
          permission: {
            adapterLabel: 'Kiro',
            nativeLabel: 'Ask Kiro',
            semantic: 'native_unknown'
          }
        }
      ]
    })

    expect(text).toContain(question)
    expect(text).toContain(persistentLabel)
    expect(text).toContain(unknownLabel)
    expect(text).not.toContain('Always allow:')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    bridgeInboundGroupMessageToAgentRooms.mockResolvedValue(false)
    vi.mocked(reserveChannelAuthorizationRequestDelivery).mockReturnValue({ reservedAt: 1_000 })
    getChannelSession.mockReturnValue(undefined)
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ACTION_SECRET__', 'test-secret')
    deleteBinding('sess-1')
    consumePendingUnack('sess-1')
  })

  afterEach(() => {
    deleteBinding('sess-1')
    consumePendingUnack('sess-1')
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('records and drops messages that structurally mention another bot before commands or pipeline side effects', async () => {
    const ack = vi.fn().mockResolvedValue(undefined)
    const unack = vi.fn().mockResolvedValue(undefined)
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_unexpected' })

    await handleInboundEvent(
      'test',
      {
        channelType: 'lark',
        sessionType: 'group',
        channelId: 'chat_1',
        messageId: 'om_other_bot',
        senderId: 'user_1',
        text: '/help',
        mentionedBot: false,
        ack,
        unack,
        raw: {}
      },
      { sendMessage } as any,
      {
        type: 'lark',
        access: { admins: ['admin_1'] }
      },
      'project',
      [makeGroupChannelLink({ ambientRouting: false })] as any
    )

    expect(ack).not.toHaveBeenCalled()
    expect(unack).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(createChannelCommandRun).not.toHaveBeenCalled()
    expect(createChannelIngressRouterRun).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'chat_1',
      channelKey: 'test',
      decision: 'ignore',
      messageId: 'om_other_bot',
      reason: 'mentioned_other_bot',
      senderId: 'user_1',
      sessionType: 'group'
    }))
  })

  it('lets the owning channel bridge a shared provider event after a non-owning channel declines it', async () => {
    const event = {
      channelType: 'lark' as const,
      sessionType: 'group' as const,
      channelId: 'chat_shared',
      messageId: 'om_shared_bridge',
      senderId: 'user_1',
      text: 'shared group message',
      mentionedBot: false,
      raw: {}
    }
    bridgeInboundGroupMessageToAgentRooms
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    await handleInboundEvent('lark:non-owner', event, undefined, { type: 'lark' }, 'project', [], [])
    await handleInboundEvent('lark:owner', event, undefined, { type: 'lark' }, 'project', [], [])

    expect(bridgeInboundGroupMessageToAgentRooms).toHaveBeenCalledTimes(2)
  })

  it('does not execute admin commands for a synthetic administrator scenario', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_unexpected' })

    await handleInboundEvent(
      'test',
      {
        channelType: 'oneworks',
        sessionType: 'direct',
        channelId: 'simulation-user',
        messageId: 'simulation-admin-command',
        senderId: 'oneworks-simulation:isolated',
        synthetic: {
          actorRole: 'admin',
          kind: 'product_simulation',
          userLabel: 'Scenario Admin'
        },
        text: '/access',
        raw: {}
      },
      { sendMessage } as any,
      { type: 'oneworks', access: { admins: ['real-admin'], allowPrivateChat: false } },
      'project',
      [{
        channelKey: 'test',
        definition: {} as never,
        entity: 'owo-demo',
        external: { accountId: 'oneworks-simulation:isolated', type: 'direct' },
        ingress: {
          ambientRouting: false,
          createOnCommand: true,
          createOnMention: true,
          createOnPendingIntent: true,
          createOnReplyToBot: true
        },
        name: 'simulation-direct-link',
        path: '/workspace/.oo/channels/simulation-direct/channel.json',
        routing: { accounts: {}, default: {}, modes: {}, users: {} }
      }] as any
    )

    expect(createChannelCommandRun).not.toHaveBeenCalled()
    expect(vi.mocked(startAdapterSession)).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('does not create a child session for an unbound direct message', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_unexpected' })

    await handleInboundEvent(
      'test',
      {
        channelType: 'lark',
        sessionType: 'direct',
        channelId: 'unbound-user',
        messageId: 'om_unbound_direct',
        senderId: 'unbound-user',
        text: 'hello',
        raw: {}
      },
      { sendMessage } as any,
      { type: 'lark', access: { admins: ['real-admin'], allowPrivateChat: true } },
      'project',
      []
    )

    expect(vi.mocked(startAdapterSession)).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('short-circuits a muted subject in the real pipeline before router or child creation', async () => {
    vi.mocked(evaluateInboundPolicy).mockResolvedValue({
      kind: 'drop',
      state: { mutedUntil: null, policyKey: 'policy-1', reason: 'spam', state: 'muted_permanent' } as any
    })
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_policy' })

    await handleInboundEvent(
      'test',
      {
        channelType: 'lark',
        sessionType: 'direct',
        channelId: 'user_1',
        messageId: 'om_muted',
        senderId: 'user_1',
        text: 'help',
        raw: {}
      },
      { sendMessage } as any,
      { type: 'lark', access: { admins: ['admin_1'] } },
      'project',
      [{
        channelKey: 'test',
        definition: {} as never,
        entity: 'owo-demo',
        external: { accountId: 'user_1', type: 'direct' },
        ingress: {
          ambientRouting: true,
          createOnCommand: true,
          createOnMention: true,
          createOnPendingIntent: true,
          createOnReplyToBot: true
        },
        moderation: { enabled: true },
        name: 'direct-link',
        path: '/workspace/.oo/channels/direct/channel.json',
        routing: { accounts: {}, default: {}, modes: {}, users: {} }
      }] as any
    )

    expect(evaluateInboundPolicy).toHaveBeenCalledOnce()
    expect(vi.mocked(getDb).mock.results[0]?.value.createChannelIngressRouterRun).not.toHaveBeenCalled()
    expect(vi.mocked(startAdapterSession)).not.toHaveBeenCalled()
  })

  it('does not execute a bare group command when command intent is disabled', async () => {
    const ack = vi.fn().mockResolvedValue(undefined)
    const unack = vi.fn().mockResolvedValue(undefined)
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_unexpected' })

    await handleInboundEvent(
      'test',
      {
        channelType: 'lark',
        sessionType: 'group',
        channelId: 'chat_1',
        messageId: 'om_bare_disabled',
        senderId: 'admin_1',
        text: '/help',
        ack,
        unack,
        raw: {}
      },
      { sendMessage } as any,
      { type: 'lark', access: { admins: ['admin_1'] } },
      'project',
      [makeGroupChannelLink({ ambientRouting: false, createOnCommand: false })] as any
    )

    expect(ack).not.toHaveBeenCalled()
    expect(unack).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('executes a group command when command intent is enabled', async () => {
    const ack = vi.fn().mockResolvedValue(undefined)
    const unack = vi.fn().mockResolvedValue(undefined)
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_help' })

    await handleInboundEvent(
      'test',
      {
        channelType: 'lark',
        sessionType: 'group',
        channelId: 'chat_1',
        messageId: 'om_bare_enabled',
        senderId: 'admin_1',
        text: '/help',
        ack,
        unack,
        raw: {}
      },
      { sendMessage } as any,
      { type: 'lark', access: { admins: ['admin_1'] } },
      'project',
      [makeGroupChannelLink({ ambientRouting: false, createOnCommand: true })] as any
    )

    expect(ack).toHaveBeenCalledOnce()
    expect(unack).toHaveBeenCalledOnce()
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('/help') }))
  })

  it('executes a mentioned group command even when bare command intent is disabled', async () => {
    const ack = vi.fn().mockResolvedValue(undefined)
    const unack = vi.fn().mockResolvedValue(undefined)
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_help' })

    await handleInboundEvent(
      'test',
      {
        channelType: 'lark',
        sessionType: 'group',
        channelId: 'chat_1',
        messageId: 'om_mentioned_enabled',
        senderId: 'admin_1',
        text: '/help',
        mentionedBot: true,
        ack,
        unack,
        raw: {}
      },
      { sendMessage } as any,
      { type: 'lark', access: { admins: ['admin_1'] } },
      'project',
      [makeGroupChannelLink({ ambientRouting: false, createOnCommand: false })] as any
    )

    expect(ack).toHaveBeenCalledOnce()
    expect(unack).toHaveBeenCalledOnce()
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('/help') }))
  })

  it('executes a registered command before treating the message as a pending interaction response', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_help' })
    externalSessionStore.set('sess-pending', createSessionConnectionState())
    getChannelSession.mockReturnValue({
      channelId: 'chat_1',
      channelKey: 'test',
      channelType: 'lark',
      replyReceiveId: 'chat_1',
      replyReceiveIdType: 'chat_id',
      senderId: 'admin_1',
      sessionId: 'sess-pending',
      sessionType: 'group'
    })
    setSessionInteraction('sess-pending', {
      id: 'interaction-pending',
      payload: {
        kind: 'permission',
        options: [{ label: 'Allow once', value: 'allow_once' }],
        question: 'Allow this operation?',
        sessionId: 'sess-pending'
      }
    })

    try {
      await handleInboundEvent(
        'test',
        {
          channelType: 'lark',
          sessionType: 'group',
          channelId: 'chat_1',
          messageId: 'om_help_while_pending',
          senderId: 'admin_1',
          text: '/help',
          mentionedBot: true,
          raw: {}
        },
        { sendMessage } as any,
        { type: 'lark', access: { admins: ['admin_1'] } },
        'project',
        [makeGroupChannelLink({ ambientRouting: false, createOnCommand: true })] as any
      )

      expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('/help') }))
      expect(getSessionInteraction('sess-pending')).toEqual(expect.objectContaining({ id: 'interaction-pending' }))
    } finally {
      clearSessionInteraction('sess-pending', 'interaction-pending')
      externalSessionStore.delete('sess-pending')
    }
  })

  it('delivers interaction requests to the bound channel and attaches quick actions', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_question' })
    const pushFollowUps = vi.fn().mockResolvedValue(undefined)
    const unack = vi.fn().mockResolvedValue(undefined)
    bindTestSession()
    setPendingUnack('sess-1', unack)

    const delivered = await handleSessionEvent(
      makeRuntimeState({ sendMessage, pushFollowUps }),
      'sess-1',
      makeInteractionRequestEvent({
        question: '晚上吃了什么？',
        options: [
          { label: '米饭', description: '主食' },
          { label: '面条' }
        ]
      })
    )

    expect(delivered).toBe(true)
    expect(unack).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      receiveId: 'chat_1',
      receiveIdType: 'chat_id',
      text: expect.stringContaining('晚上吃了什么？')
    }))
    expect(sendMessage.mock.calls[0]?.[0]?.text).toContain('米饭: 主食')
    expect(pushFollowUps).toHaveBeenCalledWith({
      messageId: 'om_question',
      followUps: [
        { content: '米饭' },
        { content: '面条' }
      ]
    })
    expect(markChannelAuthorizationRequestDelivered).not.toHaveBeenCalled()
  })

  it('formats permission interactions with context and quick actions', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_permission' })
    const pushFollowUps = vi.fn().mockResolvedValue(undefined)
    vi.mocked(ensureChannelAuthorizationRequestForInteraction).mockReturnValue({
      id: 'channel-interaction:sess-1:interaction-permission'
    } as any)
    bindTestSession({ senderId: 'user1' })
    const channelLink = {
      authorization: {
        deliveryThrottleMs: 5_000
      },
      channelKey: 'test',
      entity: 'owo-demo',
      external: {
        type: 'direct',
        senderId: 'user1'
      },
      name: 'wan-ke-dm',
      path: '/workspace/.oo/channels/wan-ke-dm/channel.json',
      definition: {} as never
    }
    const event = makeInteractionRequestEvent({
      kind: 'permission',
      question: '当前任务需要额外权限才能继续。是否授权后继续？',
      options: [
        { label: '继续并切换到 dontAsk', value: 'dontAsk', description: '尽量直接执行，不再额外询问。' },
        { label: '取消', value: 'cancel', description: '保持当前权限模式。' }
      ],
      permissionContext: {
        currentMode: 'default',
        suggestedMode: 'dontAsk',
        reasons: ['Write requires approval'],
        subjectKey: 'Write',
        subjectLabel: 'Write',
        scope: 'tool',
        projectConfigPath: '.oo.config.json'
      }
    }, 'interaction-permission')

    const delivered = await handleSessionEvent(
      makeRuntimeState({ channelLinks: [channelLink], sendMessage, pushFollowUps }),
      'sess-1',
      event
    )

    expect(delivered).toBe(true)
    expect(ensureChannelAuthorizationRequestForInteraction).toHaveBeenCalledWith({
      binding: expect.objectContaining({
        channelKey: 'test',
        senderId: 'user1'
      }),
      event,
      link: channelLink,
      sessionId: 'sess-1'
    })
    expect(markChannelAuthorizationRequestDelivered).toHaveBeenCalledWith({
      id: 'channel-interaction:sess-1:interaction-permission',
      delivery: 'dm',
      deliveryMessageId: 'om_permission',
      windowMs: 5_000
    })
    expect(reserveChannelAuthorizationRequestDelivery).toHaveBeenCalledWith({
      id: 'channel-interaction:sess-1:interaction-permission',
      windowMs: 5_000
    })
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      receiveId: 'chat_1',
      receiveIdType: 'chat_id',
      text: expect.stringContaining('[权限请求]')
    }))
    expect(sendMessage.mock.calls[0]?.[0]?.text).toContain('当前模式：default')
    expect(sendMessage.mock.calls[0]?.[0]?.text).toContain('建议模式：dontAsk')
    expect(sendMessage.mock.calls[0]?.[0]?.text).toContain('审批范围：Write')
    expect(sendMessage.mock.calls[0]?.[0]?.text).toContain('项目记忆文件：.oo.config.json')
    expect(sendMessage.mock.calls[0]?.[0]?.text).toContain('Write requires approval')
    expect(pushFollowUps).toHaveBeenCalledWith({
      messageId: 'om_permission',
      followUps: [
        { content: 'dontAsk' },
        { content: 'cancel' }
      ]
    })
  })

  it('delivers group permission prompts privately to a credential subject in the same issuer', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_public' })
    const sendPrivateMessage = vi.fn().mockResolvedValue({ messageId: 'om_dm' })
    listChannelAccountsForUser.mockReturnValue([{ accountId: 'ou_owner', issuerKey: 'test' }])
    vi.mocked(ensureChannelAuthorizationRequestForInteraction).mockReturnValue({
      channelKey: 'test',
      credentialSubjectUserId: 'user-owner',
      id: 'auth-owner',
      issuerKey: 'test',
      requesterAccountId: 'ou_requester',
      requesterUserId: 'user-requester'
    } as any)
    bindTestSession({ channelId: 'oc_1', senderId: 'ou_requester', sessionType: 'group' })

    await handleSessionEvent(
      makeRuntimeState({ sendMessage, sendPrivateMessage }),
      'sess-1',
      makeInteractionRequestEvent({ kind: 'permission', question: 'Owner approval is required.' })
    )

    expect(sendPrivateMessage).toHaveBeenCalledWith({ accountId: 'ou_owner', text: expect.any(String) })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(markChannelAuthorizationRequestDelivered).toHaveBeenCalledWith(expect.objectContaining({
      delivery: 'dm',
      deliveryMessageId: 'om_dm',
      id: 'auth-owner'
    }))
  })

  it('uses only a throttled safe public hint when a distinct owner lacks a same-issuer account', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_hint' })
    const sendPrivateMessage = vi.fn().mockResolvedValue({ messageId: 'om_unexpected' })
    listChannelAccountsForUser.mockReturnValue([{ accountId: 'ou_other', issuerKey: 'lark:other-team' }])
    vi.mocked(ensureChannelAuthorizationRequestForInteraction).mockReturnValue({
      channelKey: 'test',
      credentialSubjectUserId: 'user-owner',
      id: 'auth-owner',
      issuerKey: 'test',
      requesterAccountId: 'ou_requester',
      requesterUserId: 'user-requester'
    } as any)
    bindTestSession({ channelId: 'oc_1', senderId: 'ou_requester', sessionType: 'group' })

    await handleSessionEvent(
      makeRuntimeState({ sendMessage, sendPrivateMessage }),
      'sess-1',
      makeInteractionRequestEvent({ kind: 'permission', question: 'Owner secret scope is required.' })
    )

    expect(sendPrivateMessage).not.toHaveBeenCalled()
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: '有一项私密授权等待处理。请私聊机器人或打开 OneWorks 聊天室继续。'
    }))
    expect(sendMessage.mock.calls[0]?.[0]?.text).not.toContain('Owner secret scope')
    expect(markChannelAuthorizationRequestDelivered).toHaveBeenCalledWith(expect.objectContaining({
      delivery: 'public_hint',
      deliveryMessageId: 'om_hint',
      id: 'auth-owner'
    }))
  })

  it('suppresses repeated permission interaction delivery inside the authorization throttle window', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_permission' })
    const pushFollowUps = vi.fn().mockResolvedValue(undefined)
    vi.mocked(ensureChannelAuthorizationRequestForInteraction).mockReturnValue({
      id: 'channel-interaction:sess-1:interaction-permission'
    } as any)
    vi.mocked(reserveChannelAuthorizationRequestDelivery).mockReturnValue(undefined)
    bindTestSession({ senderId: 'user1' })

    const delivered = await handleSessionEvent(
      makeRuntimeState({ sendMessage, pushFollowUps }),
      'sess-1',
      makeInteractionRequestEvent({
        kind: 'permission',
        question: '当前任务需要额外权限才能继续。',
        options: [
          { label: '同意本次', value: 'allow_once' }
        ],
        permissionContext: {
          subjectKey: 'Write',
          subjectLabel: 'Write',
          scope: 'tool'
        }
      }, 'interaction-permission')
    )

    expect(delivered).toBe(true)
    expect(reserveChannelAuthorizationRequestDelivery).toHaveBeenCalledWith({
      id: 'channel-interaction:sess-1:interaction-permission',
      windowMs: undefined
    })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(pushFollowUps).not.toHaveBeenCalled()
    expect(markChannelAuthorizationRequestDelivered).not.toHaveBeenCalled()
  })

  it('releases an authorization delivery reservation when sending fails', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('offline'))
    vi.mocked(ensureChannelAuthorizationRequestForInteraction).mockReturnValue({ id: 'auth-1' } as any)
    bindTestSession({ senderId: 'user1' })

    await expect(handleSessionEvent(
      makeRuntimeState({ sendMessage }),
      'sess-1',
      makeInteractionRequestEvent({
        kind: 'permission',
        options: [{ label: '同意本次', value: 'allow_once' }],
        question: '需要授权'
      })
    )).rejects.toThrow('offline')

    expect(releaseChannelAuthorizationRequestDelivery).toHaveBeenCalledWith({
      id: 'auth-1',
      reservedAt: 1_000
    })
    expect(markChannelAuthorizationRequestDelivered).not.toHaveBeenCalled()
  })

  it('delivers fatal session errors to the bound channel', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_error' })
    bindTestSession()

    const delivered = await handleSessionEvent(
      makeRuntimeState({ sendMessage }),
      'sess-1',
      makeErrorEvent({ code: 'adapter_runtime_failed' })
    )

    expect(delivered).toBe(true)
    expect(sendMessage).toHaveBeenCalledWith({
      receiveId: 'chat_1',
      receiveIdType: 'chat_id',
      text: expect.stringContaining('任务执行失败，已停止回复。')
    })
    expect(sendMessage.mock.calls[0]?.[0]?.text).toContain(
      '错误：adapter_runtime_failed: Invalid proxy metadata: upstreamBaseUrl must be a valid URL'
    )
    expect(sendMessage.mock.calls[0]?.[0]?.text).toContain('服务端日志')
  })

  it('does not notify the bound channel for non-fatal session errors', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_error' })
    bindTestSession()

    const delivered = await handleSessionEvent(
      makeRuntimeState({ sendMessage }),
      'sess-1',
      makeErrorEvent({ fatal: false })
    )

    expect(delivered).toBe(false)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('suppresses group progress messages and clears pending ack on stop', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_group' })
    const unack = vi.fn().mockResolvedValue(undefined)
    bindTestSession({ sessionType: 'group' })
    setPendingUnack('sess-1', unack)
    const states = makeRuntimeState({ sendMessage })

    await expect(handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('assistant', '处理中...', 'assistant-progress')
    )).resolves.toBe(false)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(unack).not.toHaveBeenCalled()

    await expect(handleSessionEvent(
      states,
      'sess-1',
      buildChannelSessionStopEvent()
    )).resolves.toBe(false)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(unack).toHaveBeenCalledTimes(1)
  })

  it('still delivers permission prompts and fatal errors to group channels', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ messageId: 'om_permission' })
      .mockResolvedValueOnce({ messageId: 'om_error' })
    const pushFollowUps = vi.fn().mockResolvedValue(undefined)
    bindTestSession({ sessionType: 'group' })
    const states = makeRuntimeState({ sendMessage, pushFollowUps })

    await expect(handleSessionEvent(
      states,
      'sess-1',
      makeInteractionRequestEvent({
        kind: 'permission',
        question: '当前任务需要额外权限才能继续。是否授权后继续？',
        options: [
          { label: '同意本次', value: 'allow_once' }
        ]
      }, 'interaction-permission')
    )).resolves.toBe(true)
    await expect(handleSessionEvent(
      states,
      'sess-1',
      makeErrorEvent({ code: 'adapter_runtime_failed' })
    )).resolves.toBe(true)

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        receiveId: 'chat_1',
        receiveIdType: 'chat_id',
        text: '有一项私密授权等待处理。请私聊机器人或打开 OneWorks 聊天室继续。'
      })
    )
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        receiveId: 'chat_1',
        receiveIdType: 'chat_id',
        text: expect.stringContaining('任务执行失败，已停止回复。')
      })
    )
  })

  it('sends only the first and stop assistant messages for WeChat direct sessions', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ messageId: 'om_first' })
      .mockResolvedValueOnce({ messageId: 'om_final' })
    bindTestSession({
      channelType: 'wechat',
      sessionType: 'direct',
      replyReceiveId: 'wxid_user',
      replyReceiveIdType: 'wxid'
    })
    const states = makeRuntimeState({ channelType: 'wechat', sendMessage })

    await expect(handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('assistant', '我先看一下。', 'assistant-first')
    )).resolves.toBe(true)
    await expect(handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('assistant', '中间过程。', 'assistant-progress')
    )).resolves.toBe(false)
    await expect(handleSessionEvent(
      states,
      'sess-1',
      buildChannelSessionStopEvent({
        id: 'assistant-final',
        role: 'assistant',
        content: '最终结论。',
        createdAt: Date.now()
      })
    )).resolves.toBe(true)

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      receiveId: 'wxid_user',
      receiveIdType: 'wxid',
      text: '我先看一下。'
    })
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      receiveId: 'wxid_user',
      receiveIdType: 'wxid',
      text: '最终结论。'
    })
  })

  it('truncates automatic channel text delivery to 200 visible characters', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_short' })
    bindTestSession()

    await expect(handleSessionEvent(
      makeRuntimeState({ sendMessage }),
      'sess-1',
      makeMessageEvent('assistant', '你'.repeat(201), 'assistant-long')
    )).resolves.toBe(true)

    expect(sendMessage).toHaveBeenCalledWith({
      receiveId: 'chat_1',
      receiveIdType: 'chat_id',
      text: `${'你'.repeat(199)}…`
    })
  })

  it('deduplicates WeChat direct stop delivery when first and final text match', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_first' })
    bindTestSession({
      channelType: 'wechat',
      sessionType: 'direct',
      replyReceiveId: 'wxid_user',
      replyReceiveIdType: 'wxid'
    })
    const states = makeRuntimeState({ channelType: 'wechat', sendMessage })

    await handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('assistant', '完成。', 'assistant-first')
    )
    await expect(handleSessionEvent(
      states,
      'sess-1',
      buildChannelSessionStopEvent()
    )).resolves.toBe(false)

    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('keeps interaction delivery successful when follow-up actions fail after the message is sent', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_question' })
    const pushFollowUps = vi.fn().mockRejectedValue(new Error('Lark push follow up failed: HTTP 400'))
    bindTestSession()

    const delivered = await handleSessionEvent(
      makeRuntimeState({ sendMessage, pushFollowUps }),
      'sess-1',
      makeInteractionRequestEvent({
        question: '晚上吃了什么？',
        options: [
          { label: '米饭', description: '主食' },
          { label: '面条' }
        ]
      })
    )

    expect(delivered).toBe(true)
    expect(sendMessage).toHaveBeenCalledOnce()
    expect(pushFollowUps).toHaveBeenCalledOnce()
  })

  it('delivers the first tool event immediately and updates the same summary message as results arrive', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_tool_summary' })
    const updateMessage = vi.fn().mockResolvedValue({ messageId: 'om_tool_summary' })
    bindTestSession()

    await expect(handleSessionEvent(
      makeRuntimeState({ sendMessage, updateMessage }),
      'sess-1',
      makeMessageEvent('assistant', [{
        type: 'tool_use',
        id: 'tool-1',
        name: 'mcp__channel-lark-test__SendImage',
        input: {
          imagePath: 'packages/utils/src/assets/mcp.png'
        }
      }], 'assistant-tool-use')
    )).resolves.toBe(true)

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      receiveId: 'chat_1',
      receiveIdType: 'chat_id',
      toolCallSummary: expect.objectContaining({
        items: [expect.objectContaining({
          toolUseId: 'tool-1',
          name: 'SendImage',
          status: 'pending',
          argsText: '{"imagePath":"packages/utils/src/assets/mcp.png"}'
        })]
      })
    }))
    const firstItem = sendMessage.mock.calls[0]?.[0]?.toolCallSummary?.items?.[0]
    await expectActionUrl({
      url: firstItem.detailUrl,
      action: 'tool-call-detail',
      claims: {
        sessionId: 'sess-1',
        toolUseId: 'tool-1',
        messageId: 'assistant-tool-use',
        oneTime: false
      }
    })
    await expectActionUrl({
      url: firstItem.exportJsonUrl,
      action: 'tool-call-export',
      claims: {
        sessionId: 'sess-1',
        toolUseId: 'tool-1',
        messageId: 'assistant-tool-use',
        oneTime: true
      }
    })

    await expect(handleSessionEvent(
      makeRuntimeState({ sendMessage, updateMessage }),
      'sess-1',
      makeMessageEvent('user', [{
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: {
          messageId: 'om_lark_image'
        }
      }], 'user-tool-result')
    )).resolves.toBe(true)

    expect(updateMessage).toHaveBeenCalledTimes(1)
    expect(updateMessage).toHaveBeenCalledWith(
      'om_tool_summary',
      expect.objectContaining({
        toolCallSummary: expect.objectContaining({
          items: [expect.objectContaining({
            toolUseId: 'tool-1',
            status: 'success',
            resultText: '{"messageId":"om_lark_image"}'
          })]
        })
      })
    )

    await expect(handleSessionEvent(
      makeRuntimeState({ sendMessage, updateMessage }),
      'sess-1',
      makeMessageEvent('assistant', '图片已发送。', 'assistant-final')
    )).resolves.toBe(true)

    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      receiveId: 'chat_1',
      receiveIdType: 'chat_id',
      text: '图片已发送。'
    })
  })

  it('keeps adjacent tool calls inside one updatable summary card', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_tool_summary' })
    const updateMessage = vi.fn().mockResolvedValue({ messageId: 'om_tool_summary' })
    bindTestSession()
    const states = makeRuntimeState({ sendMessage, updateMessage })

    await handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('assistant', [{
        type: 'tool_use',
        id: 'tool-1',
        name: 'mcp__channel-lark-test__SendImage',
        input: { imagePath: 'a.png' }
      }], 'tool-1-use')
    )
    await handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('user', [{
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: { messageId: 'om_image' }
      }], 'tool-1-result')
    )
    await handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('assistant', [{
        type: 'tool_use',
        id: 'tool-2',
        name: 'mcp__channel-lark-test__SendFile',
        input: { filePath: 'README.md' }
      }], 'tool-2-use')
    )
    await handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('user', [{
        type: 'tool_result',
        tool_use_id: 'tool-2',
        content: { messageId: 'om_file' }
      }], 'tool-2-result')
    )

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(updateMessage).toHaveBeenCalledTimes(3)
    expect(updateMessage.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      toolCallSummary: expect.objectContaining({
        items: [
          expect.objectContaining({
            toolUseId: 'tool-1',
            status: 'success',
            resultText: '{"messageId":"om_image"}'
          }),
          expect.objectContaining({
            toolUseId: 'tool-2',
            name: 'SendFile',
            status: 'success',
            argsText: '{"filePath":"README.md"}',
            resultText: '{"messageId":"om_file"}'
          })
        ]
      })
    }))
    const finalItems = updateMessage.mock.calls[2]?.[1]?.toolCallSummary?.items ?? []
    const sendFileItem = finalItems.find((item: any) => item.toolUseId === 'tool-2')
    await expectActionUrl({
      url: sendFileItem.detailUrl,
      action: 'tool-call-detail',
      claims: {
        sessionId: 'sess-1',
        toolUseId: 'tool-2',
        messageId: 'tool-2-result',
        oneTime: false
      }
    })
    await expectActionUrl({
      url: sendFileItem.exportJsonUrl,
      action: 'tool-call-export',
      claims: {
        sessionId: 'sess-1',
        toolUseId: 'tool-2',
        messageId: 'tool-2-result',
        oneTime: true
      }
    })
  })

  it('keeps updating the same tool summary card after a permission interaction', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ messageId: 'om_tool_summary' })
      .mockResolvedValueOnce({ messageId: 'om_permission' })
    const updateMessage = vi.fn().mockResolvedValue({ messageId: 'om_tool_summary' })
    bindTestSession()
    const states = makeRuntimeState({ sendMessage, updateMessage })

    await handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('assistant', [{
        type: 'tool_use',
        id: 'tool-1',
        name: 'mcp__channel-lark-test__GetCurrentChatMessages',
        input: { chatId: '', limit: 6 }
      }], 'tool-1-use')
    )

    await handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('assistant', [{
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: 'Claude requested permissions to use mcp__channel-lark-test__GetCurrentChatMessages.',
        is_error: true
      }], 'tool-1-result')
    )

    await handleSessionEvent(
      states,
      'sess-1',
      makeInteractionRequestEvent({
        kind: 'permission',
        question: '当前任务需要使用 channel-lark-test 才能继续，请选择处理方式。',
        options: [
          { label: '同意本次', value: 'allow_once' }
        ]
      }, 'interaction-permission')
    )

    await handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('assistant', [{
        type: 'tool_use',
        id: 'tool-2',
        name: 'mcp__channel-lark-test__GetCurrentChatMessages',
        input: { chatId: '', limit: 6 }
      }], 'tool-2-use')
    )

    await handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('assistant', [{
        type: 'tool_result',
        tool_use_id: 'tool-2',
        content: {
          matchedCount: 6
        }
      }], 'tool-2-result')
    )

    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        receiveId: 'chat_1',
        receiveIdType: 'chat_id',
        toolCallSummary: expect.any(Object)
      })
    )
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        receiveId: 'chat_1',
        receiveIdType: 'chat_id',
        text: expect.stringContaining('[权限请求]')
      })
    )
    expect(updateMessage).toHaveBeenCalledTimes(3)
    expect(updateMessage.mock.calls[2]?.[0]).toBe('om_tool_summary')
    expect(updateMessage.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      toolCallSummary: expect.objectContaining({
        items: [
          expect.objectContaining({
            toolUseId: 'tool-1',
            status: 'error'
          }),
          expect.objectContaining({
            toolUseId: 'tool-2',
            status: 'success',
            resultText: '{"matchedCount":6}'
          })
        ]
      })
    }))
  })

  it('serializes tool summary upserts so fast tool results patch the first card instead of sending a second one', async () => {
    let resolveSendMessage: ((value: { messageId: string }) => void) | undefined
    const sendMessage = vi.fn().mockImplementation(async () => {
      return await new Promise<{ messageId: string }>((resolve) => {
        resolveSendMessage = resolve
      })
    })
    const updateMessage = vi.fn().mockResolvedValue({ messageId: 'om_tool_summary' })
    bindTestSession()
    const states = makeRuntimeState({ sendMessage, updateMessage })

    const firstEvent = handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('assistant', [{
        type: 'tool_use',
        id: 'tool-1',
        name: 'mcp__channel-lark-test__GetCurrentChatMessages',
        input: { chatId: '', limit: 6 }
      }], 'tool-1-use')
    )

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1)
    })

    const secondEvent = handleSessionEvent(
      states,
      'sess-1',
      makeMessageEvent('assistant', [{
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: {
          matchedCount: 6
        }
      }], 'tool-1-result')
    )

    expect(updateMessage).not.toHaveBeenCalled()
    resolveSendMessage?.({ messageId: 'om_tool_summary' })

    await expect(Promise.all([firstEvent, secondEvent])).resolves.toEqual([true, true])

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(updateMessage).toHaveBeenCalledTimes(1)
    expect(updateMessage).toHaveBeenCalledWith(
      'om_tool_summary',
      expect.objectContaining({
        toolCallSummary: expect.objectContaining({
          items: [expect.objectContaining({
            toolUseId: 'tool-1',
            name: 'GetCurrentChatMessages',
            status: 'success',
            argsText: '{"chatId":"","limit":6}',
            resultText: '{"matchedCount":6}'
          })]
        })
      })
    )
    const resultItem = updateMessage.mock.calls[0]?.[1]?.toolCallSummary?.items?.[0]
    await expectActionUrl({
      url: resultItem.detailUrl,
      action: 'tool-call-detail',
      claims: {
        sessionId: 'sess-1',
        toolUseId: 'tool-1',
        messageId: 'tool-1-result',
        oneTime: false
      }
    })
    await expectActionUrl({
      url: resultItem.exportJsonUrl,
      action: 'tool-call-export',
      claims: {
        sessionId: 'sess-1',
        toolUseId: 'tool-1',
        messageId: 'tool-1-result',
        oneTime: true
      }
    })
  })
})
