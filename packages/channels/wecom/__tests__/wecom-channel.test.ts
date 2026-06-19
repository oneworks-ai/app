import { Buffer } from 'node:buffer'
import { createCipheriv, randomBytes } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelInboundEvent } from '@oneworks/core/channel'

import type { WeComChannelConfig } from '#~/types.js'
import { clearWeComAccessTokenCacheForTests } from '#~/utils/api.js'
import { createWeComMessageSignature } from '#~/utils/callback-crypto.js'

const encodingAesKey = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
const corpId = 'wwcorp'

const config: WeComChannelConfig = {
  type: 'wecom',
  corpId,
  corpSecret: 'corp-secret',
  agentId: 1000002,
  token: 'callback-token',
  encodingAesKey
}

const getAesKey = () => Buffer.from(`${encodingAesKey}=`, 'base64')

const encryptWeComPlainText = (plainText: string, receiveId = corpId) => {
  const message = Buffer.from(plainText)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(message.length)
  const payload = Buffer.concat([
    randomBytes(16),
    length,
    message,
    Buffer.from(receiveId)
  ])
  const aesKey = getAesKey()
  const cipher = createCipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16))
  return Buffer.concat([cipher.update(payload), cipher.final()]).toString('base64')
}

const sign = (encrypted: string, timestamp = '1700000000', nonce = 'nonce') => (
  createWeComMessageSignature(config.token, timestamp, nonce, encrypted)
)

const buildEncryptedXml = (messageXml: string) => {
  const encrypted = encryptWeComPlainText(messageXml)
  return {
    encrypted,
    xml: `<xml><Encrypt><![CDATA[${encrypted}]]></Encrypt></xml>`
  }
}

describe('wecom channel connection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    clearWeComAccessTokenCacheForTests()
  })

  it('verifies callback URLs and returns the decrypted echo string', async () => {
    const echo = 'plain echo'
    const encrypted = encryptWeComPlainText(echo)
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)

    const result = await connection.handleWebhook?.({
      method: 'GET',
      headers: {},
      query: {
        msg_signature: sign(encrypted),
        timestamp: '1700000000',
        nonce: 'nonce',
        echostr: encrypted
      },
      body: undefined
    })

    expect(result).toMatchObject({
      statusCode: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8'
      },
      body: echo
    })
  })

  it('rejects callback requests with invalid signatures', async () => {
    const { encrypted, xml } = buildEncryptedXml('<xml><MsgType><![CDATA[text]]></MsgType></xml>')
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)

    const result = await connection.handleWebhook?.({
      method: 'POST',
      headers: {},
      query: {
        msg_signature: sign(`${encrypted}-tampered`),
        timestamp: '1700000000',
        nonce: 'nonce'
      },
      body: xml
    })

    expect(result).toMatchObject({
      statusCode: 403,
      body: { error: 'invalid wecom signature' }
    })
  })

  it('normalizes text callbacks into channel inbound events', async () => {
    const { xml, encrypted } = buildEncryptedXml(`
      <xml>
        <ToUserName><![CDATA[wwcorp]]></ToUserName>
        <FromUserName><![CDATA[zhangsan]]></FromUserName>
        <CreateTime>1700000000</CreateTime>
        <MsgType><![CDATA[text]]></MsgType>
        <Content><![CDATA[/help]]></Content>
        <MsgId>123456</MsgId>
        <AgentID>1000002</AgentID>
      </xml>
    `)
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    let resolveInbound: (event: ChannelInboundEvent) => void = () => undefined
    const inboundPromise = new Promise<ChannelInboundEvent>((resolve) => {
      resolveInbound = resolve
    })
    await connection.startReceiving?.({
      channelKey: 'work',
      handlers: {
        message: resolveInbound
      }
    })

    const result = await connection.handleWebhook?.({
      method: 'POST',
      headers: {},
      query: {
        msg_signature: sign(encrypted),
        timestamp: '1700000000',
        nonce: 'nonce'
      },
      body: {},
      rawBody: xml
    })

    expect(result).toMatchObject({
      statusCode: 200,
      body: ''
    })
    const inbound = await inboundPromise
    expect(inbound).toMatchObject({
      channelType: 'wecom',
      sessionType: 'direct',
      channelId: 'zhangsan',
      senderId: 'zhangsan',
      messageId: '123456',
      text: '[zhangsan]:\n/help',
      replyTo: {
        receiveId: 'zhangsan',
        receiveIdType: 'user'
      }
    })
    expect(inbound.raw).toMatchObject({
      contentItems: [{
        type: 'text',
        text: '[zhangsan]:\n/help'
      }]
    })
  })

  it('sends application text messages and caches access tokens', async () => {
    const fetchMock = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const href = String(url)
      if (href.startsWith('https://qyapi.weixin.qq.com/cgi-bin/gettoken')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              errcode: 0,
              errmsg: 'ok',
              access_token: 'token-1',
              expires_in: 7200
            })
        }
      }
      expect(href).toBe('https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=token-1')
      expect(init).toMatchObject({
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        }
      })
      expect(JSON.parse(String(init?.body))).toEqual({
        touser: 'zhangsan',
        msgtype: 'text',
        text: {
          content: 'hello'
        },
        agentid: 1000002,
        safe: 0
      })
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            errcode: 0,
            errmsg: 'ok',
            msgid: 'msg-1'
          })
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const first = await connection.sendMessage({
      receiveId: 'zhangsan',
      receiveIdType: 'user',
      text: 'hello'
    })
    const second = await connection.sendMessage({
      receiveId: 'zhangsan',
      receiveIdType: 'user',
      text: 'hello'
    })

    expect(first).toEqual({ messageId: 'msg-1' })
    expect(second).toEqual({ messageId: 'msg-1' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/cgi-bin/gettoken'))).toHaveLength(1)
  })

  it('sends markdown messages to app-created chats', async () => {
    const fetchMock = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const href = String(url)
      if (href.startsWith('https://qyapi.weixin.qq.com/cgi-bin/gettoken')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              errcode: 0,
              errmsg: 'ok',
              access_token: 'token-1',
              expires_in: 7200
            })
        }
      }
      expect(href).toBe('https://qyapi.weixin.qq.com/cgi-bin/appchat/send?access_token=token-1')
      expect(JSON.parse(String(init?.body))).toEqual({
        chatid: 'CHATID',
        msgtype: 'markdown',
        markdown: {
          content: '## Status\nDone'
        },
        safe: 0
      })
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ errcode: 0, errmsg: 'ok' })
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const result = await connection.sendMessage({
      receiveId: 'CHATID',
      receiveIdType: 'appchat',
      msgtype: 'markdown',
      text: '## Status\nDone'
    })

    expect(result).toBeUndefined()
  })
})
