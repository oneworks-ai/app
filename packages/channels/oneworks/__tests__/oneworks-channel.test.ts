import { describe, expect, it, vi } from 'vitest'

import { createChannelConnection } from '../src/connection'
import type { OneWorksDebugConnection } from '../src/connection'
import { channelDefinition } from '../src/index'
import {
  ONEWORKS_WEBHOOK_NONCE_HEADER,
  ONEWORKS_WEBHOOK_SIGNATURE_HEADER,
  ONEWORKS_WEBHOOK_TIMESTAMP_HEADER,
  buildOneWorksWebhookSignature
} from '../src/webhook-signature'

const signedWebhookRequest = (body: Record<string, unknown>, input: {
  nonce?: string
  secret?: string
  timestamp?: string
} = {}) => {
  const rawBody = JSON.stringify(body)
  const nonce = input.nonce ?? 'nonce-12345678'
  const secret = input.secret ?? 'secret'
  const timestamp = input.timestamp ?? String(Date.now())
  return {
    body,
    headers: {
      [ONEWORKS_WEBHOOK_NONCE_HEADER]: nonce,
      [ONEWORKS_WEBHOOK_SIGNATURE_HEADER]: buildOneWorksWebhookSignature({
        body: rawBody,
        nonce,
        secret,
        timestamp
      }),
      [ONEWORKS_WEBHOOK_TIMESTAMP_HEADER]: timestamp
    },
    method: 'POST',
    query: {},
    rawBody
  }
}

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

    const result = await connection.handleWebhook?.(signedWebhookRequest({
      contentItems: [{ text: 'hi', type: 'text' }],
      messageId: 'msg-1',
      roomId: 'room-demo',
      senderId: 'user-a',
      text: '@OWO hi'
    }))

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
        query: { secret: 'secret' },
        rawBody: JSON.stringify({ roomId: 'room-demo', text: 'hi' })
      })
    ).resolves.toEqual({ body: { error: 'unauthorized' }, statusCode: 401 })
  })

  it('allows unsigned synthetic simulation only for loopback sockets', async () => {
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
        headers: { host: '127.0.0.1:3000' },
        method: 'POST',
        query: {},
        remoteAddress: '203.0.113.10'
      })
    ).resolves.toEqual({ body: { error: 'unauthorized' }, statusCode: 401 })
    await expect(
      connection.handleWebhook?.({
        body,
        headers: { host: 'oneworks.example.com' },
        method: 'POST',
        query: {},
        remoteAddress: '::1'
      })
    ).resolves.toEqual({ body: { error: 'unauthorized' }, statusCode: 401 })
    await expect(
      connection.handleWebhook?.({
        body,
        headers: { host: 'localhost:3000' },
        method: 'POST',
        query: {},
        remoteAddress: '::1'
      })
    ).resolves.toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(message).toHaveBeenCalledTimes(1)
    expect(message).toHaveBeenCalledWith(expect.objectContaining({
      senderId: 'oneworks-simulation:user-a'
    }))
  })

  it('rejects stale signatures, tampered bodies, and replayed nonces', async () => {
    const connection = await createChannelConnection({ type: 'oneworks', webhookSecret: 'secret' })
    const message = vi.fn()
    await connection.startReceiving?.({ channelKey: 'oneworks-main', handlers: { message } })

    const body = { roomId: 'room-demo', senderId: 'user-a', text: 'hi' }
    await expect(
      connection.handleWebhook?.(signedWebhookRequest(body, {
        timestamp: String(Date.now() - 10 * 60 * 1000)
      }))
    ).resolves.toEqual({ body: { error: 'unauthorized' }, statusCode: 401 })

    const tampered = signedWebhookRequest(body, { nonce: 'nonce-tampered' })
    await expect(
      connection.handleWebhook?.({
        ...tampered,
        body: { ...body, senderId: 'admin' },
        rawBody: JSON.stringify({ ...body, senderId: 'admin' })
      })
    ).resolves.toEqual({ body: { error: 'unauthorized' }, statusCode: 401 })

    const request = signedWebhookRequest(body, { nonce: 'nonce-replayed' })
    await expect(connection.handleWebhook?.(request)).resolves.toEqual(expect.objectContaining({ statusCode: 200 }))
    await expect(connection.handleWebhook?.(request)).resolves.toEqual({
      body: { error: 'replayed webhook' },
      statusCode: 409
    })
  })

  it('uses the host replay store when the channel runtime provides one', async () => {
    const commit = vi.fn()
    const release = vi.fn()
    const reserve = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
    const connection = await createChannelConnection(
      { type: 'oneworks', webhookSecret: 'secret' },
      { channelKey: 'oneworks-main', webhookNonceStore: { commit, release, reserve } }
    )
    await connection.startReceiving?.({ channelKey: 'oneworks-main', handlers: { message: vi.fn() } })
    const request = signedWebhookRequest({ senderId: 'user-a', text: 'hi' }, { nonce: 'durable-nonce' })

    await expect(connection.handleWebhook?.(request)).resolves.toEqual(expect.objectContaining({ statusCode: 200 }))
    await expect(connection.handleWebhook?.(request)).resolves.toEqual(expect.objectContaining({ statusCode: 409 }))
    expect(reserve).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        channelKey: 'oneworks-main',
        channelType: 'oneworks',
        nonce: 'durable-nonce'
      })
    )
    expect(commit).toHaveBeenCalledOnce()
    expect(release).not.toHaveBeenCalled()
  })

  it('does not reserve a nonce while the receiver is unavailable', async () => {
    const connection = await createChannelConnection({ type: 'oneworks', webhookSecret: 'secret' })
    const request = signedWebhookRequest({ senderId: 'user-a', text: 'hi' }, { nonce: 'retry-after-503' })

    await expect(connection.handleWebhook?.(request)).resolves.toEqual(expect.objectContaining({ statusCode: 503 }))
    await connection.startReceiving?.({ channelKey: 'oneworks-main', handlers: { message: vi.fn() } })
    await expect(connection.handleWebhook?.(request)).resolves.toEqual(expect.objectContaining({ statusCode: 200 }))
  })

  it('releases a nonce reservation when the receiver throws', async () => {
    const connection = await createChannelConnection({ type: 'oneworks', webhookSecret: 'secret' })
    const message = vi.fn().mockRejectedValueOnce(new Error('temporary queue failure')).mockResolvedValueOnce(undefined)
    await connection.startReceiving?.({ channelKey: 'oneworks-main', handlers: { message } })
    const request = signedWebhookRequest({ senderId: 'user-a', text: 'hi' }, { nonce: 'retry-after-error' })

    await expect(connection.handleWebhook?.(request)).rejects.toThrow('temporary queue failure')
    await expect(connection.handleWebhook?.(request)).resolves.toEqual(expect.objectContaining({ statusCode: 200 }))
    expect(message).toHaveBeenCalledTimes(2)
  })

  it('does not reclaim a nonce while a long-running receiver is still handling it', async () => {
    vi.useFakeTimers()
    try {
      let finish!: () => void
      const handling = new Promise<void>((resolve) => {
        finish = resolve
      })
      const connection = await createChannelConnection({ type: 'oneworks', webhookSecret: 'secret' })
      await connection.startReceiving?.({
        channelKey: 'oneworks-main',
        handlers: { message: vi.fn().mockReturnValue(handling) }
      })
      const request = signedWebhookRequest(
        { messageId: 'long-message', senderId: 'user-a', text: 'hi' },
        { nonce: 'long-running-nonce' }
      )
      const first = connection.handleWebhook?.(request)

      await vi.advanceTimersByTimeAsync(31_000)
      await expect(connection.handleWebhook?.(request)).resolves.toEqual({
        body: { error: 'replayed webhook' },
        statusCode: 409
      })

      finish()
      await expect(first).resolves.toEqual(expect.objectContaining({ statusCode: 200 }))
    } finally {
      vi.useRealTimers()
    }
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
