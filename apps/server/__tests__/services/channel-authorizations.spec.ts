/* eslint-disable max-lines -- Authorization lifecycle coverage shares one database fixture and request graph. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import {
  buildChannelInteractionAuthorizationRequestId,
  ensureChannelAuthorizationRequestForInteraction,
  markChannelAuthorizationRequestDelivered,
  resolveChannelAuthorizationRequest,
  shouldDeliverChannelAuthorizationRequest
} from '#~/services/channel-authorizations/index.js'
import { handleInteractionResponse } from '#~/services/session/interaction.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

vi.mock('#~/services/session/interaction.js', () => ({
  handleInteractionResponse: vi.fn().mockResolvedValue(true)
}))

const createChannelAuthorizationRequest = vi.fn()
const consumeChannelReplyThrottle = vi.fn()
const getChannelAuthorizationRequest = vi.fn()
const getChannelReplyThrottle = vi.fn()
const getSessionRuntimeState = vi.fn()
const listOpenChannelPendingIntents = vi.fn()
const resolveCanonicalUserByChannelAccount = vi.fn()
const updateChannelAuthorizationRequest = vi.fn()
const updateChannelPendingIntent = vi.fn()
const upsertChannelPendingIntent = vi.fn()

const makePermissionEvent = (overrides: Record<string, unknown> = {}) =>
  ({
    type: 'interaction_request',
    id: 'interaction-1',
    payload: {
      kind: 'permission',
      sessionId: 'sess-1',
      question: '当前任务需要使用 Write 才能继续，请选择处理方式。',
      options: [
        { label: '同意本次', value: 'allow_once' }
      ],
      permissionContext: {
        adapter: 'codex',
        deniedTools: ['Write'],
        projectConfigPath: '.oo.config.json',
        reasons: ['Write requires approval'],
        scope: 'tool',
        subjectKey: 'Write',
        subjectLabel: 'Write',
        subjectLookupKeys: ['write']
      },
      ...overrides
    }
  }) as any

const binding = {
  channelId: 'oc_1',
  channelKey: 'lark-main',
  channelType: 'lark',
  senderId: 'ou_1',
  sessionType: 'group'
}

const link = {
  channelKey: 'lark-main',
  definition: {} as never,
  entity: 'owo-demo',
  external: { type: 'chat', chatId: 'oc_1' },
  name: 'wan-ke-chat',
  path: '/workspace/.oo/channels/wan-ke-chat/channel.json'
}

describe('channel authorization service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    consumeChannelReplyThrottle.mockReturnValue(true)
    getChannelAuthorizationRequest.mockReturnValue(undefined)
    getChannelReplyThrottle.mockReturnValue(undefined)
    getSessionRuntimeState.mockReturnValue({
      channelActorSnapshot: {
        actorAccountId: 'ou_1',
        actorUserId: 'user-yijie',
        channelId: 'oc_1',
        channelKey: 'lark-main',
        channelLinkName: 'wan-ke-chat',
        channelType: 'lark',
        childRunId: 'child-run-1',
        conversationStateId: 'conversation-1',
        entity: 'owo-demo',
        sessionType: 'group',
        threadKey: 'group:owo-demo:actor:user-yijie'
      }
    })
    resolveCanonicalUserByChannelAccount.mockReturnValue({
      id: 'user-yijie',
      displayName: '一介',
      createdAt: 1,
      updatedAt: 1
    })
    createChannelAuthorizationRequest.mockImplementation(input => ({
      ...input,
      status: 'pending'
    }))
    listOpenChannelPendingIntents.mockReturnValue([
      {
        createdByChildRunId: 'child-run-1',
        id: 'pending-auth-1',
        metadata: {
          reasonCode: 'session-permission-required'
        },
        threadKey: 'group:owo-demo:actor:user-yijie'
      }
    ])
    updateChannelAuthorizationRequest.mockImplementation((_id, updates) => ({
      ...getChannelAuthorizationRequest(),
      ...updates
    }))
    updateChannelPendingIntent.mockImplementation((_id, updates) => ({
      id: 'pending-auth-1',
      ...updates
    }))
    upsertChannelPendingIntent.mockReturnValue({
      id: 'channel-pending-auth:channel-interaction:sess-1:interaction-1'
    })
    vi.mocked(getDb).mockReturnValue({
      createChannelAuthorizationRequest,
      consumeChannelReplyThrottle,
      getChannelAuthorizationRequest,
      getChannelReplyThrottle,
      getSessionRuntimeState,
      listOpenChannelPendingIntents,
      resolveCanonicalUserByChannelAccount,
      updateChannelAuthorizationRequest,
      updateChannelPendingIntent,
      upsertChannelPendingIntent
    } as any)
  })

  it('builds stable authorization request ids from session and interaction', () => {
    expect(buildChannelInteractionAuthorizationRequestId('sess-1', 'interaction-1')).toBe(
      'channel-interaction:sess-1:interaction-1'
    )
  })

  it('mirrors permission interactions into channel authorization requests', () => {
    const event = makePermissionEvent()

    const request = ensureChannelAuthorizationRequestForInteraction({
      binding,
      event,
      link,
      sessionId: 'sess-1'
    })

    expect(resolveCanonicalUserByChannelAccount).toHaveBeenCalledWith('lark', 'ou_1')
    expect(createChannelAuthorizationRequest).toHaveBeenCalledWith({
      id: 'channel-interaction:sess-1:interaction-1',
      channelType: 'lark',
      channelLinkName: 'wan-ke-chat',
      requesterUserId: 'user-yijie',
      requesterAccountId: 'ou_1',
      capability: 'Write',
      message: '当前任务需要使用 Write 才能继续，请选择处理方式。',
      metadata: expect.objectContaining({
        adapter: 'codex',
        approval: expect.objectContaining({
          actorAccountId: 'ou_1',
          actorUserId: 'user-yijie',
          capability: 'Write',
          reasonCode: 'session-permission-required',
          status: 'ask_trigger_user'
        }),
        channelId: 'oc_1',
        channelKey: 'lark-main',
        deniedTools: ['Write'],
        entity: 'owo-demo',
        interactionId: 'interaction-1',
        projectConfigPath: '.oo.config.json',
        reasons: ['Write requires approval'],
        scope: 'tool',
        sessionId: 'sess-1',
        sessionType: 'group',
        subjectLookupKeys: ['write']
      })
    })
    expect(request).toEqual(expect.objectContaining({
      id: 'channel-interaction:sess-1:interaction-1',
      status: 'pending'
    }))
    expect(upsertChannelPendingIntent).toHaveBeenCalledWith(expect.objectContaining({
      id: 'channel-pending-auth:channel-interaction:sess-1:interaction-1',
      authorizationRequestId: 'channel-interaction:sess-1:interaction-1',
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      channelType: 'lark',
      conversationStateId: 'conversation-1',
      createdByChildRunId: 'child-run-1',
      entity: 'owo-demo',
      kind: 'need_approval',
      ownerAccountId: 'ou_1',
      ownerUserId: 'user-yijie',
      payload: expect.objectContaining({
        authorizationRequestId: 'channel-interaction:sess-1:interaction-1',
        capability: 'Write',
        interactionId: 'interaction-1',
        subjectLookupKeys: ['write']
      }),
      requiredAction: 'grant_authorization',
      sessionType: 'group',
      status: 'open',
      threadKey: 'group:owo-demo:actor:user-yijie'
    }))
  })

  it('stores channel link resume policy on mirrored authorization requests', () => {
    ensureChannelAuthorizationRequestForInteraction({
      binding,
      event: makePermissionEvent(),
      link: {
        ...link,
        authorization: {
          deliveryThrottleMs: 5_000,
          resume: {
            delayMs: 3_000,
            mode: 'next_message'
          }
        }
      },
      sessionId: 'sess-1'
    })

    expect(createChannelAuthorizationRequest).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        resumePolicy: {
          delayMs: 3_000,
          mode: 'next_message'
        }
      })
    }))
  })

  it('does not duplicate existing mirrored authorization requests', () => {
    getChannelAuthorizationRequest.mockReturnValue({
      id: 'channel-interaction:sess-1:interaction-1',
      status: 'pending'
    })

    const request = ensureChannelAuthorizationRequestForInteraction({
      binding,
      event: makePermissionEvent(),
      link,
      sessionId: 'sess-1'
    })

    expect(createChannelAuthorizationRequest).not.toHaveBeenCalled()
    expect(upsertChannelPendingIntent).toHaveBeenCalledWith(expect.objectContaining({
      authorizationRequestId: 'channel-interaction:sess-1:interaction-1',
      threadKey: 'group:owo-demo:actor:user-yijie'
    }))
    expect(request).toEqual({
      id: 'channel-interaction:sess-1:interaction-1',
      status: 'pending'
    })
  })

  it('uses credential subject as pending authorization owner when present', () => {
    getChannelAuthorizationRequest.mockReturnValue({
      capability: 'drive.file.read',
      channelLinkName: 'wan-ke-chat',
      channelType: 'lark',
      credentialSubjectUserId: 'user-owner',
      id: 'channel-interaction:sess-1:interaction-1',
      requesterAccountId: 'ou_1',
      requesterUserId: 'user-yijie',
      status: 'pending'
    })

    ensureChannelAuthorizationRequestForInteraction({
      binding,
      event: makePermissionEvent(),
      link,
      sessionId: 'sess-1'
    })

    expect(upsertChannelPendingIntent).toHaveBeenCalledWith(expect.objectContaining({
      ownerAccountId: 'ou_1',
      ownerUserId: 'user-owner',
      payload: expect.objectContaining({
        credentialSubjectUserId: 'user-owner'
      })
    }))
  })

  it('ignores non-permission interactions', () => {
    const request = ensureChannelAuthorizationRequestForInteraction({
      binding,
      event: makePermissionEvent({ kind: 'question' }),
      link,
      sessionId: 'sess-1'
    })

    expect(createChannelAuthorizationRequest).not.toHaveBeenCalled()
    expect(upsertChannelPendingIntent).not.toHaveBeenCalled()
    expect(request).toBeUndefined()
  })

  it('resolves authorization requests and closes related pending intents', async () => {
    getChannelAuthorizationRequest.mockReturnValue({
      id: 'auth-1',
      channelType: 'lark',
      channelLinkName: 'wan-ke-chat',
      requesterUserId: 'user-yijie',
      requesterAccountId: 'ou_1',
      credentialKey: null,
      capability: 'Write',
      status: 'pending',
      message: 'Allow Write?',
      metadata: {
        interactionId: 'interaction-1',
        sessionId: 'sess-1'
      },
      createdAt: 1,
      updatedAt: 1,
      expiresAt: null,
      resolvedAt: null
    })

    const result = await resolveChannelAuthorizationRequest({
      id: 'auth-1',
      interactionResponse: 'allow_once',
      resolvedAt: 123,
      resolvedByAccountId: 'admin1',
      status: 'granted'
    })

    expect(updateChannelAuthorizationRequest).toHaveBeenCalledWith('auth-1', {
      status: 'granted',
      resolvedAt: 123
    })
    expect(listOpenChannelPendingIntents).toHaveBeenCalledWith({
      authorizationRequestId: 'auth-1'
    })
    expect(updateChannelPendingIntent).toHaveBeenCalledWith('pending-auth-1', {
      metadata: {
        authorizationStatus: 'granted',
        reasonCode: 'session-permission-required',
        resume: expect.objectContaining({
          authorizationRequestId: 'auth-1',
          authorizationStatus: 'granted',
          capability: 'Write',
          createdByChildRunId: 'child-run-1',
          interactionResponse: 'allow_once',
          readyAt: 123,
          resolvedByAccountId: 'admin1',
          sessionId: 'sess-1',
          skipReason: 'interaction-response-handled',
          status: 'skipped',
          threadKey: 'group:owo-demo:actor:user-yijie'
        }),
        resolvedByAccountId: 'admin1',
        resolvedByUserId: undefined
      },
      resolvedAt: 123,
      status: 'resolved'
    })
    expect(handleInteractionResponse).toHaveBeenCalledWith('sess-1', 'interaction-1', 'allow_once')
    expect(result).toEqual(expect.objectContaining({
      interactionHandled: true,
      pendingIntentIds: ['pending-auth-1'],
      request: expect.objectContaining({
        id: 'auth-1',
        status: 'granted'
      })
    }))
  })

  it('leaves resolved pending intents ready when no interaction was resumed', async () => {
    getChannelAuthorizationRequest.mockReturnValue({
      id: 'auth-1',
      channelType: 'lark',
      channelLinkName: 'wan-ke-chat',
      requesterUserId: 'user-yijie',
      requesterAccountId: 'ou_1',
      credentialKey: null,
      capability: 'Write',
      status: 'pending',
      message: 'Allow Write?',
      metadata: {
        resumePolicy: {
          delayMs: 5_000,
          mode: 'immediate'
        },
        sessionId: 'sess-1'
      },
      createdAt: 1,
      updatedAt: 1,
      expiresAt: null,
      resolvedAt: null
    })

    await resolveChannelAuthorizationRequest({
      id: 'auth-1',
      interactionResponse: 'allow_once',
      resolvedAt: 123,
      resolvedByAccountId: 'admin1',
      status: 'granted'
    })

    expect(handleInteractionResponse).not.toHaveBeenCalled()
    expect(updateChannelPendingIntent).toHaveBeenCalledWith('pending-auth-1', {
      metadata: expect.objectContaining({
        resume: expect.objectContaining({
          authorizationRequestId: 'auth-1',
          mode: 'immediate',
          notBefore: 5_123,
          status: 'ready'
        })
      }),
      resolvedAt: 123,
      status: 'resolved'
    })
  })

  it('marks related pending intents as delivered', () => {
    getChannelAuthorizationRequest.mockReturnValue({
      id: 'auth-1',
      channelType: 'lark',
      channelLinkName: 'wan-ke-chat',
      requesterUserId: 'user-yijie',
      requesterAccountId: 'ou_1',
      credentialKey: null,
      capability: 'Write',
      status: 'pending',
      message: 'Allow Write?',
      metadata: {
        channelId: 'oc_1'
      },
      createdAt: 1,
      updatedAt: 1,
      expiresAt: null,
      resolvedAt: null
    })
    listOpenChannelPendingIntents.mockReturnValue([
      {
        id: 'pending-auth-1',
        channelId: 'oc_1',
        channelLinkName: 'wan-ke-chat',
        metadata: {
          reasonCode: 'session-permission-required'
        },
        ownerAccountId: 'ou_1',
        ownerUserId: 'user-yijie'
      },
      {
        id: 'pending-auth-2',
        metadata: null
      }
    ])

    const ids = markChannelAuthorizationRequestDelivered({
      id: 'auth-1',
      delivery: 'public_hint',
      deliveryMessageId: 'om_1'
    })

    expect(ids).toEqual(['pending-auth-1', 'pending-auth-2'])
    expect(listOpenChannelPendingIntents).toHaveBeenCalledWith({
      authorizationRequestId: 'auth-1'
    })
    expect(updateChannelPendingIntent).toHaveBeenCalledWith('pending-auth-1', {
      delivery: 'public_hint',
      deliveryMessageId: 'om_1',
      metadata: expect.objectContaining({
        deliveredAt: expect.any(Number),
        reasonCode: 'session-permission-required'
      })
    })
    expect(updateChannelPendingIntent).toHaveBeenCalledWith('pending-auth-2', {
      delivery: 'public_hint',
      deliveryMessageId: 'om_1',
      metadata: expect.objectContaining({
        deliveredAt: expect.any(Number)
      })
    })
    expect(consumeChannelReplyThrottle).toHaveBeenCalledWith(expect.objectContaining({
      throttleKey: 'authorization-request-delivery\u0000auth-1',
      policyType: 'authorization_request_delivery',
      channelType: 'lark',
      channelId: 'oc_1',
      actorAccountId: 'ou_1',
      actorUserId: 'user-yijie',
      windowMs: 20 * 60 * 1000
    }))
  })

  it('uses reply throttle state to suppress repeated delivery', () => {
    getChannelReplyThrottle.mockReturnValue({
      throttleKey: 'authorization-request-delivery\u0000auth-1',
      policyType: 'authorization_request_delivery',
      channelType: 'lark',
      channelId: 'oc_1',
      channelLinkName: 'wan-ke-chat',
      actorUserId: 'user-yijie',
      actorAccountId: 'ou_1',
      lastSentAt: 1_000,
      expiresAt: 1_000 + 20 * 60 * 1000,
      metadata: null
    })

    expect(shouldDeliverChannelAuthorizationRequest({
      id: 'auth-1',
      now: 1_000 + 60_000
    })).toBe(false)
    expect(shouldDeliverChannelAuthorizationRequest({
      id: 'auth-1',
      now: 1_000 + 20 * 60 * 1000 + 1
    })).toBe(true)
  })
})
