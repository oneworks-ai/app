import { afterEach, describe, expect, it } from 'vitest'

import { createChannelMemoriesRepo } from '../../src/db/channelMemories/repo'
import { channelMemoriesSchemaModule } from '../../src/db/channelMemories/schema'
import { initSchema } from '../../src/db/schema'
import { createSqliteDatabase } from '../../src/db/sqlite'
import type { SqliteDatabase } from '../../src/db/sqlite'

describe('channel memories', () => {
  let sqlite: SqliteDatabase | undefined

  afterEach(() => sqlite?.close())

  it('migrates memory tables and preserves structured snapshot/writeback audit', () => {
    sqlite = createSqliteDatabase(':memory:')
    initSchema(sqlite, [channelMemoriesSchemaModule])
    const repo = createChannelMemoriesRepo(sqlite)
    const memory = repo.upsert({
      accountId: 'account-1',
      canonicalUserId: 'user-1',
      confidence: .9,
      content: 'Prefer concise release summaries.',
      entity: 'release-bot',
      expiresAt: undefined,
      importance: .8,
      issuer: 'channel-runtime-v1',
      keywords: ['release', 'summary'],
      orgId: 'org-1',
      pinned: true,
      sensitivity: 'normal',
      source: {
        channelId: 'chat-1',
        channelKey: 'lark:main',
        channelType: 'lark',
        issuer: 'channel-runtime-v1',
        org: 'org-1',
        sessionType: 'direct'
      },
      subjectId: 'user-1',
      subjectType: 'canonical_user',
      visibility: {
        channels: ['lark:lark:main:chat-1'],
        conversationTypes: ['direct'],
        entities: ['release-bot'],
        orgs: ['org-1']
      }
    })
    repo.upsert({
      accountId: 'account-1',
      confidence: .9,
      content: 'Account-only context.',
      entity: 'release-bot',
      importance: .8,
      issuer: 'other-issuer',
      keywords: ['account'],
      orgId: 'org-1',
      pinned: false,
      sensitivity: 'normal',
      source: { issuer: 'other-issuer', org: 'org-1', sessionType: 'direct' },
      subjectId: 'account-1',
      subjectType: 'account',
      visibility: {
        channels: ['lark:lark:main:chat-1'],
        conversationTypes: ['direct'],
        entities: ['release-bot'],
        orgs: ['org-1']
      }
    })
    const snapshotId = repo.saveSnapshot({
      accountId: 'account-1',
      canonicalUserId: 'user-1',
      channelId: 'chat-1',
      channelKey: 'lark:main',
      channelType: 'lark',
      itemCount: 1,
      threadKey: 'thread-1',
      tokenCount: 8,
      snapshot: { selectedMemoryIds: [memory.id] }
    })
    const writebackId = repo.createPendingWriteback({
      childRunId: 'child-run-1',
      patch: { status: 'completed' },
      patchKey: 'terminal'
    })
    repo.commitWriteback(writebackId)
    expect(repo.attachSnapshotToChildRun(snapshotId, 'child-run-1')).toBe(true)
    expect(repo.attachSnapshotToChildRun(snapshotId, 'child-run-1')).toBe(true)

    expect(repo.get(memory.id)?.pinned).toBe(true)
    expect(
      repo.listCandidates({
        accountId: 'account-1',
        canonicalUserId: 'user-1',
        channelId: 'chat-2',
        channelKey: 'lark:other',
        channelType: 'lark',
        entity: 'release-bot',
        issuer: 'channel-runtime-v1',
        now: Date.now(),
        orgId: 'org-1',
        threadKey: 'thread-2'
      }).map(item => item.id)
    ).toEqual([memory.id])
    expect(sqlite.prepare('SELECT childRunId FROM channel_memory_snapshots WHERE id = ?').get(snapshotId)).toEqual({
      childRunId: 'child-run-1'
    })
    expect(sqlite.prepare('SELECT id FROM channel_memory_writebacks WHERE id = ?').get(writebackId)).toBeTruthy()
  })
})
