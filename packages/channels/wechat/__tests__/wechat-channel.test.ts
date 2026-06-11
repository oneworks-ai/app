/* eslint-disable max-lines -- WeChat channel behavior is covered end-to-end through one connection test suite. */
import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChannelInboundEvent } from '@oneworks/core/channel'

import type { WechatChannelConfig } from '#~/types.js'

const config: WechatChannelConfig = {
  type: 'wechat',
  token: 'wechat-token',
  appId: 'wx_app',
  webhookSecret: 'webhook-secret'
}

describe('wechat channel connection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('ignores replayed AddMsg callbacks older than the handler startup grace window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-31T14:55:37.000Z'))
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const handler = vi.fn()
    await connection.startReceiving?.({
      channelKey: 'default',
      handlers: {
        message: handler
      }
    })

    const result = await connection.handleWebhook?.({
      method: 'POST',
      headers: {},
      query: { secret: 'webhook-secret' },
      body: {
        TypeName: 'AddMsg',
        Appid: 'wx_app',
        Wxid: 'wxid_bot',
        Data: {
          NewMsgId: 123,
          MsgType: 1,
          FromUserName: { string: 'wxid_sender' },
          ToUserName: { string: 'wxid_bot' },
          Content: { string: 'old ping' },
          CreateTime: Math.floor((Date.now() - 2 * 60 * 1000) / 1000)
        }
      }
    })

    expect(result).toMatchObject({
      statusCode: 200,
      body: ''
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('ignores WeChat Team direct text callbacks from the system account', async () => {
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const handler = vi.fn()
    await connection.startReceiving?.({
      channelKey: 'default',
      handlers: {
        message: handler
      }
    })

    const result = await connection.handleWebhook?.({
      method: 'POST',
      headers: {},
      query: { secret: 'webhook-secret' },
      body: {
        TypeName: 'AddMsg',
        Appid: 'wx_app',
        Wxid: 'wxid_bot',
        Data: {
          NewMsgId: 124,
          MsgType: 1,
          FromUserName: { string: 'weixin' },
          ToUserName: { string: 'wxid_bot' },
          Content: {
            string: '如果遇到问题，可<a href="weixin://dl/feedback?from=一级" >轻触此处</a>反馈给我们。'
          },
          PushContent: '微信团队 : 如果遇到问题，可轻触此处反馈给我们。'
        }
      }
    })

    expect(result).toMatchObject({
      statusCode: 200,
      body: ''
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('ignores WechatApi system and sync AddMsg callbacks', async () => {
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const handler = vi.fn()
    await connection.startReceiving?.({
      channelKey: 'default',
      handlers: {
        message: handler
      }
    })

    for (const msgType of [51, 10002]) {
      const result = await connection.handleWebhook?.({
        method: 'POST',
        headers: {},
        query: { secret: 'webhook-secret' },
        body: {
          TypeName: 'AddMsg',
          Appid: 'wx_app',
          Wxid: 'wxid_bot',
          Data: {
            NewMsgId: `system-${msgType}`,
            MsgType: msgType,
            FromUserName: { string: 'wxid_sender' },
            ToUserName: { string: 'wxid_bot' },
            Content: { string: '<msg><op id="2" /></msg>' }
          }
        }
      })
      expect(result).toMatchObject({
        statusCode: 200,
        body: ''
      })
    }
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects webhooks without the configured secret', async () => {
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const handler = vi.fn()
    await connection.startReceiving?.({
      channelKey: 'default',
      handlers: {
        message: handler
      }
    })

    const result = await connection.handleWebhook?.({
      method: 'POST',
      headers: {},
      query: { secret: 'wrong' },
      body: {
        TypeName: 'AddMsg'
      }
    })

    expect(result).toMatchObject({
      statusCode: 403,
      body: { error: 'invalid webhook secret' }
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('normalizes direct text callbacks into channel inbound events', async () => {
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    let resolveInbound: (event: ChannelInboundEvent) => void = () => undefined
    const inboundPromise = new Promise<ChannelInboundEvent>((resolve) => {
      resolveInbound = resolve
    })
    await connection.startReceiving?.({
      channelKey: 'default',
      handlers: {
        message: resolveInbound
      }
    })

    const result = await connection.handleWebhook?.({
      method: 'POST',
      headers: {},
      query: { secret: 'webhook-secret' },
      body: {
        TypeName: 'AddMsg',
        Appid: 'wx_app',
        Wxid: 'wxid_bot',
        Data: {
          NewMsgId: 123,
          MsgType: 1,
          FromUserName: { string: 'wxid_sender' },
          ToUserName: { string: 'wxid_bot' },
          Content: { string: 'ping' }
        }
      }
    })

    expect(result).toMatchObject({
      statusCode: 200,
      body: ''
    })
    const inbound = await inboundPromise
    expect(inbound).toMatchObject({
      channelType: 'wechat',
      sessionType: 'direct',
      channelId: 'wxid_sender',
      senderId: 'wxid_sender',
      messageId: 'wx_app:123',
      text: '[wxid_sender]:\nping',
      replyTo: {
        receiveId: 'wxid_sender',
        receiveIdType: 'wxid'
      }
    })
  })

  it('normalizes group text callbacks to the chatroom and real speaker', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          ret: 200,
          msg: '操作成功',
          data: {
            memberList: [
              {
                wxid: 'wxid_member',
                nickName: '张三',
                displayName: '项目群里的张三'
              }
            ]
          }
        })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
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
        'x-oneworks-channel-secret': 'webhook-secret'
      },
      query: {},
      body: {
        TypeName: 'AddMsg',
        Appid: 'wx_app',
        Wxid: 'wxid_bot',
        Data: {
          NewMsgId: '456',
          MsgType: 1,
          FromUserName: { string: 'room@chatroom' },
          ToUserName: { string: 'wxid_bot' },
          Content: { string: 'wxid_member:\nhello group' }
        }
      }
    })

    const inbound = await inboundPromise
    expect(inbound).toMatchObject({
      sessionType: 'group',
      channelId: 'room@chatroom',
      senderId: 'wxid_member',
      text: '[wxid_member（张三）（项目群里的张三）]:\nhello group',
      replyTo: {
        receiveId: 'room@chatroom',
        receiveIdType: 'chatroom'
      }
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.wechatapi.net/finder/v2/api/group/getChatroomMemberList',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'VideosApi-token': 'wechat-token'
        },
        body: JSON.stringify({
          appId: 'wx_app',
          chatroomId: 'room@chatroom'
        })
      }
    )
  })

  it('does not duplicate equal WeChat member names in group sender labels', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            ret: 200,
            msg: '操作成功',
            data: {
              memberList: [
                {
                  wxid: 'wxid_member',
                  nickName: '张三',
                  displayName: '张三'
                }
              ]
            }
          })
      })
    )

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
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
        'x-oneworks-channel-secret': 'webhook-secret'
      },
      query: {},
      body: {
        TypeName: 'AddMsg',
        Appid: 'wx_app',
        Wxid: 'wxid_bot',
        Data: {
          NewMsgId: '456',
          MsgType: 1,
          FromUserName: { string: 'room@chatroom' },
          ToUserName: { string: 'wxid_bot' },
          Content: { string: 'wxid_member:\nhello group' }
        }
      }
    })

    const inbound = await inboundPromise
    expect(inbound.text).toBe('[wxid_member（张三）]:\nhello group')
  })

  it('strips leading group mention aliases from inbound text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          ret: 200,
          msg: '操作成功',
          data: {
            memberList: [
              {
                wxid: 'wxid_bot',
                nickName: '二介',
                displayName: '二介 dev'
              },
              {
                wxid: 'wxid_member',
                nickName: '张三',
                displayName: '张三'
              }
            ]
          }
        })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
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
        'x-oneworks-channel-secret': 'webhook-secret'
      },
      query: {},
      body: {
        TypeName: 'AddMsg',
        Appid: 'wx_app',
        Wxid: 'wxid_bot',
        Data: {
          NewMsgId: '457',
          MsgType: 1,
          FromUserName: { string: 'room@chatroom' },
          ToUserName: { string: 'wxid_bot' },
          Content: { string: 'wxid_member:\n@二介 dev\u2005/help' }
        }
      }
    })

    const inbound = await inboundPromise
    expect(inbound.text).toBe('[wxid_member（张三）]:\n/help')
    expect(inbound.raw).toMatchObject({
      contentItems: [{ type: 'text', text: '[wxid_member（张三）]:\n/help' }]
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.wechatapi.net/finder/v2/api/group/getChatroomMemberList',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'VideosApi-token': 'wechat-token'
        },
        body: JSON.stringify({
          appId: 'wx_app',
          chatroomId: 'room@chatroom'
        })
      }
    )
  })

  it('logs raw media webhook payloads and dispatches emoji frames to the agent', async () => {
    const singleFrameGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: vi.fn(() => 'image/gif')
      },
      arrayBuffer: async () =>
        singleFrameGif.buffer.slice(
          singleFrameGif.byteOffset,
          singleFrameGif.byteOffset + singleFrameGif.byteLength
        )
    })
    vi.stubGlobal('fetch', fetchMock)

    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      trace: vi.fn(),
      warn: vi.fn()
    }
    let resolveInbound: (event: ChannelInboundEvent) => void = () => undefined
    const inboundPromise = new Promise<ChannelInboundEvent>((resolve) => {
      resolveInbound = resolve
    })
    const handler = vi.fn(resolveInbound)
    const payload = {
      TypeName: 'AddMsg',
      Appid: 'wx_app',
      Wxid: 'wxid_bot',
      Data: {
        NewMsgId: 'emoji-1',
        MsgType: 47,
        FromUserName: { string: 'wxid_sender' },
        ToUserName: { string: 'wxid_bot' },
        Content: {
          string: '<msg><emoji md5="abc" len="42" cdnurl="https://example.com/emoji.gif" /></msg>'
        }
      }
    }

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config, { logger })
    await connection.startReceiving?.({
      handlers: {
        message: handler
      }
    })

    const result = await connection.handleWebhook?.({
      method: 'POST',
      headers: {},
      query: { secret: 'webhook-secret' },
      body: payload
    })

    expect(result).toMatchObject({
      statusCode: 200,
      body: ''
    })
    const inbound = await inboundPromise
    expect(handler).toHaveBeenCalledOnce()
    expect(inbound).toMatchObject({
      channelType: 'wechat',
      sessionType: 'direct',
      channelId: 'wxid_sender',
      senderId: 'wxid_sender',
      messageId: 'wx_app:emoji-1',
      text: '[wxid_sender]:\n[微信动画表情] 已抽取 GIF 第一帧、中间帧、最后一帧。'
    })
    const contentItems = (inbound.raw as { contentItems?: unknown[] }).contentItems
    const emojis = (inbound.raw as { emojis?: unknown[] }).emojis
    expect(contentItems).toHaveLength(4)
    expect(emojis).toEqual([
      {
        id: 'abc',
        platform: 'wechat',
        metadata: {
          emojiMd5: 'abc',
          emojiSize: 42
        }
      }
    ])
    expect(contentItems?.[0]).toEqual({
      type: 'text',
      text: inbound.text
    })
    for (const item of contentItems?.slice(1) ?? []) {
      expect(item).toEqual(expect.objectContaining({
        type: 'image',
        url: expect.stringMatching(/^data:image\/png;base64,/),
        path: expect.stringMatching(/wechat-gif-emoji-1-(first|middle|last)-.*\.png$/),
        name: expect.stringMatching(/^wechat-gif-emoji-1-(first|middle|last)-.*\.png$/),
        size: expect.any(Number),
        mimeType: 'image/png'
      }))
    }
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/emoji.gif')
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        channelType: 'wechat',
        appId: 'wx_app',
        msgType: 47,
        contentLength: payload.Data.Content.string.length,
        contentPreview: payload.Data.Content.string,
        rawPayload: payload,
        dataKeys: expect.arrayContaining(['Content', 'FromUserName', 'MsgType', 'NewMsgId', 'ToUserName'])
      }),
      '[wechat] webhook raw payload debug'
    )
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        channelType: 'wechat',
        messageId: 'emoji-1',
        mimeType: 'image/gif',
        imageCount: 3
      }),
      '[wechat] prepared emoji media for agent'
    )
  })

  it('downloads WeChat image CDN identifiers through WechatApi before dispatching image content', async () => {
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    )
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/message/downloadImage')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              ret: 200,
              msg: '操作成功',
              data: {
                fileUrl: 'https://cdn.example.com/wechat-image.png'
              }
            })
        }
      }
      if (url === 'https://cdn.example.com/wechat-image.png') {
        return {
          ok: true,
          status: 200,
          headers: {
            get: vi.fn(() => 'image/png')
          },
          arrayBuffer: async () =>
            tinyPng.buffer.slice(
              tinyPng.byteOffset,
              tinyPng.byteOffset + tinyPng.byteLength
            )
        }
      }
      throw new Error(`unexpected fetch ${url} ${JSON.stringify(init)}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
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
      headers: {},
      query: { secret: 'webhook-secret' },
      body: {
        TypeName: 'AddMsg',
        Appid: 'wx_app',
        Wxid: 'wxid_bot',
        Data: {
          NewMsgId: 'image-1',
          MsgType: 3,
          FromUserName: { string: 'wxid_sender' },
          ToUserName: { string: 'wxid_bot' },
          Content: {
            string:
              '<msg><img cdnmidimgurl="305f02010004" cdnthumbwidth="180" cdnthumbheight="102" length="31276" md5="7f3ef796837e24655ab64cac45b86036"></img></msg>'
          },
          MsgSource: '<msgsource><img_file_name>sample.png</img_file_name></msgsource>'
        }
      }
    })

    const inbound = await inboundPromise
    expect(inbound.text).toBe('[wxid_sender]:\n[微信图片] 已提取图片。')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.wechatapi.net/finder/v2/api/message/downloadImage',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'VideosApi-token': 'wechat-token'
        },
        body: JSON.stringify({
          appId: 'wx_app',
          type: 2,
          xml:
            '<msg><img cdnmidimgurl="305f02010004" cdnthumbwidth="180" cdnthumbheight="102" length="31276" md5="7f3ef796837e24655ab64cac45b86036"></img></msg>'
        })
      }
    )
    const contentItems = (inbound.raw as { contentItems?: unknown[] }).contentItems
    expect(contentItems).toEqual([
      { type: 'text', text: inbound.text },
      expect.objectContaining({
        type: 'image',
        url: expect.stringMatching(/^data:image\/png;base64,/),
        path: expect.stringMatching(/wechat-image-image-1-.*\.png$/),
        name: expect.stringMatching(/^wechat-image-image-1-.*\.png$/),
        size: expect.any(Number),
        mimeType: 'image/png'
      })
    ])
  })

  it('dispatches WeChat quote app messages as structured text', async () => {
    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
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
      headers: {},
      query: { secret: 'webhook-secret' },
      body: {
        TypeName: 'AddMsg',
        Appid: 'wx_app',
        Wxid: 'wxid_bot',
        Data: {
          NewMsgId: 'quote-1',
          MsgType: 49,
          FromUserName: { string: 'wxid_sender' },
          ToUserName: { string: 'wxid_bot' },
          Content: {
            string:
              '<msg><appmsg><title>这里</title><type>57</type><refermsg><displayname>二介</displayname><content>你好，有什么我可以帮你的？</content></refermsg></appmsg></msg>'
          }
        }
      }
    })

    const inbound = await inboundPromise
    expect(inbound.text).toBe(
      '[wxid_sender]:\n[微信引用消息] 收到一条引用回复。\n回复内容：这里\n引用对象：二介\n引用内容：你好，有什么我可以帮你的？'
    )
  })

  it('sends text replies through WechatApi postText', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          ret: 200,
          msg: '操作成功',
          data: {
            newMsgId: 789
          }
        })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const result = await connection.sendMessage({
      receiveId: 'wxid_sender',
      receiveIdType: 'wxid',
      text: 'pong'
    })

    expect(result).toEqual({ messageId: '789' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.wechatapi.net/finder/v2/api/message/postText',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'VideosApi-token': 'wechat-token'
        },
        body: JSON.stringify({
          appId: 'wx_app',
          toWxid: 'wxid_sender',
          content: 'pong'
        })
      }
    )
  })

  it('truncates long text replies before WechatApi postText', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          ret: 200,
          msg: '操作成功',
          data: {
            newMsgId: 790
          }
        })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    await connection.sendMessage({
      receiveId: 'wxid_sender',
      receiveIdType: 'wxid',
      text: '你'.repeat(201)
    })

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body)).toEqual({
      appId: 'wx_app',
      toWxid: 'wxid_sender',
      content: `${'你'.repeat(199)}…`
    })
  })

  it('maps structured mentions to WechatApi text ats', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          ret: 200,
          msg: '操作成功',
          data: {
            newMsgId: 791
          }
        })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const result = await connection.sendMessage({
      receiveId: 'room@chatroom',
      receiveIdType: 'chatroom',
      text: '@张三 @李四 麻烦看一下',
      mentions: [
        { id: 'wxid_a', platform: 'wechat', type: 'user' },
        { id: 'wxid_b', platform: 'wechat', type: 'user' },
        { id: 'wxid_a', platform: 'wechat', type: 'user' }
      ]
    })

    expect(result).toEqual({ messageId: '791' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.wechatapi.net/finder/v2/api/message/postText',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'VideosApi-token': 'wechat-token'
        },
        body: JSON.stringify({
          appId: 'wx_app',
          toWxid: 'room@chatroom',
          content: '@张三 @李四 麻烦看一下',
          ats: 'wxid_a,wxid_b'
        })
      }
    )
  })

  it('maps at-all mentions to notify@all', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          ret: 200,
          msg: '操作成功',
          data: {
            newMsgId: 792
          }
        })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    await connection.sendMessage({
      receiveId: 'room@chatroom',
      receiveIdType: 'chatroom',
      text: '@所有人 服务已恢复',
      mentions: [{ id: 'notify@all', platform: 'wechat', type: 'all' }]
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.wechatapi.net/finder/v2/api/message/postText',
      expect.objectContaining({
        body: JSON.stringify({
          appId: 'wx_app',
          toWxid: 'room@chatroom',
          content: '@所有人 服务已恢复',
          ats: 'notify@all'
        })
      })
    )
  })

  it('sends emoji messages through WechatApi postEmoji', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          ret: 200,
          msg: '操作成功',
          data: {
            newMsgId: 793
          }
        })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const result = await connection.sendEmojiMessage?.({
      receiveId: 'room@chatroom',
      receiveIdType: 'chatroom',
      emoji: {
        id: 'thumbs-up-bear',
        platform: 'wechat',
        metadata: {
          emojiMd5: '4cc7540a85b5b6cf4ba14e9f4ae08b7c',
          emojiSize: 102357
        }
      }
    })

    expect(result).toEqual({ messageId: '793' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.wechatapi.net/finder/v2/api/message/postEmoji',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'VideosApi-token': 'wechat-token'
        },
        body: JSON.stringify({
          appId: 'wx_app',
          toWxid: 'room@chatroom',
          emojiMd5: '4cc7540a85b5b6cf4ba14e9f4ae08b7c',
          emojiSize: 102357
        })
      }
    )
  })

  it('sends image messages through WechatApi postImage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          ret: 200,
          msg: '操作成功',
          data: {
            newMsgId: 790
          }
        })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection(config)
    const result = await connection.sendMediaMessage?.({
      receiveId: 'room@chatroom',
      receiveIdType: 'chatroom',
      type: 'image',
      src: 'https://example.com/a.png'
    })

    expect(result).toEqual({ messageId: '790' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.wechatapi.net/finder/v2/api/message/postImage',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'VideosApi-token': 'wechat-token'
        },
        body: JSON.stringify({
          appId: 'wx_app',
          toWxid: 'room@chatroom',
          imgUrl: 'https://example.com/a.png'
        })
      }
    )
  })

  it('registers callback URLs by default when a public base URL is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ret: 200, msg: '操作成功' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection({
      ...config,
      serverBaseUrl: 'https://bot.example.com'
    })
    await connection.startReceiving?.({
      channelKey: 'erjie',
      handlers: {}
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.wechatapi.net/finder/v2/api/login/setCallback',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'VideosApi-token': 'wechat-token'
        },
        body: JSON.stringify({
          token: 'wechat-token',
          callbackUrl: 'https://bot.example.com/channels/wechat/erjie/webhook?secret=webhook-secret'
        })
      }
    )
  })

  it('can reconnect the WechatApi account before callback registration on startup', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ret: 200, msg: '操作成功' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection({
      ...config,
      serverBaseUrl: 'https://bot.example.com',
      autoReconnectOnStart: true
    })
    await connection.startReceiving?.({
      channelKey: 'erjie',
      handlers: {}
    })

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://api.wechatapi.net/finder/v2/api/login/reconnection',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'VideosApi-token': 'wechat-token'
        },
        body: JSON.stringify({
          appId: 'wx_app'
        })
      }
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://api.wechatapi.net/finder/v2/api/login/setCallback',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'VideosApi-token': 'wechat-token'
        },
        body: JSON.stringify({
          token: 'wechat-token',
          callbackUrl: 'https://bot.example.com/channels/wechat/erjie/webhook?secret=webhook-secret'
        })
      }
    )
  })

  it('allows callback URL auto-registration to be disabled explicitly', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection({
      ...config,
      serverBaseUrl: 'https://bot.example.com',
      autoRegisterCallback: false
    })
    await connection.startReceiving?.({
      channelKey: 'erjie',
      handlers: {}
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not register callback URLs when webhooks are disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      trace: vi.fn(),
      warn: vi.fn()
    }

    const { createChannelConnection } = await import('#~/connection.js')
    const connection = await createChannelConnection({
      ...config,
      enableWebhook: false,
      serverBaseUrl: 'https://bot.example.com',
      autoRegisterCallback: true
    }, { logger })
    await connection.startReceiving?.({
      channelKey: 'erjie',
      handlers: {}
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      {
        channelKey: 'erjie',
        channelType: 'wechat'
      },
      '[wechat] webhook disabled by channel config'
    )
  })
})
