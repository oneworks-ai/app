import { requestJson } from '../../shared/api/requestJson'

export type RelayDiagnosticCategory = 'agent' | 'auth' | 'command' | 'error' | 'network' | 'other' | 'startup' | 'tool'
export type RelayDiagnosticSource = 'codex' | 'oneworks' | 'other'

export interface RelayAdminDiagnosticEvent {
  architecture?: string
  category: RelayDiagnosticCategory
  deviceId?: string
  durationMs?: number
  errorCode?: string
  errorFingerprint?: string
  environment?: string
  eventName: string
  failureDomain?: string
  id: string
  operationId?: string
  operationName?: string
  outcome?: string
  platform?: string
  occurredAt: string
  receivedAt: string
  releaseChannel?: string
  serviceName: string
  serviceVersion?: string
  sessionId?: string
  severity: string
  source: RelayDiagnosticSource
  stage?: string
  success?: boolean
  surface?: string
  traceId?: string
  userId: string
}

export interface RelayAdminDiagnosticSummary {
  affectedUsers: number
  byFailure: Record<string, number>
  byFingerprint: Record<string, number>
  byOutcome: Record<string, number>
  byPlatform: Record<string, number>
  bySource: Record<string, number>
  byVersion: Record<string, number>
  errorEvents: number
  startup: {
    attempts: number
    p50DurationMs?: number
    p95DurationMs?: number
    successRate?: number
  }
  total: number
}

export interface RelayAdminDiagnosticSeriesPoint {
  activeUsers: number
  date: string
  errorEvents: number
  startupAttempts: number
  startupSuccessRate?: number
  totalEvents: number
}

export interface RelayAdminDiagnosticsResponse {
  events: RelayAdminDiagnosticEvent[]
  nextCursor?: string
  retention: { days: number; maxEvents: number }
  series: RelayAdminDiagnosticSeriesPoint[]
  summary: RelayAdminDiagnosticSummary
  users: Array<{ email: string; id: string; name: string }>
}

export interface RelayAdminDiagnosticsQuery {
  category?: string
  cursor?: string
  from?: string
  limit?: number
  outcome?: string
  platform?: string
  q?: string
  source?: string
  serviceVersion?: string
  to?: string
  userId?: string
}

export const fetchRelayAdminDiagnostics = async (
  token: string,
  query: RelayAdminDiagnosticsQuery = {}
) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim() !== '') params.set(key, String(value))
  }
  const suffix = params.size === 0 ? '' : `?${params.toString()}`
  return await requestJson<RelayAdminDiagnosticsResponse>(token, `/api/admin/diagnostics${suffix}`)
}
