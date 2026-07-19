import { describe, expect, it, vi } from 'vitest'

import type { ChannelInboundEvent } from '@oneworks/core/channel'

import type { SlackChannelConfig } from '#~/types.js'

const config: SlackChannelConfig = {
  type: 'slack',
  botToken: 'xoxb-test',
  appToken: 'xapp-test',
  botUserId: 'U_BOT'
}

class MockWebSocket {
  static instances: MockWebSocket[] = []

  readonly listeners = new Map<string, Array<(event: { data: string }) => void>>()
  readonly send = vi.fn()
  readonly close = vi.fn()
  readonly url: string

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) })
    }
  }
}

describe('slack channel connection', () => {
  it('accepts current OneWorks tool-call summary message payloads', async () => {
    vi.resetModules()
    const { channelDefinition } = await import('#~/index.js')

    const message = channelDefinition.messageSchema.parse({
      receiveId: 'C123#thread=1700000000.000001',
      receiveIdType: 'channel',
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

  it('sends text messages through chat.postMessage with thread targets', async () => {
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ts: '1700000000.000002' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)

    await expect(connection.sendMessage({
      receiveId: 'C123#thread=1700000000.000001',
      receiveIdType: 'channel',
      text: 'done'
    })).resolves.toEqual({ messageId: '1700000000.000002' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer xoxb-test',
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          channel: 'C123',
          text: 'done',
          thread_ts: '1700000000.000001'
        })
      }
    )
    vi.unstubAllGlobals()
  })

  it('renders structured tool-call summaries when sending messages', async () => {
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ts: '1700000000.000003' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)

    await connection.sendMessage({
      receiveId: 'C123#thread=1700000000.000001',
      receiveIdType: 'channel',
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
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        body: JSON.stringify({
          channel: 'C123',
          text: [
            '工具调用',
            '工具: search',
            '状态: 成功',
            '参数: {"q":"release"}',
            '结果: 3 results'
          ].join('\n'),
          thread_ts: '1700000000.000001'
        })
      })
    )
    vi.unstubAllGlobals()
  })

  it('normalizes app mention socket events to topic-scoped thread events', async () => {
    vi.resetModules()
    MockWebSocket.instances = []
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, url: 'wss://slack.example/socket' })
      })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('WebSocket', MockWebSocket)

    const { createChannelConnection } = await import('#~/connection.js')
    const handler = vi.fn()
    const connection = await createChannelConnection(config)
    await connection.startReceiving?.({ handlers: { message: handler } })

    const socket = MockWebSocket.instances[0]!
    socket.emit('message', {
      envelope_id: 'env-1',
      payload: {
        event: {
          type: 'app_mention',
          channel: 'C123',
          channel_type: 'channel',
          user: 'U123',
          text: '<@U_BOT> /help',
          ts: '1700000000.000001'
        }
      }
    })
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce())

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ envelope_id: 'env-1' }))
    const inbound = handler.mock.calls[0]?.[0] as ChannelInboundEvent
    expect(inbound).toMatchObject({
      channelType: 'slack',
      sessionType: 'group',
      channelId: 'C123#thread=1700000000.000001',
      senderId: 'U123',
      messageId: '1700000000.000001',
      text: '[U123]:\n/help',
      replyTo: {
        receiveId: 'C123#thread=1700000000.000001',
        receiveIdType: 'channel'
      },
      raw: {
        accessChannelId: 'C123',
        threadTs: '1700000000.000001'
      }
    })
    vi.unstubAllGlobals()
  })

  it('keeps Slack thread replies bound to the same channel thread', async () => {
    vi.resetModules()
    MockWebSocket.instances = []
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, url: 'wss://slack.example/socket' })
      })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('WebSocket', MockWebSocket)

    const { createChannelConnection } = await import('#~/connection.js')
    const handler = vi.fn()
    const connection = await createChannelConnection(config)
    await connection.startReceiving?.({ handlers: { message: handler } })

    MockWebSocket.instances[0]!.emit('message', {
      envelope_id: 'env-2',
      payload: {
        event: {
          type: 'message',
          channel: 'C123',
          channel_type: 'channel',
          user: 'U234',
          text: 'continue',
          ts: '1700000001.000002',
          thread_ts: '1700000000.000001'
        }
      }
    })
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce())

    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      channelId: 'C123#thread=1700000000.000001',
      text: '[U234]:\ncontinue',
      replyTo: {
        receiveId: 'C123#thread=1700000000.000001'
      }
    })
    vi.unstubAllGlobals()
  })
})
