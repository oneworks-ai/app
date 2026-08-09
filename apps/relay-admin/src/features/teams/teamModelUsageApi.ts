import { requestJson } from '../../shared/api/requestJson'

export interface RelayAdminUsageAggregate {
  activeUsers: number
  cacheCreationInputTokens: number
  cacheRate?: number
  cachedInputTokens: number
  inputTokens: number
  outputTokens: number
  p95DurationMs?: number
  requests: number
  totalTokens: number
}

export interface RelayAdminModelUsageEvent {
  adapter?: string
  cacheCreationInputTokens: number
  cachedInputTokens: number
  deviceId?: string
  durationMs?: number
  id: string
  inputTokens: number
  model: string
  modelService: string
  occurredAt: string
  outputTokens: number
  receivedAt: string
  requestCount: number
  serviceName: string
  serviceVersion?: string
  sessionId?: string
  scope: 'personal' | 'team'
  source: 'codex' | 'oneworks' | 'other'
  success: boolean
  teamId?: string
  userId: string
}

export interface RelayAdminModelUsageSummary extends RelayAdminUsageAggregate {
  byAdapter: Record<string, RelayAdminUsageAggregate>
  byModel: Record<string, RelayAdminUsageAggregate>
  byModelService: Record<string, RelayAdminUsageAggregate>
  bySource: Record<string, RelayAdminUsageAggregate>
  byTeam: Record<string, RelayAdminUsageAggregate>
  byUser: Record<string, RelayAdminUsageAggregate>
}

export interface RelayAdminModelUsageResponse {
  events: RelayAdminModelUsageEvent[]
  nextCursor?: string
  retention: { days: number; maxEvents: number }
  series: Array<{ date: string } & RelayAdminUsageAggregate>
  summary: RelayAdminModelUsageSummary
  teams: Array<{ id: string; name: string; slug: string }>
  users: Array<{ email: string; id: string; name: string }>
}

export interface RelayAdminModelUsageQuery {
  adapter?: string
  cursor?: string
  from?: string
  limit?: number
  model?: string
  modelService?: string
  q?: string
  source?: string
  teamId?: string
  to?: string
  userId?: string
}

export const fetchRelayAdminTeamModelUsage = async (
  token: string,
  teamId: string,
  query: RelayAdminModelUsageQuery = {},
  scope: 'admin' | 'relay' = 'admin'
) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim() !== '') params.set(key, String(value))
  }
  const suffix = params.size === 0 ? '' : `?${params.toString()}`
  return await requestJson<RelayAdminModelUsageResponse>(
    token,
    `/api/${scope}/teams/${encodeURIComponent(teamId)}/model-usage${suffix}`
  )
}

export const fetchRelayAdminModelUsage = async (
  token: string,
  query: RelayAdminModelUsageQuery = {}
) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim() !== '') params.set(key, String(value))
  }
  const suffix = params.size === 0 ? '' : `?${params.toString()}`
  return await requestJson<RelayAdminModelUsageResponse>(token, `/api/admin/model-usage${suffix}`)
}

export const fetchRelayProfileModelUsage = async (
  token: string,
  query: RelayAdminModelUsageQuery = {}
) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value != null && String(value).trim() !== '') params.set(key, String(value))
  }
  const suffix = params.size === 0 ? '' : `?${params.toString()}`
  return await requestJson<RelayAdminModelUsageResponse>(token, `/api/profile/model-usage${suffix}`)
}
