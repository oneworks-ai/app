import { describe, expect, it, vi } from 'vitest'

import { createModelUsageClient } from '../src/index.js'
import { OtlpHttpDiagnosticExporter } from '../src/node.js'

describe('model usage metering', () => {
  it('normalizes counters and rejects content-like dimensions', () => {
    const exported: unknown[] = []
    const client = createModelUsageClient({
      createId: () => 'event-1',
      exporters: [{
        exportModelUsage: event => {
          exported.push(event)
        }
      }],
      now: () => new Date('2026-08-09T02:00:00.000Z'),
      resource: { serviceName: 'oneworks-server', surface: 'server' }
    })

    const event = client.record({
      adapter: 'codex',
      cacheCreationInputTokens: 5,
      cachedInputTokens: 120,
      context: { agentSessionId: 'private-session' },
      inputTokens: 800,
      model: 'openai/gpt-5.6',
      modelService: 'team-openai',
      outputTokens: 240
    })

    expect(event).toMatchObject({
      cacheCreationInputTokens: 5,
      cachedInputTokens: 120,
      eventId: 'event-1',
      inputTokens: 800,
      model: 'openai/gpt-5.6',
      modelService: 'team-openai',
      outputTokens: 240,
      requestCount: 1,
      success: true
    })
    expect(exported).toEqual([event])
    expect(() => client.record({ model: 'https://private.example/model', modelService: 'service' })).toThrow(
      'content-free identifier'
    )
  })

  it('exports the safe OneWorks OTLP model usage contract', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response('{}', { status: 200 })
    )
    const exporter = new OtlpHttpDiagnosticExporter({
      batchSize: 1,
      endpoint: 'https://collector.example/v1/logs',
      fetch
    })
    const client = createModelUsageClient({
      exporters: [exporter],
      resource: {
        serviceName: 'oneworks-server',
        serviceVersion: '1.2.3',
        surface: 'server'
      }
    })

    client.record({
      adapter: 'claude-code',
      cachedInputTokens: 40,
      inputTokens: 100,
      model: 'claude-sonnet-4',
      modelService: 'anthropic-team',
      outputTokens: 25
    })
    await client.flush()

    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    const serialized = JSON.stringify(request)
    expect(serialized).toContain('oneworks.model.usage')
    expect(serialized).toContain('gen_ai.usage.input_tokens')
    expect(serialized).toContain('anthropic-team')
    expect(serialized).not.toContain('prompt')
  })
})
