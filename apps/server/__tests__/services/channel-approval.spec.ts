import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import { resolveChannelApproval } from '#~/services/channel-approval/index.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

const createChannelAuthorizationRequest = vi.fn()
const getChannelAuthorizationRequest = vi.fn()
const getChannelUserCredential = vi.fn()
const upsertChannelPendingIntent = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  createChannelAuthorizationRequest.mockImplementation(row => ({
    ...row,
    createdAt: 1,
    resolvedAt: null,
    status: row.status ?? 'pending',
    updatedAt: 1
  }))
  getChannelAuthorizationRequest.mockReturnValue(undefined)
  getChannelUserCredential.mockReturnValue(undefined)
  upsertChannelPendingIntent.mockReturnValue({
    id: 'channel-pending-auth:channel-approval:demo'
  })
  vi.mocked(getDb).mockReturnValue({
    createChannelAuthorizationRequest,
    getChannelAuthorizationRequest,
    getChannelUserCredential,
    upsertChannelPendingIntent
  } as any)
})

describe('resolveChannelApproval', () => {
  it('allows normal sender-scoped capabilities without a credential requirement', () => {
    const decision = resolveChannelApproval({
      actorAccountId: 'ou_1',
      capability: 'channel.command.auth.list',
      channelType: 'lark',
      permission: 'everyone'
    })

    expect(decision).toMatchObject({
      actorAccountId: 'ou_1',
      capability: 'channel.command.auth.list',
      reasonCode: 'default-allow',
      status: 'allow'
    })
    expect(getChannelUserCredential).not.toHaveBeenCalled()
  })

  it('allows admin capabilities when the sender matches the channel admin list', () => {
    const decision = resolveChannelApproval({
      actorAccountId: 'admin1',
      capability: 'channel.command.auth.grant',
      channelAdmins: ['admin1'],
      channelType: 'lark',
      permission: 'admin',
      senderId: 'admin1'
    })

    expect(decision).toMatchObject({
      reasonCode: 'admin-allowed',
      status: 'allow'
    })
  })

  it('denies admin capabilities for non-admin senders', () => {
    const decision = resolveChannelApproval({
      actorAccountId: 'user1',
      capability: 'channel.command.auth.grant',
      channelAdmins: ['admin1'],
      channelType: 'lark',
      permission: 'admin',
      senderId: 'user1'
    })

    expect(decision).toMatchObject({
      reasonCode: 'admin-required',
      status: 'deny'
    })
  })

  it('uses an explicit default decision when no admin or credential gate applies', () => {
    const decision = resolveChannelApproval({
      actorAccountId: 'ou_1',
      actorUserId: 'user-1',
      capability: 'Write',
      channelType: 'lark',
      defaultDecision: {
        reasonCode: 'session-permission-required',
        status: 'ask_trigger_user'
      },
      source: 'system'
    })

    expect(decision).toMatchObject({
      actorAccountId: 'ou_1',
      actorUserId: 'user-1',
      capability: 'Write',
      reasonCode: 'session-permission-required',
      status: 'ask_trigger_user'
    })
  })

  it('allows active credentials with all required scopes', () => {
    getChannelUserCredential.mockReturnValue({
      channelType: 'lark',
      createdAt: 1,
      credentialKey: 'lark-user',
      expiresAt: Date.now() + 60_000,
      label: null,
      metadata: null,
      scopes: ['im:chat:read', 'im:chat.members:write_only'],
      status: 'active',
      updatedAt: 1,
      userId: 'user-1'
    })

    const decision = resolveChannelApproval({
      actorAccountId: 'ou_1',
      actorUserId: 'user-1',
      capability: 'im.chat.member.add',
      channelType: 'lark',
      credential: {
        credentialKey: 'lark-user',
        requiredScopes: ['im:chat.members:write_only']
      }
    })

    expect(getChannelUserCredential).toHaveBeenCalledWith('user-1', 'lark', 'lark-user')
    expect(decision).toMatchObject({
      credentialKey: 'lark-user',
      reasonCode: 'credential-active',
      status: 'allow'
    })
  })

  it('creates a stable authorization request when a required credential is missing', () => {
    const first = resolveChannelApproval({
      actorAccountId: 'ou_1',
      actorUserId: 'user-1',
      capability: 'im.chat.member.add',
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      channelType: 'lark',
      childRunId: 'child-run-1',
      conversationStateId: 'conversation-1',
      createAuthorizationRequest: true,
      credential: {
        credentialKey: 'lark-user',
        requiredScopes: ['im:chat.members:write_only']
      },
      entity: 'owo-demo',
      sessionId: 'sess-1',
      sessionType: 'group',
      source: 'natural_language',
      threadKey: 'group:owo-demo:actor:user-1'
    })

    const requestId = first.authorizationRequest?.id
    expect(requestId).toMatch(/^channel-approval:[a-f0-9]{24}$/u)
    expect(first).toMatchObject({
      credentialKey: 'lark-user',
      reasonCode: 'credential-missing',
      status: 'ask_trigger_user'
    })
    expect(createChannelAuthorizationRequest).toHaveBeenCalledWith(expect.objectContaining({
      id: requestId,
      capability: 'im.chat.member.add',
      channelLinkName: 'wan-ke-chat',
      channelType: 'lark',
      credentialSubjectUserId: 'user-1',
      credentialKey: 'lark-user',
      requesterAccountId: 'ou_1',
      requesterUserId: 'user-1',
      metadata: expect.objectContaining({
        channelId: 'oc_1',
        channelKey: 'lark-main',
        childRunId: 'child-run-1',
        conversationStateId: 'conversation-1',
        credentialSubjectUserId: 'user-1',
        entity: 'owo-demo',
        reasonCode: 'credential-missing',
        requiredScopes: ['im:chat.members:write_only'],
        sessionId: 'sess-1',
        sessionType: 'group',
        source: 'natural_language'
      })
    }))
    expect(upsertChannelPendingIntent).toHaveBeenCalledWith(expect.objectContaining({
      id: `channel-pending-auth:${requestId}`,
      authorizationRequestId: requestId,
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      channelType: 'lark',
      conversationStateId: 'conversation-1',
      createdByChildRunId: 'child-run-1',
      entity: 'owo-demo',
      kind: 'need_approval',
      ownerAccountId: 'ou_1',
      ownerUserId: 'user-1',
      payload: expect.objectContaining({
        authorizationRequestId: requestId,
        capability: 'im.chat.member.add',
        credentialSubjectUserId: 'user-1',
        credentialKey: 'lark-user',
        reasonCode: 'credential-missing',
        requiredScopes: ['im:chat.members:write_only']
      }),
      requiredAction: 'grant_authorization',
      sessionType: 'group',
      status: 'open',
      threadKey: 'group:owo-demo:actor:user-1'
    }))

    getChannelAuthorizationRequest.mockReturnValue(first.authorizationRequest)
    createChannelAuthorizationRequest.mockClear()
    upsertChannelPendingIntent.mockClear()

    const second = resolveChannelApproval({
      actorAccountId: 'ou_1',
      actorUserId: 'user-1',
      capability: 'im.chat.member.add',
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      channelType: 'lark',
      childRunId: 'child-run-1',
      conversationStateId: 'conversation-1',
      createAuthorizationRequest: true,
      credential: {
        credentialKey: 'lark-user',
        requiredScopes: ['im:chat.members:write_only']
      },
      entity: 'owo-demo',
      sessionId: 'sess-1',
      sessionType: 'group',
      source: 'natural_language',
      threadKey: 'group:owo-demo:actor:user-1'
    })

    expect(second.authorizationRequest?.id).toBe(requestId)
    expect(createChannelAuthorizationRequest).not.toHaveBeenCalled()
    expect(upsertChannelPendingIntent).toHaveBeenCalledWith(expect.objectContaining({
      id: `channel-pending-auth:${requestId}`,
      authorizationRequestId: requestId,
      conversationStateId: 'conversation-1',
      threadKey: 'group:owo-demo:actor:user-1'
    }))
  })

  it('keeps the triggering requester separate from the credential subject', () => {
    const decision = resolveChannelApproval({
      actorAccountId: 'ou_requester',
      actorUserId: 'user-requester',
      capability: 'drive.file.read',
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelType: 'lark',
      conversationStateId: 'conversation-1',
      createAuthorizationRequest: true,
      credential: {
        credentialKey: 'lark-user',
        requiredScopes: ['drive:drive:readonly'],
        subjectUserId: 'user-owner'
      },
      sessionType: 'group',
      source: 'natural_language',
      threadKey: 'group:owo-demo:actor:user-requester'
    })

    const requestId = decision.authorizationRequest?.id
    expect(decision).toMatchObject({
      actorAccountId: 'ou_requester',
      actorUserId: 'user-requester',
      credentialSubjectUserId: 'user-owner',
      reasonCode: 'credential-missing',
      status: 'ask_resource_owner'
    })
    expect(createChannelAuthorizationRequest).toHaveBeenCalledWith(expect.objectContaining({
      id: requestId,
      credentialSubjectUserId: 'user-owner',
      requesterAccountId: 'ou_requester',
      requesterUserId: 'user-requester'
    }))
    expect(upsertChannelPendingIntent).toHaveBeenCalledWith(expect.objectContaining({
      authorizationRequestId: requestId,
      ownerAccountId: 'ou_requester',
      ownerUserId: 'user-owner',
      payload: expect.objectContaining({
        credentialSubjectUserId: 'user-owner'
      })
    }))
  })
})
