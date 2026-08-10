import { readFile } from 'node:fs/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchRelayDataDashboardOverview } from '../src/features/data-dashboard/dataDashboardApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

const diagnosticsResponse = {
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
    startup: { attempts: 0 },
    total: 0
  },
  users: []
}

const modelUsageResponse = {
  events: [],
  retention: { days: 90, maxEvents: 100_000 },
  series: [],
  summary: {
    activeUsers: 0,
    byAdapter: {},
    byModel: {},
    byModelService: {},
    bySource: {},
    byTeam: {},
    byUser: {},
    cacheCreationInputTokens: 0,
    cachedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    requests: 0,
    totalTokens: 0
  },
  teams: [],
  users: []
}

describe('relay admin data dashboard', () => {
  it('loads the observed daily, weekly, monthly, and Model Service windows together', async () => {
    const fetchMock = vi.fn(async (path: string) =>
      new Response(
        JSON.stringify(path.startsWith('/api/admin/model-usage') ? modelUsageResponse : diagnosticsResponse),
        { headers: { 'content-type': 'application/json' }, status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const overview = await fetchRelayDataDashboardOverview(
      'admin-token',
      new Date('2026-08-10T12:00:00.000Z')
    )

    expect(overview.observedAt).toBe('2026-08-10T12:00:00.000Z')

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/admin/diagnostics?from=2026-08-10T00%3A00%3A00.000Z&limit=1',
      '/api/admin/diagnostics?from=2026-08-03T12%3A00%3A00.000Z&limit=1',
      '/api/admin/diagnostics?from=2026-07-11T12%3A00%3A00.000Z&limit=1',
      '/api/admin/model-usage?from=2026-07-11T12%3A00%3A00.000Z&limit=1'
    ])
  })

  it('keeps one sidebar section and stable URL tabs without legacy top-level dashboard routes', async () => {
    const [appSource, sidebarSource, pageSource] = await Promise.all([
      readFile(new URL('../src/app/AdminApp.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/app/useAdminSidebarItems.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/data-dashboard/DataDashboardPage.tsx', import.meta.url), 'utf8')
    ])

    expect(sidebarSource).toContain("label: '数据看板'")
    expect(sidebarSource).toContain("path: '/data-dashboard'")
    expect(sidebarSource).not.toContain("path: '/diagnostics'")
    expect(sidebarSource).not.toContain("path: '/model-usage'")
    expect(appSource).toContain("path='data-dashboard/:dashboardTab'")
    expect(appSource).not.toContain("path='diagnostics'")
    expect(appSource).not.toContain("path='model-usage'")
    expect(pageSource).toContain("['overview', 'stability', 'model-service']")
  })
})
