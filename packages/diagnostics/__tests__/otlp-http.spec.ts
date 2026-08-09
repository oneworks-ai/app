import { describe, expect, it, vi } from 'vitest'

import { createDiagnosticClient } from '@oneworks/diagnostics'
import { OtlpHttpDiagnosticExporter, createOtlpHttpDiagnosticExporterFromEnv } from '@oneworks/diagnostics/node'

describe('otlp HTTP diagnostic exporter', () => {
  it('exports privacy-safe operation events as OTLP JSON logs', async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ input: String(input), init })
      return new Response('{}', { status: 200 })
    }) as typeof globalThis.fetch
    const exporter = new OtlpHttpDiagnosticExporter({
      batchSize: 2,
      endpoint: 'https://collector.example/v1/logs',
      fetch,
      headers: { authorization: 'Bearer opaque-token' }
    })
    const client = createDiagnosticClient({
      context: { startupId: 'startup-private-id' },
      createId: (() => {
        let index = 0
        return () => `event-${++index}`
      })(),
      exporters: [exporter],
      resource: {
        architecture: 'arm64',
        environment: 'test',
        platform: 'darwin',
        releaseChannel: 'stable',
        serviceName: 'oneworks-test',
        serviceVersion: '1.2.3',
        surface: 'test'
      }
    })

    const operation = client.startOperation('oneworks.test.run', { operationId: 'operation-1' })
    operation.succeed()
    await client.flush()

    expect(requests).toHaveLength(1)
    expect(requests[0]?.input).toBe('https://collector.example/v1/logs')
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer opaque-token',
      'content-type': 'application/json'
    })
    const body = JSON.parse(String(requests[0]?.init?.body)) as {
      resourceLogs: Array<{
        resource: { attributes: Array<{ key: string; value: { stringValue?: string } }> }
        scopeLogs: Array<{ logRecords: Array<{ attributes: Array<{ key: string }> }> }>
      }>
    }
    expect(body.resourceLogs).toHaveLength(2)
    expect(body.resourceLogs[0]?.resource.attributes).toContainEqual({
      key: 'service.name',
      value: { stringValue: 'oneworks-test' }
    })
    expect(body.resourceLogs[0]?.resource.attributes).toContainEqual({
      key: 'os.type',
      value: { stringValue: 'darwin' }
    })
    expect(body.resourceLogs[1]?.scopeLogs[0]?.logRecords[0]?.attributes).toContainEqual({
      key: 'oneworks.operation.outcome',
      value: { stringValue: 'success' }
    })
  })

  it('uses standard OTLP environment variables and JSON protocol', () => {
    const exporter = createOtlpHttpDiagnosticExporterFromEnv({
      env: {
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://relay.example/otel/',
        OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20token,x-oneworks-device-id=device-1',
        OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json'
      }
    })
    expect(exporter).toBeInstanceOf(OtlpHttpDiagnosticExporter)
    expect(createOtlpHttpDiagnosticExporterFromEnv({
      env: {
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://relay.example/v1/logs',
        OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/protobuf'
      }
    })).toBeUndefined()
  })

  it('overrides the team scope per exporter without leaking a static team header into personal usage', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response('{}', { status: 200 })
    )
    const personal = createOtlpHttpDiagnosticExporterFromEnv({
      env: {
        OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20token,X-OneWorks-Team-Id=static-team',
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://relay.example/v1/logs'
      },
      fetch: fetchMock as typeof globalThis.fetch,
      headerOverrides: { 'x-oneworks-team-id': undefined }
    })
    const team = createOtlpHttpDiagnosticExporterFromEnv({
      env: {
        OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer%20token,X-OneWorks-Team-Id=static-team',
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://relay.example/v1/logs'
      },
      fetch: fetchMock as typeof globalThis.fetch,
      headerOverrides: { 'x-oneworks-team-id': 'team-2' }
    })
    const event = {
      context: {},
      eventId: 'event-1',
      inputTokens: 1,
      model: 'gpt-5',
      modelService: 'openai',
      outputTokens: 1,
      source: 'oneworks' as const
    }

    personal?.exportModelUsage({
      ...event,
      cacheCreationInputTokens: 0,
      cachedInputTokens: 0,
      occurredAt: new Date(0).toISOString(),
      requestCount: 1,
      resource: { serviceName: 'test', surface: 'test' },
      schemaVersion: 1,
      success: true
    })
    team?.exportModelUsage({
      ...event,
      cacheCreationInputTokens: 0,
      cachedInputTokens: 0,
      occurredAt: new Date(0).toISOString(),
      requestCount: 1,
      resource: { serviceName: 'test', surface: 'test' },
      schemaVersion: 1,
      success: true
    })
    await personal?.flush()
    await team?.flush()

    const personalHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    const teamHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>
    expect(Object.keys(personalHeaders).map(key => key.toLowerCase())).not.toContain('x-oneworks-team-id')
    expect(teamHeaders['x-oneworks-team-id']).toBe('team-2')
  })

  it('retries transient status codes without retrying permanent failures', async () => {
    const transientFetch = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) as typeof globalThis.fetch
    const transient = new OtlpHttpDiagnosticExporter({
      delay: async () => {},
      endpoint: 'https://collector.example/v1/logs',
      fetch: transientFetch
    })
    const client = createDiagnosticClient({
      exporters: [transient],
      resource: { serviceName: 'oneworks-test', surface: 'test' }
    })
    client.startOperation('oneworks.test.run')
    await client.flush()
    expect(transientFetch).toHaveBeenCalledTimes(2)

    const onError = vi.fn()
    const permanentFetch = vi.fn(async () => new Response('{}', { status: 400 })) as typeof globalThis.fetch
    const permanent = new OtlpHttpDiagnosticExporter({
      endpoint: 'https://collector.example/v1/logs',
      fetch: permanentFetch,
      onError
    })
    const secondClient = createDiagnosticClient({
      exporters: [permanent],
      resource: { serviceName: 'oneworks-test', surface: 'test' }
    })
    secondClient.startOperation('oneworks.test.run')
    await secondClient.flush()
    expect(permanentFetch).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledOnce()
  })
})
