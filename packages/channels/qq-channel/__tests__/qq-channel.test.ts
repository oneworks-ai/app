import { Buffer } from 'node:buffer'
import { createPrivateKey, sign } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelInboundEvent, ChannelWebhookRequest } from '@oneworks/core/channel'

import type { QQChannelConfig } from '#~/types.js'

const config: QQChannelConfig = {
  type: 'qq-channel',
  appId: '11111111',
  appSecret: 'DG5g3B4j9X2KOErG'
}

const ED25519_PKCS8_SEED_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

const createPrivateKeyFromSecret = (secret: string) => {
  let seed = secret
  while (Buffer.byteLength(seed) < 32) {
    seed += seed
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, Buffer.from(seed).subarray(0, 32)]),
    format: 'der',
    type: 'pkcs8'
  })
}

const signRequestBody = (secret: string, timestamp: string, body: string) => (
  sign(null, Buffer.from(`${timestamp}${body}`), createPrivateKeyFromSecret(secret)).toString('hex')
)

const withRawBody = (request: ChannelWebhookRequest & { rawBody: string }): ChannelWebhookRequest => request

describe('qq-channel channel connection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('responds to official webhook validation challenges', async () => {
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)

    const result = await connection.handleWebhook?.({
      method: 'POST',
      headers: {
        'x-bot-appid': '11111111'
      },
      query: {},
      body: {
        d: {
          plain_token: 'Arq0D5A61EgUu4OxUvOp',
          event_ts: '1725442341'
        },
        op: 13
      }
    })

    expect(result).toMatchObject({
      statusCode: 200,
      body: {
        plain_token: 'Arq0D5A61EgUu4OxUvOp',
        signature:
          '87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706'
      }
    })
  })

  it('rejects dispatch webhooks with invalid signatures', async () => {
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const handler = vi.fn()
    await connection.startReceiving?.({
      channelKey: 'qq',
      handlers: {
        message: handler
      }
    })

    const result = await connection.handleWebhook?.(withRawBody({
      method: 'POST',
      headers: {
        'x-bot-appid': '11111111',
        'x-signature-ed25519': '00',
        'x-signature-timestamp': '1725442341'
      },
      query: {},
      body: {
        op: 0,
        t: 'AT_MESSAGE_CREATE',
        d: {}
      },
      rawBody: '{"op":0,"t":"AT_MESSAGE_CREATE","d":{}}'
    }))

    expect(result).toMatchObject({
      statusCode: 403,
      body: { error: 'invalid webhook signature' }
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('normalizes QQ Channel at-message webhooks into inbound events', async () => {
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    let resolveInbound: (event: ChannelInboundEvent) => void = () => undefined
    const inboundPromise = new Promise<ChannelInboundEvent>((resolve) => {
      resolveInbound = resolve
    })
    await connection.startReceiving?.({
      channelKey: 'qq',
      handlers: {
        message: resolveInbound
      }
    })

    const rawBody = JSON.stringify({
      id: 'event-1',
      op: 0,
      s: 101,
      t: 'AT_MESSAGE_CREATE',
      d: {
        author: {
          bot: false,
          id: 'user_1234',
          username: 'abc'
        },
        channel_id: '100010',
        content: '<@!11111111> ping',
        guild_id: '18700000000001',
        id: '0812345677890abcdef',
        timestamp: '2021-05-20T15:14:58+08:00',
        seq: 101
      }
    })

    const result = await connection.handleWebhook?.(withRawBody({
      method: 'POST',
      headers: {
        'x-bot-appid': '11111111',
        'x-signature-ed25519': signRequestBody(config.appSecret, '1725442341', rawBody),
        'x-signature-timestamp': '1725442341'
      },
      query: {},
      body: JSON.parse(rawBody) as unknown,
      rawBody
    }))

    expect(result).toMatchObject({
      statusCode: 200,
      body: { op: 12 }
    })
    const inbound = await inboundPromise
    expect(inbound).toMatchObject({
      channelType: 'qq-channel',
      sessionType: 'group',
      channelId: '100010',
      senderId: 'user_1234',
      messageId: '0812345677890abcdef',
      text: '[user_1234 (abc)]:\nping',
      replyTo: {
        receiveId: '100010',
        receiveIdType: 'channel_id'
      },
      raw: {
        eventId: 'event-1',
        msgId: '0812345677890abcdef'
      }
    })
  })

  it('normalizes QQ Channel DM webhooks to guild_id direct sessions', async () => {
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection({
      ...config,
      verifyWebhookSignature: false
    })
    let resolveInbound: (event: ChannelInboundEvent) => void = () => undefined
    const inboundPromise = new Promise<ChannelInboundEvent>((resolve) => {
      resolveInbound = resolve
    })
    await connection.startReceiving?.({
      handlers: {
        message: resolveInbound
      }
    })

    await connection.handleWebhook?.({
      method: 'POST',
      headers: {
        'x-bot-appid': '11111111'
      },
      query: {},
      body: {
        id: 'event-dm',
        op: 0,
        t: 'DIRECT_MESSAGE_CREATE',
        d: {
          author: {
            id: 'user_1234',
            username: 'abc'
          },
          channel_id: 'dm_channel',
          content: 'hello',
          guild_id: '18700000000001',
          id: 'dm_message_id'
        }
      }
    })

    const inbound = await inboundPromise
    expect(inbound).toMatchObject({
      sessionType: 'direct',
      channelId: '18700000000001',
      replyTo: {
        receiveId: '18700000000001',
        receiveIdType: 'guild_id'
      }
    })
  })

  it('sends text messages through QQ OpenAPI with cached AccessToken', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            access_token: 'access-token',
            expires_in: 7200
          })
      })
      .mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'qq-message-id',
            timestamp: '2026-06-18T12:00:00+08:00'
          })
      })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection({
      ...config,
      apiBaseUrl: 'https://sandbox.api.sgroup.qq.com'
    })

    await expect(connection.sendMessage({
      receiveId: '100010',
      receiveIdType: 'channel_id',
      text: 'hello',
      msgId: 'incoming-message-id',
      msgSeq: 2
    })).resolves.toEqual({ messageId: 'qq-message-id' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        appId: '11111111',
        clientSecret: 'DG5g3B4j9X2KOErG'
      })
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://sandbox.api.sgroup.qq.com/channels/100010/messages', {
      method: 'POST',
      headers: {
        authorization: 'QQBot access-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        content: 'hello',
        msg_type: 0,
        msg_id: 'incoming-message-id',
        msg_seq: 2
      })
    })
  })

  it('sends channel DM text messages to the dms endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            access_token: 'dm-access-token',
            expires_in: 7200
          })
      })
      .mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'dm-outbound-id'
          })
      })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection({
      ...config,
      appId: '22222222'
    })

    await connection.sendMessage({
      receiveId: '18700000000001',
      receiveIdType: 'guild_id',
      text: 'hello dm'
    })

    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.sgroup.qq.com/dms/18700000000001/messages', {
      method: 'POST',
      headers: {
        authorization: 'QQBot dm-access-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        content: 'hello dm',
        msg_type: 0
      })
    })
  })
})
