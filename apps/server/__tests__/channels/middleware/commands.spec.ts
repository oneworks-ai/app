import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelContext } from '#~/channels/middleware/@types/index.js'
import {
  channelCommandMiddleware,
  invokeChannelCommandTool,
  listChannelCommandTools
} from '#~/channels/middleware/commands/index.js'
import { createT, defineMessages } from '#~/channels/middleware/i18n.js'
import { deleteBinding } from '#~/channels/state.js'
import { getDb } from '#~/db/index.js'
import { listReadyChannelResumeIntents, resumeReadyChannelIntents } from '#~/services/channel-resume/index.js'
import { loadConfigState } from '#~/services/config/index.js'
import { killSession, startAdapterSession } from '#~/services/session/index.js'
import { handleInteractionResponse } from '#~/services/session/interaction.js'
import { updateConfigFile } from '@oneworks/config'
import type { SessionWorkspace } from '@oneworks/core'

vi.mock('@oneworks/config', () => ({
  updateConfigFile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: vi.fn().mockResolvedValue({
    globalSource: { rawConfig: { channels: {} }, resolvedConfig: { channels: {} } },
    projectSource: { rawConfig: { channels: {} }, resolvedConfig: { channels: {} } },
    userSource: { rawConfig: { channels: {} }, resolvedConfig: { channels: {} } }
  })
}))

vi.mock('#~/services/session/interaction.js', () => ({
  getSessionInteraction: vi.fn(),
  handleInteractionResponse: vi.fn().mockResolvedValue(true)
}))

vi.mock('#~/services/channel-resume/index.js', () => ({
  listReadyChannelResumeIntents: vi.fn().mockReturnValue([]),
  resumeReadyChannelIntents: vi.fn().mockResolvedValue([])
}))

vi.mock('#~/channels/state.js', () => ({
  deleteBinding: vi.fn()
}))

vi.mock('#~/services/session/index.js', () => ({
  getSessionInteraction: vi.fn(),
  killSession: vi.fn(),
  processUserMessage: vi.fn(),
  startAdapterSession: vi.fn().mockResolvedValue(undefined)
}))

const deleteChannelSessionBySessionId = vi.fn()
const deleteChannelSession = vi.fn()
const consumeChannelIdentityLinkCode = vi.fn()
const createChannelIdentityLinkCode = vi.fn()
const getChannelSession = vi.fn()
const getChannelSessionBySessionId = vi.fn()
const getSessions = vi.fn()
const getSession = vi.fn()
const createChannelAuthorizationRequest = vi.fn()
const createChannelCommandRun = vi.fn()
const ensureCanonicalUser = vi.fn()
const finishChannelCommandRun = vi.fn()
const getChannelAuthorizationRequest = vi.fn()
const listOpenChannelPendingIntents = vi.fn()
const listChannelAccountsForUser = vi.fn()
const listChannelUserCredentials = vi.fn()
const listPendingChannelAuthorizationRequestsForAccount = vi.fn()
const listPendingChannelAuthorizationRequestsForUser = vi.fn()
const linkChannelAccountToUser = vi.fn()
const resolveCanonicalUserByChannelAccount = vi.fn()
const resolveChannelAuthorizationRequestRecord = vi.fn()
const resolveSessionWorkspace = vi.fn()
const updateSession = vi.fn()
const updateChannelAuthorizationRequest = vi.fn()
const updateChannelPendingIntent = vi.fn()
const updateSessionArchivedWithChildren = vi.fn()
const upsertChannelAccount = vi.fn()
const upsertChannelPreference = vi.fn()
const upsertChannelSession = vi.fn()

const makeInbound = (overrides: Record<string, unknown> = {}) => ({
  channelType: 'lark',
  channelId: 'ch1',
  sessionType: 'direct' as const,
  messageId: 'm1',
  senderId: 'user1',
  ack: vi.fn().mockResolvedValue(undefined),
  unack: vi.fn().mockResolvedValue(undefined),
  ...overrides
})

const makeCtx = (overrides: Partial<ChannelContext> = {}): ChannelContext => {
  const ctx: ChannelContext = {
    channelKey: 'lark:default',
    configSource: 'project',
    inbound: makeInbound() as any,
    connection: undefined,
    config: undefined,
    sessionId: 'sess-abc',
    channelAdapter: undefined,
    channelPermissionMode: undefined,
    channelEffort: undefined,
    contentItems: undefined,
    commandText: '',
    defineMessages,
    t: createT(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    pushFollowUps: vi.fn().mockResolvedValue(undefined),
    getBoundSession: vi.fn(),
    searchSessions: vi.fn(),
    bindSession: vi.fn(),
    unbindSession: vi.fn(),
    resetSession: vi.fn(),
    stopSession: vi.fn(),
    restartSession: vi.fn().mockResolvedValue(undefined),
    resolveSessionWorkspace: vi.fn(),
    updateSession: vi.fn(),
    getChannelAdapterPreference: vi.fn(() => ctx.channelAdapter),
    setChannelAdapterPreference: vi.fn((adapter?: string) => {
      ctx.channelAdapter = adapter
      upsertChannelPreference({
        channelType: ctx.inbound.channelType,
        sessionType: ctx.inbound.sessionType,
        channelId: ctx.inbound.channelId,
        channelKey: ctx.channelKey,
        adapter,
        permissionMode: ctx.channelPermissionMode
      })
    }),
    getChannelPermissionModePreference: vi.fn(() => ctx.channelPermissionMode),
    setChannelPermissionModePreference: vi.fn((permissionMode) => {
      ctx.channelPermissionMode = permissionMode
      upsertChannelPreference({
        channelType: ctx.inbound.channelType,
        sessionType: ctx.inbound.sessionType,
        channelId: ctx.inbound.channelId,
        channelKey: ctx.channelKey,
        adapter: ctx.channelAdapter,
        permissionMode
      })
    }),
    getChannelEffortPreference: vi.fn(() => ctx.channelEffort),
    setChannelEffortPreference: vi.fn((effort) => {
      ctx.channelEffort = effort
    }),
    ...overrides
  }

  // wire up default implementations that reference ctx
  if (!overrides.getBoundSession) {
    ctx.getBoundSession = vi.fn(() => ctx.sessionId ? getSession(ctx.sessionId) : undefined)
  }
  if (!overrides.searchSessions) {
    ctx.searchSessions = vi.fn((query: string) => {
      const normalized = query.trim().toLowerCase()
      return getSessions()
        .filter((session: any) => {
          const haystack = [
            session.id,
            session.title,
            session.lastMessage,
            session.lastUserMessage,
            session.model,
            session.adapter,
            ...(session.tags ?? [])
          ]
            .filter(Boolean)
            .join('\n')
            .toLowerCase()
          return haystack.includes(normalized)
        })
        .map((session: any) => ({
          session,
          binding: getChannelSessionBySessionId(session.id)
            ? {
              channelType: getChannelSessionBySessionId(session.id).channelType,
              sessionType: getChannelSessionBySessionId(session.id).sessionType,
              channelId: getChannelSessionBySessionId(session.id).channelId,
              channelKey: getChannelSessionBySessionId(session.id).channelKey
            }
            : undefined
        }))
    })
  }
  if (!overrides.bindSession) {
    ctx.bindSession = vi.fn((sessionId: string) => {
      const session = getSession(sessionId)
      if (!session) {
        return { alreadyBound: false }
      }
      const previous = getChannelSession(ctx.inbound.channelType, ctx.inbound.sessionType, ctx.inbound.channelId)
      const transferred = getChannelSessionBySessionId(sessionId)
      if (
        transferred &&
        (
          transferred.channelType !== ctx.inbound.channelType ||
          transferred.sessionType !== ctx.inbound.sessionType ||
          transferred.channelId !== ctx.inbound.channelId
        )
      ) {
        deleteChannelSession(transferred.channelType, transferred.sessionType, transferred.channelId)
      }
      upsertChannelSession({
        channelType: ctx.inbound.channelType,
        sessionType: ctx.inbound.sessionType,
        channelId: ctx.inbound.channelId,
        channelKey: ctx.channelKey,
        senderId: ctx.inbound.senderId,
        replyReceiveId: ctx.inbound.replyTo?.receiveId,
        replyReceiveIdType: ctx.inbound.replyTo?.receiveIdType,
        sessionId
      })
      ctx.sessionId = sessionId
      return {
        alreadyBound: previous?.sessionId === sessionId,
        session,
        previousSessionId: previous?.sessionId !== sessionId ? previous?.sessionId : undefined,
        transferredFrom: transferred == null
          ? undefined
          : {
            channelType: transferred.channelType,
            sessionType: transferred.sessionType,
            channelId: transferred.channelId,
            channelKey: transferred.channelKey
          }
      }
    })
  }
  if (!overrides.unbindSession) {
    ctx.unbindSession = vi.fn(() => {
      const current = getChannelSession(ctx.inbound.channelType, ctx.inbound.sessionType, ctx.inbound.channelId)
      if (!current?.sessionId) {
        return { sessionId: undefined }
      }
      deleteChannelSession(ctx.inbound.channelType, ctx.inbound.sessionType, ctx.inbound.channelId)
      ctx.sessionId = undefined
      return { sessionId: current.sessionId }
    })
  }
  if (!overrides.resetSession) {
    ctx.resetSession = vi.fn(() => {
      if (ctx.sessionId) {
        updateSessionArchivedWithChildren(ctx.sessionId, true)
        deleteChannelSessionBySessionId(ctx.sessionId)
        deleteBinding(ctx.sessionId)
        ctx.sessionId = undefined
      }
    })
  }
  if (!overrides.stopSession) {
    ctx.stopSession = vi.fn(() => {
      if (ctx.sessionId) killSession(ctx.sessionId)
    })
  }
  if (!overrides.restartSession) {
    ctx.restartSession = vi.fn(async () => {
      if (ctx.sessionId) {
        killSession(ctx.sessionId)
        await startAdapterSession(ctx.sessionId)
      }
    })
  }
  if (!overrides.updateSession) {
    ctx.updateSession = vi.fn((updates) => {
      if (ctx.sessionId) updateSession(ctx.sessionId, updates)
    })
  }
  if (!overrides.resolveSessionWorkspace) {
    ctx.resolveSessionWorkspace = vi.fn(async (sessionId?: string) => {
      const targetSessionId = sessionId ?? ctx.sessionId
      if (targetSessionId == null) {
        return undefined
      }
      return resolveSessionWorkspace(targetSessionId)
    })
  }

  return ctx
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadConfigState).mockResolvedValue({
    globalSource: { rawConfig: { channels: {} }, resolvedConfig: { channels: {} } },
    projectSource: { rawConfig: { channels: {} }, resolvedConfig: { channels: {} } },
    userSource: { rawConfig: { channels: {} }, resolvedConfig: { channels: {} } }
  } as any)
  getChannelSession.mockReturnValue({ sessionId: 'sess-abc' })
  getChannelSessionBySessionId.mockReturnValue(undefined)
  getSession.mockReturnValue({
    id: 'sess-abc',
    title: 'Session A',
    status: 'running',
    messageCount: 12,
    model: 'gpt-test',
    adapter: 'codex',
    permissionMode: 'plan',
    tags: ['tag-a'],
    isArchived: false,
    isStarred: true,
    lastMessage: 'Investigate lark resume failure',
    createdAt: Date.now()
  })
  getSessions.mockReturnValue([
    getSession(),
    {
      id: 'sess-other',
      title: 'Lark handoff window',
      status: 'completed',
      messageCount: 446,
      model: 'gpt-responses,gpt-5.4-2026-03-05',
      adapter: 'codex',
      tags: ['channel:lark:group:oc_790b0dd9fff1f5e216ac15bfbc257556'],
      isArchived: false,
      isStarred: false,
      lastMessage: 'Resume miniapp gear session after interruption',
      createdAt: Date.now()
    }
  ])
  upsertChannelAccount.mockImplementation((row: any) => ({
    issuerKey: row.issuerKey,
    channelType: row.channelType,
    accountId: row.accountId,
    accountKey: row.accountKey ?? `${row.channelType}:${row.accountId}`,
    displayName: row.displayName ?? null,
    avatarUrl: row.avatarUrl ?? null,
    metadata: row.metadata ?? null,
    createdAt: 1,
    updatedAt: 1
  }))
  ensureCanonicalUser.mockReturnValue({
    id: 'user-new',
    displayName: 'user1',
    createdAt: 1,
    updatedAt: 1
  })
  linkChannelAccountToUser.mockReturnValue({
    issuerKey: 'lark:default',
    channelType: 'lark',
    accountId: 'user1',
    userId: 'user-new',
    status: 'verified',
    source: 'self_claim',
    createdAt: 1,
    updatedAt: 1
  })
  createChannelIdentityLinkCode.mockImplementation((row: any) => ({
    code: row.code ?? 'ABCD1234',
    userId: row.userId,
    sourceChannelType: row.sourceChannelType,
    sourceIssuerKey: row.sourceIssuerKey,
    sourceAccountId: row.sourceAccountId,
    status: 'active',
    createdAt: 1,
    expiresAt: row.expiresAt,
    consumedAt: null,
    consumedChannelType: null,
    consumedIssuerKey: null,
    consumedAccountId: null,
    metadata: row.metadata ?? null
  }))
  consumeChannelIdentityLinkCode.mockReturnValue({
    link: {
      issuerKey: 'lark:default',
      channelType: 'lark',
      accountId: 'user1',
      userId: 'user-existing',
      status: 'verified',
      source: 'link_code',
      createdAt: 1,
      updatedAt: 1
    },
    status: 'consumed'
  })
  resolveCanonicalUserByChannelAccount.mockReturnValue(undefined)
  listChannelAccountsForUser.mockReturnValue([])
  listChannelUserCredentials.mockReturnValue([])
  createChannelAuthorizationRequest.mockReturnValue({
    id: 'auth-1',
    channelType: 'lark',
    issuerKey: 'lark:default',
    channelKey: 'lark:default',
    channelId: 'ch1',
    channelLinkName: 'wan-ke-chat',
    requesterUserId: 'user-yijie',
    requesterAccountId: 'ou_1',
    credentialKey: null,
    allowedApprovers: ['user:user-yijie', 'account:lark:default:admin1'],
    capability: 'im.chat.member.add',
    status: 'pending',
    message: '拉群',
    metadata: {
      allowedApproverRefs: ['admin1', 'user-yijie'],
      channelId: 'ch1',
      channelKey: 'lark:default',
      interactionId: 'interaction-1',
      sessionId: 'sess-abc'
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: null,
    resolvedAt: null
  })
  createChannelCommandRun.mockReturnValue({
    id: 'cmd-run-1',
    status: 'started'
  })
  finishChannelCommandRun.mockReturnValue({
    id: 'cmd-run-1',
    status: 'success'
  })
  getChannelAuthorizationRequest.mockReturnValue({
    id: 'auth-1',
    channelType: 'lark',
    issuerKey: 'lark:default',
    channelKey: 'lark:default',
    channelId: 'ch1',
    channelLinkName: 'wan-ke-chat',
    requesterUserId: 'user-yijie',
    requesterAccountId: 'ou_1',
    credentialKey: null,
    allowedApprovers: ['user:user-yijie', 'account:lark:default:admin1'],
    capability: 'im.chat.member.add',
    status: 'pending',
    message: '拉群',
    metadata: {
      allowedApproverRefs: ['admin1', 'user-yijie'],
      channelId: 'ch1',
      channelKey: 'lark:default',
      interactionId: 'interaction-1',
      sessionId: 'sess-abc'
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: null,
    resolvedAt: null
  })
  listPendingChannelAuthorizationRequestsForAccount.mockReturnValue([
    getChannelAuthorizationRequest()
  ])
  resolveChannelAuthorizationRequestRecord.mockImplementation(input => ({
    ...getChannelAuthorizationRequest(),
    resolvedAt: input.resolvedAt,
    status: input.status
  }))
  listPendingChannelAuthorizationRequestsForUser.mockReturnValue([
    getChannelAuthorizationRequest()
  ])
  vi.mocked(listReadyChannelResumeIntents).mockReturnValue([])
  listOpenChannelPendingIntents.mockReturnValue([
    {
      id: 'pending-auth-1',
      metadata: {
        reasonCode: 'session-permission-required'
      }
    }
  ])
  resolveSessionWorkspace.mockImplementation((sessionId: string): SessionWorkspace | undefined => (
    sessionId === 'sess-other'
      ? {
        sessionId,
        kind: 'managed_worktree',
        workspaceFolder: `/tmp/.oo/worktrees/sessions/${sessionId}`,
        repositoryRoot: `/tmp/.oo/worktrees/sessions/${sessionId}`,
        worktreePath: `/tmp/.oo/worktrees/sessions/${sessionId}`,
        baseRef: 'origin/main',
        cleanupPolicy: 'delete_on_session_delete',
        state: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      : {
        sessionId,
        kind: 'managed_worktree',
        workspaceFolder: `/tmp/.oo/worktrees/sessions/${sessionId}`,
        repositoryRoot: `/tmp/.oo/worktrees/sessions/${sessionId}`,
        worktreePath: `/tmp/.oo/worktrees/sessions/${sessionId}`,
        baseRef: 'HEAD',
        cleanupPolicy: 'delete_on_session_delete',
        state: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
  ))
  vi.mocked(getDb).mockReturnValue({
    consumeChannelIdentityLinkCode,
    createChannelIdentityLinkCode,
    deleteChannelSession,
    deleteChannelSessionBySessionId,
    ensureCanonicalUser,
    getChannelPreference: vi.fn().mockReturnValue(undefined),
    getChannelSession,
    getChannelSessionBySessionId,
    getSession,
    getSessions,
    createChannelAuthorizationRequest,
    createChannelCommandRun,
    finishChannelCommandRun,
    getChannelAuthorizationRequest,
    linkChannelAccountToUser,
    listChannelAccountsForUser,
    listOpenChannelPendingIntents,
    listChannelUserCredentials,
    listPendingChannelAuthorizationRequestsForAccount,
    listPendingChannelAuthorizationRequestsForUser,
    resolveCanonicalUserByChannelAccount,
    resolveChannelAuthorizationRequest: resolveChannelAuthorizationRequestRecord,
    updateChannelAuthorizationRequest,
    updateChannelPendingIntent,
    upsertChannelAccount,
    upsertChannelSession,
    upsertChannelPreference,
    updateSession,
    updateSessionArchivedWithChildren
  } as any)
})

// ── non-command ────────────────────────────────────────────────────────────

describe('non-command input', () => {
  it('calls next for regular text', async () => {
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({ commandText: 'hello world' })
    await channelCommandMiddleware(ctx, next)
    expect(next).toHaveBeenCalledOnce()
    expect(ctx.reply).not.toHaveBeenCalled()
    expect(createChannelCommandRun).not.toHaveBeenCalled()
  })

  it('calls next when commandText is empty', async () => {
    const next = vi.fn().mockResolvedValue(undefined)
    await channelCommandMiddleware(makeCtx({ commandText: '' }), next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('calls next for unknown slash commands', async () => {
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({ commandText: '/unknown' })
    await channelCommandMiddleware(ctx, next)
    expect(next).toHaveBeenCalledOnce()
    expect(ctx.reply).not.toHaveBeenCalled()
    expect(createChannelCommandRun).not.toHaveBeenCalled()
  })

  it('defers bare group commands when the channel link disables command intent', async () => {
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      channelLink: {
        channelKey: 'lark:default',
        definition: {} as never,
        entity: 'owo-demo',
        external: { type: 'chat', chatId: 'ch1' },
        ingress: {
          ambientRouting: false,
          createOnCommand: false,
          createOnMention: true,
          createOnPendingIntent: true,
          createOnReplyToBot: true
        },
        name: 'wan-ke-chat',
        path: '/workspace/.oo/channels/wan-ke-chat/channel.json',
        routing: { accounts: {}, default: {}, modes: {}, users: {} }
      },
      commandText: '/help',
      inbound: makeInbound({ sessionType: 'group', text: '/help' }) as any
    })

    await channelCommandMiddleware(ctx, next)

    expect(next).toHaveBeenCalledOnce()
    expect(ctx.inbound.ack).not.toHaveBeenCalled()
    expect(ctx.reply).not.toHaveBeenCalled()
    expect(createChannelCommandRun).not.toHaveBeenCalled()
  })

  it('handles group commands that structurally mention the current bot', async () => {
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      channelLink: {
        channelKey: 'lark:default',
        definition: {} as never,
        entity: 'owo-demo',
        external: { type: 'chat', chatId: 'ch1' },
        ingress: {
          ambientRouting: false,
          createOnCommand: false,
          createOnMention: true,
          createOnPendingIntent: true,
          createOnReplyToBot: true
        },
        name: 'wan-ke-chat',
        path: '/workspace/.oo/channels/wan-ke-chat/channel.json',
        routing: { accounts: {}, default: {}, modes: {}, users: {} }
      },
      commandText: '/help',
      inbound: makeInbound({ mentionedBot: true, sessionType: 'group', text: '/help' }) as any
    })

    await channelCommandMiddleware(ctx, next)

    expect(next).not.toHaveBeenCalled()
    expect(ctx.inbound.ack).toHaveBeenCalledOnce()
    expect(ctx.reply).toHaveBeenCalled()
    expect(createChannelCommandRun).toHaveBeenCalledOnce()
  })
})

describe('command audit runs', () => {
  it('records successful command runs with actor context', async () => {
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
        }
      },
      channelLink: {
        channelKey: 'lark:default',
        definition: {} as never,
        entity: 'owo-demo',
        external: { type: 'direct', senderId: 'ou_1' },
        ingress: {
          ambientRouting: false,
          createOnCommand: true,
          createOnMention: true,
          createOnPendingIntent: true,
          createOnReplyToBot: true
        },
        name: 'wan-ke-dm',
        path: '/workspace/.oo/channels/wan-ke-dm/channel.json',
        routing: { accounts: {}, default: {}, modes: {}, users: {} }
      },
      commandText: '/whoami',
      inbound: makeInbound({ messageId: 'om_1', senderId: 'ou_1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('统一用户：user-yijie'))
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('可执行凭证：0 个'))
    expect(listChannelUserCredentials).toHaveBeenCalledWith('lark:default', 'user-yijie')
    expect(createChannelCommandRun).toHaveBeenCalledWith(expect.objectContaining({
      actorAccountId: 'ou_1',
      actorUserId: 'user-yijie',
      channelId: 'ch1',
      channelKey: 'lark:default',
      channelLinkName: 'wan-ke-dm',
      commandName: 'whoami',
      commandPath: ['/whoami'],
      entity: 'owo-demo',
      messageId: 'om_1',
      permission: 'everyone',
      rawArgs: [],
      senderId: 'ou_1',
      sessionType: 'direct',
      source: 'slash'
    }))
    expect(finishChannelCommandRun).toHaveBeenCalledWith('cmd-run-1', {
      status: 'success'
    })
  })

  it('audits a rejected unlisted authorization action', async () => {
    const ctx = makeCtx({
      commandText: '/auth grant auth-1',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'user1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(createChannelCommandRun).toHaveBeenCalledWith(expect.objectContaining({
      commandName: 'grant',
      commandPath: ['/auth', 'grant'],
      permission: 'everyone',
      rawArgs: ['auth-1']
    }))
    expect(finishChannelCommandRun).toHaveBeenCalledWith('cmd-run-1', {
      status: 'success'
    })
  })

  it('does not let a non-admin inspect another sender policy state or audit', async () => {
    const options = {
      channelLink: {
        channelKey: 'lark:default',
        entity: 'assistant',
        external: { type: 'chat' },
        ingress: {
          ambientRouting: false,
          createOnCommand: true,
          createOnMention: true,
          createOnPendingIntent: true,
          createOnReplyToBot: true
        },
        name: 'support',
        path: '/workspace/.oo/channels/support/channel.json',
        definition: {} as never
      } as any,
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'user1' }) as any
    }
    const ctx = makeCtx({ ...options, commandText: '/policy status user2' })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith('您没有权限执行该操作，只有管理员才能执行该指令。')

    const auditCtx = makeCtx({ ...options, commandText: '/policy audit user2' })
    await channelCommandMiddleware(auditCtx, vi.fn())
    expect(auditCtx.reply).toHaveBeenCalledWith('您没有权限执行该操作，只有管理员才能执行该指令。')
  })

  it('records failed command runs before returning the generic error reply', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(updateConfigFile).mockRejectedValueOnce(new Error('write failed'))
    const ctx = makeCtx({
      commandText: '/lang zh',
      config: { type: 'lark', access: { admins: ['user1'] } } as any
    })

    try {
      await channelCommandMiddleware(ctx, vi.fn())
    } finally {
      consoleError.mockRestore()
    }

    expect(finishChannelCommandRun).toHaveBeenCalledWith('cmd-run-1', {
      error: 'write failed',
      status: 'failed'
    })
    expect(ctx.reply).toHaveBeenCalledWith('指令执行失败，请稍后重试。')
  })
})

describe('channel command tool registry', () => {
  it('exposes command specs as sender-scoped typed tools', () => {
    const tools = listChannelCommandTools()

    const grant = tools.find(tool => tool.name === 'channel.auth.grant')
    expect(grant).toMatchObject({
      namespace: 'channel',
      commandPath: ['auth', 'grant'],
      slashUsage: '/auth grant <id>',
      descriptionKey: 'cmd.auth.grant.description',
      permission: 'everyone',
      approval: {
        capability: 'channel.authorization.grant',
        risk: 'high',
        visibility: 'dm'
      },
      actorAuthority: 'sender',
      source: 'command-spec',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id'],
        additionalProperties: false
      }
    })

    const resume = tools.find(tool => tool.name === 'channel.auth.resume')
    expect(resume).toMatchObject({
      namespace: 'channel',
      commandPath: ['auth', 'resume'],
      slashUsage: '/auth resume <id>',
      descriptionKey: 'cmd.auth.resume.description',
      permission: 'admin',
      actorAuthority: 'sender',
      source: 'command-spec',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id'],
        additionalProperties: false
      }
    })

    const whoami = tools.find(tool => tool.name === 'channel.whoami')
    expect(whoami).toMatchObject({
      namespace: 'channel',
      commandPath: ['whoami'],
      slashUsage: '/whoami',
      descriptionKey: 'cmd.whoami.description',
      permission: 'everyone',
      actorAuthority: 'sender',
      source: 'command-spec',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false
      }
    })

    const identityLink = tools.find(tool => tool.name === 'channel.identity.link')
    expect(identityLink).toMatchObject({
      namespace: 'channel',
      commandPath: ['identity', 'link'],
      slashUsage: '/identity link [code]',
      descriptionKey: 'cmd.identity.link.description',
      permission: 'everyone',
      actorAuthority: 'sender',
      source: 'command-spec',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string' }
        },
        required: [],
        additionalProperties: false
      }
    })

    const permissionMode = tools.find(tool => tool.name === 'channel.permissionMode')
    expect(permissionMode).toMatchObject({
      commandPath: ['permissionMode'],
      slashUsage: '/permissionMode <mode:default|acceptEdits|plan|dontAsk|bypassPermissions>',
      permission: 'admin',
      arguments: [
        expect.objectContaining({
          name: 'mode',
          kind: 'required',
          choices: [
            expect.objectContaining({ value: 'default' }),
            expect.objectContaining({ value: 'acceptEdits' }),
            expect.objectContaining({ value: 'plan' }),
            expect.objectContaining({ value: 'dontAsk' }),
            expect.objectContaining({ value: 'bypassPermissions' })
          ]
        })
      ]
    })
    expect(permissionMode?.inputSchema).toMatchObject({
      properties: {
        mode: {
          type: 'string',
          enum: ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']
        }
      },
      required: ['mode']
    })
  })

  it('projects distinct path-derived approval capabilities for legacy command specs', () => {
    const tools = listChannelCommandTools()
    const help = tools.find(tool => tool.name === 'channel.help')
    const whoami = tools.find(tool => tool.name === 'channel.whoami')

    expect(help?.approval).toMatchObject({
      capability: 'channel.command.help',
      risk: 'low',
      visibility: 'public'
    })
    expect(whoami?.approval).toMatchObject({
      capability: 'channel.command.whoami',
      risk: 'low',
      visibility: 'public'
    })
  })

  it('keeps policy mute reason optional in the typed command schema', () => {
    const mute = listChannelCommandTools().find(tool => tool.name === 'channel.policy.mute')
    expect(mute?.inputSchema).toMatchObject({ required: ['senderId'] })
  })

  it('keeps optional, required, and rest arguments in the generated schema', () => {
    const tools = listChannelCommandTools()

    const authRequest = tools.find(tool => tool.name === 'channel.auth.request')
    expect(authRequest?.slashUsage).toBe('/auth request <capability> [message]')
    expect(authRequest?.inputSchema).toEqual({
      type: 'object',
      properties: {
        capability: { type: 'string' },
        message: { type: 'string' }
      },
      required: ['capability'],
      additionalProperties: false
    })

    const authList = tools.find(tool => tool.name === 'channel.auth.list')
    expect(authList?.slashUsage).toBe('/auth list [scope:pending|resumable]')
    expect(authList?.inputSchema).toEqual({
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['pending', 'resumable']
        }
      },
      required: [],
      additionalProperties: false
    })

    const setCommand = tools.find(tool => tool.name === 'channel.set')
    expect(setCommand?.slashUsage).toBe('/set <field:model|adapter> <name>')
    expect(setCommand?.inputSchema).toMatchObject({
      properties: {
        field: {
          type: 'string',
          enum: ['model', 'adapter']
        },
        name: { type: 'string' }
      },
      required: ['field', 'name']
    })
  })
})

describe('channel command tool invocation', () => {
  it('invokes a typed command tool through the sender-scoped command runner', async () => {
    const ctx = makeCtx({
      commandText: '',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    const result = await invokeChannelCommandTool(ctx, 'channel.auth.grant', { id: 'auth-1' })

    expect(result).toMatchObject({
      commandPath: ['/auth', 'grant'],
      source: 'natural_language',
      status: 'success',
      usage: '/auth grant <id>'
    })
    expect(resolveChannelAuthorizationRequestRecord).toHaveBeenCalledWith({
      id: 'auth-1',
      resolvedAt: expect.any(Number),
      status: 'granted'
    })
    expect(createChannelCommandRun).toHaveBeenCalledWith(expect.objectContaining({
      commandName: 'grant',
      commandPath: ['/auth', 'grant'],
      metadata: expect.objectContaining({
        actorAuthority: 'sender',
        approval: expect.objectContaining({
          capability: 'channel.authorization.grant',
          reasonCode: 'default-allow',
          status: 'allow'
        }),
        toolName: 'channel.auth.grant',
        usage: '/auth grant <id>'
      }),
      rawArgs: ['auth-1'],
      source: 'natural_language'
    }))
    expect(finishChannelCommandRun).toHaveBeenCalledWith('cmd-run-1', {
      status: 'success'
    })
  })

  it('invokes the manual authorization resume tool as the sender', async () => {
    vi.mocked(resumeReadyChannelIntents).mockResolvedValueOnce([
      {
        intentId: 'pending-auth-1',
        resumeChildRunId: 'resume-run-1',
        sessionId: 'sess-abc',
        status: 'dispatched'
      }
    ])
    const ctx = makeCtx({
      commandText: '',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    const result = await invokeChannelCommandTool(ctx, 'channel.auth.resume', { id: 'auth-1' })

    expect(result).toMatchObject({
      commandPath: ['/auth', 'resume'],
      source: 'natural_language',
      status: 'success',
      usage: '/auth resume <id>'
    })
    expect(resumeReadyChannelIntents).toHaveBeenCalledWith({
      filter: {
        authorizationRequestId: 'auth-1'
      },
      includeDeferred: true,
      limit: 20
    })
    expect(ctx.reply).toHaveBeenCalledWith('授权请求 auth-1 已触发 1 个恢复任务。')
    expect(createChannelCommandRun).toHaveBeenCalledWith(expect.objectContaining({
      commandName: 'resume',
      commandPath: ['/auth', 'resume'],
      metadata: expect.objectContaining({
        actorAuthority: 'sender',
        approval: expect.objectContaining({
          capability: 'channel.authorization.resume',
          status: 'allow'
        }),
        toolName: 'channel.auth.resume',
        usage: '/auth resume <id>'
      }),
      rawArgs: ['auth-1'],
      source: 'natural_language'
    }))
  })

  it('invokes the resumable authorization list through typed command input', async () => {
    vi.mocked(listReadyChannelResumeIntents).mockReturnValueOnce([
      {
        intent: {
          channelKey: 'lark:default',
          id: 'pending-auth-1',
          ownerAccountId: 'admin1',
          ownerUserId: 'user-admin',
          payload: {
            capability: 'Write'
          }
        } as any,
        resume: {
          authorizationRequestId: 'auth-1',
          authorizationStatus: 'granted',
          capability: 'Write',
          mode: 'manual',
          sessionId: 'sess-abc',
          status: 'ready'
        }
      }
    ])
    const ctx = makeCtx({
      commandText: '',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    const result = await invokeChannelCommandTool(ctx, 'channel.auth.list', { scope: 'resumable' })

    expect(result).toMatchObject({
      commandPath: ['/auth', 'list'],
      source: 'natural_language',
      status: 'success',
      usage: '/auth list [scope:pending|resumable]'
    })
    expect(listReadyChannelResumeIntents).toHaveBeenCalledWith({
      channelKey: 'lark:default',
      channelType: 'lark'
    }, { includeDeferred: true })
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('可恢复授权任务'))
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('auth-1 | manual | Write'))
  })

  it('enforces typed approver authority when a typed command tool is invoked', async () => {
    const ctx = makeCtx({
      commandText: '',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'user1' }) as any
    })

    const result = await invokeChannelCommandTool(ctx, 'channel.auth.grant', { id: 'auth-1' })

    expect(result).toMatchObject({
      commandPath: ['/auth', 'grant'],
      status: 'success'
    })
    expect(updateChannelAuthorizationRequest).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith('授权请求 auth-1 不属于当前频道、当前审批人，或已经处理。')
    expect(finishChannelCommandRun).toHaveBeenCalledWith('cmd-run-1', {
      status: 'success'
    })
  })

  it('parses rest arguments from tool input without splitting on spaces', async () => {
    const ctx = makeCtx({
      commandText: '',
      config: { type: 'lark', access: { admins: ['user1'] } } as any,
      sessionId: undefined
    })

    const result = await invokeChannelCommandTool(ctx, 'channel.set', {
      field: 'adapter',
      name: 'codex cli'
    })

    expect(result).toMatchObject({
      commandPath: ['/set'],
      status: 'success'
    })
    expect(ctx.setChannelAdapterPreference).toHaveBeenCalledWith('codex cli')
    expect(createChannelCommandRun).toHaveBeenCalledWith(expect.objectContaining({
      commandName: 'set',
      rawArgs: ['adapter', 'codex cli'],
      source: 'natural_language'
    }))
  })

  it('returns structured parse errors before creating command runs', async () => {
    const ctx = makeCtx({ commandText: '' })

    const result = await invokeChannelCommandTool(ctx, 'channel.auth.grant', {}, { replyOnError: true })

    expect(result).toMatchObject({
      ok: false,
      code: 'missing-argument',
      message: 'Missing argument: id',
      usage: '/auth grant <id>'
    })
    expect(ctx.reply).toHaveBeenCalledWith('Missing argument: id\n用法：/auth grant <id>')
    expect(createChannelCommandRun).not.toHaveBeenCalled()
  })
})

describe('operator policy commands', () => {
  it('recognizes an explicitly mentioned group command and audits sender-scoped denial', async () => {
    const next = vi.fn()
    const ctx = makeCtx({
      channelLink: {
        entity: 'operator',
        ingress: { createOnCommand: true, createOnMention: true },
        name: 'operator-room'
      } as any,
      commandText: '/availability off',
      config: { access: { admins: ['admin1'] }, type: 'oneworks' } as any,
      inbound: makeInbound({
        channelType: 'oneworks',
        mentionedBot: true,
        sessionType: 'group'
      }) as any
    })

    await channelCommandMiddleware(ctx, next)

    expect(next).not.toHaveBeenCalled()
    expect(createChannelCommandRun).toHaveBeenCalledWith(expect.objectContaining({
      commandName: 'off',
      commandPath: ['/availability', 'off'],
      permission: 'admin',
      senderId: 'user1'
    }))
    expect(finishChannelCommandRun).toHaveBeenCalledWith('cmd-run-1', { status: 'denied' })
    expect(ctx.reply).toHaveBeenCalledWith('您没有权限执行该操作，只有管理员才能执行该指令。')
  })
})

describe('/identity command', () => {
  const actorAccount = {
    issuerKey: 'lark:default',
    channelType: 'lark',
    accountId: 'ou_1',
    accountKey: 'lark:open_id:ou_1',
    displayName: '一介[字节]',
    avatarUrl: null,
    metadata: null,
    createdAt: 1,
    updatedAt: 1
  }

  it('creates a short-lived link code for the current canonical user', async () => {
    const ctx = makeCtx({
      actor: {
        account: actorAccount,
        user: {
          id: 'user-yijie',
          displayName: '一介',
          createdAt: 1,
          updatedAt: 1
        }
      },
      channelLink: {
        channelKey: 'lark:default',
        definition: {} as never,
        entity: 'owo-demo',
        external: { type: 'direct', senderId: 'ou_1' },
        ingress: {
          ambientRouting: false,
          createOnCommand: true,
          createOnMention: true,
          createOnPendingIntent: true,
          createOnReplyToBot: true
        },
        name: 'wan-ke-dm',
        path: '/workspace/.oo/channels/wan-ke-dm/channel.json',
        routing: { accounts: {}, default: {}, modes: {}, users: {} }
      },
      commandText: '/identity link',
      inbound: makeInbound({ messageId: 'om_1', senderId: 'ou_1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ensureCanonicalUser).not.toHaveBeenCalled()
    expect(linkChannelAccountToUser).not.toHaveBeenCalled()
    expect(createChannelIdentityLinkCode).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-yijie',
      sourceChannelType: 'lark',
      sourceIssuerKey: 'lark:default',
      sourceAccountId: 'ou_1',
      metadata: expect.objectContaining({
        channelKey: 'lark:default',
        channelLinkName: 'wan-ke-dm',
        messageId: 'om_1'
      })
    }))
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('身份绑定码：ABCD1234'))
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('不授予该账号的 API 登录态'))
  })

  it('refuses to create or consume bearer link codes in group conversations', async () => {
    const ctx = makeCtx({
      actor: { account: actorAccount },
      commandText: '/identity link ABCD1234',
      inbound: makeInbound({ senderId: 'ou_1', sessionType: 'group' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('只能在私聊中'))
    expect(createChannelIdentityLinkCode).not.toHaveBeenCalled()
    expect(consumeChannelIdentityLinkCode).not.toHaveBeenCalled()
  })

  it('self-claims the current account before creating a link code when it is unlinked', async () => {
    const ctx = makeCtx({
      actor: {
        account: actorAccount
      },
      commandText: '/identity link',
      inbound: makeInbound({ senderId: 'ou_1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ensureCanonicalUser).toHaveBeenCalledWith({ displayName: '一介[字节]' })
    expect(linkChannelAccountToUser).toHaveBeenCalledWith({
      issuerKey: 'lark:default',
      channelType: 'lark',
      accountId: 'ou_1',
      userId: 'user-new',
      source: 'self_claim',
      status: 'verified'
    })
    expect(createChannelIdentityLinkCode).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-new',
      sourceAccountId: 'ou_1'
    }))
  })

  it('consumes a link code for the current account', async () => {
    const ctx = makeCtx({
      actor: {
        account: actorAccount
      },
      commandText: '/identity link ABCD1234',
      inbound: makeInbound({ senderId: 'ou_1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(consumeChannelIdentityLinkCode).toHaveBeenCalledWith({
      code: 'ABCD1234',
      targetIssuerKey: 'lark:default',
      targetChannelType: 'lark',
      targetAccountId: 'ou_1'
    })
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('已把当前频道账号绑定到统一用户 user-existing'))
  })

  it('does not overwrite a conflicting identity link', async () => {
    consumeChannelIdentityLinkCode.mockReturnValueOnce({
      existingLink: {
        issuerKey: 'lark:default',
        channelType: 'lark',
        accountId: 'ou_1',
        userId: 'user-other',
        status: 'verified',
        source: 'manual',
        createdAt: 1,
        updatedAt: 1
      },
      status: 'conflict'
    })
    const ctx = makeCtx({
      actor: {
        account: actorAccount
      },
      commandText: '/identity link ABCD1234',
      inbound: makeInbound({ senderId: 'ou_1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('已绑定到另一个统一用户 user-other'))
    expect(linkChannelAccountToUser).not.toHaveBeenCalled()
  })

  it('lists accounts linked to the current canonical user', async () => {
    listChannelAccountsForUser.mockReturnValueOnce([
      actorAccount,
      {
        issuerKey: 'telegram-main',
        channelType: 'telegram',
        accountId: 'tg_1',
        accountKey: 'telegram:tg_1',
        displayName: null,
        avatarUrl: null,
        metadata: null,
        createdAt: 1,
        updatedAt: 1
      }
    ])
    const ctx = makeCtx({
      actor: {
        account: actorAccount,
        user: {
          id: 'user-yijie',
          displayName: '一介',
          createdAt: 1,
          updatedAt: 1
        }
      },
      commandText: '/identity accounts',
      inbound: makeInbound({ senderId: 'ou_1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(listChannelAccountsForUser).toHaveBeenCalledWith('user-yijie')
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('统一用户 user-yijie 已绑定 2 个频道账号'))
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('- telegram/telegram-main:tg_1 | telegram:tg_1'))
  })
})

// ── /help ──────────────────────────────────────────────────────────────────

describe('/help command', () => {
  it('sends the help message and does not call next', async () => {
    const next = vi.fn()
    const ctx = makeCtx({
      commandText: '/help',
      config: { type: 'lark', access: { admins: ['user1'] } } as any,
      reply: vi.fn().mockResolvedValue({ messageId: 'om-help-1' }) as any
    })
    await channelCommandMiddleware(ctx, next)

    expect(ctx.reply).toHaveBeenCalledOnce()
    expect(String(vi.mocked(ctx.reply).mock.calls[0][0])).toContain('第 1/6 页')
    expect(ctx.pushFollowUps).toHaveBeenCalledWith({
      messageId: 'om-help-1',
      followUps: [{ content: '/help --page=2' }]
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('calls ack before replying and unack after', async () => {
    const ack = vi.fn().mockResolvedValue(undefined)
    const unack = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({ commandText: '/help', inbound: makeInbound({ ack, unack }) as any })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ack).toHaveBeenCalledOnce()
    expect(unack).toHaveBeenCalledOnce()
  })

  it('swallows ack errors', async () => {
    const ack = vi.fn().mockRejectedValue(new Error('ack failed'))
    const ctx = makeCtx({ commandText: '/help', inbound: makeInbound({ ack }) as any })
    await expect(channelCommandMiddleware(ctx, vi.fn())).resolves.toBeUndefined()
  })

  it('shows union argument choices in detailed help', async () => {
    const ctx = makeCtx({
      commandText: '/help set',
      config: { type: 'lark', access: { admins: ['user1'] } } as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledOnce()
    const message = String(vi.mocked(ctx.reply).mock.calls[0][0])
    expect(message).toContain('/set <field:model|adapter> <name>')
    expect(message).toContain('model：模型')
    expect(message).toContain('适配器')
  })

  it('falls back to fuzzy search when no exact help target exists', async () => {
    const ctx = makeCtx({
      commandText: '/help permiss',
      config: { type: 'lark', access: { admins: ['user1'] } } as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledOnce()
    const message = String(vi.mocked(ctx.reply).mock.calls[0][0])
    expect(message).toContain('未找到完整匹配')
    expect(message).toContain('/permissionMode <mode:default|acceptEdits|plan|dontAsk|bypassPermissions>')
  })

  it('supports help paging callbacks through explicit page arguments', async () => {
    const ctx = makeCtx({
      commandText: '/help --page=4',
      config: { type: 'lark', access: { admins: ['user1'] } } as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledOnce()
    const message = String(vi.mocked(ctx.reply).mock.calls[0][0])
    expect(message).toContain('第 4/6 页')
    expect(message).toContain('/session stop')
    expect(ctx.pushFollowUps).toHaveBeenCalledWith({
      messageId: undefined,
      followUps: [{ content: '/help --page=3' }, { content: '/help --page=5' }]
    })
  })

  it('shows titled choice guidance for invalid values', async () => {
    const ctx = makeCtx({ commandText: '/set wrong gpt-next', config: { type: 'lark' } as any })

    await channelCommandMiddleware(ctx, vi.fn())

    const message = String(vi.mocked(ctx.reply).mock.calls[0][0])
    expect(message).toContain('参数值无效：wrong')
    expect(message).toContain('model(模型)')
    expect(message).toContain('可选值：')
    expect(message).toContain('adapter：适配器')
  })
})

describe('/session command', () => {
  it('shows current session metadata', async () => {
    const ctx = makeCtx({ commandText: '/session' })
    await channelCommandMiddleware(ctx, vi.fn())
    expect(ctx.reply).toHaveBeenCalledOnce()
    expect(String(vi.mocked(ctx.reply).mock.calls[0][0])).toContain('Session A')
    expect(String(vi.mocked(ctx.reply).mock.calls[0][0])).toContain('gpt-test')
    expect(String(vi.mocked(ctx.reply).mock.calls[0][0])).toContain('上下文消息数：12')
    expect(String(vi.mocked(ctx.reply).mock.calls[0][0])).toContain('工作区：/tmp/.oo/worktrees/sessions/sess-abc')
    expect(String(vi.mocked(ctx.reply).mock.calls[0][0])).toContain('工作区模式：托管 worktree')
  })

  it('/session search without query lists recent sessions', async () => {
    const ctx = makeCtx({
      commandText: '/session search',
      config: { type: 'lark', access: { admins: ['user1'] } } as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.searchSessions).toHaveBeenCalledWith('')
    expect(ctx.reply).toHaveBeenCalledOnce()
    const message = String(vi.mocked(ctx.reply).mock.calls[0][0])
    expect(message).toContain('最近会话列表')
    expect(message).toContain('第 1/1 页')
    expect(message).toContain('sess-abc')
    expect(message).toContain('sess-other')
  })

  it('/session search lists matching sessions with binding status', async () => {
    getChannelSessionBySessionId.mockImplementation((sessionId: string) => (
      sessionId === 'sess-other'
        ? {
          channelType: 'lark',
          sessionType: 'group',
          channelId: 'oc_790b0dd9fff1f5e216ac15bfbc257556',
          channelKey: 'lark:miniapp-gear'
        }
        : {
          channelType: 'lark',
          sessionType: 'direct',
          channelId: 'ch1',
          channelKey: 'lark:default'
        }
    ))
    const ctx = makeCtx({
      commandText: '/session search miniapp gear',
      config: { type: 'lark', access: { admins: ['user1'] } } as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledOnce()
    const message = String(vi.mocked(ctx.reply).mock.calls[0][0])
    expect(message).toContain('找到 1 个匹配会话')
    expect(message).toContain('sess-other')
    expect(message).toContain('已绑定 lark/group/oc_790b0dd9fff1f5e216ac15bfbc257556')
  })

  it('/session list supports pagination', async () => {
    getSessions.mockReturnValue(Array.from({ length: 10 }, (_, index) => ({
      id: `sess-${index + 1}`,
      title: `Session ${index + 1}`,
      status: 'completed',
      messageCount: index + 1,
      model: 'gpt-responses,gpt-5.4-2026-03-05',
      adapter: 'codex',
      tags: [],
      isArchived: false,
      isStarred: false,
      createdAt: Date.now() - index
    })))
    const ctx = makeCtx({
      commandText: '/session list --page=2',
      config: { type: 'lark', access: { admins: ['user1'] } } as any,
      reply: vi.fn().mockResolvedValue({ messageId: 'om-session-list-2' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledOnce()
    const message = String(vi.mocked(ctx.reply).mock.calls[0][0])
    expect(message).toContain('最近会话列表（共 10 个）')
    expect(message).toContain('第 2/2 页')
    expect(message).toContain('sess-9')
    expect(message).toContain('sess-10')
    expect(ctx.pushFollowUps).toHaveBeenCalledWith({
      messageId: 'om-session-list-2',
      followUps: [{ content: '/session list --page=1' }]
    })
  })

  it('/session bind rebinds the current channel to an existing session', async () => {
    getSession.mockImplementation((sessionId: string) => (
      sessionId === 'sess-other'
        ? {
          id: 'sess-other',
          title: 'Lark handoff window',
          status: 'completed',
          messageCount: 446,
          model: 'gpt-responses,gpt-5.4-2026-03-05',
          adapter: 'codex',
          tags: [],
          isArchived: false,
          isStarred: false,
          createdAt: Date.now()
        }
        : {
          id: 'sess-abc',
          title: 'Session A',
          status: 'running',
          messageCount: 12,
          model: 'gpt-test',
          adapter: 'codex',
          tags: ['tag-a'],
          isArchived: false,
          isStarred: true,
          createdAt: Date.now()
        }
    ))
    const ctx = makeCtx({
      commandText: '/session bind sess-other',
      config: { type: 'lark', access: { admins: ['user1'] } } as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(upsertChannelSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'sess-other'
    }))
    expect(ctx.reply).toHaveBeenCalledOnce()
    const message = String(vi.mocked(ctx.reply).mock.calls[0][0])
    expect(message).toContain('已将当前频道绑定到会话 sess-other')
    expect(message).toContain('当前频道原先绑定的会话 sess-abc 已解除绑定')
    expect(message).toContain('工作区：/tmp/.oo/worktrees/sessions/sess-other')
    expect(message).toContain('工作区模式：托管 worktree')
  })

  it('/session unbind detaches the current channel without archiving the session', async () => {
    const ctx = makeCtx({
      commandText: '/session unbind',
      config: { type: 'lark', access: { admins: ['user1'] } } as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(deleteChannelSession).toHaveBeenCalledWith('lark', 'direct', 'ch1')
    expect(updateSessionArchivedWithChildren).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith('已解除当前频道与会话 sess-abc 的绑定，会话内容已保留。')
  })

  it('/session stop keeps the runtime stop behavior', async () => {
    const ctx = makeCtx({
      commandText: '/session stop',
      config: { type: 'lark', access: { admins: ['user1'] } } as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(killSession).toHaveBeenCalledWith('sess-abc')
    expect(ctx.reply).toHaveBeenCalledWith('已停止当前会话。')
  })
})

describe('channel control commands', () => {
  it('/silent adds the target session to silentSessions', async () => {
    const ctx = makeCtx({
      commandText: '/silent sess-muted',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'project',
      section: 'channels',
      value: {
        'lark:default': {
          type: 'lark',
          access: {
            admins: ['admin1']
          },
          silentSessions: ['sess-muted']
        }
      }
    }))
    expect(ctx.reply).toHaveBeenCalledWith(
      '已静默会话 sess-muted，它不能再通过 oneworks channel 主动发送频道消息。'
    )
  })

  it('/unsilent removes the target session from silentSessions', async () => {
    const ctx = makeCtx({
      commandText: '/unsilent sess-muted',
      config: {
        type: 'lark',
        access: { admins: ['admin1'] },
        silentSessions: ['sess-old', 'sess-muted']
      } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'project',
      section: 'channels',
      value: {
        'lark:default': {
          type: 'lark',
          access: {
            admins: ['admin1']
          },
          silentSessions: ['sess-old']
        }
      }
    }))
    expect(ctx.reply).toHaveBeenCalledWith(
      '已解除静默会话 sess-muted，它可以继续通过 oneworks channel 主动发送频道消息。'
    )
  })

  it('/unsilent removes silentSessions when the last silent session is cleared', async () => {
    const ctx = makeCtx({
      commandText: '/unsilent sess-muted',
      config: {
        type: 'lark',
        access: { admins: ['admin1'] },
        silentSessions: ['sess-muted']
      } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      value: {
        'lark:default': {
          type: 'lark',
          access: {
            admins: ['admin1']
          }
        }
      }
    }))
    expect(ctx.reply).toHaveBeenCalledWith(
      '已解除静默会话 sess-muted，它可以继续通过 oneworks channel 主动发送频道消息。'
    )
  })

  it('/stop blocks the current group from future inbound processing', async () => {
    const ctx = makeCtx({
      commandText: '/stop',
      config: { type: 'lark', access: { admins: ['admin1'], blockedGroups: ['group-old'] } } as any,
      inbound: makeInbound({
        channelId: 'group-new',
        senderId: 'admin1',
        sessionType: 'group'
      }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      value: {
        'lark:default': {
          type: 'lark',
          access: {
            admins: ['admin1'],
            blockedGroups: ['group-old', 'group-new']
          }
        }
      }
    }))
    expect(killSession).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith('已停止接收当前群聊 group-new 的普通消息。管理员仍可发送 /start 恢复。')
  })

  it('/start removes the current group from the blocked group list', async () => {
    const ctx = makeCtx({
      commandText: '/start',
      config: { type: 'lark', access: { admins: ['admin1'], blockedGroups: ['group-old', 'group-new'] } } as any,
      inbound: makeInbound({
        channelId: 'group-new',
        senderId: 'admin1',
        sessionType: 'group'
      }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      value: {
        'lark:default': {
          type: 'lark',
          access: {
            admins: ['admin1'],
            blockedGroups: ['group-old']
          }
        }
      }
    }))
    expect(ctx.reply).toHaveBeenCalledWith('已恢复接收当前群聊 group-new 的消息。')
  })

  it('/ban stores the normalized sender id in blockedSenders', async () => {
    const ctx = makeCtx({
      commandText: '/ban @wxid_user',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({
        senderId: 'admin1',
        sessionType: 'group'
      }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      value: {
        'lark:default': {
          type: 'lark',
          access: {
            admins: ['admin1'],
            blockedSenders: ['wxid_user']
          }
        }
      }
    }))
    expect(ctx.reply).toHaveBeenCalledWith('已屏蔽发送者 wxid_user，后续消息会被过滤。')
  })
})

// ── /reset ─────────────────────────────────────────────────────────────────

describe('/reset command — no admins configured', () => {
  it('blocks reset because default state has no admins', async () => {
    const next = vi.fn()
    const ctx = makeCtx({ commandText: '/reset' })
    await channelCommandMiddleware(ctx, next)

    expect(updateSessionArchivedWithChildren).not.toHaveBeenCalled()
    expect(deleteChannelSessionBySessionId).not.toHaveBeenCalled()
    expect(deleteBinding).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledOnce()
    expect(String(vi.mocked(ctx.reply).mock.calls[0][0])).toContain('没有权限')
    expect(next).not.toHaveBeenCalled()
  })

  it('does not clear ctx.sessionId when reset is blocked', async () => {
    const ctx = makeCtx({ commandText: '/reset' })
    await channelCommandMiddleware(ctx, vi.fn())
    expect(ctx.sessionId).toBe('sess-abc')
  })

  it('does not reset when sessionId is undefined and no admins are configured', async () => {
    const ctx = makeCtx({ commandText: '/reset', sessionId: undefined })
    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateSessionArchivedWithChildren).not.toHaveBeenCalled()
    expect(deleteChannelSessionBySessionId).not.toHaveBeenCalled()
    expect(deleteBinding).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledOnce()
    expect(String(vi.mocked(ctx.reply).mock.calls[0][0])).toContain('没有权限')
  })

  it('calls ack and unack', async () => {
    const ack = vi.fn().mockResolvedValue(undefined)
    const unack = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({ commandText: '/reset', inbound: makeInbound({ ack, unack }) as any })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ack).toHaveBeenCalledOnce()
    expect(unack).toHaveBeenCalledOnce()
  })
})

describe('/reset command — admins configured', () => {
  const configWithAdmins: any = { access: { admins: ['admin1'] } }

  it('allows an admin to reset', async () => {
    const ctx = makeCtx({
      commandText: '/reset',
      config: configWithAdmins,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })
    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateSessionArchivedWithChildren).toHaveBeenCalledWith('sess-abc', true)
    expect(deleteChannelSessionBySessionId).toHaveBeenCalledWith('sess-abc')
    expect(ctx.reply).toHaveBeenCalledOnce()
  })

  it('blocks a non-admin sender and sends permission error', async () => {
    const next = vi.fn()
    const ctx = makeCtx({
      commandText: '/reset',
      config: configWithAdmins,
      inbound: makeInbound({ senderId: 'user99' }) as any
    })
    await channelCommandMiddleware(ctx, next)

    expect(deleteChannelSessionBySessionId).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledOnce()
    const msg = vi.mocked(ctx.reply).mock.calls[0][0]
    expect(msg).toContain('没有权限')
    expect(next).not.toHaveBeenCalled()
  })

  it('blocks when senderId is absent', async () => {
    const ctx = makeCtx({
      commandText: '/reset',
      config: configWithAdmins,
      inbound: makeInbound({ senderId: undefined }) as any
    })
    await channelCommandMiddleware(ctx, vi.fn())

    expect(deleteChannelSessionBySessionId).not.toHaveBeenCalled()
  })
})

describe('session setting commands', () => {
  it('/permissionMode updates session settings and restarts the session', async () => {
    const ctx = makeCtx({
      commandText: '/permissionMode dontAsk',
      config: { type: 'lark', access: { admins: ['user1'] } } as any
    })
    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateSession).toHaveBeenCalledWith('sess-abc', { permissionMode: 'dontAsk' })
    expect(killSession).toHaveBeenCalledWith('sess-abc')
    expect(startAdapterSession).toHaveBeenCalledWith('sess-abc')
  })

  it('/permissionMode stores the next-session permission mode when no session is bound', async () => {
    const ctx = makeCtx({
      commandText: '/permissionMode dontAsk',
      config: { type: 'lark', access: { admins: ['user1'] } } as any,
      sessionId: undefined
    })
    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledOnce()
    const message = String(vi.mocked(ctx.reply).mock.calls[0][0])
    expect(message).toContain('已将下次会话的权限模式设置为 dontAsk')
    expect(upsertChannelPreference).toHaveBeenCalledWith({
      channelType: 'lark',
      sessionType: 'direct',
      channelId: 'ch1',
      channelKey: 'lark:default',
      adapter: undefined,
      permissionMode: 'dontAsk'
    })
    expect(updateSession).not.toHaveBeenCalled()
    expect(startAdapterSession).not.toHaveBeenCalled()
  })

  it('/permissionMode shows detailed choices when the mode is missing', async () => {
    const ctx = makeCtx({ commandText: '/permissionMode', config: { type: 'lark' } as any })
    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      '缺少参数：<mode>\n可选值：\n- default：默认，使用适配器默认的权限行为。\n- acceptEdits：接受编辑，自动接受编辑类操作。\n- plan：规划，先规划，再等待进一步执行确认。\n- dontAsk：不询问，尽量直接执行，不额外询问。\n- bypassPermissions：绕过权限，跳过大部分权限检查，风险最高。\n用法：/permissionMode <mode:default|acceptEdits|plan|dontAsk|bypassPermissions>'
    )
  })

  it('/set model validates usage', async () => {
    const ctx = makeCtx({ commandText: '/set model', config: { type: 'lark' } as any })
    await channelCommandMiddleware(ctx, vi.fn())
    expect(ctx.reply).toHaveBeenCalledWith('缺少参数：<name>\n用法：/set <field:model|adapter> <name>')
  })

  it('/set adapter stores the next-session adapter when no session is bound', async () => {
    const ctx = makeCtx({
      commandText: '/set adapter codex',
      config: { type: 'lark', access: { admins: ['user1'] } } as any,
      sessionId: undefined
    })
    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledOnce()
    const message = String(vi.mocked(ctx.reply).mock.calls[0][0])
    expect(message).toContain('已将下次会话的适配器设置为 codex')
    expect(upsertChannelPreference).toHaveBeenCalledWith({
      channelType: 'lark',
      sessionType: 'direct',
      channelId: 'ch1',
      channelKey: 'lark:default',
      adapter: 'codex'
    })
  })

  it('/set adapter is rejected when a session is already bound', async () => {
    const ctx = makeCtx({
      commandText: '/set adapter codex',
      config: { type: 'lark', access: { admins: ['user1'] } } as any
    })
    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith('当前频道已有会话，无法切换适配器。请先执行 /reset 重置会话，再设置适配器。')
    expect(upsertChannelPreference).not.toHaveBeenCalled()
    expect(updateSession).not.toHaveBeenCalled()
    expect(startAdapterSession).not.toHaveBeenCalled()
  })

  it('/get validates usage', async () => {
    const ctx = makeCtx({ commandText: '/get', config: { type: 'lark' } as any })
    await channelCommandMiddleware(ctx, vi.fn())
    expect(ctx.reply).toHaveBeenCalledWith(
      '缺少参数：<field>\n可选值：\n- model：模型，读取当前会话使用的模型名称。\n- adapter：适配器，读取当前会话绑定的适配器。\n- permissionMode：权限模式，读取当前会话的权限策略。\n- effort：Effort，读取当前会话的显式 effort 设置。\n用法：/get <field:model|adapter|permissionMode|effort>'
    )
  })

  it('/get model returns the current session model', async () => {
    const ctx = makeCtx({ commandText: '/get model', config: { type: 'lark' } as any })
    await channelCommandMiddleware(ctx, vi.fn())
    expect(ctx.reply).toHaveBeenCalledWith('模型：gpt-test')
  })

  it('/get adapter returns the pending channel adapter when no session is bound', async () => {
    const ctx = makeCtx({
      commandText: '/get adapter',
      config: { type: 'lark' } as any,
      sessionId: undefined,
      channelAdapter: 'codex'
    })
    await channelCommandMiddleware(ctx, vi.fn())
    expect(ctx.reply).toHaveBeenCalledWith('适配器：codex')
  })

  it('/get permissionMode returns the pending channel permission mode when no session is bound', async () => {
    const ctx = makeCtx({
      commandText: '/get permissionMode',
      config: { type: 'lark' } as any,
      sessionId: undefined,
      channelPermissionMode: 'dontAsk'
    })
    await channelCommandMiddleware(ctx, vi.fn())
    expect(ctx.reply).toHaveBeenCalledWith('权限模式：dontAsk')
  })

  it('/set model updates session model and restarts the session', async () => {
    const ctx = makeCtx({
      commandText: '/set model gpt-next',
      config: { type: 'lark', access: { admins: ['user1'] } } as any
    })
    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateSession).toHaveBeenCalledWith('sess-abc', { model: 'gpt-next' })
    expect(killSession).toHaveBeenCalledWith('sess-abc')
    expect(startAdapterSession).toHaveBeenCalledWith('sess-abc')
  })
})

describe('permission config commands', () => {
  it('/allow validates usage', async () => {
    const ctx = makeCtx({
      commandText: '/allow sender',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith(
      '缺少参数：<value>\n用法：/allow <field:sender|group|private|groupchat> <value>'
    )
  })

  it('/admin add writes updated channel config', async () => {
    const ctx = makeCtx({
      commandText: '/admin add admin2',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'project',
      section: 'channels',
      value: {
        'lark:default': {
          type: 'lark',
          access: {
            admins: ['admin1', 'admin2']
          }
        }
      }
    }))
  })

  it('/admin add writes back to global config for global channels', async () => {
    const ctx = makeCtx({
      commandText: '/admin add admin2',
      configSource: 'global',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'global',
      section: 'channels',
      value: {
        'lark:default': {
          type: 'lark',
          access: {
            admins: ['admin1', 'admin2']
          }
        }
      }
    }))
  })

  it('/admin add preserves other channels in the same config source', async () => {
    vi.mocked(loadConfigState).mockResolvedValueOnce({
      projectSource: {
        rawConfig: {
          channels: {
            'slack:ops': {
              type: 'slack',
              teamId: 'T123'
            }
          }
        },
        resolvedConfig: {
          channels: {
            'email:inherited': {
              type: 'email'
            },
            'lark:default': {
              type: 'lark',
              access: {
                admins: ['admin1']
              }
            },
            'slack:ops': {
              type: 'slack',
              teamId: 'T123'
            }
          }
        }
      }
    } as any)

    const ctx = makeCtx({
      commandText: '/admin add admin2',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'project',
      section: 'channels',
      value: {
        'lark:default': {
          type: 'lark',
          access: {
            admins: ['admin1', 'admin2']
          }
        },
        'slack:ops': {
          type: 'slack',
          teamId: 'T123'
        }
      }
    }))
  })

  it('/block group writes updated channel config', async () => {
    const ctx = makeCtx({
      commandText: '/block group group2',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'project',
      section: 'channels',
      value: {
        'lark:default': {
          type: 'lark',
          access: {
            admins: ['admin1'],
            blockedGroups: ['group2']
          }
        }
      }
    }))
  })

  it('blocks non-admin users from mutation commands when admins are configured', async () => {
    const ctx = makeCtx({
      commandText: '/allow sender user2',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'user1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateConfigFile).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledOnce()
    expect(String(vi.mocked(ctx.reply).mock.calls[0][0])).toContain('没有权限')
  })
})

describe('/auth command', () => {
  it('/auth request creates a sender-scoped authorization request', async () => {
    const ctx = makeCtx({
      commandText: '/auth request im.chat.member.add 拉群',
      actor: {
        account: {
          issuerKey: 'lark:default',
          channelType: 'lark',
          accountId: 'ou_1',
          accountKey: 'lark:ou_1',
          displayName: '一介',
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
        }
      },
      channelLink: {
        channelKey: 'lark:default',
        definition: {} as any,
        entity: 'owo-demo',
        external: { type: 'chat', chatId: 'oc_1' },
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
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(createChannelAuthorizationRequest).toHaveBeenCalledWith(expect.objectContaining({
      channelType: 'lark',
      channelLinkName: 'wan-ke-chat',
      requesterUserId: 'user-yijie',
      requesterAccountId: 'ou_1',
      capability: 'im.chat.member.add',
      message: '拉群',
      metadata: expect.objectContaining({
        channelKey: 'lark:default',
        channelId: 'ch1',
        sessionType: 'direct',
        entity: 'owo-demo'
      })
    }))
    expect(ctx.reply).toHaveBeenCalledWith('已创建授权请求 auth-1：im.chat.member.add')
  })

  it('/auth list shows pending requests for the resolved canonical user', async () => {
    const ctx = makeCtx({
      commandText: '/auth list',
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
        }
      }
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(listPendingChannelAuthorizationRequestsForUser).toHaveBeenCalledWith('user-yijie', 'lark')
    expect(listPendingChannelAuthorizationRequestsForAccount).not.toHaveBeenCalled()
    const message = String(vi.mocked(ctx.reply).mock.calls[0][0])
    expect(message).toContain('待处理授权请求')
    expect(message).toContain('auth-1')
    expect(message).toContain('im.chat.member.add')
  })

  it('/auth list falls back to sender account when no canonical user is bound', async () => {
    const ctx = makeCtx({
      commandText: '/auth list',
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
        }
      }
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(listPendingChannelAuthorizationRequestsForAccount).toHaveBeenCalledWith('ou_1', 'lark')
    expect(ctx.reply).toHaveBeenCalledOnce()
  })

  it('/auth list resumable shows only sender-owned resume intents for regular users', async () => {
    vi.mocked(listReadyChannelResumeIntents).mockImplementation((filter: any) => (
      filter.ownerUserId === 'user-yijie'
        ? [
          {
            intent: {
              channelKey: 'lark:default',
              id: 'pending-auth-1',
              ownerAccountId: 'ou_1',
              ownerUserId: 'user-yijie',
              payload: {
                capability: 'Write'
              }
            } as any,
            resume: {
              authorizationRequestId: 'auth-1',
              authorizationStatus: 'granted',
              capability: 'Write',
              mode: 'manual',
              sessionId: 'sess-abc',
              status: 'ready'
            }
          }
        ]
        : []
    ))
    const ctx = makeCtx({
      commandText: '/auth list resumable',
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
        }
      }
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(listReadyChannelResumeIntents).toHaveBeenCalledWith({
      channelKey: 'lark:default',
      channelType: 'lark',
      ownerUserId: 'user-yijie'
    }, { includeDeferred: true })
    expect(listReadyChannelResumeIntents).toHaveBeenCalledWith({
      channelKey: 'lark:default',
      channelType: 'lark',
      ownerAccountId: 'ou_1'
    }, { includeDeferred: true })
    const message = String(vi.mocked(ctx.reply).mock.calls[0][0])
    expect(message).toContain('可恢复授权任务')
    expect(message).toContain('auth-1')
    expect(message).toContain('manual')
    expect(message).toContain('session=sess-abc')
  })

  it('/auth list resumable shows all channel resumable intents for admins', async () => {
    vi.mocked(listReadyChannelResumeIntents).mockReturnValueOnce([
      {
        intent: {
          channelKey: 'lark:default',
          id: 'pending-auth-1',
          ownerAccountId: 'ou_1',
          ownerUserId: 'user-yijie',
          payload: {
            capability: 'Write'
          }
        } as any,
        resume: {
          authorizationRequestId: 'auth-1',
          authorizationStatus: 'granted',
          capability: 'Write',
          mode: 'manual',
          sessionId: 'sess-abc',
          status: 'ready'
        }
      }
    ])
    const ctx = makeCtx({
      commandText: '/auth list resumable',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(listReadyChannelResumeIntents).toHaveBeenCalledWith({
      channelKey: 'lark:default',
      channelType: 'lark'
    }, { includeDeferred: true })
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('auth-1 | manual | Write'))
  })

  it('rejects unlisted senders from granting authorization requests', async () => {
    const ctx = makeCtx({
      commandText: '/auth grant auth-1',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'user1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateChannelAuthorizationRequest).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith('授权请求 auth-1 不属于当前频道、当前审批人，或已经处理。')
  })

  it('lets an exact issuer-qualified non-admin approver grant and resume a request', async () => {
    getChannelAuthorizationRequest.mockReturnValue({
      ...getChannelAuthorizationRequest(),
      allowedApprovers: ['account:lark:default:ou_requester']
    })
    const ctx = makeCtx({
      commandText: '/auth grant auth-1',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'ou_requester' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(resolveChannelAuthorizationRequestRecord).toHaveBeenCalledWith(expect.objectContaining({
      id: 'auth-1',
      status: 'granted'
    }))
    expect(resumeReadyChannelIntents).toHaveBeenCalledWith({
      filter: { authorizationRequestId: 'auth-1' },
      limit: 20
    })
    expect(ctx.reply).toHaveBeenCalledWith('授权请求 auth-1 已标记为 已批准。')
  })

  it('/auth grant resolves a pending authorization request for admins', async () => {
    const ctx = makeCtx({
      commandText: '/auth grant auth-1',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(resolveChannelAuthorizationRequestRecord).toHaveBeenCalledWith({
      id: 'auth-1',
      resolvedAt: expect.any(Number),
      status: 'granted'
    })
    expect(listOpenChannelPendingIntents).toHaveBeenCalledWith({
      authorizationRequestId: 'auth-1'
    })
    expect(updateChannelPendingIntent).toHaveBeenCalledWith('pending-auth-1', {
      metadata: expect.objectContaining({
        authorizationStatus: 'granted',
        resolvedByAccountId: 'admin1'
      }),
      resolvedAt: expect.any(Number),
      status: 'resolved'
    })
    expect(handleInteractionResponse).toHaveBeenCalledWith('sess-abc', 'interaction-1', 'allow_once')
    expect(resumeReadyChannelIntents).toHaveBeenCalledWith({
      filter: {
        authorizationRequestId: 'auth-1'
      },
      limit: 20
    })
    expect(ctx.reply).toHaveBeenCalledWith('授权请求 auth-1 已标记为 已批准。')
  })

  it('/auth grant repairs open intents after the same authorization was already granted', async () => {
    getChannelAuthorizationRequest.mockReturnValue({
      ...getChannelAuthorizationRequest(),
      status: 'granted',
      resolvedAt: 123
    })
    resolveChannelAuthorizationRequestRecord.mockReturnValue(undefined)
    const ctx = makeCtx({
      commandText: '/auth grant auth-1',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateChannelPendingIntent).toHaveBeenCalledWith(
      'pending-auth-1',
      expect.objectContaining({
        resolvedAt: 123,
        status: 'resolved'
      })
    )
    expect(ctx.reply).toHaveBeenCalledWith('授权请求 auth-1 已标记为 已批准。')
  })

  it('/auth deny resolves a pending authorization request for admins', async () => {
    const ctx = makeCtx({
      commandText: '/auth deny auth-1 不行',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(resolveChannelAuthorizationRequestRecord).toHaveBeenCalledWith({
      id: 'auth-1',
      message: '不行',
      resolvedAt: expect.any(Number),
      status: 'denied'
    })
    expect(updateChannelPendingIntent).toHaveBeenCalledWith('pending-auth-1', {
      metadata: expect.objectContaining({
        authorizationStatus: 'denied',
        resolvedByAccountId: 'admin1'
      }),
      resolvedAt: expect.any(Number),
      status: 'resolved'
    })
    expect(handleInteractionResponse).toHaveBeenCalledWith('sess-abc', 'interaction-1', 'deny_once')
    expect(resumeReadyChannelIntents).toHaveBeenCalledWith({
      filter: {
        authorizationRequestId: 'auth-1'
      },
      limit: 20
    })
    expect(ctx.reply).toHaveBeenCalledWith('授权请求 auth-1 已标记为 已拒绝。')
  })

  it('/auth resume manually resumes deferred authorization work for admins', async () => {
    vi.mocked(resumeReadyChannelIntents).mockResolvedValueOnce([
      {
        intentId: 'pending-auth-1',
        resumeChildRunId: 'resume-run-1',
        sessionId: 'sess-abc',
        status: 'dispatched'
      },
      {
        intentId: 'pending-auth-2',
        status: 'skipped'
      }
    ])
    const ctx = makeCtx({
      commandText: '/auth resume auth-1',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(updateChannelAuthorizationRequest).not.toHaveBeenCalled()
    expect(resumeReadyChannelIntents).toHaveBeenCalledWith({
      filter: {
        authorizationRequestId: 'auth-1'
      },
      includeDeferred: true,
      limit: 20
    })
    expect(ctx.reply).toHaveBeenCalledWith('授权请求 auth-1 已触发 1 个恢复任务。')
  })

  it('/auth resume reports when no resolved pending intent can be resumed', async () => {
    vi.mocked(resumeReadyChannelIntents).mockResolvedValueOnce([])
    const ctx = makeCtx({
      commandText: '/auth resume auth-1',
      config: { type: 'lark', access: { admins: ['admin1'] } } as any,
      inbound: makeInbound({ senderId: 'admin1' }) as any
    })

    await channelCommandMiddleware(ctx, vi.fn())

    expect(ctx.reply).toHaveBeenCalledWith('授权请求 auth-1 当前没有可恢复的会话。')
  })
})
