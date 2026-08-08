import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelContext } from '#~/channels/middleware/@types/index.js'
import { identityMiddleware } from '#~/channels/middleware/identity.js'
import { getDb } from '#~/db/index.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

const makeCtx = (overrides: Partial<ChannelContext> = {}): ChannelContext => ({
  channelKey: 'lark-main',
  inbound: {
    channelType: 'lark',
    channelId: 'oc_123',
    sessionType: 'group',
    messageId: 'om_1',
    senderId: 'ou_1',
    text: 'hello',
    raw: {}
  } as any,
  connection: undefined,
  config: { type: 'lark' } as any,
  sessionId: undefined,
  channelAdapter: undefined,
  channelPermissionMode: undefined,
  channelEffort: undefined,
  contentItems: undefined,
  commandText: 'hello',
  defineMessages: vi.fn(),
  t: (key: string) => key,
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

describe('identityMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upserts the sender channel account and resolves a verified canonical user', async () => {
    const account = {
      channelType: 'lark',
      accountId: 'ou_1',
      accountKey: 'lark:ou_1',
      displayName: null,
      avatarUrl: null,
      metadata: null,
      createdAt: 1,
      updatedAt: 1
    }
    const identityLink = {
      channelType: 'lark',
      accountId: 'ou_1',
      userId: 'user-yijie',
      status: 'verified',
      source: 'manual',
      createdAt: 1,
      updatedAt: 1
    } as const
    const user = {
      id: 'user-yijie',
      displayName: '一介',
      createdAt: 1,
      updatedAt: 1
    }
    vi.mocked(getDb).mockReturnValue({
      getChannelIdentityLink: vi.fn(() => identityLink),
      resolveCanonicalUserByChannelAccount: vi.fn(() => user),
      upsertChannelAccount: vi.fn(() => account)
    } as any)
    const ctx = makeCtx()
    const next = vi.fn().mockResolvedValue(undefined)

    await identityMiddleware(ctx, next)

    expect(getDb().upsertChannelAccount).toHaveBeenCalledWith({
      channelType: 'lark',
      accountId: 'ou_1'
    })
    expect(ctx.actor).toEqual({
      account,
      identityLink,
      user
    })
    expect(next).toHaveBeenCalledOnce()
  })

  it('does not create an actor when the inbound event has no sender', async () => {
    vi.mocked(getDb).mockReturnValue({
      getChannelIdentityLink: vi.fn(),
      resolveCanonicalUserByChannelAccount: vi.fn(),
      upsertChannelAccount: vi.fn()
    } as any)
    const ctx = makeCtx({
      inbound: {
        channelType: 'lark',
        channelId: 'oc_123',
        sessionType: 'group',
        raw: {}
      } as any
    })
    const next = vi.fn().mockResolvedValue(undefined)

    await identityMiddleware(ctx, next)

    expect(getDb().upsertChannelAccount).not.toHaveBeenCalled()
    expect(ctx.actor).toBeUndefined()
    expect(next).toHaveBeenCalledOnce()
  })
})
