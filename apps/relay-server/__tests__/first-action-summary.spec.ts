import { describe, expect, it } from 'vitest'

import { summarizeFirstActionEvents } from '../src/diagnostics/first-action-summary.js'
import type { RelayDiagnosticEvent } from '../src/types.js'

const event = (
  id: string,
  occurredAt: string,
  input: Partial<RelayDiagnosticEvent> = {}
): RelayDiagnosticEvent => ({
  category: 'first-action',
  eventName: 'oneworks.diagnostic.operation.stage',
  id,
  occurredAt,
  operationId: 'operation-1',
  receivedAt: occurredAt,
  serviceName: 'oneworks-desktop',
  severity: 'INFO',
  source: 'oneworks',
  userId: 'user-1',
  ...input
})

describe('first-action diagnostic summary', () => {
  it('excludes right-censored in-flight attempts from the success-rate denominator', () => {
    const summary = summarizeFirstActionEvents([
      event('startup', '2026-08-09T00:00:00.000Z', {
        category: 'startup',
        eventName: 'oneworks.diagnostic.operation.started',
        operationId: 'startup-1',
        sessionId: 'app-session-1'
      }),
      event('success-started', '2026-08-09T00:00:01.000Z', {
        eventName: 'oneworks.diagnostic.operation.started',
        operationId: 'first-action-success',
        sessionId: 'app-session-1'
      }),
      event('success-stage', '2026-08-09T00:00:01.200Z', {
        operationId: 'first-action-success',
        sessionId: 'app-session-1',
        stage: 'first.success'
      }),
      event('success-completed', '2026-08-09T00:00:01.300Z', {
        eventName: 'oneworks.diagnostic.operation.completed',
        operationId: 'first-action-success',
        outcome: 'success',
        sessionId: 'app-session-1',
        stage: 'first.success'
      }),
      event('pending-started', '2026-08-09T00:00:02.000Z', {
        eventName: 'oneworks.diagnostic.operation.started',
        operationId: 'first-action-pending'
      }),
      event('failed-started', '2026-08-09T00:00:03.000Z', {
        eventName: 'oneworks.diagnostic.operation.started',
        operationId: 'first-action-failed'
      }),
      event('failed-completed', '2026-08-09T00:00:03.400Z', {
        eventName: 'oneworks.diagnostic.operation.completed',
        operationId: 'first-action-failed',
        outcome: 'timeout'
      })
    ])

    expect(summary).toMatchObject({
      appStartToSubmit: { p50DurationMs: 1000, p95DurationMs: 1000 },
      attempts: 3,
      pendingAttempts: 1,
      submitToSuccess: { p50DurationMs: 200, p95DurationMs: 200 },
      successRate: 0.5,
      terminalAttempts: 2
    })
  })
})
