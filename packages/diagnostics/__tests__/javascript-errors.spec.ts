import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  createDiagnosticClient,
  createJavaScriptErrorReport,
  createJavaScriptErrorReporter,
  parseJavaScriptErrorReport,
  recordJavaScriptError
} from '@oneworks/diagnostics'
import type { DiagnosticEvent } from '@oneworks/diagnostics'

describe('javascript error diagnostics', () => {
  it('creates a stable content-free fingerprint without retaining messages or stacks', () => {
    const first = new TypeError('secret token sk-private')
    first.stack = `TypeError: secret token sk-private\n    at render (/Users/private/project/App.tsx:42:9)`
    const second = new TypeError('different private message')
    second.stack = `TypeError: different private message\n    at render (/home/another/build/App.tsx:91:2)`

    const firstReport = createJavaScriptErrorReport(first, {
      serviceVersion: '1.2.3',
      source: 'client.react_render',
      surface: 'web'
    })
    const secondReport = createJavaScriptErrorReport(second, {
      serviceVersion: '1.2.3',
      source: 'client.react_render',
      surface: 'web'
    })

    expect(firstReport).toEqual(secondReport)
    expect(firstReport.fingerprint).toMatch(/^js_[a-f0-9]{16}$/u)
    expect(firstReport.fingerprint).toBe(`js_${
      createHash('sha256')
        .update('client.react_render\nTypeError\nat render (<path>/App.tsx:#)\n')
        .digest('hex')
        .slice(0, 16)
    }`)
    expect(JSON.stringify(firstReport)).not.toContain('secret token')
    expect(JSON.stringify(firstReport)).not.toContain('/Users/private')
  })

  it('validates the complete bounded transport contract', () => {
    const report = createJavaScriptErrorReport(new Error('private'), {
      source: 'client.window_error',
      surface: 'pwa'
    })

    expect(parseJavaScriptErrorReport(report)).toEqual(report)
    expect(parseJavaScriptErrorReport({ ...report, fingerprint: 'raw stack' })).toBeUndefined()
    expect(parseJavaScriptErrorReport({ ...report, source: '/private/path' })).toBeUndefined()
    expect(parseJavaScriptErrorReport({ ...report, extra: 'ignored secret' })).toEqual(report)
  })

  it('deduplicates bursts and rate limits unique exception storms', async () => {
    let timestamp = 0
    const send = vi.fn()
    const reporter = createJavaScriptErrorReporter({
      dedupeWindowMs: 5_000,
      maxReportsPerMinute: 2,
      now: () => timestamp,
      send
    })
    const error = new Error('private')
    error.stack = 'Error: private\n    at render (app.js:1:1)'

    expect(reporter.capture(error, { source: 'client.window_error', surface: 'web' }).status).toBe('reported')
    timestamp = 100
    expect(reporter.capture(error, { source: 'client.window_error', surface: 'web' }).status).toBe('deduplicated')
    timestamp = 6_000
    expect(reporter.capture(error, { source: 'client.window_error', surface: 'web' }).status).toBe('reported')
    timestamp = 7_000
    expect(
      reporter.capture(error, {
        fingerprintMaterial: 'different-frame',
        source: 'client.window_error',
        surface: 'web'
      }).status
    ).toBe('rate_limited')
    await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('records the source, safe type, and fingerprint as a failed operation', () => {
    const events: DiagnosticEvent[] = []
    const client = createDiagnosticClient({
      exporters: [{
        export: event => {
          events.push(event)
        }
      }],
      resource: { serviceName: 'oneworks-client', surface: 'web' }
    })
    const report = createJavaScriptErrorReport(new TypeError('private content'), {
      source: 'client.unhandled_rejection',
      surface: 'web'
    })

    recordJavaScriptError(client, report)

    expect(events.map(event => event.kind)).toEqual([
      'operation.started',
      'operation.stage',
      'operation.completed'
    ])
    expect(events.at(-1)?.operation).toMatchObject({
      failure: {
        code: 'javascript.client_unhandled_rejection',
        domain: 'client',
        fingerprint: report.fingerprint,
        type: 'TypeError'
      },
      outcome: 'error',
      stage: 'client.unhandled_rejection'
    })
    expect(JSON.stringify(events)).not.toContain('private content')
  })
})
