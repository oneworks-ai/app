import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchRelayAdminDiagnostics } from '../src/features/diagnostics/diagnosticsApi'
import type { RelayAdminDiagnosticEvent } from '../src/features/diagnostics/diagnosticsApi'
import {
  diagnosticOutcomeTone,
  diagnosticUserLabel,
  formatDiagnosticDuration
} from '../src/features/diagnostics/diagnosticsModel'

afterEach(() => {
  vi.unstubAllGlobals()
})

const event: RelayAdminDiagnosticEvent = {
  category: 'startup',
  durationMs: 1_250,
  errorCode: 'renderer.ready_timeout',
  eventName: 'oneworks.diagnostic.operation.completed',
  id: 'event-1',
  occurredAt: '2026-08-09T00:00:00.000Z',
  outcome: 'timeout',
  receivedAt: '2026-08-09T00:00:01.000Z',
  serviceName: 'oneworks-desktop',
  severity: 'ERROR',
  source: 'oneworks',
  userId: 'user-1'
}

describe('relay admin diagnostics', () => {
  it('formats diagnostic facts for product and support analysis', () => {
    expect(formatDiagnosticDuration(event.durationMs)).toBe('1.25 s')
    expect(diagnosticOutcomeTone(event)).toBe('danger')
    expect(diagnosticUserLabel(event, [{ email: 'user@example.com', id: 'user-1', name: 'User One' }]))
      .toBe('User One')
  })

  it('encodes replayable filters and cursor pagination in the admin request', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          events: [],
          retention: { days: 30, maxEvents: 10_000 },
          series: [],
          summary: {
            affectedUsers: 0,
            byFailure: {},
            byFingerprint: {},
            byOutcome: {},
            byPlatform: {},
            bySource: {},
            byVersion: {},
            errorEvents: 0,
            startup: {},
            total: 0
          },
          users: []
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchRelayAdminDiagnostics('admin-token', {
      cursor: 'next-page',
      outcome: 'timeout',
      platform: 'darwin',
      q: 'renderer',
      serviceVersion: '1.2.3',
      userId: 'user-1'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/diagnostics?cursor=next-page&outcome=timeout&platform=darwin&q=renderer&serviceVersion=1.2.3&userId=user-1',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer admin-token' })
      })
    )
  })
})
