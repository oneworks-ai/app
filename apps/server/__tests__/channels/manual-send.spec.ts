import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { upsertChannelEmojiRegistryEntry } from '@oneworks/utils'

import { sendManualChannelMessage } from '#~/channels/manual-send.js'

const makeStates = (connection: Record<string, unknown>, config: Record<string, unknown> = {}) =>
  new Map([
    ['erjie', {
      key: 'erjie',
      type: 'wechat',
      status: 'connected',
      config,
      connection
    } as any]
  ])

const tempDirs: string[] = []
const originalServerDataDir = process.env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__

const createTempDataDir = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-manual-send-'))
  tempDirs.push(dir)
  process.env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__ = dir
  return dir
}

afterEach(async () => {
  if (originalServerDataDir == null) {
    delete process.env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__
  } else {
    process.env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__ = originalServerDataDir
  }
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('manual channel send', () => {
  it('sends text through the bound channel connection', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_text' })

    await expect(sendManualChannelMessage(makeStates({ sendMessage }), {
      channelKey: 'erjie',
      payload: 'hello',
      receiveId: 'wxid_user',
      receiveIdType: 'wxid'
    })).resolves.toEqual({
      ok: true,
      type: 'text',
      messageId: 'om_text'
    })

    expect(sendMessage).toHaveBeenCalledWith({
      receiveId: 'wxid_user',
      receiveIdType: 'wxid',
      text: 'hello'
    })
  })

  it('converts escaped line breaks before sending text', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_text' })

    await expect(sendManualChannelMessage(makeStates({ sendMessage }), {
      channelKey: 'erjie',
      payload: '第一段\\n\\n- 第二段',
      receiveId: 'wxid_user',
      receiveIdType: 'wxid'
    })).resolves.toEqual({
      ok: true,
      type: 'text',
      messageId: 'om_text'
    })

    expect(sendMessage).toHaveBeenCalledWith({
      receiveId: 'wxid_user',
      receiveIdType: 'wxid',
      text: '第一段\n\n- 第二段'
    })
  })

  it('rejects text messages longer than 200 visible characters', async () => {
    const sendMessage = vi.fn()

    await expect(sendManualChannelMessage(makeStates({ sendMessage }), {
      channelKey: 'erjie',
      payload: '你'.repeat(201),
      receiveId: 'wxid_user',
      receiveIdType: 'wxid'
    })).resolves.toEqual({
      ok: false,
      statusCode: 400,
      message: 'Text message is too long: 201/200 characters.'
    })

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('forwards structured mentions with text messages', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_at' })

    await expect(sendManualChannelMessage(makeStates({ sendMessage }), {
      channelKey: 'erjie',
      mentions: [{ id: 'wxid_a', platform: 'wechat', type: 'user' }],
      payload: '@张三 已处理',
      receiveId: 'room@chatroom',
      receiveIdType: 'chatroom'
    })).resolves.toEqual({
      ok: true,
      type: 'text',
      messageId: 'om_at'
    })

    expect(sendMessage).toHaveBeenCalledWith({
      mentions: [{ id: 'wxid_a', platform: 'wechat', type: 'user' }],
      receiveId: 'room@chatroom',
      receiveIdType: 'chatroom',
      text: '@张三 已处理'
    })
  })

  it('accepts mentions embedded in text object payloads', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'om_payload_at' })

    await sendManualChannelMessage(makeStates({ sendMessage }), {
      channelKey: 'erjie',
      payload: {
        text: '@李四 麻烦看下',
        mentions: [{ wxid: 'wxid_b', name: '李四', type: 'user' }]
      },
      receiveId: 'room@chatroom',
      receiveIdType: 'chatroom'
    })

    expect(sendMessage).toHaveBeenCalledWith({
      mentions: [{ id: 'wxid_b', label: '李四', type: 'user' }],
      receiveId: 'room@chatroom',
      receiveIdType: 'chatroom',
      text: '@李四 麻烦看下'
    })
  })

  it('sends emoji payloads when the channel supports emoji messages', async () => {
    const sendEmojiMessage = vi.fn().mockResolvedValue({ messageId: 'om_emoji' })

    await expect(sendManualChannelMessage(
      makeStates({
        sendMessage: vi.fn(),
        sendEmojiMessage
      }),
      {
        channelKey: 'erjie',
        payload: {
          type: 'emoji',
          emojiMd5: '4cc7540a85b5b6cf4ba14e9f4ae08b7c',
          emojiSize: '102357'
        },
        receiveId: 'room@chatroom',
        receiveIdType: 'chatroom'
      }
    )).resolves.toEqual({
      ok: true,
      type: 'emoji',
      messageId: 'om_emoji'
    })

    expect(sendEmojiMessage).toHaveBeenCalledWith({
      receiveId: 'room@chatroom',
      receiveIdType: 'chatroom',
      emoji: {
        id: '4cc7540a85b5b6cf4ba14e9f4ae08b7c',
        platform: 'wechat',
        metadata: {
          emojiMd5: '4cc7540a85b5b6cf4ba14e9f4ae08b7c',
          emojiSize: 102357
        }
      }
    })
  })

  it('resolves emoji payload ids from the registry', async () => {
    const dataDir = await createTempDataDir()
    await upsertChannelEmojiRegistryEntry(path.join(dataDir, 'channel-memory', 'v1'), {
      id: 'thumbs-up-bear',
      platform: 'wechat',
      label: '点赞小熊',
      metadata: {
        emojiMd5: 'abc',
        emojiSize: 42
      }
    })
    const sendEmojiMessage = vi.fn().mockResolvedValue({ messageId: 'om_saved_emoji' })

    await expect(sendManualChannelMessage(
      makeStates({
        sendMessage: vi.fn(),
        sendEmojiMessage
      }),
      {
        channelKey: 'erjie',
        payload: {
          type: 'emoji',
          id: 'thumbs-up-bear',
          platform: 'wechat'
        },
        receiveId: 'room@chatroom',
        receiveIdType: 'chatroom'
      }
    )).resolves.toEqual({
      ok: true,
      type: 'emoji',
      messageId: 'om_saved_emoji'
    })

    expect(sendEmojiMessage).toHaveBeenCalledWith({
      receiveId: 'room@chatroom',
      receiveIdType: 'chatroom',
      emoji: {
        id: 'thumbs-up-bear',
        label: '点赞小熊',
        metadata: {
          emojiMd5: 'abc',
          emojiSize: 42
        },
        platform: 'wechat'
      }
    })
  })

  it('uses media send for URL image payloads when available', async () => {
    const sendMediaMessage = vi.fn().mockResolvedValue({ messageId: 'om_image' })

    await expect(sendManualChannelMessage(
      makeStates({
        sendMessage: vi.fn(),
        sendMediaMessage
      }),
      {
        channelKey: 'erjie',
        payload: {
          type: 'image',
          src: 'https://example.com/a.png'
        },
        receiveId: 'group-1',
        receiveIdType: 'chat_id'
      }
    )).resolves.toEqual({
      ok: true,
      type: 'image',
      messageId: 'om_image'
    })

    expect(sendMediaMessage).toHaveBeenCalledWith({
      receiveId: 'group-1',
      receiveIdType: 'chat_id',
      type: 'image',
      src: 'https://example.com/a.png'
    })
  })

  it('returns a clear error when the target is missing', async () => {
    await expect(sendManualChannelMessage(makeStates({ sendMessage: vi.fn() }), {
      channelKey: 'erjie',
      payload: 'hello'
    })).resolves.toEqual({
      ok: false,
      statusCode: 400,
      message: 'Missing receiveId. Pass --to or run from a channel session context.'
    })
  })

  it('blocks manual sends from silent channel sessions', async () => {
    const sendMessage = vi.fn()

    await expect(sendManualChannelMessage(
      makeStates({ sendMessage }, { silentSessions: ['sess-muted'] }),
      {
        channelKey: 'erjie',
        payload: 'hello',
        receiveId: 'room@chatroom',
        receiveIdType: 'chatroom',
        sessionId: 'sess-muted'
      }
    )).resolves.toEqual({
      ok: false,
      statusCode: 403,
      message: 'Channel session "sess-muted" is silent and cannot send messages.'
    })

    expect(sendMessage).not.toHaveBeenCalled()
  })
})
