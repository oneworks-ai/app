/* eslint-disable max-lines -- Channel initialization coverage shares one mocked runtime and connection registry. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const loadChannelModule = vi.fn()
const handleInboundEvent = vi.fn()
const handleSessionEvent = vi.fn()
const resolveBinding = vi.fn()
const sendToolCallJsonFile = vi.fn()
const connectionHandleWebhook = vi.fn()
const loadChannelLinks = vi.fn()
const migrateLegacyChannelIdentityNamespace = vi.fn()
const commitChannelWebhookNonce = vi.fn()
const releaseChannelWebhookNonce = vi.fn()
const reserveChannelWebhookNonce = vi.fn()
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}

vi.mock('#~/channels/loader.js', () => ({
  loadChannelModule
}))

vi.mock('#~/channels/handlers.js', () => ({
  handleInboundEvent,
  handleSessionEvent
}))

vi.mock('#~/channels/state.js', () => ({
  resolveBinding
}))

vi.mock('#~/channels/tool-call-file.js', () => ({
  sendToolCallJsonFile
}))

vi.mock('#~/services/channel-links/index.js', () => ({
  loadChannelLinks
}))

vi.mock('#~/db/index.js', () => ({
  getDb: () => ({
    commitChannelWebhookNonce,
    migrateLegacyChannelIdentityNamespace,
    releaseChannelWebhookNonce,
    reserveChannelWebhookNonce
  })
}))

vi.mock('#~/utils/logger.js', () => ({
  logger
}))

describe('initChannels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    handleInboundEvent.mockResolvedValue(undefined)
    handleSessionEvent.mockResolvedValue(false)
    loadChannelLinks.mockResolvedValue([])
    reserveChannelWebhookNonce.mockReturnValue(true)
    migrateLegacyChannelIdentityNamespace.mockReturnValue({
      accounts: 0,
      credentials: 0,
      identityLinks: 0,
      linkCodes: 0
    })
  })

  it('logs connected channels after startReceiving succeeds', async () => {
    const startReceiving = vi.fn()

    loadChannelModule.mockReturnValue({
      definition: {
        configSchema: z.object({
          type: z.literal('lark'),
          appId: z.string()
        })
      },
      create: vi.fn().mockResolvedValue({
        startReceiving,
        close: vi.fn()
      })
    })

    const { initChannels } = await import('#~/channels/index.js')
    const manager = await initChannels([{
      source: 'project',
      config: {
        channels: {
          'miniapp-gear': {
            type: 'lark',
            appId: 'cli_xxx'
          }
        }
      }
    }])

    expect(startReceiving).toHaveBeenCalledOnce()
    expect(migrateLegacyChannelIdentityNamespace).toHaveBeenCalledWith({
      channelType: 'lark',
      issuerKey: 'miniapp-gear'
    })
    expect(startReceiving).toHaveBeenCalledWith({
      channelKey: 'miniapp-gear',
      handlers: {
        message: expect.any(Function)
      }
    })
    expect(manager.states.get('miniapp-gear')).toMatchObject({
      key: 'miniapp-gear',
      type: 'lark',
      status: 'connected',
      configSource: 'project'
    })
    expect(logger.info).toHaveBeenCalledWith(
      {
        channelKey: 'miniapp-gear',
        channelType: 'lark',
        configSource: 'project'
      },
      '[channels] channel connected'
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        channelKey: 'miniapp-gear',
        channelType: 'lark',
        configSource: 'project',
        authorizationCommand: expect.stringMatching(/^\/authorize-admin [a-f0-9]{24}$/u)
      }),
      '[channel] 管理员尚未初始化，请将授权指令发送到频道完成管理员授权'
    )
  })

  it('does not migrate a legacy channel type shared by multiple issuers', async () => {
    loadChannelModule.mockReturnValue({
      definition: {
        configSchema: z.object({
          type: z.literal('lark'),
          appId: z.string()
        })
      },
      create: vi.fn().mockResolvedValue({
        startReceiving: vi.fn(),
        close: vi.fn()
      })
    })

    const { initChannels } = await import('#~/channels/index.js')
    await initChannels([{
      source: 'project',
      config: {
        channels: {
          'lark-main': { type: 'lark', appId: 'cli_main' },
          'lark-support': { type: 'lark', appId: 'cli_support' }
        }
      }
    }])

    expect(migrateLegacyChannelIdentityNamespace).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      {
        channelType: 'lark',
        issuerKeys: ['lark-main', 'lark-support']
      },
      '[channels] skipped ambiguous legacy identity namespace migration'
    )
  })

  it('serializes inbound events for the same channel conversation', async () => {
    const startReceiving = vi.fn()

    loadChannelModule.mockReturnValue({
      definition: {
        configSchema: z.object({
          type: z.literal('lark'),
          appId: z.string()
        })
      },
      create: vi.fn().mockResolvedValue({
        startReceiving,
        close: vi.fn()
      })
    })

    const { initChannels } = await import('#~/channels/index.js')
    await initChannels([{
      source: 'project',
      config: {
        channels: {
          'miniapp-gear': {
            type: 'lark',
            appId: 'cli_xxx'
          }
        }
      }
    }])

    const handler = startReceiving.mock.calls[0]?.[0].handlers.message
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    handleInboundEvent.mockImplementation(async (_channelKey, event) => {
      order.push(`start:${event.messageId}`)
      if (event.messageId === 'm1') {
        await new Promise<void>(resolve => {
          releaseFirst = resolve
        })
      }
      order.push(`end:${event.messageId}`)
    })

    const first = handler?.({
      channelType: 'lark',
      sessionType: 'direct',
      channelId: 'open-user-1',
      messageId: 'm1',
      raw: {}
    })
    await Promise.resolve()

    const second = handler?.({
      channelType: 'lark',
      sessionType: 'direct',
      channelId: 'open-user-1',
      messageId: 'm2',
      raw: {}
    })
    await Promise.resolve()

    expect(order).toEqual(['start:m1'])
    releaseFirst?.()
    await Promise.all([first, second])

    expect(order).toEqual(['start:m1', 'end:m1', 'start:m2', 'end:m2'])
  })

  it('passes configured channel links for the channel into inbound handling', async () => {
    const startReceiving = vi.fn()
    const channelLink = {
      channelKey: 'miniapp-gear',
      entity: 'owo-demo',
      external: { type: 'chat', chatId: 'chat_1' },
      name: 'wan-ke-chat',
      path: '/workspace/.oo/channels/wan-ke-chat/channel.json',
      definition: {}
    }
    loadChannelLinks.mockResolvedValue([
      channelLink,
      {
        ...channelLink,
        channelKey: 'other',
        name: 'other-chat'
      }
    ])

    loadChannelModule.mockReturnValue({
      definition: {
        configSchema: z.object({
          type: z.literal('lark'),
          appId: z.string()
        })
      },
      create: vi.fn().mockResolvedValue({
        startReceiving,
        close: vi.fn()
      })
    })

    const { initChannels } = await import('#~/channels/index.js')
    await initChannels([{
      source: 'project',
      config: {
        channels: {
          'miniapp-gear': {
            type: 'lark',
            appId: 'cli_xxx'
          }
        }
      }
    }])

    const handler = startReceiving.mock.calls[0]?.[0].handlers.message
    await handler?.({
      channelType: 'lark',
      sessionType: 'group',
      channelId: 'chat_1',
      messageId: 'm1',
      raw: {}
    })

    expect(handleInboundEvent).toHaveBeenCalledWith(
      'miniapp-gear',
      expect.objectContaining({
        channelId: 'chat_1',
        messageId: 'm1'
      }),
      expect.any(Object),
      expect.objectContaining({ type: 'lark' }),
      'project',
      [channelLink]
    )
  })

  it('logs validation failures instead of failing silently', async () => {
    loadChannelModule.mockReturnValue({
      definition: {
        configSchema: z.object({
          type: z.literal('lark'),
          appId: z.string()
        })
      },
      create: vi.fn()
    })

    const { initChannels } = await import('#~/channels/index.js')
    const manager = await initChannels([{
      source: 'project',
      config: {
        channels: {
          'miniapp-gear': {
            type: 'lark'
          }
        }
      }
    }])

    expect(manager.states.get('miniapp-gear')).toMatchObject({
      key: 'miniapp-gear',
      type: 'lark',
      status: 'error',
      configSource: 'project'
    })

    const [payload, message] = logger.error.mock.calls[0] ?? []
    expect(message).toBe('[channels] channel config validation failed')
    expect(payload).toEqual(expect.objectContaining({
      channelKey: 'miniapp-gear',
      channelType: 'lark',
      configSource: 'project'
    }))
    expect(typeof payload.error).toBe('string')
  })

  it('logs init failures and closes the partially created connection', async () => {
    const close = vi.fn()
    const startReceiving = vi.fn().mockRejectedValue(new Error('connection rejected'))

    loadChannelModule.mockReturnValue({
      definition: {
        configSchema: z.object({
          type: z.literal('lark'),
          appId: z.string()
        })
      },
      create: vi.fn().mockResolvedValue({
        startReceiving,
        close
      })
    })

    const { initChannels } = await import('#~/channels/index.js')
    const manager = await initChannels([{
      source: 'project',
      config: {
        channels: {
          'miniapp-gear': {
            type: 'lark',
            appId: 'cli_xxx'
          }
        }
      }
    }])

    expect(close).toHaveBeenCalledOnce()
    expect(manager.states.get('miniapp-gear')).toMatchObject({
      key: 'miniapp-gear',
      type: 'lark',
      status: 'error',
      error: 'connection rejected',
      configSource: 'project'
    })
    expect(logger.error).toHaveBeenCalledWith(
      {
        channelKey: 'miniapp-gear',
        channelType: 'lark',
        configSource: 'project',
        error: 'connection rejected'
      },
      '[channels] channel initialization failed'
    )
  })

  it('keeps globally configured channels attributed to global config', async () => {
    const startReceiving = vi.fn()

    loadChannelModule.mockReturnValue({
      definition: {
        configSchema: z.object({
          type: z.literal('lark'),
          appId: z.string()
        })
      },
      create: vi.fn().mockResolvedValue({
        startReceiving,
        close: vi.fn()
      })
    })

    const { initChannels } = await import('#~/channels/index.js')
    const manager = await initChannels([{
      source: 'global',
      config: {
        channels: {
          'miniapp-gear': {
            type: 'lark',
            appId: 'cli_global'
          }
        }
      }
    }])

    expect(manager.states.get('miniapp-gear')).toMatchObject({
      key: 'miniapp-gear',
      type: 'lark',
      status: 'connected',
      configSource: 'global'
    })
    expect(logger.info).toHaveBeenCalledWith(
      {
        channelKey: 'miniapp-gear',
        channelType: 'lark',
        configSource: 'global'
      },
      '[channels] channel connected'
    )
  })

  it('injects the server public base URL as the default channel serverBaseUrl', async () => {
    const startReceiving = vi.fn()
    const create = vi.fn().mockResolvedValue({
      startReceiving,
      close: vi.fn()
    })

    loadChannelModule.mockReturnValue({
      definition: {
        configSchema: z.object({
          type: z.literal('wechat'),
          token: z.string(),
          serverBaseUrl: z.string().optional()
        })
      },
      create
    })

    const { initChannels } = await import('#~/channels/index.js')
    await initChannels([{
      source: 'project',
      config: {
        channels: {
          erjie: {
            type: 'wechat',
            token: 'token'
          }
        }
      }
    }], {
      serverBaseUrl: 'https://bot.example.com'
    })

    expect(create).toHaveBeenCalledWith(
      {
        type: 'wechat',
        token: 'token',
        serverBaseUrl: 'https://bot.example.com'
      },
      {
        channelKey: 'erjie',
        logger,
        webhookNonceStore: {
          commit: expect.any(Function),
          release: expect.any(Function),
          reserve: expect.any(Function)
        }
      }
    )
  })

  it('routes webhooks to connected channel implementations', async () => {
    const startReceiving = vi.fn()
    connectionHandleWebhook.mockResolvedValue({
      statusCode: 200,
      body: ''
    })

    loadChannelModule.mockReturnValue({
      definition: {
        configSchema: z.object({
          type: z.literal('wechat'),
          token: z.string()
        })
      },
      create: vi.fn().mockResolvedValue({
        startReceiving,
        handleWebhook: connectionHandleWebhook,
        close: vi.fn()
      })
    })

    const { initChannels } = await import('#~/channels/index.js')
    const { handleChannelWebhook } = await import('#~/channels/webhook.js')
    await initChannels([{
      source: 'project',
      config: {
        channels: {
          wx: {
            type: 'wechat',
            token: 'token'
          }
        }
      }
    }])

    const result = await handleChannelWebhook({
      channelType: 'wechat',
      channelKey: 'wx',
      method: 'POST',
      headers: { 'x-test': '1' },
      query: { secret: 'secret' },
      body: { TypeName: 'AddMsg' },
      rawBody: '{"TypeName":"AddMsg"}'
    })

    expect(result).toEqual({
      statusCode: 200,
      body: ''
    })
    expect(connectionHandleWebhook).toHaveBeenCalledWith({
      method: 'POST',
      headers: { 'x-test': '1' },
      query: { secret: 'secret' },
      body: { TypeName: 'AddMsg' },
      rawBody: '{"TypeName":"AddMsg"}'
    })
  })

  it('routes OneWorks native webhooks through receiving handlers with channel links', async () => {
    const { channelDefinition } = await import('../../../../packages/channels/oneworks/src/index.js')
    const { createChannelConnection } = await import('../../../../packages/channels/oneworks/src/connection.js')
    const signature = await import('../../../../packages/channels/oneworks/src/webhook-signature.js')
    const channelLink = {
      channelKey: 'oneworks-main',
      entity: 'owo-demo',
      external: { type: 'room', roomId: 'wan-ke-native' },
      name: 'wan-ke-native',
      path: '/workspace/.oo/channels/wan-ke-native/channel.json',
      definition: {}
    }
    loadChannelLinks.mockResolvedValue([channelLink])
    loadChannelModule.mockReturnValue({
      create: createChannelConnection,
      definition: channelDefinition
    })

    const { initChannels } = await import('#~/channels/index.js')
    const { handleChannelWebhook } = await import('#~/channels/webhook.js')
    await initChannels([{
      source: 'project',
      config: {
        channels: {
          'oneworks-main': {
            type: 'oneworks',
            title: 'OneWorks Native',
            webhookSecret: 'secret'
          }
        }
      }
    }])

    const body = {
      messageId: 'msg-native-1',
      roomId: 'wan-ke-native',
      senderId: 'user-yijie',
      text: '@OWO hi'
    }
    const rawBody = JSON.stringify(body)
    const nonce = 'nonce-native-1'
    const timestamp = String(Date.now())
    const result = await handleChannelWebhook({
      channelType: 'oneworks',
      channelKey: 'oneworks-main',
      method: 'POST',
      headers: {
        [signature.ONEWORKS_WEBHOOK_NONCE_HEADER]: nonce,
        [signature.ONEWORKS_WEBHOOK_SIGNATURE_HEADER]: signature.buildOneWorksWebhookSignature({
          body: rawBody,
          nonce,
          secret: 'secret',
          timestamp
        }),
        [signature.ONEWORKS_WEBHOOK_TIMESTAMP_HEADER]: timestamp
      },
      query: {},
      body,
      rawBody
    })

    expect(result).toEqual({
      body: {
        channelId: 'wan-ke-native',
        messageId: 'msg-native-1',
        ok: true,
        sessionType: 'group'
      },
      statusCode: 200
    })
    expect(handleInboundEvent).toHaveBeenCalledWith(
      'oneworks-main',
      expect.objectContaining({
        channelId: 'wan-ke-native',
        channelType: 'oneworks',
        messageId: 'msg-native-1',
        replyTo: {
          receiveId: 'wan-ke-native',
          receiveIdType: 'room'
        },
        senderId: 'user-yijie',
        sessionType: 'group',
        text: '@OWO hi'
      }),
      expect.any(Object),
      expect.objectContaining({
        title: 'OneWorks Native',
        type: 'oneworks',
        webhookSecret: 'secret'
      }),
      'project',
      [channelLink]
    )
  })

  it('exposes OneWorks native debug outbound messages through the channel manager', async () => {
    const { channelDefinition } = await import('../../../../packages/channels/oneworks/src/index.js')
    const { createChannelConnection } = await import('../../../../packages/channels/oneworks/src/connection.js')
    loadChannelModule.mockReturnValue({
      create: createChannelConnection,
      definition: channelDefinition
    })

    const {
      clearChannelDebugOutboundMessages,
      initChannels,
      listChannelDebugOutboundMessages
    } = await import('#~/channels/index.js')
    const manager = await initChannels([{
      source: 'project',
      config: {
        channels: {
          'oneworks-main': {
            type: 'oneworks',
            title: 'OneWorks Native'
          }
        }
      }
    }])

    const connection = manager.states.get('oneworks-main')?.connection
    await connection?.sendMessage({
      receiveId: 'wan-ke-native',
      receiveIdType: 'room',
      text: 'hello'
    })

    expect(listChannelDebugOutboundMessages({ channelKey: 'oneworks-main' })).toEqual({
      ok: true,
      messages: [
        expect.objectContaining({
          receiveId: 'wan-ke-native',
          receiveIdType: 'room',
          text: 'hello'
        })
      ]
    })
    await expect(clearChannelDebugOutboundMessages({ channelKey: 'oneworks-main' })).resolves.toEqual({
      ok: true
    })
    expect(listChannelDebugOutboundMessages({ channelKey: 'oneworks-main' })).toEqual({
      ok: true,
      messages: []
    })
  })

  it('blocks webhooks when the channel config disables them', async () => {
    loadChannelModule.mockReturnValue({
      definition: {
        configSchema: z.object({
          type: z.literal('wechat'),
          token: z.string(),
          enableWebhook: z.boolean().optional()
        })
      },
      create: vi.fn().mockResolvedValue({
        handleWebhook: connectionHandleWebhook,
        close: vi.fn()
      })
    })

    const { initChannels } = await import('#~/channels/index.js')
    const { handleChannelWebhook } = await import('#~/channels/webhook.js')
    await initChannels([{
      source: 'project',
      config: {
        channels: {
          erjie: {
            type: 'wechat',
            token: 'token',
            enableWebhook: false
          }
        }
      }
    }])

    const result = await handleChannelWebhook({
      channelType: 'wechat',
      channelKey: 'erjie',
      method: 'POST',
      headers: {},
      query: {},
      body: { TypeName: 'AddMsg' }
    })

    expect(result).toEqual({
      statusCode: 404,
      body: { error: 'channel webhook is disabled' }
    })
    expect(connectionHandleWebhook).not.toHaveBeenCalled()
  })
})
