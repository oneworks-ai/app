export const DIAGNOSTIC_SCHEMA_VERSION = 1 as const

export type DiagnosticDataClass = 'restricted' | 'safe'
export type DiagnosticEnvironment = 'development' | 'production' | 'staging' | 'test'
export type DiagnosticEventKind =
  | 'operation.completed'
  | 'operation.ready'
  | 'operation.stage'
  | 'operation.started'
export type DiagnosticFailureDomain =
  | 'adapter'
  | 'auth'
  | 'client'
  | 'config'
  | 'network'
  | 'plugin'
  | 'process'
  | 'provider'
  | 'renderer'
  | 'server'
  | 'storage'
  | 'unknown'
export type DiagnosticOperationOutcome =
  | 'abandoned'
  | 'cancelled'
  | 'degraded'
  | 'error'
  | 'success'
  | 'timeout'
export type DiagnosticSurface = 'cli' | 'desktop' | 'pwa' | 'relay' | 'server' | 'test' | 'web'

export interface DiagnosticResource {
  architecture?: string
  environment?: DiagnosticEnvironment
  platform?: string
  releaseChannel?: string
  serviceName: string
  serviceVersion?: string
  surface: DiagnosticSurface
}

export interface DiagnosticContext {
  agentSessionId?: string
  appSessionId?: string
  deviceId?: string
  installationId?: string
  nativeSessionId?: string
  startupId?: string
  traceId?: string
  userId?: string
  workspaceSessionId?: string
}

export interface DiagnosticFailure {
  code: string
  domain: DiagnosticFailureDomain
  fingerprint?: string
  retryable?: boolean
  type?: string
}

export interface DiagnosticOperationSnapshot {
  completedAt?: string
  durationMs?: number
  failure?: DiagnosticFailure
  id: string
  name: string
  outcome?: DiagnosticOperationOutcome
  readyAt?: string
  stage?: string
  stageDurationMs?: number
  stageSequence: number
  startedAt: string
}

export interface DiagnosticEvent {
  context: DiagnosticContext
  dataClass: DiagnosticDataClass
  eventId: string
  kind: DiagnosticEventKind
  operation: DiagnosticOperationSnapshot
  resource: DiagnosticResource
  schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION
  timestamp: string
}

export interface DiagnosticExporter {
  export: (event: DiagnosticEvent) => Promise<void> | void
  flush?: () => Promise<void> | void
}

export type ModelUsageSource = 'codex' | 'oneworks' | 'other'

/**
 * Content-free model consumption fact. This contract intentionally excludes
 * prompts, responses, tool payloads, URLs, keys, and provider billing claims.
 */
export interface ModelUsageEvent {
  adapter?: string
  cacheCreationInputTokens: number
  cachedInputTokens: number
  context: DiagnosticContext
  durationMs?: number
  eventId: string
  inputTokens: number
  model: string
  modelService: string
  occurredAt: string
  outputTokens: number
  requestCount: number
  resource: DiagnosticResource
  schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION
  source: ModelUsageSource
  success: boolean
}

export interface ModelUsageExporter {
  exportModelUsage: (event: ModelUsageEvent) => Promise<void> | void
  flush?: () => Promise<void> | void
}
