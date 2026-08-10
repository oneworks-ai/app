import type { RelayAdminDiagnosticsResponse } from '../diagnostics/diagnosticsApi'
import { fetchRelayAdminDiagnostics } from '../diagnostics/diagnosticsApi'
import type { RelayAdminModelUsageResponse } from '../teams/teamModelUsageApi'
import { fetchRelayAdminModelUsage } from '../teams/teamModelUsageApi'

export interface RelayDataDashboardOverview {
  daily: RelayAdminDiagnosticsResponse
  monthly: RelayAdminDiagnosticsResponse
  modelUsage: RelayAdminModelUsageResponse
  observedAt: string
  weekly: RelayAdminDiagnosticsResponse
}

const daysBefore = (now: Date, days: number) => (
  new Date(now.getTime() - days * 24 * 60 * 60 * 1_000).toISOString()
)

const startOfUtcDay = (now: Date) => {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  return start.toISOString()
}

export const fetchRelayDataDashboardOverview = async (
  token: string,
  now = new Date()
): Promise<RelayDataDashboardOverview> => {
  const monthlyFrom = daysBefore(now, 30)
  const [daily, weekly, monthly, modelUsage] = await Promise.all([
    fetchRelayAdminDiagnostics(token, { from: startOfUtcDay(now), limit: 1 }),
    fetchRelayAdminDiagnostics(token, { from: daysBefore(now, 7), limit: 1 }),
    fetchRelayAdminDiagnostics(token, { from: monthlyFrom, limit: 1 }),
    fetchRelayAdminModelUsage(token, { from: monthlyFrom, limit: 1 })
  ])
  return { daily, modelUsage, monthly, observedAt: now.toISOString(), weekly }
}
