import { createHmac } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import type { ChannelInboundEvent } from '@oneworks/core/channel'

import type { SmsChannelConfig } from '#~/types.js'

const config: SmsChannelConfig = {
  type: 'sms',
  accountSid: 'AC123',
  authToken: 'auth-token',
  fromNumber: '+15550000000',
  verifyWebhookSignature: false
}

const buildSignature = (
  url: string,
  authToken: string,
  params: URLSearchParams
) => {
  const payload = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .reduce((acc, [key, value]) => `${acc}${key}${value}`, url)
  return createHmac('sha1', authToken).update(payload).digest('base64')
}

describe('sms channel connection', () => {
  it('sends SMS messages through Twilio REST API', async () => {
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SM123' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)

    await expect(connection.sendMessage({
      receiveId: '+15551112222',
      receiveIdType: 'phone',
      text: 'hello'
    })).resolves.toEqual({ messageId: 'SM123' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json')
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Basic QUMxMjM6YXV0aC10b2tlbg==',
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
    expect((init.body as URLSearchParams).toString()).toBe('From=%2B15550000000&To=%2B15551112222&Body=hello')
    vi.unstubAllGlobals()
  })

  it('normalizes Twilio webhook form payloads into direct inbound events', async () => {
    vi.resetModules()
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const handler = vi.fn()
    await connection.startReceiving?.({ channelKey: 'sms', handlers: { message: handler } })

    const result = await connection.handleWebhook?.({
      method: 'POST',
      headers: {},
      query: {},
      body: {
        Body: 'hello',
        From: '+15551112222',
        MessageSid: 'SM123',
        NumMedia: '1',
        MediaUrl0: 'https://example.com/image.jpg',
        MediaContentType0: 'image/jpeg'
      }
    })

    expect(result).toEqual({
      statusCode: 200,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8'
      },
      body: '<Response></Response>'
    })
    expect(handler).toHaveBeenCalledOnce()
    const inbound = handler.mock.calls[0]?.[0] as ChannelInboundEvent
    expect(inbound).toMatchObject({
      channelType: 'sms',
      sessionType: 'direct',
      channelId: '+15551112222',
      senderId: '+15551112222',
      messageId: 'SM123',
      text: '[+15551112222]:\nhello\n[SMS media] image/jpeg https://example.com/image.jpg',
      replyTo: {
        receiveId: '+15551112222',
        receiveIdType: 'phone'
      }
    })
  })

  it('validates Twilio webhook signatures when enabled', async () => {
    vi.resetModules()
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection({
      ...config,
      verifyWebhookSignature: true,
      webhookUrl: 'https://bot.example.com/channels/sms/main/webhook'
    })
    const handler = vi.fn()
    await connection.startReceiving?.({ channelKey: 'main', handlers: { message: handler } })

    const params = new URLSearchParams({
      Body: 'signed',
      From: '+15551112222',
      MessageSid: 'SM124'
    })
    const result = await connection.handleWebhook?.({
      method: 'POST',
      headers: {
        'x-twilio-signature': buildSignature(
          'https://bot.example.com/channels/sms/main/webhook',
          'auth-token',
          params
        )
      },
      query: {},
      rawBody: params.toString(),
      body: {}
    })

    expect(result?.statusCode).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })
})
