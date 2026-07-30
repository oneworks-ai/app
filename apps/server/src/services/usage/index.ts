/* eslint-disable max-lines -- usage collection keeps source availability, normalization, and report merging together. */
import { basename } from 'node:path'

import { collectCodexUsage } from '@oneworks/adapter-codex/usage'
import type {
  Adapter,
  AdapterCtx,
  PluginContributionSurface,
  PluginContributionUsageSource,
  PluginRuntimeInstance,
  PluginServerRuntimeRole,
  UsageObservation,
  UsageQuery,
  UsageReport,
  UsageResourceDescriptor,
  UsageSourceResult
} from '@oneworks/types'
import { BUILTIN_NATIVE_ADAPTERS } from '@oneworks/utils/model-selection'

import { getDb } from '#~/db/index.js'
import { buildUsageReport, localUsageWorkspace } from '#~/db/usage/repo.js'
import { createServerAdapterAccountContext } from '#~/services/adapter-accounts.js'
import { loadConfigState } from '#~/services/config/index.js'
import { listLauncherWorkspaceRuntimeEndpoints } from '#~/services/launcher/manager.js'
import { getPluginManager } from '#~/services/plugins/index.js'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const mergeUsageReports = (reports: UsageReport[], query: UsageQuery): UsageReport => {
  const merged = buildUsageReport(
    reports.flatMap(report => report.observations ?? []),
    query,
    reports.flatMap(report => report.resources ?? [])
  )
  merged.coverage = [...new Map(
    reports
      .flatMap(report => report.coverage ?? [])
      .map(source => [`${source.kind}:${source.id}`, source])
  ).values()]
  return merged
}

export const rebaseUsageReportWorkspace = (
  report: UsageReport,
  workspace: { id: string; label: string }
): UsageReport => ({
  ...report,
  observations: report.observations?.map(observation => ({
    ...observation,
    workspaceId: workspace.id,
    workspaceLabel: workspace.label
  })),
  resources: report.resources?.map(resource => (
    resource.kind === 'workspace'
      ? { ...resource, id: workspace.id, label: workspace.label }
      : resource
  ))
})

export const resolveLauncherUsageWorkspaceLabel = (
  workspaceFolder: string | undefined,
  workspaceId: string | undefined,
  fallbackId: string
) => (
  (workspaceFolder == null ? '' : basename(workspaceFolder)) ||
  workspaceId ||
  fallbackId
)

const readAvailabilityValues = <T>(values: T[] | undefined) => (
  values != null && values.length > 0 ? values : undefined
)

export const isUsageSourceAvailable = (
  plugin: PluginRuntimeInstance,
  source: PluginContributionUsageSource,
  surface: PluginContributionSurface,
  runtimeRole: PluginServerRuntimeRole
) => {
  const inheritedAvailability = plugin.contributions
  const roles = readAvailabilityValues(source.roles) ??
    readAvailabilityValues(inheritedAvailability?.roles) ??
    readAvailabilityValues(plugin.manifest?.plugin?.server?.roles)
  if (roles != null && !roles.includes(runtimeRole)) return false

  const surfaces = readAvailabilityValues(source.surfaces) ??
    readAvailabilityValues(inheritedAvailability?.surfaces)
  return surfaces == null || surfaces.includes(surface)
}

const getUsageContributions = (
  plugin: PluginRuntimeInstance,
  surface: PluginContributionSurface
) => (
  (plugin.contributions?.usageSources ?? [])
    .filter(source => isUsageSourceAvailable(plugin, source, surface, getPluginManager().getRuntimeRole()))
)

const getPluginRef = (plugin: PluginRuntimeInstance) => ({
  id: plugin.packageId ?? plugin.name ?? plugin.scope,
  label: plugin.displayName ?? plugin.name ?? plugin.scope,
  scope: plugin.scope
})

const normalizePluginObservation = (
  observation: UsageObservation,
  plugin: PluginRuntimeInstance,
  contribution: PluginContributionUsageSource,
  defaultWorkspace?: { id: string; label: string }
): UsageObservation => {
  const pluginRef = getPluginRef(plugin)
  return {
    ...observation,
    ...(observation.workspaceId != null || defaultWorkspace == null
      ? {}
      : {
        workspaceId: defaultWorkspace.id,
        workspaceLabel: defaultWorkspace.label
      }),
    provenance: {
      ...observation.provenance,
      origin: 'plugin',
      ...(observation.provenance.authorityPlugin == null && contribution.kind !== 'transport'
        ? { authorityPlugin: pluginRef }
        : {}),
      ...(contribution.kind === 'transport' ? { transportPlugin: pluginRef } : {})
    }
  }
}

const normalizePluginResource = (
  resource: UsageResourceDescriptor,
  plugin: PluginRuntimeInstance,
  contribution: PluginContributionUsageSource
): UsageResourceDescriptor => ({
  ...resource,
  ...(resource.authorityPlugin != null || contribution.kind === 'transport'
    ? {}
    : { authorityPlugin: getPluginRef(plugin) })
})

const collectPluginUsageReports = async (
  query: UsageQuery,
  surface: PluginContributionSurface,
  defaultWorkspace?: { id: string; label: string }
): Promise<UsageReport[]> => {
  const manager = getPluginManager()
  await manager.load()
  const reports: UsageReport[] = []
  for (const plugin of manager.snapshot().plugins.filter(candidate => candidate.enabled)) {
    for (const contribution of getUsageContributions(plugin, surface)) {
      try {
        const raw = await manager.invokeCommand(plugin.scope, contribution.command, { payload: query })
        if (!isRecord(raw) || !Array.isArray(raw.observations)) continue
        const result = raw as unknown as UsageSourceResult
        const observations = result.observations.map(observation =>
          normalizePluginObservation(observation, plugin, contribution, defaultWorkspace)
        )
        const resources = (result.resources ?? []).map(resource =>
          normalizePluginResource(resource, plugin, contribution)
        )
        const report = buildUsageReport(observations, query, resources)
        report.coverage = [{
          id: `${plugin.scope}:${contribution.id}`,
          kind: 'plugin',
          label: contribution.title,
          status: result.coverage?.status ?? 'available',
          ...(result.coverage?.message == null ? {} : { message: result.coverage.message })
        }]
        reports.push(report)
      } catch (error) {
        reports.push({
          ...buildUsageReport([], query),
          coverage: [{
            id: `${plugin.scope}:${contribution.id}`,
            kind: 'plugin',
            label: contribution.title,
            message: error instanceof Error ? error.message : String(error),
            status: 'unavailable'
          }]
        })
      }
    }
  }
  return reports
}

type AdapterUsageContextFactory = (adapterKey: string) => Promise<{
  adapter: Adapter
  adapterCtx: AdapterCtx
}>

const builtinUsageSources: Partial<Record<string, NonNullable<Adapter['getUsage']>>> = {
  codex: collectCodexUsage
}

const listUsageAdapterKeys = async () => {
  const { mergedConfig } = await loadConfigState()
  return [
    ...new Set([
      ...BUILTIN_NATIVE_ADAPTERS,
      ...Object.keys(mergedConfig.adapters ?? {}),
      mergedConfig.defaultAdapter
    ].filter((value): value is string => typeof value === 'string' && value.trim() !== ''))
  ]
}

export const collectAdapterUsageReports = async (
  query: UsageQuery,
  adapterKeys?: string[],
  createContext: AdapterUsageContextFactory = createServerAdapterAccountContext
): Promise<UsageReport[]> => {
  const reports: UsageReport[] = []
  const keys = adapterKeys ?? await listUsageAdapterKeys()
  for (const adapterKey of keys) {
    let runtime: Awaited<ReturnType<AdapterUsageContextFactory>>
    try {
      runtime = await createContext(adapterKey)
    } catch (error) {
      if (builtinUsageSources[adapterKey] != null) {
        reports.push({
          ...buildUsageReport([], query),
          coverage: [{
            id: `adapter:${adapterKey}`,
            kind: 'local',
            label: adapterKey,
            message: error instanceof Error ? error.message : String(error),
            status: 'unavailable'
          }]
        })
      }
      continue
    }
    const getUsage = runtime.adapter.getUsage ?? builtinUsageSources[adapterKey]
    if (getUsage == null) continue

    try {
      const result = await getUsage(runtime.adapterCtx, query)
      const report = buildUsageReport(
        result.observations.map(observation => ({
          ...observation,
          provenance: {
            ...observation.provenance,
            origin: 'local'
          }
        })),
        query,
        result.resources ?? []
      )
      report.coverage = [{
        id: result.coverage?.id ?? `adapter:${adapterKey}`,
        kind: result.coverage?.kind ?? 'local',
        label: result.coverage?.label ?? adapterKey,
        status: result.coverage?.status ?? 'available',
        ...(result.coverage?.message == null ? {} : { message: result.coverage.message })
      }]
      reports.push(report)
    } catch (error) {
      reports.push({
        ...buildUsageReport([], query),
        coverage: [{
          id: `adapter:${adapterKey}`,
          kind: 'local',
          label: adapterKey,
          message: error instanceof Error ? error.message : String(error),
          status: 'unavailable'
        }]
      })
    }
  }
  return reports
}

export const getWorkspaceUsageReport = async (query: UsageQuery = {}) => {
  const normalizedQuery = {
    ...query,
    scope: 'workspace' as const,
    workspaces: [localUsageWorkspace.id]
  }
  const local = getDb().getUsageReport(normalizedQuery)
  const pluginReports = await collectPluginUsageReports(
    normalizedQuery,
    'workspace',
    localUsageWorkspace
  )
  return mergeUsageReports([local, ...pluginReports], normalizedQuery)
}

const createWorkspaceUsageUrl = (serverBaseUrl: string, query: UsageQuery) => {
  const url = new URL('/api/usage', serverBaseUrl)
  Object.entries(query).forEach(([key, value]) => {
    if (value == null) return
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value))
  })
  return url
}

export const getLauncherUsageReport = async (query: UsageQuery = {}) => {
  const normalizedQuery = { ...query, scope: 'all' as const }
  const reports = [
    ...await collectAdapterUsageReports(normalizedQuery),
    ...await collectPluginUsageReports(normalizedQuery, 'launcher')
  ]
  const selectedWorkspaces = normalizedQuery.workspaces == null
    ? undefined
    : new Set(normalizedQuery.workspaces)
  const endpoints = (await listLauncherWorkspaceRuntimeEndpoints())
    .filter(endpoint => (
      selectedWorkspaces == null ||
      (endpoint.workspaceId != null && selectedWorkspaces.has(endpoint.workspaceId))
    ))
  await Promise.all(endpoints.map(async (endpoint) => {
    const label = resolveLauncherUsageWorkspaceLabel(
      endpoint.workspaceFolder,
      endpoint.workspaceId,
      endpoint.id
    )
    if (endpoint.status !== 'online' || endpoint.serverBaseUrl == null) {
      reports.push({
        ...buildUsageReport([], normalizedQuery),
        coverage: [{
          id: endpoint.workspaceId ?? endpoint.id,
          kind: 'workspace',
          label,
          status: 'offline'
        }]
      })
      return
    }
    try {
      const response = await fetch(createWorkspaceUsageUrl(endpoint.serverBaseUrl, normalizedQuery), {
        signal: AbortSignal.timeout(5_000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const report = await response.json() as UsageReport
      reports.push(
        endpoint.workspaceId == null
          ? report
          : rebaseUsageReportWorkspace(report, {
            id: endpoint.workspaceId,
            label
          })
      )
    } catch (error) {
      reports.push({
        ...buildUsageReport([], normalizedQuery),
        coverage: [{
          id: endpoint.workspaceId ?? endpoint.id,
          kind: 'workspace',
          label,
          message: error instanceof Error ? error.message : String(error),
          status: 'unavailable'
        }]
      })
    }
  }))
  return mergeUsageReports(reports, normalizedQuery)
}
