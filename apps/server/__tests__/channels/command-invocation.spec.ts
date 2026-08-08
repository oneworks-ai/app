import { beforeEach, describe, expect, it, vi } from 'vitest'

import { invokeChannelCommandForState } from '#~/channels/command-invocation.js'
import type { ChannelRuntimeState } from '#~/channels/types.js'
import { getDb } from '#~/db/index.js'
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
  startAdapterSession: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('#~/services/session/interaction.js', () => ({
  handleInteractionResponse: vi.fn().mockResolvedValue(true)
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
const getChannelAuthorizationRequest = vi.fn()
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
const updateChannelAuthorizationRequest = vi.fn()
const updateChannelPendingIntent = vi.fn()
const upsertChannelAccount = vi.fn()
const upsertChannelPreference = vi.fn()

const makeState = (): ChannelRuntimeState => ({
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
  channelLinks: [
    {
      channelKey: 'lark-main',
      definition: {} as never,
      entity: 'owo-demo',
      external: {
        chatId: 'oc_1',
        type: 'chat'
      },
      name: 'wan-ke-chat',
      path: '/workspace/.oo/channels/wan-ke-chat/channel.json'
    }
  ]
})

beforeEach(() => {
  vi.clearAllMocks()
  upsertChannelAccount.mockReturnValue({
    accountId: 'admin1',
    accountKey: 'lark:admin1',
    avatarUrl: null,
    channelType: 'lark',
    createdAt: 1,
    displayName: null,
    metadata: null,
    updatedAt: 1
  })
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
  getChannelSessionBySessionId.mockReturnValue(undefined)
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
  getSessionRuntimeState.mockReturnValue(undefined)
  getSessions.mockReturnValue([])
  listChannelUserCredentials.mockReturnValue([])
  createChannelCommandRun.mockReturnValue({ id: 'cmd-run-1', status: 'started' })
  finishChannelCommandRun.mockReturnValue({ id: 'cmd-run-1', status: 'success' })
  getChannelAuthorizationRequest.mockReturnValue({
    capability: 'im.chat.member.add',
    channelLinkName: 'wan-ke-chat',
    channelType: 'lark',
    createdAt: 1,
    credentialKey: null,
    expiresAt: null,
    id: 'auth-1',
    message: '拉群',
    metadata: {
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
    createChannelCommandRun,
    deleteChannelSession: vi.fn(),
    deleteChannelSessionBySessionId: vi.fn(),
    finishChannelCommandRun,
    getChannelAuthorizationRequest,
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
    updateChannelAuthorizationRequest,
    updateChannelPendingIntent,
    updateSession: vi.fn(),
    updateSessionArchivedWithChildren: vi.fn(),
    upsertChannelAccount,
    upsertChannelPreference,
    upsertChannelSession: vi.fn()
  } as any)
})

describe('invokeChannelCommandForState', () => {
  it('invokes channel command tools with the current sender as actor', async () => {
    const result = await invokeChannelCommandForState(makeState(), {
      context: {
        channelId: 'oc_1',
        messageId: 'om_1',
        senderId: 'admin1',
        sessionId: 'sess-1',
        sessionType: 'group'
      },
      input: {
        id: 'auth-1'
      },
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
      channelType: 'lark'
    })
    expect(updateChannelAuthorizationRequest).toHaveBeenCalledWith('auth-1', {
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
      permission: 'admin',
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
      context: {
        channelId: 'oc_1',
        messageId: 'om_1',
        senderId: 'admin1',
        sessionId: 'sess-1',
        sessionType: 'group'
      },
      input: {
        id: 'auth-1'
      },
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
    getSessionRuntimeState.mockReturnValueOnce({
      channelActorSnapshot: {
        actorAccountId: 'admin1',
        actorUserId: 'user-admin',
        channelId: 'oc_1',
        channelKey: 'lark-main',
        channelLinkName: 'wan-ke-chat',
        channelType: 'lark',
        entity: 'owo-demo',
        messageId: 'om_snapshot',
        senderId: 'admin1',
        sessionId: 'sess-1',
        sessionType: 'group'
      }
    })

    const result = await invokeChannelCommandForState(makeState(), {
      input: {
        id: 'auth-1'
      },
      sessionId: 'sess-1',
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

  it('invokes whoami against the authoritative session actor snapshot', async () => {
    getSessionRuntimeState.mockReturnValueOnce({
      channelActorSnapshot: {
        actorAccountId: 'admin1',
        actorUserId: 'user-admin',
        channelId: 'oc_1',
        channelKey: 'lark-main',
        channelLinkName: 'wan-ke-chat',
        channelType: 'lark',
        entity: 'owo-demo',
        messageId: 'om_snapshot',
        senderId: 'admin1',
        sessionId: 'sess-1',
        sessionType: 'group'
      }
    })
    listChannelUserCredentials.mockReturnValueOnce([
      {
        channelType: 'lark',
        createdAt: 1,
        credentialKey: 'lark-user',
        expiresAt: null,
        id: 'cred-1',
        metadata: null,
        scopes: ['im:message'],
        status: 'active',
        updatedAt: 1,
        userId: 'user-admin'
      }
    ])

    const result = await invokeChannelCommandForState(makeState(), {
      sessionId: 'sess-1',
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
    expect(listChannelUserCredentials).toHaveBeenCalledWith('user-admin', 'lark')
    expect(createChannelCommandRun).toHaveBeenCalledWith(expect.objectContaining({
      actorAccountId: 'admin1',
      actorUserId: 'user-admin',
      commandPath: ['/whoami'],
      messageId: 'om_snapshot',
      senderId: 'admin1',
      source: 'natural_language'
    }))
  })

  it('rejects command tool context that conflicts with the session actor snapshot', async () => {
    getSessionRuntimeState.mockReturnValueOnce({
      channelActorSnapshot: {
        actorAccountId: 'user1',
        actorUserId: 'user-regular',
        channelId: 'oc_1',
        channelKey: 'lark-main',
        channelType: 'lark',
        messageId: 'om_snapshot',
        senderId: 'user1',
        sessionId: 'sess-1',
        sessionType: 'group'
      }
    })

    const result = await invokeChannelCommandForState(makeState(), {
      context: {
        channelId: 'oc_1',
        senderId: 'admin1',
        sessionId: 'sess-1',
        sessionType: 'group'
      },
      input: {
        id: 'auth-1'
      },
      toolName: 'channel.auth.grant'
    })

    expect(result).toMatchObject({
      ok: false,
      statusCode: 403,
      message: expect.stringContaining('senderId')
    })
    expect(createChannelCommandRun).not.toHaveBeenCalled()
    expect(updateChannelAuthorizationRequest).not.toHaveBeenCalled()
  })

  it('does not let non-admin senders perform admin command tools', async () => {
    const result = await invokeChannelCommandForState(makeState(), {
      context: {
        channelId: 'oc_1',
        senderId: 'user1',
        sessionType: 'group'
      },
      input: {
        id: 'auth-1'
      },
      toolName: 'channel.auth.grant'
    })

    expect(result).toMatchObject({
      ok: true,
      replies: ['您没有权限执行该操作，只有管理员才能执行该指令。'],
      result: {
        commandPath: ['/auth', 'grant'],
        status: 'denied'
      }
    })
    expect(updateChannelAuthorizationRequest).not.toHaveBeenCalled()
    expect(finishChannelCommandRun).toHaveBeenCalledWith('cmd-run-1', {
      status: 'denied'
    })
  })
})
