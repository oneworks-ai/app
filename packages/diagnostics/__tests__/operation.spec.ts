import { describe, expect, it, vi } from 'vitest'

import { createDiagnosticClient, diagnosticFailureFromError } from '@oneworks/diagnostics'
import type { DiagnosticEvent, DiagnosticExporter } from '@oneworks/diagnostics'

const createClock = (timestamps: string[]) => {
  let index = 0
  return () => new Date(timestamps[Math.min(index++, timestamps.length - 1)]!)
}

const createIds = () => {
  let index = 0
  return () => `id-${++index}`
}

describe('diagnostic operations', () => {
  it('records started, staged, ready, and stable lifecycle facts', () => {
    const events: DiagnosticEvent[] = []
    const client = createDiagnosticClient({
      context: {
        appSessionId: 'app-session-1',
        startupId: 'startup-1'
      },
      createId: createIds(),
      exporters: [{
        export: event => {
          events.push(event)
        }
      }],
      now: createClock([
        '2026-08-09T00:00:00.000Z',
        '2026-08-09T00:00:00.100Z',
        '2026-08-09T00:00:00.350Z',
        '2026-08-09T00:00:00.400Z',
        '2026-08-09T00:00:30.400Z'
      ]),
      resource: {
        environment: 'test',
        serviceName: 'oneworks-desktop',
        surface: 'desktop'
      }
    })

    const operation = client.startOperation('oneworks.app.startup')
    operation.stage('desktop.state.ready')
    operation.ready('renderer.interactive')
    operation.stable()

    expect(events.map(event => event.kind)).toEqual([
      'operation.started',
      'operation.stage',
      'operation.stage',
      'operation.ready',
      'operation.completed'
    ])
    expect(events[1]?.operation.stageDurationMs).toBe(100)
    expect(events[2]?.operation.stageDurationMs).toBe(250)
    expect(events[3]?.operation.readyAt).toBe('2026-08-09T00:00:00.400Z')
    expect(events[3]?.operation.durationMs).toBe(400)
    expect(events[4]?.operation).toMatchObject({
      durationMs: 30400,
      outcome: 'success',
      stage: 'renderer.interactive'
    })
    expect(events.every(event => event.dataClass === 'restricted')).toBe(true)
  })

  it('completes only once and ignores later stages', () => {
    const events: DiagnosticEvent[] = []
    const client = createDiagnosticClient({
      createId: createIds(),
      exporters: [{
        export: event => {
          events.push(event)
        }
      }],
      now: createClock([
        '2026-08-09T00:00:00.000Z',
        '2026-08-09T00:00:01.000Z'
      ]),
      resource: {
        serviceName: 'oneworks-server',
        surface: 'server'
      }
    })

    const operation = client.startOperation('oneworks.server.startup')
    operation.succeed()

    expect(operation.fail({ code: 'server.failed', domain: 'server' })).toBeUndefined()
    expect(operation.stage('server.late')).toBeUndefined()
    expect(events).toHaveLength(2)
    expect(events[1]?.operation.outcome).toBe('success')
  })

  it('keeps raw error messages and stacks out of failure facts', () => {
    const failure = diagnosticFailureFromError(
      new TypeError('secret token sk-do-not-export'),
      {
        code: 'config.load_failed',
        domain: 'config',
        retryable: true
      }
    )

    expect(failure).toEqual({
      code: 'config.load_failed',
      domain: 'config',
      retryable: true,
      type: 'TypeError'
    })
    expect(JSON.stringify(failure)).not.toContain('secret token')
  })

  it('drops unsafe custom error types and rejects unsafe failure codes', () => {
    const customError = new Error('safe message')
    customError.name = 'token=secret value'
    expect(diagnosticFailureFromError(customError, {
      code: 'config.load_failed',
      domain: 'config'
    })).toEqual({
      code: 'config.load_failed',
      domain: 'config'
    })

    const client = createDiagnosticClient({
      resource: {
        serviceName: 'oneworks-test',
        surface: 'test'
      }
    })
    const operation = client.startOperation('oneworks.test.run')
    expect(() =>
      operation.fail({
        code: '/private/workspace/token',
        domain: 'unknown'
      })
    ).toThrow('stable lowercase dotted identifier')
    expect(operation.isTerminal()).toBe(false)
  })

  it('isolates exporter failures and flushes asynchronous exporters', async () => {
    const onExporterError = vi.fn()
    let resolveExport: (() => void) | undefined
    const asyncExporter: DiagnosticExporter = {
      export: () =>
        new Promise<void>(resolve => {
          resolveExport = resolve
        })
    }
    const client = createDiagnosticClient({
      createId: createIds(),
      exporters: [
        {
          export: () => {
            throw new Error('unavailable')
          }
        },
        asyncExporter
      ],
      onExporterError,
      resource: {
        serviceName: 'oneworks-test',
        surface: 'test'
      }
    })

    client.startOperation('oneworks.test.run')
    const flushed = client.flush()
    resolveExport?.()
    await flushed

    expect(onExporterError).toHaveBeenCalledOnce()
  })

  it('rejects names that could contain paths or user content', () => {
    const client = createDiagnosticClient({
      resource: {
        serviceName: 'oneworks-test',
        surface: 'test'
      }
    })

    expect(() => client.startOperation('/Users/example/workspace')).toThrow('stable lowercase dotted identifier')
  })
})
