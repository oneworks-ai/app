import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { findChannelEmojiRegistryEntry } from '@oneworks/utils'

import { emojiRegistryMiddleware } from '#~/channels/middleware/emoji-registry.js'
import { resolveChannelMemoryRoot } from '#~/services/session/channel-context.js'

const tempDirs: string[] = []
const originalServerDataDir = process.env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__

const createTempDataDir = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'oneworks channel-emoji-'))
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

describe('emojiRegistryMiddleware', () => {
  it('stores inbound emoji references by platform', async () => {
    await createTempDataDir()
    await emojiRegistryMiddleware({
      channelKey: 'erjie',
      inbound: {
        channelType: 'wechat',
        channelId: 'room@chatroom',
        senderId: 'wxid_sender',
        sessionType: 'group',
        messageId: 'wx_app:emoji-1',
        raw: {
          emojis: [{
            id: 'abc',
            platform: 'wechat',
            metadata: {
              emojiMd5: 'abc',
              emojiSize: 42
            }
          }]
        }
      }
    } as any, async () => undefined)

    await expect(findChannelEmojiRegistryEntry(resolveChannelMemoryRoot(), {
      id: 'abc',
      platform: 'wechat'
    })).resolves.toMatchObject({
      id: 'abc',
      platform: 'wechat',
      metadata: {
        emojiMd5: 'abc',
        emojiSize: 42
      },
      source: {
        channelKey: 'erjie',
        messageId: 'wx_app:emoji-1'
      }
    })
  })
})
