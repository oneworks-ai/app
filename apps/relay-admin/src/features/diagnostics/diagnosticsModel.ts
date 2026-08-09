import type { RelayAdminDiagnosticEvent } from './diagnosticsApi'

export const diagnosticOutcomeTone = (event: RelayAdminDiagnosticEvent) => {
  if (event.outcome === 'success' || event.success === true) return 'success'
  if (event.outcome === 'timeout' || event.outcome === 'error' || event.errorCode != null) return 'danger'
  if (event.outcome === 'degraded' || event.severity === 'WARN') return 'warning'
  return 'muted'
}

export const formatDiagnosticDuration = (durationMs: number | undefined) => {
  if (durationMs == null) return '-'
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`
  return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 1 : 2)} s`
}

export const formatDiagnosticTimestamp = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(date)
}

export const diagnosticUserLabel = (
  event: RelayAdminDiagnosticEvent,
  users: Array<{ email: string; id: string; name: string }>
) => {
  const user = users.find(item => item.id === event.userId)
  return user?.name.trim() || user?.email || event.userId
}
