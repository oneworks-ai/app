import { beforeEach, describe, expect, it, vi } from 'vitest'

import { updateConfigFile } from '@oneworks/config'

import type { ChannelContext } from '#~/channels/middleware/@types/index.js'
import {
  ADMIN_BOOTSTRAP_REPLY_TEXT,
  adminBootstrapMiddleware,
  logAdminBootstrapAuthorizationCommand
} from '#~/channels/middleware/admin-bootstrap.js'
import { createT, defineMessages } from '#~/channels/middleware/i18n.js'
import { loadConfigState } from '#~/services/config/index.js'
import { logger } from '#~/utils/logger.js'

vi.mock('@oneworks/config', () => ({
  updateConfigFile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: vi.fn().mockResolvedValue({
    globalSource: { rawConfig: { channels: {} }, resolvedConfig: { channels: {} } },
    projectSource: { rawConfig: { channels: {} }, resolvedConfig: { channels: {} } },
    userSource: { rawConfig: { channels: {} }, resolvedConfig: { channels: {} } }
  })
}))

vi.mock('#~/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  }
}))

const makeCtx = (overrides: Partial<ChannelContext> = {}): ChannelContext => ({
  channelKey: 'lark:default',
  configSource: 'project',
  inbound: {
    channelType: 'lark',
    channelId: 'ch1',
    sessionType: 'direct',
    messageId: 'm1',
    senderId: 'user1',
    ack: vi.fn().mockResolvedValue(undefined),
    unack: vi.fn().mockResolvedValue(undefined)
  } as any,
  connection: undefined,
  config: { type: 'lark', access: { allowPrivateChat: true } } as any,
  sessionId: undefined,
  channelAdapter: undefined,
  channelPermissionMode: undefined,
  channelEffort: undefined,
  contentItems: undefined,
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

const getLoggedAuthorizationCommand = () => {
  const logContext = vi.mocked(logger.warn).mock.calls[0]?.[0] as { authorizationCommand?: string } | undefined
  return logContext?.authorizationCommand
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadConfigState).mockResolvedValue({
    globalSource: { rawConfig: { channels: {} }, resolvedConfig: { channels: {} } },
    projectSource: { rawConfig: { channels: {} }, resolvedConfig: { channels: {} } },
    userSource: { rawConfig: { channels: {} }, resolvedConfig: { channels: {} } }
  } as any)
})

describe('adminBootstrapMiddleware', () => {
  it('blocks all messages and logs an authorization command when admins are not initialized', async () => {
    const next = vi.fn()
    const ctx = makeCtx()

    await adminBootstrapMiddleware(ctx, next)

    expect(next).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith(ADMIN_BOOTSTRAP_REPLY_TEXT)
    expect(ctx.inbound.ack).toHaveBeenCalledOnce()
    expect(ctx.inbound.unack).toHaveBeenCalledOnce()
    const authorizationCommand = getLoggedAuthorizationCommand()
    expect(authorizationCommand).toMatch(/^\/authorize-admin [a-f0-9]{24}$/u)
    expect(vi.mocked(ctx.reply).mock.calls[0]?.[0]).not.toContain(authorizationCommand!)
  })

  it('adds the current sender as the first admin when they send the logged authorization command', async () => {
    const ctx = makeCtx({
      channelKey: 'lark:bootstrap-second',
      inbound: {
        channelType: 'lark',
        channelId: 'ch1',
        sessionType: 'direct',
        messageId: 'm2',
        senderId: 'user2',
        ack: vi.fn().mockResolvedValue(undefined),
        unack: vi.fn().mockResolvedValue(undefined)
      } as any
    })
    await adminBootstrapMiddleware(ctx, vi.fn())
    const authorizationCommand = getLoggedAuthorizationCommand()
    expect(authorizationCommand).toBeTruthy()
    vi.mocked(ctx.reply).mockClear()

    ctx.commandText = authorizationCommand!
    await adminBootstrapMiddleware(ctx, vi.fn())

    expect(updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'project',
      section: 'channels',
      value: {
        'lark:bootstrap-second': {
          type: 'lark',
          access: {
            allowPrivateChat: true,
            admins: ['user2']
          }
        }
      }
    }))
    expect(ctx.reply).toHaveBeenCalledWith('已完成授权：user2 已加入管理员列表。')
  })

  it('uses the startup authorization command to authorize the first inbound sender', async () => {
    const ctx = makeCtx({
      channelKey: 'lark:startup-bootstrap',
      inbound: {
        channelType: 'lark',
        channelId: 'ch1',
        sessionType: 'direct',
        messageId: 'm3',
        senderId: 'user-from-channel',
        ack: vi.fn().mockResolvedValue(undefined),
        unack: vi.fn().mockResolvedValue(undefined)
      } as any
    })

    logAdminBootstrapAuthorizationCommand({
      channelKey: ctx.channelKey,
      channelType: ctx.inbound.channelType,
      config: ctx.config,
      configSource: ctx.configSource
    })
    const authorizationCommand = getLoggedAuthorizationCommand()
    expect(authorizationCommand).toMatch(/^\/authorize-admin [a-f0-9]{24}$/u)

    ctx.commandText = authorizationCommand!
    await adminBootstrapMiddleware(ctx, vi.fn())

    expect(updateConfigFile).toHaveBeenCalledWith(expect.objectContaining({
      source: 'project',
      section: 'channels',
      value: {
        'lark:startup-bootstrap': {
          type: 'lark',
          access: {
            allowPrivateChat: true,
            admins: ['user-from-channel']
          }
        }
      }
    }))
    expect(ctx.reply).toHaveBeenCalledWith('已完成授权：user-from-channel 已加入管理员列表。')
  })

  it('continues the pipeline when admins are already configured', async () => {
    const next = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      config: { type: 'lark', access: { admins: ['admin1'] } } as any
    })

    await adminBootstrapMiddleware(ctx, next)

    expect(next).toHaveBeenCalledOnce()
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it('rejects invalid bootstrap commands without updating config', async () => {
    const ctx = makeCtx({ commandText: '/authorize-admin wrong-token' })

    await adminBootstrapMiddleware(ctx, vi.fn())

    expect(updateConfigFile).not.toHaveBeenCalled()
    expect(ctx.reply).toHaveBeenCalledWith(ADMIN_BOOTSTRAP_REPLY_TEXT)
    expect(vi.mocked(ctx.reply).mock.calls[0]?.[0]).not.toMatch(/\/authorize-admin [a-f0-9]{24}/u)
  })
})
