import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelContext } from '#~/channels/middleware/@types/index.js'
import {
  clearGroupMessageDebounceStateForTests,
  groupMessageDebounceMiddleware
} from '#~/channels/middleware/group-message-debounce.js'
import { createT, defineMessages } from '#~/channels/middleware/i18n.js'

const makeCtx = (overrides: Partial<ChannelContext> = {}): ChannelContext => ({
  channelKey: 'wechat',
  inbound: {
    channelType: 'wechat',
    channelId: 'room@chatroom',
    sessionType: 'group',
    messageId: 'm1',
    senderId: 'user1',
    text: '[user1]:\nhello',
    raw: { contentItems: [{ type: 'text', text: '[user1]:\nhello' }] }
  } as any,
  connection: undefined,
  config: { type: 'wechat', groupMessageDebounceMs: 50 } as any,
  sessionId: 'sess-1',
  channelAdapter: undefined,
  channelPermissionMode: undefined,
  channelEffort: undefined,
  contentItems: [{ type: 'text', text: '[user1]:\nhello' }] as any,
  commandText: 'hello',
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

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  clearGroupMessageDebounceStateForTests()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('groupMessageDebounceMiddleware', () => {
  it('passes direct messages through immediately', async () => {
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      inbound: {
        channelType: 'wechat',
        channelId: 'wxid_user',
        sessionType: 'direct',
        messageId: 'm1',
        text: '[wxid_user]:\nhello',
        raw: {}
      } as any
    })

    await groupMessageDebounceMiddleware(ctx, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('passes slash commands through immediately', async () => {
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      commandText: '/help',
      inbound: {
        ...makeCtx().inbound,
        text: '[user1]:\n/help'
      } as any
    })

    await groupMessageDebounceMiddleware(ctx, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('passes group messages with non-text content through immediately', async () => {
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      commandText: '[微信图片] 已提取图片。',
      contentItems: [
        { type: 'text', text: '[user1]:\n[微信图片] 已提取图片。' },
        { type: 'image', url: 'file:///tmp/wechat-image.png', mimeType: 'image/png' }
      ] as any,
      inbound: {
        ...makeCtx().inbound,
        text: '[user1]:\n[微信图片] 已提取图片。',
        raw: {
          contentItems: [
            { type: 'text', text: '[user1]:\n[微信图片] 已提取图片。' },
            { type: 'image', url: 'file:///tmp/wechat-image.png', mimeType: 'image/png' }
          ]
        }
      } as any
    })

    await groupMessageDebounceMiddleware(ctx, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('passes group messages through immediately when debounce is disabled', async () => {
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      config: { type: 'wechat', groupMessageDebounceMs: 0 } as any
    })

    await groupMessageDebounceMiddleware(ctx, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('debounces and merges ordinary group messages', async () => {
    const firstNext = vi.fn().mockResolvedValue(undefined)
    const secondNext = vi.fn().mockResolvedValue(undefined)
    const firstCtx = makeCtx()
    const secondCtx = makeCtx({
      inbound: {
        channelType: 'wechat',
        channelId: 'room@chatroom',
        sessionType: 'group',
        messageId: 'm2',
        senderId: 'user2',
        text: '[user2]:\nworld',
        raw: { contentItems: [{ type: 'text', text: '[user2]:\nworld' }] }
      } as any,
      contentItems: [{ type: 'text', text: '[user2]:\nworld' }] as any,
      commandText: 'world'
    })

    await groupMessageDebounceMiddleware(firstCtx, firstNext)
    await vi.advanceTimersByTimeAsync(40)
    await groupMessageDebounceMiddleware(secondCtx, secondNext)
    await vi.advanceTimersByTimeAsync(49)

    expect(firstNext).not.toHaveBeenCalled()
    expect(secondNext).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(firstNext).not.toHaveBeenCalled()
    expect(secondNext).toHaveBeenCalledOnce()
    expect(secondCtx.inbound.text).toBe('[user1]:\nhello\n\n[user2]:\nworld')
    expect(secondCtx.commandText).toBe('hello\n\nworld')
    expect(secondCtx.contentItems).toEqual([
      { type: 'text', text: '[user1]:\nhello\n\n[user2]:\nworld' }
    ])
    expect(secondCtx.inbound.raw).toMatchObject({
      debouncedMessages: [
        { messageId: 'm1', senderId: 'user1' },
        { messageId: 'm2', senderId: 'user2' }
      ]
    })
  })
})
