import { afterEach, describe, expect, it } from 'vitest'

import { createChannelIngressRouterRunsRepo } from '../../src/db/channelIngressRouterRuns/repo'
import { channelIngressRouterRunsSchemaModule } from '../../src/db/channelIngressRouterRuns/schema'
import { initSchema } from '../../src/db/schema'
import { createSqliteDatabase } from '../../src/db/sqlite'
import type { SqliteDatabase } from '../../src/db/sqlite'

describe('channel ingress router runs', () => {
  let sqlite: SqliteDatabase | undefined

  afterEach(() => sqlite?.close())

  it('stores every decision audit and attaches its child run idempotently', () => {
    sqlite = createSqliteDatabase(':memory:')
    initSchema(sqlite, [channelIngressRouterRunsSchemaModule])
    const repo = createChannelIngressRouterRunsRepo(sqlite)
    for (const decision of ['ignore', 'observe', 'create_child', 'defer'] as const) {
      const row = repo.create({
        actorAccountId: 'account-1',
        actorUserId: 'user-1',
        adapter: 'gemini',
        candidateCount: 2,
        channelId: 'chat-1',
        channelKey: 'issuer-a',
        channelLinkName: 'link-1',
        channelType: 'lark',
        childRunId: null,
        confidence: .8,
        contextCount: 1,
        decision,
        entity: 'bot',
        error: null,
        filteredCount: 1,
        latencyMs: 12,
        messageId: `message-${decision}`,
        mode: 'reply',
        model: 'gemini-2.5',
        reason: decision,
        senderId: 'account-1',
        sessionType: 'group',
        syntheticActorRole: 'admin',
        syntheticUserLabel: 'Scenario Admin',
        visibility: 'public'
      })
      expect(row.decision).toBe(decision)
      expect(row.candidateCount).toBe(2)
      expect(row.syntheticActorRole).toBe('admin')
      expect(row.syntheticUserLabel).toBe('Scenario Admin')
      if (decision === 'create_child') {
        expect(repo.attachChildRun(row.id, 'child-1')?.childRunId).toBe('child-1')
        expect(repo.attachChildRun(row.id, 'child-1')?.childRunId).toBe('child-1')
      }
    }
  })
})
