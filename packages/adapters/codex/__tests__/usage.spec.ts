import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { classifyCodexUsageLine } from '#~/runtime/usage-history-record.js'
import { clearCodexUsageCache, collectCodexUsage } from '#~/runtime/usage.js'

const tempDirs: string[] = []

const createHistoryFile = async (
  codexHome: string,
  timestamp: string,
  name: string,
  entries: unknown[]
) => {
  const date = new Date(timestamp)
  const filePath = join(
    codexHome,
    'sessions',
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
    `${name}.jsonl`
  )
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`)
  return filePath
}

const tokenCount = (
  timestamp: string,
  counts: {
    cacheRead: number
    input: number
    output: number
    reasoning: number
    total: number
  }
) => ({
  timestamp,
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      total_token_usage: {
        cache_write_input_tokens: 0,
        cached_input_tokens: counts.cacheRead,
        input_tokens: counts.input,
        output_tokens: counts.output,
        reasoning_output_tokens: counts.reasoning,
        total_tokens: counts.total
      }
    }
  }
})

afterEach(async () => {
  clearCodexUsageCache()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('codex local usage history', () => {
  it('converts cumulative snapshots into stable deltas without reading prompt content', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'oneworks-codex-usage-'))
    tempDirs.push(codexHome)
    const firstTimestamp = '2026-07-29T10:00:00.000Z'
    const secondTimestamp = '2026-07-29T10:05:00.000Z'
    const promptRecord = {
      timestamp: firstTimestamp,
      type: 'response_item',
      payload: {
        content: 'private prompt containing token_count, session_meta, and turn_context'
      }
    }
    expect(classifyCodexUsageLine(JSON.stringify(promptRecord))).toBeUndefined()
    await createHistoryFile(codexHome, firstTimestamp, 'external-session', [
      {
        timestamp: firstTimestamp,
        type: 'session_meta',
        payload: {
          id: 'external-session',
          model_provider: 'openai',
          originator: 'Codex Desktop'
        }
      },
      {
        timestamp: firstTimestamp,
        type: 'turn_context',
        payload: { model: 'gpt-5.6-sol' }
      },
      promptRecord,
      tokenCount(firstTimestamp, {
        cacheRead: 30,
        input: 80,
        output: 20,
        reasoning: 5,
        total: 100
      }),
      tokenCount(secondTimestamp, {
        cacheRead: 50,
        input: 120,
        output: 30,
        reasoning: 8,
        total: 150
      })
    ])

    const result = await collectCodexUsage(
      { env: { CODEX_HOME: codexHome } },
      {
        from: Date.parse('2026-07-29T00:00:00.000Z'),
        to: Date.parse('2026-07-30T00:00:00.000Z')
      }
    )

    expect(result.coverage).toMatchObject({
      id: 'adapter:codex-local-history',
      status: 'available'
    })
    expect(result.observations).toHaveLength(2)
    expect(result.observations.map(observation => observation.tokens)).toEqual([
      {
        cacheCreation: 0,
        cacheRead: 30,
        input: 80,
        output: 20,
        reasoning: 5,
        total: 100
      },
      {
        cacheCreation: 0,
        cacheRead: 20,
        input: 40,
        output: 10,
        reasoning: 3,
        total: 50
      }
    ])
    expect(result.observations[0]).toMatchObject({
      id: `codex-history:external-session:${Date.parse(firstTimestamp)}:100`,
      modelId: 'gpt-5.6-sol',
      modelServiceId: 'openai',
      sessionId: 'external-session',
      toolId: 'codex'
    })
    expect(result.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'codex', kind: 'tool' }),
      expect.objectContaining({ id: 'openai', kind: 'model-service' }),
      expect.objectContaining({
        id: 'gpt-5.6-sol',
        kind: 'model',
        parent: { id: 'openai', kind: 'model-service' }
      })
    ]))
  })

  it('includes resumed sessions whose files remain in their original date directory', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'oneworks-codex-usage-'))
    tempDirs.push(codexHome)
    const originalTimestamp = '2026-06-24T10:00:00.000Z'
    const resumedTimestamp = '2026-07-29T10:00:00.000Z'
    await createHistoryFile(codexHome, originalTimestamp, 'resumed-session', [
      {
        timestamp: originalTimestamp,
        type: 'session_meta',
        payload: {
          id: 'resumed-session',
          model_provider: 'openai',
          originator: 'Codex Desktop'
        }
      },
      tokenCount(originalTimestamp, {
        cacheRead: 30,
        input: 80,
        output: 20,
        reasoning: 5,
        total: 100
      }),
      tokenCount(resumedTimestamp, {
        cacheRead: 50,
        input: 120,
        output: 30,
        reasoning: 8,
        total: 150
      })
    ])

    const result = await collectCodexUsage(
      { env: { CODEX_HOME: codexHome } },
      {
        from: Date.parse('2026-07-29T00:00:00.000Z'),
        to: Date.parse('2026-07-30T00:00:00.000Z')
      }
    )

    expect(result.observations).toEqual([
      expect.objectContaining({
        observedAt: Date.parse(resumedTimestamp),
        sessionId: 'resumed-session',
        tokens: {
          cacheCreation: 0,
          cacheRead: 20,
          input: 40,
          output: 10,
          reasoning: 3,
          total: 50
        }
      })
    ])
  })

  it('excludes One Works-owned Codex sessions to avoid double counting workspace ledger data', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'oneworks-codex-usage-'))
    tempDirs.push(codexHome)
    const timestamp = '2026-07-29T10:00:00.000Z'
    await createHistoryFile(codexHome, timestamp, 'oneworks-session', [
      {
        timestamp,
        type: 'session_meta',
        payload: {
          id: 'oneworks-session',
          model_provider: 'openai',
          originator: 'One Works'
        }
      },
      tokenCount(timestamp, {
        cacheRead: 0,
        input: 800,
        output: 200,
        reasoning: 0,
        total: 1_000
      })
    ])

    const result = await collectCodexUsage(
      { env: { CODEX_HOME: codexHome } },
      {
        from: Date.parse('2026-07-29T00:00:00.000Z'),
        to: Date.parse('2026-07-30T00:00:00.000Z')
      }
    )

    expect(result.observations).toEqual([])
    expect(result.coverage?.status).toBe('available')
  })

  it('reports an available source when Codex has no local history yet', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'oneworks-codex-usage-'))
    tempDirs.push(codexHome)

    const result = await collectCodexUsage(
      { env: { CODEX_HOME: codexHome } },
      {
        from: Date.parse('2026-07-29T00:00:00.000Z'),
        to: Date.parse('2026-07-30T00:00:00.000Z')
      }
    )

    expect(result.observations).toEqual([])
    expect(result.coverage).toMatchObject({
      label: 'Codex local history',
      status: 'available'
    })
  })

  it('fails closed when history cannot be attributed to a known originator', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'oneworks-codex-usage-'))
    tempDirs.push(codexHome)
    const timestamp = '2026-07-29T10:00:00.000Z'
    await createHistoryFile(codexHome, timestamp, 'unknown-session', [
      {
        timestamp,
        type: 'session_meta',
        payload: {
          id: 'unknown-session',
          model_provider: 'openai'
        }
      },
      tokenCount(timestamp, {
        cacheRead: 0,
        input: 80,
        output: 20,
        reasoning: 0,
        total: 100
      })
    ])

    const result = await collectCodexUsage(
      { env: { CODEX_HOME: codexHome } },
      {
        from: Date.parse('2026-07-29T00:00:00.000Z'),
        to: Date.parse('2026-07-30T00:00:00.000Z')
      }
    )

    expect(result.observations).toEqual([])
    expect(result.coverage).toMatchObject({
      status: 'partial'
    })
  })
})
