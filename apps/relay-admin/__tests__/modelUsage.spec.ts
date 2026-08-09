import { readFile } from 'node:fs/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchRelayAdminModelUsage,
  fetchRelayAdminTeamModelUsage,
  fetchRelayProfileModelUsage
} from '../src/features/teams/teamModelUsageApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relay admin team Model Service usage', () => {
  it('uses the unified profile data and diagnostics route without a development-time usage alias', async () => {
    const source = await readFile(new URL('../src/features/profile/ProfilePage.tsx', import.meta.url), 'utf8')

    expect(source).toContain("'diagnostics'")
    expect(source).toContain("profileTabLabel('monitor_heart', '数据与诊断')")
    expect(source).not.toContain("key: 'usage'")
  })

  it('encodes the team path and replayable usage filters', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
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
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await fetchRelayAdminTeamModelUsage('admin-token', 'team / 上海', {
      cursor: 'next page',
      from: '2026-07-01T00:00:00.000Z',
      modelService: 'openai-main',
      q: 'gpt 5',
      source: 'oneworks',
      userId: 'user-1'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/teams/team%20%2F%20%E4%B8%8A%E6%B5%B7/model-usage?cursor=next+page&from=2026-07-01T00%3A00%3A00.000Z&modelService=openai-main&q=gpt+5&source=oneworks&userId=user-1',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer admin-token' })
      })
    )

    await fetchRelayAdminTeamModelUsage('team-token', 'team-1', { source: 'codex' }, 'relay')
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/relay/teams/team-1/model-usage?source=codex',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer team-token' })
      })
    )

    await fetchRelayAdminModelUsage('admin-token', {
      modelService: 'anthropic-main',
      teamId: 'team-2'
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/admin/model-usage?modelService=anthropic-main&teamId=team-2',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer admin-token' })
      })
    )

    await fetchRelayProfileModelUsage('user-token', { modelService: 'openai-main', source: 'codex' })
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/profile/model-usage?modelService=openai-main&source=codex',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer user-token' })
      })
    )
  })
})
