import { describe, expect, it } from 'vitest'

import type { UsageObservation, UsageReport } from '@oneworks/types'

import { createUsageHeatmapDays, createUsageRangeStart, shouldShowUsageFilter } from '#~/components/usage/UsagePanel'

const report = {
  activity: [],
  coverage: [],
  facets: {},
  generatedAt: 0,
  observations: [],
  query: {},
  resources: [],
  summary: {}
} as unknown as UsageReport

describe('usage heatmap range', () => {
  it('matches the number of days selected by the user', () => {
    const days30 = createUsageHeatmapDays(report, 30)
    const days365 = createUsageHeatmapDays(report, 365)

    expect(days30).toHaveLength(30)
    expect(days365).toHaveLength(365)
    expect(days30.at(-1)?.date.toDateString()).toBe(new Date().toDateString())
    expect(days365.at(-1)?.date.toDateString()).toBe(new Date().toDateString())
  })

  it('uses the same calendar-day boundary for the query and heatmap', () => {
    const now = new Date(2026, 2, 29, 16, 45)
    const days = createUsageHeatmapDays(report, 30, now)

    expect(days[0]?.date.getTime()).toBe(createUsageRangeStart(30, now))
    expect(days.at(-1)?.date.toDateString()).toBe(now.toDateString())
    expect(days[0]?.date.getHours()).toBe(0)
  })
})

describe('usage filter visibility', () => {
  const observation = {
    aggregationMode: 'delta',
    id: 'plugin-usage',
    observedAt: 1,
    provenance: {
      authorityPlugin: { id: 'relay-source' },
      origin: 'plugin'
    },
    quality: 'reported',
    tokens: {
      cacheCreation: 0,
      cacheRead: 0,
      input: 1,
      output: 0,
      reasoning: 0,
      total: 1
    },
    toolId: 'codex'
  } satisfies UsageObservation

  it('shows a single attributed value when unattributed usage is also present', () => {
    const mixedReport = {
      ...report,
      facets: {
        authorityPlugin: [{
          id: 'relay-source',
          label: 'Relay source',
          observationCount: 1,
          total: 1
        }]
      },
      observations: [
        observation,
        {
          ...observation,
          id: 'local-usage',
          provenance: { origin: 'local' }
        }
      ],
      summary: { observationCount: 2 }
    } as UsageReport

    expect(shouldShowUsageFilter(mixedReport, 'authorityPlugin', false)).toBe(true)
    expect(shouldShowUsageFilter(
      {
        ...mixedReport,
        observations: [observation],
        summary: { ...mixedReport.summary, observationCount: 1 }
      },
      'authorityPlugin',
      false
    )).toBe(false)
  })
})
