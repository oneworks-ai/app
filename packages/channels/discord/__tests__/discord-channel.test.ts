import { describe, expect, it, vi } from 'vitest'

import type { ChannelInboundEvent } from '@oneworks/core/channel'

import type { DiscordChannelConfig } from '#~/types.js'

const config: DiscordChannelConfig = {
  type: 'discord',
  botToken: 'discord-token',
  botUserId: '999'
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

describe('discord channel connection', () => {
  it('accepts current OneWorks tool-call summary message payloads', async () => {
    vi.resetModules()
    const { channelDefinition } = await import('#~/index.js')

    const message = channelDefinition.messageSchema.parse({
      receiveId: 'chan-1',
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

  it('sends text messages through Discord REST API', async () => {
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-1' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)

    await expect(connection.sendMessage({
      receiveId: 'chan-1',
      receiveIdType: 'channel',
      text: 'hello'
    })).resolves.toEqual({ messageId: 'msg-1' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/v10/channels/chan-1/messages',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bot discord-token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: 'hello' })
      }
    )
    vi.unstubAllGlobals()
  })

  it('renders structured tool-call summaries when sending messages', async () => {
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-summary' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)

    await connection.sendMessage({
      receiveId: 'chan-1',
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
      'https://discord.com/api/v10/channels/chan-1/messages',
      expect.objectContaining({
        body: JSON.stringify({
          content: [
            '工具调用',
            '工具: search',
            '状态: 成功',
            '参数: {"q":"release"}',
            '结果: 3 results'
          ].join('\n')
        })
      })
    )
    vi.unstubAllGlobals()
  })

  it('normalizes guild mentions from Gateway MESSAGE_CREATE events', async () => {
    vi.resetModules()
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)

    const { createChannelConnection } = await import('#~/connection.js')
    const handler = vi.fn()
    const connection = await createChannelConnection(config)
    await connection.startReceiving?.({ handlers: { message: handler } })

    MockWebSocket.instances[0]!.emit('message', {
      t: 'MESSAGE_CREATE',
      d: {
        id: 'msg-1',
        channel_id: 'chan-1',
        guild_id: 'guild-1',
        content: '<@999> /help',
        author: {
          id: 'user-1',
          username: 'alice',
          discriminator: '0'
        },
        mentions: [{ id: '999' }]
      }
    })
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce())

    const inbound = handler.mock.calls[0]?.[0] as ChannelInboundEvent
    expect(inbound).toMatchObject({
      channelType: 'discord',
      sessionType: 'group',
      channelId: 'chan-1',
      senderId: 'user-1',
      messageId: 'msg-1',
      text: '[user-1（alice）]:\n/help',
      replyTo: {
        receiveId: 'chan-1',
        receiveIdType: 'channel'
      }
    })
    vi.unstubAllGlobals()
  })

  it('preserves sticker and embed-only messages as structured text', async () => {
    vi.resetModules()
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)

    const { createChannelConnection } = await import('#~/connection.js')
    const handler = vi.fn()
    const connection = await createChannelConnection({
      ...config,
      respondToAllGuildMessages: true
    })
    await connection.startReceiving?.({ handlers: { message: handler } })

    MockWebSocket.instances[0]!.emit('message', {
      t: 'MESSAGE_CREATE',
      d: {
        id: 'msg-2',
        channel_id: 'chan-1',
        guild_id: 'guild-1',
        content: '',
        author: {
          id: 'user-2',
          username: 'bob',
          discriminator: '1234'
        },
        stickers: [{ id: 'sticker-1', name: 'Ship it' }],
        embeds: [{ title: 'Deploy', description: 'finished', url: 'https://example.com/deploy' }]
      }
    })
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce())

    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      text: [
        '[user-2（bob#1234）]:',
        '[Discord sticker] Ship it',
        '[Discord embed] title=Deploy; description=finished; url=https://example.com/deploy'
      ].join('\n'),
      raw: {
        stickers: [{ id: 'sticker-1', name: 'Ship it' }],
        embeds: [{ title: 'Deploy', description: 'finished', url: 'https://example.com/deploy' }]
      }
    })
    vi.unstubAllGlobals()
  })
})
