import { describe, expect, it, vi } from 'vitest'

import { createChannelConnection } from '../src/connection'
import type { OneWorksDebugConnection } from '../src/connection'
import { channelDefinition } from '../src/index'

describe('oneworks native channel', () => {
  it('defines the first-party oneworks channel type', () => {
    const parsed = channelDefinition.configSchema.parse({
      type: 'oneworks',
      title: 'OneWorks Native',
      webhookSecret: 'secret'
    })

    expect(channelDefinition.type).toBe('oneworks')
    expect(parsed).toMatchObject({
      title: 'OneWorks Native',
      type: 'oneworks',
      webhookSecret: 'secret'
    })
  })

  it('normalizes simulation webhook payloads into channel inbound events', async () => {
    const message = vi.fn()
    const connection = await createChannelConnection({
      type: 'oneworks',
      webhookSecret: 'secret'
    })
    await connection.startReceiving?.({
      channelKey: 'oneworks-main',
      handlers: { message }
    })

    const result = await connection.handleWebhook?.({
      body: {
        contentItems: [{ text: 'hi', type: 'text' }],
        messageId: 'msg-1',
        roomId: 'room-demo',
        senderId: 'user-a',
        text: '@OWO hi'
      },
      headers: {
        'x-oneworks-channel-secret': 'secret'
      },
      method: 'POST',
      query: {}
    })

    expect(result).toEqual({
      body: {
        channelId: 'room-demo',
        messageId: 'msg-1',
        ok: true,
        sessionType: 'group'
      },
      statusCode: 200
    })
    expect(message).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'room-demo',
      channelType: 'oneworks',
      messageId: 'msg-1',
      replyTo: {
        receiveId: 'room-demo',
        receiveIdType: 'room'
      },
      senderId: 'user-a',
      sessionType: 'group',
      text: '@OWO hi'
    }))
    expect(message.mock.calls[0][0].raw).toMatchObject({
      contentItems: [{ text: 'hi', type: 'text' }],
      source: 'oneworks-native'
    })
  })

  it('rejects invalid or unauthorized webhook payloads', async () => {
    const connection = await createChannelConnection({
      type: 'oneworks',
      webhookSecret: 'secret'
    })
    await connection.startReceiving?.({
      channelKey: 'oneworks-main',
      handlers: { message: vi.fn() }
    })

    await expect(
      connection.handleWebhook?.({
        body: { roomId: 'room-demo', senderId: 'user-a', text: 'hi' },
        headers: {},
        method: 'POST',
        query: {}
      })
    ).resolves.toEqual({
      body: { error: 'unauthorized' },
      statusCode: 401
    })

    await expect(
      connection.handleWebhook?.({
        body: { roomId: 'room-demo', text: 'hi' },
        headers: {},
        method: 'POST',
        query: { secret: 'secret' }
      })
    ).resolves.toEqual({
      body: { error: 'invalid oneworks native channel payload' },
      statusCode: 400
    })
  })

  it('allows explicit insecure simulation only for loopback requests', async () => {
    const connection = await createChannelConnection({
      allowInsecureWebhooks: true,
      type: 'oneworks'
    })
    const message = vi.fn()
    await connection.startReceiving?.({ channelKey: 'oneworks-main', handlers: { message } })

    const body = { roomId: 'room-demo', senderId: 'user-a', text: 'hi' }
    await expect(
      connection.handleWebhook?.({
        body,
        headers: { host: 'oneworks.example.com' },
        method: 'POST',
        query: {}
      })
    ).resolves.toEqual({ body: { error: 'unauthorized' }, statusCode: 401 })
    await expect(
      connection.handleWebhook?.({
        body,
        headers: { host: '127.0.0.1:3000' },
        method: 'POST',
        query: {}
      })
    ).resolves.toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(message).toHaveBeenCalledTimes(1)
  })

  it('returns stable ids for outbound messages and updates', async () => {
    const connection = await createChannelConnection({
      type: 'oneworks'
    })

    const sent = await connection.sendMessage({
      receiveId: 'room-demo',
      receiveIdType: 'room',
      text: 'done'
    })
    expect(sent?.messageId).toMatch(/^oneworks-out-/u)

    await expect(
      connection.updateMessage?.(sent!.messageId!, {
        receiveId: 'room-demo',
        receiveIdType: 'room',
        text: 'updated'
      })
    ).resolves.toEqual({
      messageId: sent?.messageId
    })
  })

  it('exposes and clears debug outbound message snapshots', async () => {
    const connection = await createChannelConnection({
      type: 'oneworks'
    })

    const sent = await connection.sendMessage({
      receiveId: 'room-demo',
      receiveIdType: 'room',
      text: 'done'
    })
    await connection.updateMessage?.(sent!.messageId!, {
      receiveId: 'room-demo',
      receiveIdType: 'room',
      text: 'updated'
    })

    const debugConnection = connection as OneWorksDebugConnection
    const messages = debugConnection.getDebugOutboundMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual(expect.objectContaining({
      messageId: sent?.messageId,
      receiveId: 'room-demo',
      receiveIdType: 'room',
      text: 'updated'
    }))
    expect(messages[0]?.createdAt).toEqual(expect.any(Number))
    expect(messages[0]?.updatedAt).toEqual(expect.any(Number))

    messages.splice(0)
    expect(debugConnection.getDebugOutboundMessages()).toHaveLength(1)

    debugConnection.clearDebugOutboundMessages()
    expect(debugConnection.getDebugOutboundMessages()).toEqual([])
  })
})
