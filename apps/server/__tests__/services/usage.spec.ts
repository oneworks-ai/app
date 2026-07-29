import { describe, expect, it } from 'vitest'

import type {
  PluginContributionUsageSource,
  PluginRuntimeInstance,
  UsageObservation,
  UsageQuery,
  UsageResourceDescriptor
} from '@oneworks/types'

import { USAGE_DIRECT_TRANSPORT_ID, buildUsageReport } from '#~/db/usage/repo.js'
import { isUsageSourceAvailable, mergeUsageReports } from '#~/services/usage/index.js'

const query: UsageQuery = {
  from: 1_799_999_000_000,
  scope: 'all',
  to: 1_800_001_000_000
}

const resources: UsageResourceDescriptor[] = [
  {
    id: 'kimi-api',
    kind: 'model-service',
    label: 'Kimi API',
    authorityPlugin: {
      id: 'remote-kimi',
      label: 'Remote Kimi'
    }
  },
  {
    id: 'kimi-team',
    kind: 'account',
    label: 'Kimi Team',
    parent: {
      id: 'kimi-api',
      kind: 'model-service'
    },
    authorityPlugin: {
      id: 'remote-kimi',
      label: 'Remote Kimi'
    }
  }
]

const createObservation = (transported: boolean): UsageObservation => ({
  accountId: 'kimi-team',
  aggregationMode: 'delta',
  id: 'remote-observation-1',
  observedAt: 1_800_000_000_000,
  provenance: transported
    ? {
      origin: 'plugin',
      transportPlugin: {
        id: 'relay',
        label: 'Relay'
      }
    }
    : {
      origin: 'local',
      deviceId: 'remote-device'
    },
  quality: 'provider_reported',
  sessionId: 'remote-session',
  tokens: {
    cacheCreation: 0,
    cacheRead: 0,
    input: 80,
    output: 20,
    reasoning: 0,
    total: 100
  },
  toolId: 'claude-code',
  workspaceId: 'workspace:remote'
})

describe('usage report aggregation', () => {
  it('deduplicates observations across reports and joins plugin resource metadata', () => {
    const direct = buildUsageReport([createObservation(false)], query, resources)
    const relayed = buildUsageReport([createObservation(true)], query, resources)

    const report = mergeUsageReports([relayed, direct], query)

    expect(report.summary).toMatchObject({
      observationCount: 1,
      total: 100
    })
    expect(report.observations).toHaveLength(1)
    expect(report.facets.modelService).toEqual([
      expect.objectContaining({
        id: 'kimi-api',
        label: 'Kimi API',
        resource: expect.objectContaining({
          authorityPlugin: expect.objectContaining({ id: 'remote-kimi' })
        })
      })
    ])
    expect(report.facets.account).toEqual([
      expect.objectContaining({
        id: 'kimi-team',
        label: 'Kimi Team',
        resource: expect.objectContaining({
          parent: { id: 'kimi-api', kind: 'model-service' }
        })
      })
    ])
    expect(report.facets.authorityPlugin).toEqual([
      expect.objectContaining({ id: 'remote-kimi', total: 100 })
    ])
    expect(report.facets.transportPlugin).toEqual([
      expect.objectContaining({ id: USAGE_DIRECT_TRANSPORT_ID, total: 100 })
    ])
    expect(
      mergeUsageReports([relayed, direct], {
        ...query,
        transportPlugins: ['relay']
      }).facets.transportPlugin
    ).toEqual([
      expect.objectContaining({ id: 'relay', total: 100 })
    ])
    expect(
      mergeUsageReports([relayed, direct], {
        ...query,
        transportPlugins: [USAGE_DIRECT_TRANSPORT_ID]
      }).facets.transportPlugin
    ).toEqual([
      expect.objectContaining({ id: USAGE_DIRECT_TRANSPORT_ID, total: 100 })
    ])
  })

  it('keeps one attributed authority filterable beside unattributed local usage', () => {
    const plugin = buildUsageReport([createObservation(true)], query, resources)
    const local = buildUsageReport([{
      ...createObservation(false),
      accountId: undefined,
      id: 'local-observation',
      provenance: { origin: 'local' },
      tokens: {
        ...createObservation(false).tokens,
        input: 30,
        output: 10,
        total: 40
      }
    }], query)
    const report = mergeUsageReports([plugin, local], query)

    expect(report.summary.total).toBe(140)
    expect(report.facets.authorityPlugin).toEqual([
      expect.objectContaining({ id: 'remote-kimi', total: 100 })
    ])
    expect(
      mergeUsageReports([plugin, local], {
        ...query,
        authorityPlugins: ['remote-kimi']
      }).summary.total
    ).toBe(100)
  })
})

describe('usage source availability', () => {
  const source = {
    command: 'usage.read',
    id: 'relay-usage',
    title: 'Relay usage'
  } satisfies PluginContributionUsageSource
  const plugin = {
    contributions: {
      roles: ['manager'],
      surfaces: ['launcher'],
      usageSources: [source]
    },
    enabled: true,
    requestId: 'relay',
    scope: 'relay'
  } as PluginRuntimeInstance

  it('inherits role and surface availability from the contribution manifest', () => {
    expect(isUsageSourceAvailable(plugin, source, 'launcher', 'manager')).toBe(true)
    expect(isUsageSourceAvailable(plugin, source, 'workspace', 'manager')).toBe(false)
    expect(isUsageSourceAvailable(plugin, source, 'launcher', 'workspace')).toBe(false)
  })

  it('allows a usage source to override inherited availability', () => {
    const workspaceSource = {
      ...source,
      roles: ['workspace'],
      surfaces: ['workspace']
    } satisfies PluginContributionUsageSource

    expect(isUsageSourceAvailable(plugin, workspaceSource, 'workspace', 'workspace')).toBe(true)
    expect(isUsageSourceAvailable(plugin, workspaceSource, 'launcher', 'manager')).toBe(false)
  })

  it('falls back to the plugin server role when contribution availability is omitted', () => {
    const serverScopedPlugin = {
      ...plugin,
      contributions: { usageSources: [source] },
      manifest: {
        plugin: {
          server: {
            entry: './server.js',
            roles: ['manager']
          }
        }
      }
    } as PluginRuntimeInstance

    expect(isUsageSourceAvailable(serverScopedPlugin, source, 'launcher', 'manager')).toBe(true)
    expect(isUsageSourceAvailable(serverScopedPlugin, source, 'workspace', 'workspace')).toBe(false)
  })
})
