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
import { resolveChannelMemoryRoot } from '#~/services/session/channel-context.js'
import { createSessionWithInitialMessage } from '#~/services/session/create.js'
import { processUserMessage, writeChannelMessageContext } from '#~/services/session/index.js'

vi.mock('#~/services/session/create.js', () => ({
  createSessionWithInitialMessage: vi.fn()
}))

vi.mock('#~/services/session/index.js', () => ({
  processUserMessage: vi.fn(),
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
        channelId: 'ch1',
        channelKey: 'lark:default',
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

  describe('existing session (sessionId present)', () => {
    it('forwards text message to processUserMessage', async () => {
      const ctx = makeCtx({ sessionId: 'existing-sess' })
      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      expect(processUserMessage).toHaveBeenCalledWith('existing-sess', 'hello world', {
        channelContext: expect.objectContaining({
          channelId: 'ch1',
          channelKey: 'lark:default',
          senderId: 'user1'
        })
      })
      expect(createSessionWithInitialMessage).not.toHaveBeenCalled()
    })

    it('forwards contentItems when present', async () => {
      const contentItems = [{ type: 'image', url: 'http://img' }] as any
      const ctx = makeCtx({ sessionId: 'existing-sess', contentItems })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      expect(processUserMessage).toHaveBeenCalledWith('existing-sess', contentItems, {
        channelContext: expect.objectContaining({
          channelId: 'ch1',
          channelKey: 'lark:default',
          senderId: 'user1'
        })
      })
    })

    it('uses the configured multimodal model for image follow-up messages', async () => {
      const contentItems = [{ type: 'image', url: 'http://img' }] as any
      const ctx = makeCtx({
        config: { type: 'wechat', multimodalModel: 'gpt-5.5' } as any,
        sessionId: 'existing-sess',
        contentItems
      })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      expect(processUserMessage).toHaveBeenCalledWith('existing-sess', contentItems, {
        channelContext: expect.objectContaining({
          channelId: 'ch1',
          channelKey: 'lark:default',
          senderId: 'user1'
        }),
        model: 'gpt-5.5'
      })
    })

    it('passes a group-only runtime reminder to existing sessions without changing saved content', async () => {
      const ctx = makeCtx({
        inbound: {
          channelType: 'wechat',
          channelId: 'grp1@chatroom',
          sessionType: 'group',
          messageId: 'm1',
          senderId: 'user1',
          text: '@二介 吃了吗'
        } as any,
        sessionId: 'existing-sess'
      })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      expect(processUserMessage).toHaveBeenCalledWith('existing-sess', '@二介 吃了吗', {
        channelContext: expect.objectContaining({
          channelId: 'grp1@chatroom',
          sessionType: 'group'
        }),
        runtimeContent: expect.stringContaining('外显风格')
      })
    })

    it('passes a compact emoji mood palette to existing direct sessions', async () => {
      await registerMoodEmojis()
      const ctx = makeCtx({
        inbound: {
          channelType: 'wechat',
          channelId: 'wxid_user',
          sessionType: 'direct',
          messageId: 'm1',
          senderId: 'wxid_user',
          text: '今天这波有点抽象啊'
        } as any,
        sessionId: 'existing-sess'
      })

      await dispatchMiddleware(ctx, vi.fn().mockResolvedValue(undefined))

      expect(processUserMessage).toHaveBeenCalledWith('existing-sess', '今天这波有点抽象啊', {
        channelContext: expect.objectContaining({
          channelId: 'wxid_user',
          sessionType: 'direct'
        }),
        runtimeContent: expect.stringContaining('channel-emoji-mood-hint')
      })
    })

    it('calls next after forwarding', async () => {
      const next = vi.fn().mockResolvedValue(undefined)
      await dispatchMiddleware(makeCtx({ sessionId: 'existing-sess' }), next)
      expect(next).toHaveBeenCalledOnce()
    })
  })
})
