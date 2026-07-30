import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { UsageObservation } from '@oneworks/types'

import { SqliteDb } from '#~/db/index.js'
import { createSqliteDatabase } from '#~/db/sqlite.js'
import { buildUsageReport } from '#~/db/usage/repo.js'

describe('usage ledger', () => {
  let db: SqliteDb

  beforeEach(() => {
    db = new SqliteDb({ db: createSqliteDatabase(':memory:') })
    db.createSession('Usage session', 'usage-session', 'running')
    db.updateSession('usage-session', {
      account: 'kimi-team',
      adapter: 'claude-code',
      model: 'kimi-api,kimi-k2.5'
    })
  })

  afterEach(() => {
    db.close()
  })

  it('records message usage with tool, service, model and account facets', () => {
    db.saveMessage('usage-session', {
      type: 'message',
      message: {
        id: 'message-1',
        role: 'assistant',
        content: 'done',
        createdAt: 1_800_000_000_000,
        usage: {
          input_tokens: 100,
          output_tokens: 30,
          cache_read_input_tokens: 20,
          aggregation_mode: 'delta',
          quality: 'provider_reported'
        }
      }
    })

    const report = db.getUsageReport({
      from: 1_799_999_000_000,
      to: 1_800_001_000_000
    })

    expect(report.summary).toMatchObject({
      input: 100,
      output: 30,
      cacheRead: 20,
      total: 150,
      observationCount: 1
    })
    expect(report.facets.tool[0]).toMatchObject({ id: 'claude-code', total: 150 })
    expect(report.facets.modelService[0]).toMatchObject({ id: 'kimi-api', total: 150 })
    expect(report.facets.model[0]).toMatchObject({ id: 'kimi-k2.5', total: 150 })
    expect(report.facets.account[0]).toMatchObject({ id: 'kimi-team', total: 150 })
  })

  it('keeps the selected model service while accepting the model reported by an adapter', () => {
    db.saveMessage('usage-session', {
      type: 'message',
      message: {
        id: 'reported-model',
        role: 'assistant',
        content: 'done',
        createdAt: 1_800_000_000_000,
        model: 'kimi-k2.5',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          aggregation_mode: 'delta'
        }
      }
    })
    db.saveMessage('usage-session', {
      type: 'adapter_event',
      data: {
        source: 'adapter_usage',
        usage: {
          id: 'full-model-selection',
          observedAt: 1_800_000_001_000,
          inputTokens: 20,
          outputTokens: 5,
          model: 'kimi-api,kimi-k2.5',
          aggregationMode: 'delta'
        }
      }
    })

    const report = db.getUsageReport({
      from: 1_799_999_000_000,
      to: 1_800_001_000_000
    })

    expect(report.facets.modelService).toEqual([
      expect.objectContaining({ id: 'kimi-api', total: 40 })
    ])
    expect(report.facets.model).toEqual([
      expect.objectContaining({ id: 'kimi-k2.5', total: 40 })
    ])
  })

  it('records cumulative usage and final cost from a stop message without persisting duplicate content', () => {
    db.recordSessionUsageEvent('usage-session', {
      type: 'message',
      message: {
        id: 'claude-stop',
        role: 'assistant',
        content: 'final answer',
        createdAt: 1_800_000_000_000,
        model: 'kimi-k2.5',
        usage: {
          input_tokens: 120,
          output_tokens: 30,
          aggregation_mode: 'cumulative',
          quality: 'provider_reported',
          total_cost_usd: 0.42
        }
      }
    })

    expect(db.getMessages('usage-session')).toEqual([])
    expect(db.getUsageReport({
      from: 1_799_999_000_000,
      to: 1_800_001_000_000
    })).toMatchObject({
      summary: {
        costUsd: 0.42,
        total: 150,
        observationCount: 1
      }
    })
  })

  it('uses deltas instead of double counting a cumulative session total', () => {
    db.saveMessage('usage-session', {
      type: 'adapter_event',
      data: {
        source: 'adapter_usage',
        usage: {
          id: 'delta',
          observedAt: 1_800_000_000_000,
          inputTokens: 80,
          outputTokens: 20,
          aggregationMode: 'delta'
        }
      }
    })
    db.saveMessage('usage-session', {
      type: 'adapter_event',
      data: {
        source: 'adapter_usage',
        usage: {
          id: 'cumulative',
          observedAt: 1_800_000_001_000,
          inputTokens: 800,
          outputTokens: 200,
          costUsd: 1.23,
          aggregationMode: 'cumulative'
        }
      }
    })

    expect(
      db.getUsageReport({
        from: 1_799_999_000_000,
        to: 1_800_001_000_000
      }).summary
    ).toMatchObject({
      costUsd: 1.23,
      total: 100
    })
  })

  it('deduplicates stable observation ids without merging sessions across workspaces', () => {
    const createObservation = (
      id: string,
      workspaceId: string,
      total: number
    ): UsageObservation => ({
      id,
      aggregationMode: 'delta',
      observedAt: 1_800_000_000_000,
      provenance: { origin: 'plugin', deviceId: 'shared-device' },
      quality: 'provider_reported',
      sessionId: 'shared-session',
      tokens: {
        input: total,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        reasoning: 0,
        total
      },
      toolId: 'codex',
      workspaceId
    })
    const first = createObservation('observation-a', 'workspace:a', 40)
    const second = createObservation('observation-b', 'workspace:b', 60)
    const report = buildUsageReport([first, first, second], {
      from: 1_799_999_000_000,
      to: 1_800_001_000_000
    })
    const expectedDate = new Date(first.observedAt)

    expect(report.summary.total).toBe(100)
    expect(report.facets.workspace.map(item => item.id)).toEqual(['workspace:b', 'workspace:a'])
    expect(report.activity[0]?.key).toBe([
      expectedDate.getFullYear(),
      String(expectedDate.getMonth() + 1).padStart(2, '0'),
      String(expectedDate.getDate()).padStart(2, '0')
    ].join('-'))
  })
})
