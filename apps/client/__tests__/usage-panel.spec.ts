import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { UsageFacetOption, UsageObservation, UsageReport } from '@oneworks/types'

import {
  createUsageDateRange,
  createUsageHeatmapDays,
  createUsageHeatmapWeeks,
  createUsageRangeStart,
  getUsageHeatLevel,
  getUsageHeatmapLatestScrollLeft,
  resolveUsageHeatmapSelection
} from '#~/components/usage/@core/usage-heatmap'
import {
  USAGE_GLOBAL_WORKSPACE_SCOPE_ID,
  createDefaultUsageWorkspaceSelection,
  createUsageWorkspaceScopeOptions,
  resolveUsagePanelDataScope,
  resolveUsageReportContext,
  resolveUsageWorkspaceSelectionChange,
  toggleUsageWorkspaceSelection
} from '#~/components/usage/@core/usage-workspace-scope'
import {
  createUsageSearchResults,
  resolveUsageBreakdownIcon,
  shouldShowUsageFilter
} from '#~/components/usage/UsagePanel'

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
  it('always renders the most recent 365 calendar days', () => {
    const days30 = createUsageHeatmapDays(report, 30)
    const days365 = createUsageHeatmapDays(report)

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

  it('aligns the year into Sunday-first week columns with month labels', () => {
    const days = createUsageHeatmapDays(report, 365, new Date(2026, 6, 30, 16, 45))
    const weeks = createUsageHeatmapWeeks(days, 'en-US')

    expect(weeks).toHaveLength(53)
    expect(weeks[0]?.days[4]?.date.toDateString()).toBe(days[0]?.date.toDateString())
    expect(weeks.some(week => week.monthLabel === 'Aug')).toBe(true)
    expect(weeks.at(-1)?.days[4]?.date.toDateString()).toBe(days.at(-1)?.date.toDateString())
  })

  it('starts a horizontally overflowing year at the latest date', () => {
    expect(getUsageHeatmapLatestScrollLeft({
      clientWidth: 690,
      scrollWidth: 773
    })).toBe(83)
    expect(getUsageHeatmapLatestScrollLeft({
      clientWidth: 773,
      scrollWidth: 773
    })).toBe(0)
  })

  it('uses distribution ranks for four stable intensity levels', () => {
    const totals = [0, 1, 10, 100, 1_000]

    expect(getUsageHeatLevel(0, totals)).toBe(0)
    expect(getUsageHeatLevel(1, totals)).toBe(1)
    expect(getUsageHeatLevel(10, totals)).toBe(2)
    expect(getUsageHeatLevel(100, totals)).toBe(3)
    expect(getUsageHeatLevel(1_000, totals)).toBe(4)
  })

  it('selects one day, toggles it off, and caps shift ranges at one month', () => {
    const days = createUsageHeatmapDays(report, 365, new Date(2026, 6, 30, 16, 45))
    const first = resolveUsageHeatmapSelection({
      days,
      index: 10,
      shiftKey: false
    })
    const cleared = resolveUsageHeatmapSelection({
      anchorIndex: first.anchorIndex,
      current: first.range,
      days,
      index: 10,
      shiftKey: false
    })
    const range = resolveUsageHeatmapSelection({
      anchorIndex: first.anchorIndex,
      current: first.range,
      days,
      index: 100,
      shiftKey: true
    })

    expect(first.range).toEqual(createUsageDateRange(days[10]!, days[10]!))
    expect(cleared.range).toBeUndefined()
    expect(range.range).toEqual(createUsageDateRange(days[10]!, days[40]!))
  })
})

describe('usage workspace scope', () => {
  const currentWorkspaceId = 'w_current1234'
  const otherWorkspaceId = 'w_other123456'
  const options = createUsageWorkspaceScopeOptions(
    {
      recentProjects: [],
      runningProjects: [
        {
          description: '/projects/other',
          name: 'Other project',
          workspaceFolder: '/projects/other',
          workspaceId: otherWorkspaceId
        },
        {
          description: '/projects/current',
          isCurrent: true,
          name: 'Current project',
          workspaceFolder: '/projects/current',
          workspaceId: currentWorkspaceId
        }
      ]
    },
    currentWorkspaceId,
    'Current workspace'
  )

  it('defaults to the current workspace and keeps it first in the selector', () => {
    expect(createDefaultUsageWorkspaceSelection(currentWorkspaceId)).toEqual([
      currentWorkspaceId
    ])
    expect(options.map(option => option.id)).toEqual([
      currentWorkspaceId,
      otherWorkspaceId
    ])
  })

  it('supports exclusive global scope and non-empty workspace multi-selection', () => {
    const global = toggleUsageWorkspaceSelection(
      [currentWorkspaceId],
      USAGE_GLOBAL_WORKSPACE_SCOPE_ID
    )
    const other = toggleUsageWorkspaceSelection(global, otherWorkspaceId)
    const multiple = toggleUsageWorkspaceSelection(other, currentWorkspaceId)

    expect(global).toEqual([USAGE_GLOBAL_WORKSPACE_SCOPE_ID])
    expect(other).toEqual([otherWorkspaceId])
    expect(multiple).toEqual([otherWorkspaceId, currentWorkspaceId])
    expect(toggleUsageWorkspaceSelection(multiple, otherWorkspaceId)).toEqual([
      currentWorkspaceId
    ])
    expect(toggleUsageWorkspaceSelection([currentWorkspaceId], currentWorkspaceId))
      .toEqual([currentWorkspaceId])
  })

  it('normalizes standard multi-select changes through the global exclusivity rules', () => {
    expect(resolveUsageWorkspaceSelectionChange(
      [currentWorkspaceId],
      [currentWorkspaceId, USAGE_GLOBAL_WORKSPACE_SCOPE_ID]
    )).toEqual([USAGE_GLOBAL_WORKSPACE_SCOPE_ID])
    expect(resolveUsageWorkspaceSelectionChange(
      [USAGE_GLOBAL_WORKSPACE_SCOPE_ID],
      [USAGE_GLOBAL_WORKSPACE_SCOPE_ID, otherWorkspaceId]
    )).toEqual([otherWorkspaceId])
    expect(resolveUsageWorkspaceSelectionChange(
      [currentWorkspaceId],
      []
    )).toEqual([currentWorkspaceId])
  })

  it('keeps the current workspace local and routes global or multi-project reports through Launcher', () => {
    expect(resolveUsagePanelDataScope([currentWorkspaceId], currentWorkspaceId))
      .toBeUndefined()
    expect(resolveUsageReportContext('workspace')).toEqual({
      query: { scope: 'workspace' },
      surface: 'workspace'
    })
    expect(resolveUsageReportContext(
      'workspace',
      resolveUsagePanelDataScope(
        [currentWorkspaceId, otherWorkspaceId],
        currentWorkspaceId
      )
    )).toEqual({
      query: {
        scope: 'all',
        workspaces: [currentWorkspaceId, otherWorkspaceId]
      },
      surface: 'launcher'
    })
    expect(resolveUsageReportContext(
      'workspace',
      resolveUsagePanelDataScope(
        [USAGE_GLOBAL_WORKSPACE_SCOPE_ID],
        currentWorkspaceId
      )
    )).toEqual({
      query: { scope: 'all' },
      surface: 'launcher'
    })
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

describe('usage search results', () => {
  const searchReport = {
    ...report,
    facets: {
      account: [{
        id: 'kimi-plan',
        label: 'Kimi 套餐',
        observationCount: 8,
        resource: {
          authorityPlugin: {
            id: 'relay',
            label: 'OneWorks Relay'
          },
          id: 'kimi-plan',
          kind: 'account',
          label: 'Kimi 套餐'
        },
        total: 80
      }],
      authorityPlugin: [{
        id: 'relay',
        label: 'OneWorks Relay',
        observationCount: 8,
        total: 80
      }],
      modelService: [{
        id: 'openai',
        label: 'OpenAI',
        observationCount: 12,
        total: 120
      }],
      tool: [{
        id: 'codex',
        label: 'Codex',
        observationCount: 12,
        total: 120
      }]
    }
  } as UsageReport

  it('matches usage facets without leaving the usage page', () => {
    expect(createUsageSearchResults(searchReport, 'Codex')).toEqual([
      expect.objectContaining({
        filterKey: 'tool',
        option: expect.objectContaining({ id: 'codex' })
      })
    ])
    expect(createUsageSearchResults(searchReport, 'Relay').map(result => result.filterKey))
      .toEqual(['account', 'authorityPlugin'])
    expect(createUsageSearchResults(searchReport, 'Codex', ['tool'])).toEqual([])
  })
})

describe('usage panel layout contract', () => {
  it('uses the panel gap as the section spacing owner', () => {
    const component = readFileSync(
      new URL('../src/components/usage/UsagePanel.tsx', import.meta.url),
      'utf8'
    )
    const stylesheet = readFileSync(
      new URL('../src/components/usage/UsagePanel.scss', import.meta.url),
      'utf8'
    )

    expect(stylesheet).toMatch(/\.usage-panel\s*\{[^}]*display:\s*flex/u)
    expect(stylesheet).toMatch(
      /\.usage-panel\s*\{[^}]*gap:\s*var\(--subpage-tertiary-gap,\s*10px\);/u
    )
    expect(stylesheet).toMatch(
      /\.usage-panel__activity\s*\{[^}]*gap:\s*var\(--subpage-tertiary-gap,\s*10px\);/u
    )
    expect(stylesheet).not.toMatch(/\.usage-panel__activity\s*\{[^}]*margin-top/u)
    expect(stylesheet).not.toMatch(/\.usage-panel__heatmap\s*\{[^}]*margin-top/u)
    expect(component).not.toContain('usage-panel__intro')
  })

  it('uses the shared project select for workspace scope instead of a custom popover', () => {
    const scopeControl = readFileSync(
      new URL(
        '../src/components/usage/@components/UsageWorkspaceScopeControl.tsx',
        import.meta.url
      ),
      'utf8'
    )
    const scopeStyles = readFileSync(
      new URL(
        '../src/components/usage/@components/UsageWorkspaceScopeControl.scss',
        import.meta.url
      ),
      'utf8'
    )

    expect(scopeControl).toContain('<MobileAwareSelect')
    expect(scopeControl).not.toContain('<Popover')
    expect(scopeControl).toContain("popupClassName='usage-workspace-scope-popup'")
    expect(scopeStyles).toMatch(
      /--usage-workspace-scope-bleed:\s*2px;[^}]*height:\s*var\(--oneworks-select-control-height\);[^}]*margin:\s*calc\(var\(--usage-workspace-scope-bleed\)\s*\*\s*-1\);[^}]*align-self:\s*center;/u
    )
    expect(scopeStyles).toMatch(
      /\.ant-select-selection-item\s*\{[^}]*height:\s*var\(--oneworks-select-content-height\);[^}]*min-height:\s*var\(--oneworks-select-content-height\);[^}]*margin:\s*0;/u
    )
    expect(scopeStyles).toMatch(
      /\.usage-workspace-scope-popup\.oneworks-select-popup\s*\{[^}]*--oneworks-overlay-select-item-min-height:\s*26px;[^}]*--oneworks-overlay-select-item-padding:\s*3px 8px 3px 12px;[^}]*--oneworks-overlay-select-panel-padding-y:\s*4px;/u
    )
  })

  it('resolves authentic provider and adapter icons for breakdown rows', () => {
    expect(resolveUsageBreakdownIcon('modelService', {
      id: 'openai'
    } as UsageFacetOption)).toEqual({ id: 'openai', kind: 'builtin' })
    expect(resolveUsageBreakdownIcon('tool', {
      id: 'codex'
    } as UsageFacetOption)).toMatchObject({ kind: 'url' })
    expect(resolveUsageBreakdownIcon('account', {
      id: 'openai-account',
      resource: {
        id: 'openai-account',
        kind: 'account',
        label: 'OpenAI account',
        parent: {
          id: 'openai',
          kind: 'model-service'
        }
      }
    } as UsageFacetOption)).toEqual({ id: 'openai', kind: 'builtin' })
  })

  it('centers breakdown icons and labels from one flex alignment source', () => {
    const component = readFileSync(
      new URL('../src/components/usage/UsagePanel.tsx', import.meta.url),
      'utf8'
    )
    const stylesheet = readFileSync(
      new URL('../src/components/usage/UsagePanel.scss', import.meta.url),
      'utf8'
    )

    expect(component).toContain("className='usage-panel__breakdown-text'")
    expect(stylesheet).toMatch(
      /\.usage-panel__breakdown-copy\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*var\(--oneworks-overlay-icon-gap,\s*6px\);/u
    )
    expect(stylesheet).toMatch(
      /\.usage-panel__breakdown-label\s*\{[^}]*line-height:\s*var\(--app-chrome-icon-size,\s*18px\);/u
    )
    expect(stylesheet).not.toMatch(
      /\.usage-panel__breakdown-item-icon\s*\{[^}]*grid-row:/u
    )
  })

  it('keeps breakdowns flat and omits redundant share decoration', () => {
    const component = readFileSync(
      new URL('../src/components/usage/UsagePanel.tsx', import.meta.url),
      'utf8'
    )
    const stylesheet = readFileSync(
      new URL('../src/components/usage/UsagePanel.scss', import.meta.url),
      'utf8'
    )

    expect(component).not.toContain('usage-panel__breakdown-share')
    expect(component).not.toContain('usage-panel__breakdown-track')
    expect(stylesheet).toMatch(
      /\.usage-panel__breakdowns\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(240px,\s*1fr\)\);/u
    )
    expect(stylesheet).not.toMatch(
      /\.usage-panel__breakdown\s*\{[^}]*border-radius:/u
    )
  })
})
