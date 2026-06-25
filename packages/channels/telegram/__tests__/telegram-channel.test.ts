import { describe, expect, it, vi } from 'vitest'

import type { ChannelInboundEvent } from '@oneworks/core/channel'

import type { TelegramChannelConfig } from '#~/types.js'

const config: TelegramChannelConfig = {
  type: 'telegram',
  botToken: 'telegram-token',
  botUsername: 'oneworks_bot',
  webhookSecret: 'webhook-secret'
}

describe('telegram channel connection', () => {
  it('accepts current OneWorks tool-call summary message payloads', async () => {
    vi.resetModules()
    const { channelDefinition } = await import('#~/index.js')

    const message = channelDefinition.messageSchema.parse({
      receiveId: '-1001#thread=42#reply=7',
      receiveIdType: 'chat_id',
      text: 'Tool call finished',
      toolCallSummary: {
        title: 'Tool calls',
        items: [{
          toolUseId: 'toolu-1',
          name: 'search',
          status: 'success',
          argsText: '{"q":"release"}',
          resultText: '3 results',
          detailUrl: 'oneworks://tool/toolu-1',
          exportJsonUrl: 'oneworks://tool/toolu-1/export'
        }]
      }
    })

    expect(message.toolCallSummary?.items[0]).toMatchObject({
      toolUseId: 'toolu-1',
      name: 'search',
      status: 'success'
    })
  })

  it('sends reply messages through Telegram Bot API', async () => {
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 12 } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)

    await expect(connection.sendMessage({
      receiveId: '-1001#thread=42#reply=7',
      receiveIdType: 'chat_id',
      text: 'done'
    })).resolves.toEqual({ messageId: '12' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/bottelegram-token/sendMessage',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: '-1001',
          text: 'done',
          message_thread_id: 42,
          reply_parameters: {
            message_id: 7
          }
        })
      }
    )
    vi.unstubAllGlobals()
  })

  it('renders structured tool-call summaries when sending messages', async () => {
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 13 } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)

    await connection.sendMessage({
      receiveId: '-1001#thread=42#reply=7',
      receiveIdType: 'chat_id',
      text: 'truncated',
      toolCallSummary: {
        title: '工具调用',
        items: [{
          toolUseId: 'toolu-1',
          name: 'search',
          status: 'success',
          argsText: '{"q":"release"}',
          resultText: '3 results'
        }]
      }
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/bottelegram-token/sendMessage',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: '-1001',
          text: [
            '工具调用',
            '工具: search',
            '状态: 成功',
            '参数: {"q":"release"}',
            '结果: 3 results'
          ].join('\n'),
          message_thread_id: 42,
          reply_parameters: {
            message_id: 7
          }
        })
      }
    )
    vi.unstubAllGlobals()
  })

  it('normalizes private webhook messages into direct inbound events', async () => {
    vi.resetModules()
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const handler = vi.fn()
    await connection.startReceiving?.({ handlers: { message: handler } })

    const result = await connection.handleWebhook?.({
      method: 'POST',
      headers: {
        'x-telegram-bot-api-secret-token': 'webhook-secret'
      },
      query: {},
      body: {
        update_id: 1,
        message: {
          message_id: 7,
          chat: {
            id: 123,
            type: 'private'
          },
          from: {
            id: 123,
            first_name: 'Alice',
            username: 'alice'
          },
          text: '/help@oneworks_bot'
        }
      }
    })

    expect(result).toEqual({ statusCode: 200, body: '' })
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      channelType: 'telegram',
      sessionType: 'direct',
      channelId: '123',
      senderId: '123',
      messageId: '7',
      text: '[123（Alice / @alice）]:\n/help',
      replyTo: {
        receiveId: '123#reply=7',
        receiveIdType: 'chat_id'
      }
    })
  })

  it('keeps forum topics separated by binding channel id', async () => {
    vi.resetModules()
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const handler = vi.fn()
    await connection.startReceiving?.({ handlers: { message: handler } })

    for (const threadId of [42, 43]) {
      await connection.handleWebhook?.({
        method: 'POST',
        headers: {},
        query: {
          secret: 'webhook-secret'
        },
        body: {
          update_id: threadId,
          message: {
            message_id: threadId + 100,
            message_thread_id: threadId,
            chat: {
              id: -1001,
              type: 'supergroup',
              title: 'Team'
            },
            from: {
              id: 321,
              first_name: 'Bob'
            },
            text: `topic ${threadId}`
          }
        }
      })
    }

    const inboundA = handler.mock.calls[0]?.[0] as ChannelInboundEvent
    const inboundB = handler.mock.calls[1]?.[0] as ChannelInboundEvent
    expect(inboundA.channelId).toBe('-1001#thread=42')
    expect(inboundB.channelId).toBe('-1001#thread=43')
    expect(inboundA.replyTo).toEqual({
      receiveId: '-1001#thread=42#reply=142',
      receiveIdType: 'chat_id'
    })
    expect(inboundB.replyTo).toEqual({
      receiveId: '-1001#thread=43#reply=143',
      receiveIdType: 'chat_id'
    })
    expect(inboundA.raw).toMatchObject({
      accessChannelId: '-1001',
      bindingChannelId: '-1001#thread=42'
    })
  })
})
