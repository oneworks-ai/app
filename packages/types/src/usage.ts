export type UsageAggregationMode = 'cumulative' | 'delta'
export type UsageDataQuality = 'estimated' | 'provider_reported' | 'reported'
export type UsageFacetKey =
  | 'account'
  | 'authorityPlugin'
  | 'device'
  | 'model'
  | 'modelService'
  | 'tool'
  | 'transportPlugin'
  | 'workspace'
export type UsageGranularity = 'day' | 'hour' | 'month' | 'week'
export type UsageResourceKind =
  | 'account'
  | 'device'
  | 'model'
  | 'model-service'
  | 'plugin'
  | 'subscription'
  | 'tool'
  | 'workspace'

export interface UsageTokenCounts {
  cacheCreation: number
  cacheRead: number
  input: number
  output: number
  reasoning: number
  total: number
}

export interface UsagePluginReference {
  id: string
  label?: string
  scope?: string
}

/**
 * `authorityPlugin` owns the resource identity. `transportPlugin` only moved
 * the observation between runtimes (for example, Relay).
 */
export interface UsageProvenance {
  authorityPlugin?: UsagePluginReference
  deviceId?: string
  deviceLabel?: string
  origin: 'local' | 'plugin'
  transportPlugin?: UsagePluginReference
}

export interface UsageResourceDescriptor {
  authorityPlugin?: UsagePluginReference
  id: string
  kind: UsageResourceKind
  label: string
  parent?: {
    id: string
    kind: UsageResourceKind
  }
}

export interface UsageObservation {
  accountId?: string
  accountLabel?: string
  aggregationMode: UsageAggregationMode
  costUsd?: number
  id: string
  modelId?: string
  modelLabel?: string
  modelServiceId?: string
  modelServiceLabel?: string
  observedAt: number
  provenance: UsageProvenance
  quality: UsageDataQuality
  sessionId?: string
  tokens: UsageTokenCounts
  toolId: string
  toolLabel?: string
  workspaceId?: string
  workspaceLabel?: string
}

export interface UsageQuery {
  accounts?: string[]
  authorityPlugins?: string[]
  devices?: string[]
  from?: number
  granularity?: UsageGranularity
  modelServices?: string[]
  models?: string[]
  scope?: 'all' | 'workspace'
  to?: number
  tools?: string[]
  transportPlugins?: string[]
  workspaces?: string[]
}

export interface UsageSummary extends UsageTokenCounts {
  costUsd: number
  observationCount: number
}

export interface UsageActivityBucket extends UsageSummary {
  from: number
  key: string
  to: number
}

export interface UsageFacetOption extends UsageSummary {
  id: string
  label: string
  resource?: UsageResourceDescriptor
}

export interface UsageCoverageSource {
  id: string
  kind: 'local' | 'plugin' | 'workspace'
  label: string
  message?: string
  status: 'available' | 'offline' | 'partial' | 'unavailable'
}

export interface UsageReport {
  activity: UsageActivityBucket[]
  coverage: UsageCoverageSource[]
  facets: Record<UsageFacetKey, UsageFacetOption[]>
  generatedAt: number
  /**
   * Query-filtered raw observations are retained so an upstream manager can
   * deduplicate and re-apply cumulative/delta semantics across sources.
   */
  observations: UsageObservation[]
  query: UsageQuery
  resources: UsageResourceDescriptor[]
  summary: UsageSummary
}

export interface UsageSourceResult {
  coverage?: UsageCoverageSource
  observations: UsageObservation[]
  resources?: UsageResourceDescriptor[]
}
