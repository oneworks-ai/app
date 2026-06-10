import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  filterChannelEmojiRegistryEntries,
  findChannelEmojiRegistryEntry,
  formatChannelEmojiRegistryEntries,
  isChannelEmojiRegistryEntrySendable,
  listChannelEmojiRegistryEntries,
  sortChannelEmojiRegistryEntriesByRecent,
  upsertChannelEmojiRegistryEntry
} from '../src/channel-emoji-registry'

const tempDirs: string[] = []

const createTempDir = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-emoji-registry-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('channel emoji registry', () => {
  it('stores, lists, and finds emoji entries by id or alias', async () => {
    const root = await createTempDir()
    await upsertChannelEmojiRegistryEntry(root, {
      id: 'thumbs-up-bear',
      platform: 'wechat',
      aliases: ['赞'],
      label: '点赞小熊',
      metadata: {
        emojiMd5: 'abc',
        emojiSize: 42
      },
      note: '适合回应认可、没问题。',
      tags: ['赞同', '轻松']
    })
    await upsertChannelEmojiRegistryEntry(root, {
      id: 'unknown-bear',
      platform: 'wechat',
      note: '还没识别清楚，可以后续补充。',
      tags: ['待标注']
    })

    await expect(listChannelEmojiRegistryEntries(root, 'wechat')).resolves.toEqual([
      expect.objectContaining({
        id: 'thumbs-up-bear',
        platform: 'wechat',
        aliases: ['赞'],
        label: '点赞小熊',
        note: '适合回应认可、没问题。',
        tags: ['赞同', '轻松']
      }),
      expect.objectContaining({
        id: 'unknown-bear',
        platform: 'wechat'
      })
    ])
    await upsertChannelEmojiRegistryEntry(root, {
      id: 'thumbs-up-bear',
      platform: 'wechat',
      aliases: ['没问题'],
      note: '适合回应认可、赞赏或确认。',
      tags: ['确认']
    })
    await expect(findChannelEmojiRegistryEntry(root, {
      id: '赞',
      platform: 'wechat'
    })).resolves.toMatchObject({
      id: 'thumbs-up-bear',
      metadata: {
        emojiMd5: 'abc',
        emojiSize: 42
      },
      platform: 'wechat',
      aliases: ['赞', '没问题'],
      note: '适合回应认可、赞赏或确认。',
      tags: ['赞同', '轻松', '确认']
    })
    const entries = await listChannelEmojiRegistryEntries(root, 'wechat')
    await expect(findChannelEmojiRegistryEntry(root, {
      id: '没问题',
      platform: 'wechat'
    })).resolves.toMatchObject({
      id: 'thumbs-up-bear'
    })
    expect(filterChannelEmojiRegistryEntries(entries, { tags: ['确认'] })).toHaveLength(1)
    expect(filterChannelEmojiRegistryEntries(entries, { query: '认可' })).toHaveLength(1)
    expect(filterChannelEmojiRegistryEntries(entries, { sendable: true })).toHaveLength(1)
    expect(isChannelEmojiRegistryEntrySendable(entries[0]!)).toBe(true)
    expect(sortChannelEmojiRegistryEntriesByRecent(entries)[0]?.id).toBe('thumbs-up-bear')
    const output = formatChannelEmojiRegistryEntries(entries)
    expect(output).toContain('label=点赞小熊')
    expect(output).toContain('tags=赞同,轻松,确认')
    expect(output).toContain('note=适合回应认可、赞赏或确认。')
    expect(output).toContain('sendable=yes')
  })

  it('normalizes platform-prefixed ids and merges duplicate annotations', async () => {
    const root = await createTempDir()
    await upsertChannelEmojiRegistryEntry(root, {
      id: '886d811081cfe16044c18e48a7fc152c',
      platform: 'wechat',
      metadata: {
        emojiMd5: '886d811081cfe16044c18e48a7fc152c',
        emojiSize: 13658
      }
    })
    await upsertChannelEmojiRegistryEntry(root, {
      id: 'wechat:886d811081cfe16044c18e48a7fc152c',
      platform: 'wechat',
      aliases: ['人才库'],
      label: '已回到人才库',
      note: '适合被轻度调侃时自嘲回怼。',
      tags: ['回怼', '自嘲']
    })

    const entries = await listChannelEmojiRegistryEntries(root, 'wechat')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id: '886d811081cfe16044c18e48a7fc152c',
      aliases: ['人才库'],
      label: '已回到人才库',
      metadata: {
        emojiMd5: '886d811081cfe16044c18e48a7fc152c',
        emojiSize: 13658
      },
      tags: ['回怼', '自嘲']
    })
    expect(isChannelEmojiRegistryEntrySendable(entries[0]!)).toBe(true)
    expect(filterChannelEmojiRegistryEntries(entries, { query: '人才库', sendable: true })).toHaveLength(1)
    await expect(findChannelEmojiRegistryEntry(root, {
      id: 'wechat:886d811081cfe16044c18e48a7fc152c',
      platform: 'wechat'
    })).resolves.toMatchObject({
      id: '886d811081cfe16044c18e48a7fc152c',
      label: '已回到人才库'
    })
    expect(formatChannelEmojiRegistryEntries(entries)).not.toContain('wechat:wechat:')
  })
})
