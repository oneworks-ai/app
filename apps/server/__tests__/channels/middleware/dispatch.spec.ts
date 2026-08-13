/* eslint-disable max-lines -- Dispatch lifecycle coverage shares one channel context and runtime fixture. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { upsertChannelEmojiRegistryEntry } from '@oneworks/utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelContext } from '#~/channels/middleware/@types/index.js'
import { syncChannelSessionBinding } from '#~/channels/middleware/bind-session.js'
import { dispatchMiddleware } from '#~/channels/middleware/dispatch/index.js'
import { createT, defineMessages } from '#~/channels/middleware/i18n.js'
import { getDb } from '#~/db/index.js'
import { resolveChannelMemoryRoot } from '#~/services/session/channel-context.js'
import { createSessionWithInitialMessage } from '#~/services/session/create.js'
import { writeChannelMessageContext } from '#~/services/session/index.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

vi.mock('#~/services/session/create.js', () => ({
  createSessionWithInitialMessage: vi.fn()
}))

vi.mock('#~/services/session/index.js', () => ({
  writeChannelMessageContext: vi.fn()
}))

vi.mock('#~/channels/middleware/bind-session.js', () => ({
  syncChannelSessionBinding: vi.fn()
}))

vi.mock('#~/channels/middleware/dispatch/prompt.js', () => ({
  buildSessionSystemPrompt: vi.fn().mockResolvedValue('system-prompt')
}))

const makeCtx = (overrides: Partial<ChannelContext> = {}): ChannelContext => ({
  channelKey: 'lark:default',
  inbound: {
    channelType: 'lark',
    channelId: 'ch1',
    sessionType: 'direct',
    messageId: 'm1',
    senderId: 'user1',
    text: 'hello world'
  } as any,
  connection: undefined,
  config: undefined,
  sessionId: undefined,
  channelAdapter: undefined,
  channelPermissionMode: undefined,
  channelEffort: undefined,
  contentItems: undefined,
  commandText: 'hello world',
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
  updateSession: vi.fn(),
  getChannelAdapterPreference: vi.fn(),
  setChannelAdapterPreference: vi.fn(),
  getChannelPermissionModePreference: vi.fn(),
  setChannelPermissionModePreference: vi.fn(),
  getChannelEffortPreference: vi.fn(),
  setChannelEffortPreference: vi.fn(),
  ...overrides,
  resolveSessionWorkspace: overrides.resolveSessionWorkspace ?? vi.fn().mockResolvedValue(undefined)
})

const tempDirs: string[] = []
const originalServerDataDir = process.env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__
const createChannelChildSessionRun = vi.fn()
const finishChannelChildSessionRun = vi.fn()
const ensureChannelConversationState = vi.fn()
const appendChannelConversationTurn = vi.fn()
const claimChannelPendingIntentResume = vi.fn()
const listResolvedChannelPendingIntents = vi.fn()
const finishChannelPendingIntentResumeClaim = vi.fn()
const getSessionRuntimeState = vi.fn()
const getChannelConversationState = vi.fn()
const getChannelConversationStateByThread = vi.fn()
const listRecentChannelConversationTurns = vi.fn()
const listOpenChannelPendingIntents = vi.fn()
const updateChannelPendingIntent = vi.fn()
const transferSessionPermissionState = vi.fn()

const makeNextMessageResumeIntent = (overrides: Record<string, unknown> = {}) => ({
  authorizationRequestId: 'auth-1',
  channelId: 'ch1',
  channelKey: 'lark:default',
  channelLinkName: 'wan-ke-chat',
  channelType: 'lark',
  conversationStateId: 'conversation-1',
  createdByChildRunId: 'blocked-child-run-1',
  delivery: 'public_hint',
  deliveryMessageId: 'om_1',
  entity: 'owo-demo',
  expiresAt: null,
  id: 'pending-auth-1',
  kind: 'need_approval',
  metadata: {
    resume: {
      authorizationRequestId: 'auth-1',
      authorizationStatus: 'granted',
      capability: 'Write',
      createdByChildRunId: 'blocked-child-run-1',
      mode: 'next_message',
      readyAt: 123,
      resolvedByAccountId: 'admin1',
      sessionId: 'resume-sess',
      status: 'ready',
      threadKey: 'direct:lark_default:ch1'
    }
  },
  ownerAccountId: 'user1',
  ownerUserId: null,
  payload: {
    authorizationRequestId: 'auth-1',
    capability: 'Write'
  },
  requiredAction: 'grant_authorization',
  resolvedAt: 123,
  sessionType: 'direct',
  status: 'resolved',
  threadKey: 'direct:lark_default:ch1',
  ...overrides
})

const useTempServerDataDir = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-dispatch-emoji-'))
  tempDirs.push(dir)
  process.env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__ = dir
}

const registerMoodEmojis = async () => {
  await upsertChannelEmojiRegistryEntry(resolveChannelMemoryRoot(), {
    id: '886d811081cfe16044c18e48a7fc152c',
    label: '已回到人才库',
    platform: 'wechat',
    tags: ['回怼', '自嘲', '裁员梗', '开除'],
    metadata: {
      emojiMd5: '886d811081cfe16044c18e48a7fc152c',
      emojiSize: 13658
    }
  })
  await upsertChannelEmojiRegistryEntry(resolveChannelMemoryRoot(), {
    id: 'd83aba14502d8aaf5e626eb963321532',
    label: '王师傅跳舞一',
    note: '适合开始整活、庆祝或进入表演状态。',
    platform: 'wechat',
    tags: ['跳舞', '整活', '摇摆'],
    metadata: {
      emojiMd5: 'd83aba14502d8aaf5e626eb963321532',
      emojiSize: 610807
    }
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  await useTempServerDataDir()
  createChannelChildSessionRun.mockReturnValue({
    id: 'child-run-1'
  })
  ensureChannelConversationState.mockReturnValue({
    id: 'conversation-1',
    threadKey: 'direct:lark_default:ch1'
  })
  appendChannelConversationTurn.mockReturnValue({
    id: 'turn-1'
  })
  listResolvedChannelPendingIntents.mockReturnValue([])
  getChannelConversationStateByThread.mockReturnValue(undefined)
  listRecentChannelConversationTurns.mockReturnValue([])
  listOpenChannelPendingIntents.mockReturnValue([])
  getChannelConversationState.mockReturnValue(undefined)
  claimChannelPendingIntentResume.mockReset()
  claimChannelPendingIntentResume.mockImplementation(input => ({
    ...makeNextMessageResumeIntent(),
    id: input.id,
    metadata: input.metadata
  }))
  updateChannelPendingIntent.mockReturnValue(undefined)
  getSessionRuntimeState.mockReturnValue({
    channelActorSnapshot: {
      actorAccountId: 'user1',
      channelKey: 'lark:default'
    }
  })
  vi.mocked(getDb).mockReturnValue({
    appendChannelConversationTurn,
    attachChannelIngressRouterRunChild: vi.fn(),
    attachChannelMemorySnapshotToChildRun: vi.fn(),
    claimChannelPendingIntentResume,
    createChannelChildSessionRun,
    ensureChannelConversationState,
    finishChannelPendingIntentResumeClaim,
    finishChannelChildSessionRun,
    findAgentRoomChannelConnections: vi.fn(() => []),
    getSessionRuntimeState,
    getChannelConversationState,
    getChannelConversationStateByThread,
    listChannelMemoryCandidates: vi.fn(() => []),
    listAgentRoomChannelConnections: vi.fn(() => []),
    listOpenChannelPendingIntents,
    listRecentChannelConversationTurns,
    markChannelChildSessionRunDispatched: vi.fn(),
    markChannelChildSessionRunRunning: vi.fn(),
    saveChannelMemorySnapshot: vi.fn(() => 'snapshot-1'),
    listResolvedChannelPendingIntents,
    transferSessionPermissionState,
    updateChannelPendingIntent
  } as any)
  vi.mocked(createSessionWithInitialMessage).mockResolvedValue({ id: 'new-sess' } as any)
})

afterEach(async () => {
  if (originalServerDataDir == null) {
    delete process.env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__
  } else {
    process.env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__ = originalServerDataDir
  }
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('dispatchMiddleware', () => {
  describe('new session (no sessionId)', () => {
    it('creates a session with text message', async () => {
      const ctx = makeCtx()
      const next = vi.fn().mockResolvedValue(undefined)

      await dispatchMiddleware(ctx, next)

      expect(createSessionWithInitialMessage).toHaveBeenCalledOnce()
      const args = vi.mocked(createSessionWithInitialMessage).mock.calls[0][0]
      expect(args.initialMessage).toBe('hello world')
      expect(args.initialContent).toBeUndefined()
      expect(args.shouldStart).toBe(true)
      expect(args.channelContext).toEqual(expect.objectContaining({
        actorAccountId: 'user1',
        channelId: 'ch1',
        channelKey: 'lark:default',
        childRunId: 'child-run-1',
        conversationStateId: 'conversation-1',
        threadKey: 'direct:lark_default:ch1',
        senderId: 'user1'
      }))
      expect(createChannelChildSessionRun).toHaveBeenCalledWith(expect.objectContaining({
        actorAccountId: 'user1',
        channelId: 'ch1',
        channelKey: 'lark:default',
        conversationStateId: 'conversation-1',
        dispatchMode: 'create_session',
        messageId: 'm1',
        metadata: expect.objectContaining({
          contentKind: 'text',
          hasRuntimeContent: false,
          threadReason: 'direct_entity'
        }),
        senderId: 'user1',
        threadKey: 'direct:lark_default:ch1',
        triggerType: 'message'
      }))
      expect(vi.mocked(getDb)().markChannelChildSessionRunDispatched).toHaveBeenCalledWith('child-run-1', {
        sessionId: 'new-sess'
      })
      expect(appendChannelConversationTurn).toHaveBeenCalledWith(expect.objectContaining({
        actorAccountId: 'user1',
        childRunId: 'child-run-1',
        conversationStateId: 'conversation-1',
        messageId: 'm1',
        role: 'inbound',
        summary: 'hello world',
        text: 'hello world',
        threadKey: 'direct:lark_default:ch1'
      }))
    })

    it('captures the resolved actor in the channel runtime context', async () => {
      const ctx = makeCtx({
        actor: {
          account: {
            accountId: 'ou_1',
            accountKey: 'lark:ou_1',
            avatarUrl: null,
            channelType: 'lark',
            createdAt: 1,
            displayName: null,
            metadata: null,
            updatedAt: 1
          },
          user: {
            createdAt: 1,
            displayName: '一介',
            id: 'user-yijie',
            updatedAt: 1
          }
        } as any
      })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      const args = vi.mocked(createSessionWithInitialMessage).mock.calls[0][0]
      expect(args.channelContext).toEqual(expect.objectContaining({
        actorAccountId: 'ou_1',
        actorUserId: 'user-yijie',
        senderId: 'user1'
      }))
    })

    it('sets ctx.sessionId to the newly created session id', async () => {
      const ctx = makeCtx()
      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))
      expect(ctx.sessionId).toBe('new-sess')
    })

    it('uses the pending channel adapter when creating a new session', async () => {
      const ctx = makeCtx({ channelAdapter: 'codex' })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      const args = vi.mocked(createSessionWithInitialMessage).mock.calls[0][0]
      expect(args.adapter).toBe('codex')
    })

    it('uses the pending channel permission mode when creating a new session', async () => {
      const ctx = makeCtx({ channelPermissionMode: 'dontAsk' })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      const args = vi.mocked(createSessionWithInitialMessage).mock.calls[0][0]
      expect(args.permissionMode).toBe('dontAsk')
    })

    it('uses a matched channel link entity as the new session prompt target', async () => {
      const ctx = makeCtx({
        channelLink: {
          channelKey: 'lark:default',
          entity: 'owo-demo',
          external: { type: 'chat', chatId: 'ch1' },
          name: 'wan-ke-chat',
          path: '/workspace/.oo/channels/wan-ke-chat/channel.json',
          definition: {} as never,
          ingress: {
            ambientRouting: false,
            createOnCommand: true,
            createOnMention: true,
            createOnPendingIntent: true,
            createOnReplyToBot: true
          },
          routing: { accounts: {}, default: {}, modes: {}, users: {} }
        }
      })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      const args = vi.mocked(createSessionWithInitialMessage).mock.calls[0][0]
      expect(args.promptType).toBe('entity')
      expect(args.promptName).toBe('owo-demo')
      expect(args.channelContext).toEqual(expect.objectContaining({
        channelLinkName: 'wan-ke-chat',
        entity: 'owo-demo'
      }))
    })

    it('hydrates a child with unexpired shared ambient turns only', async () => {
      getChannelConversationStateByThread.mockReturnValue({ id: 'ambient-state' })
      getChannelConversationState.mockReturnValue({
        activeParticipants: [],
        expiresAt: null,
        id: 'conversation-1',
        lastBotReply: null,
        summary: null,
        threadKey: 'direct:lark_default:ch1',
        topic: null
      })
      listRecentChannelConversationTurns.mockReturnValueOnce([]).mockReturnValueOnce([
        { createdAt: Date.now(), role: 'inbound', summary: 'ambient context', text: 'ambient context' }
      ])
      const ctx = makeCtx({
        channelLink: {
          channelKey: 'lark:default',
          definition: {} as never,
          entity: 'owo-demo',
          external: { type: 'chat', chatId: 'ch1' },
          ingress: {
            ambientRouting: false,
            createOnCommand: true,
            createOnMention: true,
            createOnPendingIntent: true,
            createOnReplyToBot: true,
            observeWindow: { maxTurns: 2, ttlSeconds: 60 }
          },
          name: 'wan-ke-chat',
          path: '/workspace/.oo/channels/wan-ke-chat/channel.json',
          routing: { accounts: {}, default: {}, modes: {}, users: {} }
        }
      })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      const childRun = createChannelChildSessionRun.mock.calls.at(-1)?.[0]
      expect(childRun.continuitySnapshot).toEqual(expect.objectContaining({
        ambientRecentTurns: [expect.objectContaining({ summary: 'ambient context' })]
      }))
      expect(vi.mocked(createSessionWithInitialMessage).mock.calls.at(-1)?.[0].initialRuntimeContent)
        .toContain('<ambient-channel-context>')
    })

    it('uses contentItems when present instead of text', async () => {
      const contentItems = [{ type: 'text', text: 'rich' }] as any
      const ctx = makeCtx({ contentItems })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      const args = vi.mocked(createSessionWithInitialMessage).mock.calls[0][0]
      expect(args.initialContent).toEqual(contentItems)
      expect(args.initialMessage).toBeUndefined()
    })

    it('uses the configured multimodal model for new image sessions', async () => {
      const contentItems = [{ type: 'image', url: 'file:///tmp/pic.png' }] as any
      const ctx = makeCtx({
        config: { type: 'wechat', multimodalModel: 'gpt-5.5' } as any,
        contentItems
      })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      const args = vi.mocked(createSessionWithInitialMessage).mock.calls[0][0]
      expect(args.model).toBe('gpt-5.5')
      expect(args.initialContent).toEqual(contentItems)
    })

    it('builds direct channel tags', async () => {
      const ctx = makeCtx()
      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      const args = vi.mocked(createSessionWithInitialMessage).mock.calls[0][0]
      expect(args.tags).toContain('channel:lark:direct:user1')
    })

    it('builds group channel tags', async () => {
      const ctx = makeCtx({
        inbound: { channelType: 'lark', channelId: 'grp1', sessionType: 'group', messageId: 'm1', text: 'hi' } as any
      })
      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      const args = vi.mocked(createSessionWithInitialMessage).mock.calls[0][0]
      expect(args.tags).toContain('channel:lark:group:grp1')
    })

    it('adds a group-only runtime reminder without changing the visible initial message', async () => {
      const ctx = makeCtx({
        inbound: {
          channelType: 'wechat',
          channelId: 'grp1@chatroom',
          sessionType: 'group',
          messageId: 'm1',
          text: '@二介 吃了吗'
        } as any
      })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      const args = vi.mocked(createSessionWithInitialMessage).mock.calls[0][0]
      expect(args.initialMessage).toBe('@二介 吃了吗')
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining('普通 assistant 回复不会自动发送到群里'))
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining('oneworks channel send'))
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining('oneworks channel send --br'))
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining('Chat History 是内部记录'))
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining('外显风格'))
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining('被调侃别正经辩解'))
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining('完成或 stop 时'))
    })

    it('adds a compact emoji mood palette for direct casual chats', async () => {
      await registerMoodEmojis()
      const ctx = makeCtx({
        inbound: {
          channelType: 'wechat',
          channelId: 'wxid_user',
          sessionType: 'direct',
          messageId: 'm1',
          text: '今天这波有点抽象啊'
        } as any
      })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      const args = vi.mocked(createSessionWithInitialMessage).mock.calls[0][0]
      expect(args.initialMessage).toBe('今天这波有点抽象啊')
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining('channel-emoji-mood-hint'))
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining('当前可发表情小抄'))
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining('已回到人才库'))
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining('王师傅跳舞一'))
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining(
        'oneworks channel emoji send 886d811081cfe16044c18e48a7fc152c --platform wechat'
      ))
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining(
        'oneworks channel emoji send d83aba14502d8aaf5e626eb963321532 --platform wechat'
      ))
      expect(args.initialRuntimeContent).not.toEqual(expect.stringContaining('Chat History 是内部记录'))
    })

    it('calls next after session creation', async () => {
      const next = vi.fn().mockResolvedValue(undefined)
      await dispatchMiddleware(makeCtx(), next)
      expect(next).toHaveBeenCalledOnce()
    })

    it('syncs the channel binding before starting the first adapter run', async () => {
      let beforeStart: ((sessionId: string) => Promise<void> | void) | undefined
      vi.mocked(createSessionWithInitialMessage).mockImplementationOnce(async (options) => {
        beforeStart = options.beforeStart
        await options.beforeStart?.('new-sess')
        return { id: 'new-sess' } as any
      })

      await dispatchMiddleware(makeCtx(), vi.fn().mockResolvedValue(undefined))

      expect(beforeStart).toBeTypeOf('function')
      expect(syncChannelSessionBinding).toHaveBeenCalledWith({
        channelKey: 'lark:default',
        inbound: expect.objectContaining({
          channelType: 'lark',
          channelId: 'ch1',
          sessionType: 'direct'
        }),
        sessionId: 'new-sess'
      })
      expect(writeChannelMessageContext).toHaveBeenCalledWith(
        'new-sess',
        expect.objectContaining({
          channelId: 'ch1',
          channelKey: 'lark:default',
          channelType: 'lark',
          senderId: 'user1',
          sessionType: 'direct'
        })
      )
    })
  })

  describe('continued conversation (parent session present)', () => {
    it('creates a fresh child session with the previous session as its parent', async () => {
      vi.mocked(createSessionWithInitialMessage).mockImplementationOnce(async (options) => {
        await options.beforeStart?.('new-sess')
        return { id: 'new-sess' } as any
      })
      const ctx = makeCtx({ sessionId: 'existing-sess' })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      expect(createSessionWithInitialMessage).toHaveBeenCalledWith(expect.objectContaining({
        initialMessage: 'hello world',
        parentSessionId: 'existing-sess',
        workspace: {
          createWorktree: false,
          sourceSessionId: 'existing-sess'
        }
      }))
      expect(syncChannelSessionBinding).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'new-sess'
      }))
      expect(transferSessionPermissionState).toHaveBeenCalledWith('existing-sess', 'new-sess')
      const childRunInput = createChannelChildSessionRun.mock.calls[0]![0]
      expect(childRunInput.dispatchMode).toBe('continue_session')
      expect(childRunInput.sessionId).toBeUndefined()
      expect(vi.mocked(getDb)().markChannelChildSessionRunDispatched).toHaveBeenCalledWith('child-run-1', {
        sessionId: 'new-sess'
      })
      expect(ctx.sessionId).toBe('new-sess')
    })

    it('does not transfer parent permissions across message senders', async () => {
      getSessionRuntimeState.mockReturnValueOnce({
        channelActorSnapshot: {
          actorAccountId: 'different-user',
          channelKey: 'lark:default'
        }
      })
      vi.mocked(createSessionWithInitialMessage).mockImplementationOnce(async (options) => {
        await options.beforeStart?.('new-sess')
        return { id: 'new-sess' } as any
      })

      await dispatchMiddleware(makeCtx({ sessionId: 'existing-sess' }), vi.fn())

      expect(transferSessionPermissionState).not.toHaveBeenCalled()
    })

    it('injects next-message resume context into the fresh child session', async () => {
      listResolvedChannelPendingIntents.mockReturnValue([
        makeNextMessageResumeIntent({
          metadata: {
            resume: {
              authorizationRequestId: 'auth-1',
              authorizationStatus: 'granted',
              capability: 'Write',
              mode: 'next_message',
              sessionId: 'existing-sess',
              status: 'ready',
              threadKey: 'direct:lark_default:ch1'
            }
          }
        })
      ])
      const ctx = makeCtx({ sessionId: 'existing-sess' })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      const args = vi.mocked(createSessionWithInitialMessage).mock.calls[0][0]
      expect(args.parentSessionId).toBe('existing-sess')
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining('<channel-next-message-resume>'))
      expect(args.initialRuntimeContent).toEqual(expect.stringContaining('authorizationRequestId: auth-1'))
      const claimId = claimChannelPendingIntentResume.mock.calls[0][0].metadata.resume.claimId
      expect(claimChannelPendingIntentResume).toHaveBeenCalledWith({
        id: 'pending-auth-1',
        metadata: expect.objectContaining({
          resume: expect.objectContaining({
            claimId,
            dispatchReason: 'next_message',
            leaseExpiresAt: expect.any(Number),
            status: 'dispatching'
          })
        }),
        now: expect.any(Number)
      })
      expect(finishChannelPendingIntentResumeClaim).toHaveBeenCalledWith({
        claimId,
        id: 'pending-auth-1',
        metadata: expect.objectContaining({
          resume: expect.objectContaining({
            resumeChildRunId: 'child-run-1',
            sessionId: 'new-sess',
            status: 'dispatched'
          })
        }),
        now: expect.any(Number)
      })
    })

    it('does not inject a next-message resume already claimed by another dispatch', async () => {
      listResolvedChannelPendingIntents.mockReturnValue([makeNextMessageResumeIntent()])
      claimChannelPendingIntentResume.mockReturnValueOnce(undefined)

      await dispatchMiddleware(makeCtx({ sessionId: 'existing-sess' }), vi.fn().mockResolvedValue(undefined))

      const args = vi.mocked(createSessionWithInitialMessage).mock.calls[0][0]
      expect(args.initialRuntimeContent).not.toEqual(expect.stringContaining('<channel-next-message-resume>'))
      expect(finishChannelPendingIntentResumeClaim).not.toHaveBeenCalled()
    })

    it('uses the pending intent session as parent when no active binding exists', async () => {
      listResolvedChannelPendingIntents.mockReturnValue([makeNextMessageResumeIntent()])
      const ctx = makeCtx()

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      expect(createSessionWithInitialMessage).toHaveBeenCalledWith(expect.objectContaining({
        parentSessionId: 'resume-sess',
        workspace: {
          createWorktree: false,
          sourceSessionId: 'resume-sess'
        }
      }))
      expect(ctx.sessionId).toBe('new-sess')
    })

    it('uses the pending intent session when another message changed the active binding', async () => {
      listResolvedChannelPendingIntents.mockReturnValue([makeNextMessageResumeIntent()])

      await dispatchMiddleware(makeCtx({ sessionId: 'unrelated-latest-sess' }), vi.fn().mockResolvedValue(undefined))

      expect(createSessionWithInitialMessage).toHaveBeenCalledWith(expect.objectContaining({
        parentSessionId: 'resume-sess',
        workspace: {
          createWorktree: false,
          sourceSessionId: 'resume-sess'
        }
      }))
    })

    it('marks the child run failed when child creation fails', async () => {
      vi.mocked(createSessionWithInitialMessage).mockRejectedValueOnce(new Error('runtime offline'))

      await expect(dispatchMiddleware(
        makeCtx({ sessionId: 'existing-sess' }),
        vi.fn().mockResolvedValue(undefined)
      )).rejects.toThrow('runtime offline')

      expect(finishChannelChildSessionRun).toHaveBeenCalledWith('child-run-1', {
        error: 'runtime offline',
        sessionId: 'existing-sess',
        status: 'failed'
      })
    })

    it('keeps rich content and model selection on the child session', async () => {
      const contentItems = [{ type: 'image', url: 'http://img' }] as any
      await dispatchMiddleware(
        makeCtx({
          config: { type: 'wechat', multimodalModel: 'gpt-5.5' } as any,
          contentItems,
          sessionId: 'existing-sess'
        }),
        vi.fn().mockResolvedValue(undefined)
      )

      expect(createSessionWithInitialMessage).toHaveBeenCalledWith(expect.objectContaining({
        initialContent: contentItems,
        model: 'gpt-5.5',
        parentSessionId: 'existing-sess'
      }))
    })

    it('calls next after creating the child session', async () => {
      const next = vi.fn().mockResolvedValue(undefined)
      await dispatchMiddleware(makeCtx({ sessionId: 'existing-sess' }), next)
      expect(next).toHaveBeenCalledOnce()
    })
  })
})
