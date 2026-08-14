/* eslint-disable max-lines -- command authority integration cases share one mocked channel-runtime fixture. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { invokeChannelCommandForState } from '#~/channels/command-invocation.js'
import type { ChannelRuntimeState } from '#~/channels/types.js'
import { getDb } from '#~/db/index.js'
import { createChannelCommandInvocationToken } from '#~/services/channel-commands/invocation-token.js'
import { listReadyChannelResumeIntents, resumeReadyChannelIntents } from '#~/services/channel-resume/index.js'
import { handleInteractionResponse } from '#~/services/session/interaction.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

vi.mock('#~/services/adapter-accounts.js', () => ({
  createServerAdapterAccountContext: vi.fn(),
  isMissingAdapterPackageError: vi.fn(() => false)
}))

vi.mock('#~/services/session/index.js', () => ({
  killSession: vi.fn(),
  processUserMessage: vi.fn(),
  startAdapterSession: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('#~/services/session/interaction.js', () => ({
  getSessionInteraction: vi.fn(),
  handleInteractionResponse: vi.fn().mockResolvedValue(true),
  notifySessionUpdated: vi.fn()
}))

vi.mock('#~/services/channel-resume/index.js', () => ({
  listReadyChannelResumeIntents: vi.fn().mockReturnValue([]),
  resumeReadyChannelIntents: vi.fn().mockResolvedValue([])
}))

vi.mock('#~/services/session/runtime.js', () => ({
  notifySessionUpdated: vi.fn()
}))

vi.mock('#~/services/session/workspace.js', () => ({
  resolveSessionWorkspace: vi.fn().mockResolvedValue(undefined)
}))

const createChannelCommandRun = vi.fn()
const finishChannelCommandRun = vi.fn()
const finishChannelOutboundOperation = vi.fn()
const getChannelAuthorizationRequest = vi.fn()
const getChannelChildSessionRun = vi.fn()
const getChannelCommandRun = vi.fn()
const getChannelIdentityLink = vi.fn()
const getChannelPreference = vi.fn()
const getChannelSession = vi.fn()
const getChannelSessionBySessionId = vi.fn()
const getCanonicalUser = vi.fn()
const getSession = vi.fn()
const getSessionRuntimeState = vi.fn()
const getSessions = vi.fn()
const listChannelUserCredentials = vi.fn()
const listOpenChannelPendingIntents = vi.fn()
const listPendingChannelAuthorizationRequestsForAccount = vi.fn()
const listPendingChannelAuthorizationRequestsForUser = vi.fn()
const resolveCanonicalUserByChannelAccount = vi.fn()
const resolveChannelAuthorizationRequestRecord = vi.fn()
const updateChannelAuthorizationRequest = vi.fn()
const updateChannelCommandRunMetadata = vi.fn()
const updateChannelPendingIntent = vi.fn()
const upsertChannelAccount = vi.fn()
const upsertChannelPreference = vi.fn()

const makeState = (connection?: ChannelRuntimeState['connection']): ChannelRuntimeState => ({
  key: 'lark-main',
  type: 'lark',
  status: 'connected',
  config: {
    type: 'lark',
    access: {
      admins: ['admin1']
    }
  },
  configSource: 'project',
  connection,
  channelLinks: [
    {
      channelKey: 'lark-main',
      definition: {} as never,
      entity: 'owo-demo',
      external: {
        chatId: 'oc_1',
        type: 'chat'
      },
      ingress: {
        ambientRouting: false,
        createOnCommand: true,
        createOnMention: true,
        createOnPendingIntent: true,
        createOnReplyToBot: true
      },
      name: 'wan-ke-chat',
      path: '/workspace/.oo/channels/wan-ke-chat/channel.json',
      routing: { accounts: {}, default: {}, modes: {}, users: {} }
    }
  ]
})

const makeInvocationToken = () =>
  createChannelCommandInvocationToken({
    channelKey: 'lark-main',
    childRunId: 'child-run-1',
    sessionId: 'sess-1'
  })

const activeChildRunStatuses = ['started', 'dispatched', 'running'] as const
const terminalChildRunStatuses = ['completed', 'blocked', 'failed', 'expired'] as const

const makeChildRun = (overrides: Record<string, unknown> = {}) => ({
  actorAccountId: 'admin1',
  actorUserId: 'user-admin',
  channelId: 'oc_1',
  channelKey: 'lark-main',
  channelLinkName: 'wan-ke-chat',
  channelType: 'lark',
  entity: 'owo-demo',
  id: 'child-run-1',
  messageId: 'om_1',
  senderId: 'admin1',
  sessionType: 'group',
  status: 'started',
  threadKey: 'group:owo-demo:actor:user-admin',
  ...overrides
})

const makeActorSnapshot = (overrides: Record<string, unknown> = {}) => ({
  actorAccountId: 'admin1',
  actorUserId: 'user-admin',
  channelId: 'oc_1',
  channelKey: 'lark-main',
  channelLinkName: 'wan-ke-chat',
  channelType: 'lark',
  childRunId: 'child-run-1',
  entity: 'owo-demo',
  messageId: 'om_1',
  senderId: 'admin1',
  sessionId: 'sess-1',
  sessionType: 'group',
  ...overrides
})

beforeEach(() => {
  vi.clearAllMocks()
  upsertChannelAccount.mockImplementation(input => ({
    accountId: input.accountId,
    accountKey: `${input.channelType}:${input.accountId}`,
    avatarUrl: null,
    channelType: 'lark',
    createdAt: 1,
    displayName: null,
    metadata: null,
    updatedAt: 1
  }))
  getChannelIdentityLink.mockReturnValue({
    accountId: 'admin1',
    channelType: 'lark',
    createdAt: 1,
    source: 'manual',
    status: 'verified',
    updatedAt: 1,
    userId: 'user-admin'
  })
  resolveCanonicalUserByChannelAccount.mockReturnValue({
    createdAt: 1,
    displayName: 'Admin',
    id: 'user-admin',
    updatedAt: 1
  })
  getChannelSession.mockReturnValue({ sessionId: 'sess-1' })
  getChannelPreference.mockReturnValue(undefined)
  getChannelChildSessionRun.mockReturnValue(makeChildRun())
  getChannelSessionBySessionId.mockReturnValue({
    channelId: 'oc_1',
    channelKey: 'lark-main',
    channelType: 'lark',
    replyReceiveId: 'oc_1',
    replyReceiveIdType: 'chat_id',
    senderId: 'admin1',
    sessionId: 'sess-1',
    sessionType: 'group'
  })
  getCanonicalUser.mockImplementation((id: string) =>
    id === 'user-admin'
      ? {
        createdAt: 1,
        displayName: 'Admin',
        id: 'user-admin',
        updatedAt: 1
      }
      : undefined
  )
  getSession.mockReturnValue(undefined)
  getSessionRuntimeState.mockReturnValue({
    channelActorSnapshot: makeActorSnapshot()
  })
  getSessions.mockReturnValue([])
  listChannelUserCredentials.mockReturnValue([])
  createChannelCommandRun.mockReturnValue({ id: 'cmd-run-1', status: 'started' })
  finishChannelCommandRun.mockReturnValue({ id: 'cmd-run-1', status: 'success' })
  getChannelCommandRun.mockReturnValue({
    id: 'cmd-run-1',
    metadata: { effect: { effect: 'external-write', operation: 'channel.send' } }
  })
  finishChannelOutboundOperation.mockReturnValue({ operationId: 'operation-1', status: 'sent' })
  getChannelAuthorizationRequest.mockReturnValue({
    allowedApprovers: ['user:user-admin', 'account:lark-main:admin1'],
    capability: 'im.chat.member.add',
    channelId: 'oc_1',
    channelKey: 'lark-main',
    channelLinkName: 'wan-ke-chat',
    channelType: 'lark',
    createdAt: 1,
    credentialKey: null,
    expiresAt: null,
    id: 'auth-1',
    issuerKey: 'lark-main',
    message: '拉群',
    metadata: {
      allowedApproverRefs: ['admin1', 'user-admin'],
      channelId: 'oc_1',
      channelKey: 'lark-main',
      interactionId: 'interaction-1',
      sessionId: 'sess-1'
    },
    requesterAccountId: 'ou_1',
    requesterUserId: 'user-yijie',
    resolvedAt: null,
    status: 'pending',
    updatedAt: 1
  })
  listPendingChannelAuthorizationRequestsForAccount.mockReturnValue([])
  listPendingChannelAuthorizationRequestsForUser.mockReturnValue([])
  resolveChannelAuthorizationRequestRecord.mockImplementation(input => ({
    ...getChannelAuthorizationRequest(),
    resolvedAt: input.resolvedAt,
    status: input.status
  }))
  vi.mocked(listReadyChannelResumeIntents).mockReturnValue([])
  listOpenChannelPendingIntents.mockReturnValue([
    {
      id: 'pending-auth-1',
      metadata: {
        reasonCode: 'session-permission-required'
      }
    }
  ])
  vi.mocked(getDb).mockReturnValue({
    claimChannelOutboundOperation: vi.fn(input => ({
      claimed: true,
      operation: { operationId: input.operationId, status: 'pending' }
    })),
    createChannelCommandRun,
    deleteChannelSession: vi.fn(),
    deleteChannelSessionBySessionId: vi.fn(),
    finishChannelCommandRun,
    finishChannelOutboundOperation,
    getChannelAuthorizationRequest,
    getChannelChildSessionRun,
    getChannelCommandRun,
    getChannelIdentityLink,
    getChannelPreference,
    getChannelSession,
    getChannelSessionBySessionId,
    getCanonicalUser,
    getSession,
    getSessionRuntimeState,
    getSessions,
    listChannelUserCredentials,
    listOpenChannelPendingIntents,
    listPendingChannelAuthorizationRequestsForAccount,
    listPendingChannelAuthorizationRequestsForUser,
    resolveCanonicalUserByChannelAccount,
    resolveChannelAuthorizationRequest: resolveChannelAuthorizationRequestRecord,
    updateChannelAuthorizationRequest,
    updateChannelCommandRunMetadata,
    updateChannelPendingIntent,
    updateSession: vi.fn(),
    updateSessionArchivedWithChildren: vi.fn(),
    upsertChannelAccount,
    upsertChannelPreference,
    upsertChannelSession: vi.fn()
  } as any)
})

describe('invokeChannelCommandForState', () => {
  it.each(activeChildRunStatuses)(
    'sends through an active %s child-run sender context without channel-specific approval',
    async status => {
      const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_sent' })
      getChannelChildSessionRun.mockReturnValueOnce(makeChildRun({ status }))

      const result = await invokeChannelCommandForState(makeState({ sendMessage }), {
        input: {
          message: 'done',
          target: {
            channelId: 'oc_release',
            channelKey: 'lark-main',
            channelType: 'lark',
            receiveId: 'oc_release',
            receiveIdType: 'chat_id'
          }
        },
        invocationToken: makeInvocationToken(),
        toolName: 'channel.send'
      })

      expect(result).toMatchObject({
        ok: true,
        result: { commandPath: ['/send'], source: 'natural_language', status: 'success' }
      })
      expect(sendMessage).toHaveBeenCalledWith({
        receiveId: 'oc_release',
        receiveIdType: 'chat_id',
        text: 'done'
      })
      expect(createChannelCommandRun).toHaveBeenCalledWith(expect.objectContaining({
        actorAccountId: 'admin1',
        actorUserId: 'user-admin',
        metadata: expect.objectContaining({
          authorization: { status: 'allow', strategy: 'sender-permission' },
          effect: expect.objectContaining({ effect: 'external-write', operation: 'channel.send' })
        }),
        senderId: 'admin1'
      }))
      expect(createChannelCommandRun.mock.calls[0]?.[0]?.metadata).not.toHaveProperty('approval')
    }
  )

  it.each(terminalChildRunStatuses)(
    'rejects external writes from a terminal %s child run',
    async status => {
      const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_sent' })
      getChannelChildSessionRun.mockReturnValueOnce(makeChildRun({ status }))

      const result = await invokeChannelCommandForState(makeState({ sendMessage }), {
        input: {
          message: 'done',
          target: {
            channelId: 'oc_release',
            channelKey: 'lark-main',
            channelType: 'lark',
            receiveId: 'oc_release',
            receiveIdType: 'chat_id'
          }
        },
        invocationToken: makeInvocationToken(),
        toolName: 'channel.send'
      })

      expect(result).toMatchObject({
        ok: false,
        statusCode: 403,
        message: expect.stringContaining('authority is unavailable or inconsistent')
      })
      expect(sendMessage).not.toHaveBeenCalled()
      expect(createChannelCommandRun).not.toHaveBeenCalled()
    }
  )

  it('invokes channel command tools with the current sender as actor', async () => {
    const result = await invokeChannelCommandForState(makeState(), {
      input: {
        id: 'auth-1'
      },
      invocationToken: makeInvocationToken(),
      toolName: 'channel.auth.grant'
    })

    expect(result).toMatchObject({
      ok: true,
      replies: ['授权请求 auth-1 已标记为 已批准。'],
      result: {
        commandPath: ['/auth', 'grant'],
        source: 'natural_language',
        status: 'success'
      }
    })
    expect(upsertChannelAccount).toHaveBeenCalledWith({
      accountId: 'admin1',
      channelType: 'lark',
      issuerKey: 'lark-main'
    })
    expect(resolveChannelAuthorizationRequestRecord).toHaveBeenCalledWith({
      id: 'auth-1',
      resolvedAt: expect.any(Number),
      status: 'granted'
    })
    expect(updateChannelPendingIntent).toHaveBeenCalledWith('pending-auth-1', {
      metadata: expect.objectContaining({
        authorizationStatus: 'granted',
        resolvedByAccountId: 'admin1',
        resolvedByUserId: 'user-admin'
      }),
      resolvedAt: expect.any(Number),
      status: 'resolved'
    })
    expect(handleInteractionResponse).toHaveBeenCalledWith('sess-1', 'interaction-1', 'allow_once')
    expect(resumeReadyChannelIntents).toHaveBeenCalledWith({
      filter: {
        authorizationRequestId: 'auth-1'
      },
      limit: 20
    })
    expect(createChannelCommandRun).toHaveBeenCalledWith(expect.objectContaining({
      actorAccountId: 'admin1',
      actorUserId: 'user-admin',
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      commandPath: ['/auth', 'grant'],
      entity: 'owo-demo',
      messageId: 'om_1',
      permission: 'everyone',
      rawArgs: ['auth-1'],
      senderId: 'admin1',
      sessionType: 'group',
      source: 'natural_language'
    }))
  })

  it('invokes manual authorization resume through the same sender-scoped path', async () => {
    vi.mocked(resumeReadyChannelIntents).mockResolvedValueOnce([
      {
        intentId: 'pending-auth-1',
        resumeChildRunId: 'resume-run-1',
        sessionId: 'sess-1',
        status: 'dispatched'
      }
    ])

    const result = await invokeChannelCommandForState(makeState(), {
      input: {
        id: 'auth-1'
      },
      invocationToken: makeInvocationToken(),
      toolName: 'channel.auth.resume'
    })

    expect(result).toMatchObject({
      ok: true,
      replies: ['授权请求 auth-1 已触发 1 个恢复任务。'],
      result: {
        commandPath: ['/auth', 'resume'],
        source: 'natural_language',
        status: 'success'
      }
    })
    expect(resumeReadyChannelIntents).toHaveBeenCalledWith({
      filter: {
        authorizationRequestId: 'auth-1'
      },
      includeDeferred: true,
      limit: 20
    })
    expect(updateChannelAuthorizationRequest).not.toHaveBeenCalled()
    expect(createChannelCommandRun).toHaveBeenCalledWith(expect.objectContaining({
      actorAccountId: 'admin1',
      actorUserId: 'user-admin',
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      commandPath: ['/auth', 'resume'],
      entity: 'owo-demo',
      messageId: 'om_1',
      permission: 'admin',
      rawArgs: ['auth-1'],
      senderId: 'admin1',
      sessionType: 'group',
      source: 'natural_language'
    }))
  })

  it('uses the session actor snapshot when invoking command tools from a channel session', async () => {
    getChannelChildSessionRun.mockReturnValueOnce(makeChildRun({ messageId: 'om_snapshot' }))
    getSessionRuntimeState.mockReturnValueOnce({
      channelActorSnapshot: makeActorSnapshot({ messageId: 'om_snapshot' })
    })

    const result = await invokeChannelCommandForState(makeState(), {
      input: {
        id: 'auth-1'
      },
      invocationToken: makeInvocationToken(),
      toolName: 'channel.auth.grant'
    })

    expect(result).toMatchObject({
      ok: true,
      replies: ['授权请求 auth-1 已标记为 已批准。'],
      result: {
        commandPath: ['/auth', 'grant'],
        status: 'success'
      }
    })
    expect(createChannelCommandRun).toHaveBeenCalledWith(expect.objectContaining({
      actorAccountId: 'admin1',
      actorUserId: 'user-admin',
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelLinkName: 'wan-ke-chat',
      commandPath: ['/auth', 'grant'],
      entity: 'owo-demo',
      messageId: 'om_snapshot',
      senderId: 'admin1',
      sessionType: 'group',
      source: 'natural_language'
    }))
  })

  it('accepts a threadless binding returned from SQLite with a null thread id', async () => {
    getChannelSessionBySessionId.mockReturnValueOnce({
      channelId: 'oc_1',
      channelKey: 'lark-main',
      channelType: 'lark',
      replyReceiveId: 'oc_1',
      replyReceiveIdType: 'chat_id',
      senderId: 'admin1',
      sessionId: 'sess-1',
      sessionType: 'group',
      threadId: null
    })

    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_sent' })
    const result = await invokeChannelCommandForState(makeState({ sendMessage }), {
      input: {
        message: 'done',
        target: {
          channelId: 'oc_1',
          channelKey: 'lark-main',
          channelType: 'lark',
          receiveId: 'oc_1',
          receiveIdType: 'chat_id'
        }
      },
      invocationToken: makeInvocationToken(),
      toolName: 'channel.send'
    })

    expect(result).toMatchObject({ ok: true })
    expect(sendMessage).toHaveBeenCalledOnce()
  })

  it('invokes whoami against the authoritative session actor snapshot', async () => {
    getChannelChildSessionRun.mockReturnValueOnce(makeChildRun({ messageId: 'om_snapshot' }))
    getSessionRuntimeState.mockReturnValueOnce({
      channelActorSnapshot: makeActorSnapshot({ messageId: 'om_snapshot' })
    })
    listChannelUserCredentials.mockReturnValueOnce([
      {
        channelType: 'lark',
        createdAt: 1,
        credentialKey: 'lark-user',
        expiresAt: null,
        issuerKey: 'lark-main',
        metadata: null,
        scopes: ['im:message'],
        status: 'active',
        updatedAt: 1,
        userId: 'user-admin'
      }
    ])

    const result = await invokeChannelCommandForState(makeState(), {
      invocationToken: makeInvocationToken(),
      toolName: 'channel.whoami'
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        commandPath: ['/whoami'],
        status: 'success'
      }
    })
    expect(result.ok === true ? result.replies[0] : '').toContain('发送者：admin1')
    expect(result.ok === true ? result.replies[0] : '').toContain('统一用户：user-admin')
    expect(result.ok === true ? result.replies[0] : '').toContain('可执行凭证：1 个')
    expect(listChannelUserCredentials).toHaveBeenCalledWith('lark-main', 'user-admin')
    expect(createChannelCommandRun).toHaveBeenCalledWith(expect.objectContaining({
      actorAccountId: 'admin1',
      actorUserId: 'user-admin',
      commandPath: ['/whoami'],
      messageId: 'om_snapshot',
      senderId: 'admin1',
      source: 'natural_language'
    }))
  })

  it('rejects a tampered child-run token before creating a command run', async () => {
    const result = await invokeChannelCommandForState(makeState(), {
      input: {
        id: 'auth-1'
      },
      invocationToken: `${makeInvocationToken()}-tampered`,
      toolName: 'channel.auth.grant'
    })

    expect(result).toMatchObject({
      ok: false,
      statusCode: 403,
      message: expect.stringContaining('invalid or expired')
    })
    expect(createChannelCommandRun).not.toHaveBeenCalled()
    expect(updateChannelAuthorizationRequest).not.toHaveBeenCalled()
  })

  it('does not let an unlisted sender resolve a request through forged command context', async () => {
    getChannelChildSessionRun.mockReturnValueOnce(makeChildRun({
      actorAccountId: 'user1',
      actorUserId: 'user-regular',
      senderId: 'user1'
    }))
    getSessionRuntimeState.mockReturnValueOnce({
      channelActorSnapshot: makeActorSnapshot({
        actorAccountId: 'user1',
        actorUserId: 'user-regular',
        senderId: 'user1'
      })
    })
    const result = await invokeChannelCommandForState(makeState(), {
      context: {
        actorAccountId: 'admin1',
        actorUserId: 'user-admin',
        channelId: 'oc_1',
        senderId: 'admin1',
        sessionId: 'sess-1',
        sessionType: 'group'
      },
      input: {
        id: 'auth-1'
      },
      invocationToken: makeInvocationToken(),
      toolName: 'channel.auth.grant'
    })

    expect(result).toMatchObject({
      ok: true,
      replies: ['授权请求 auth-1 不属于当前频道、当前审批人，或已经处理。'],
      result: {
        commandPath: ['/auth', 'grant'],
        status: 'success'
      }
    })
    expect(updateChannelAuthorizationRequest).not.toHaveBeenCalled()
    expect(resolveChannelAuthorizationRequestRecord).not.toHaveBeenCalled()
  })
})
