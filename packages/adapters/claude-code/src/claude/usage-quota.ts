import type { AdapterAccountQuotaInfo } from '@oneworks/types'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const normalizePercent = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined
)

const formatPercent = (value: number) => `${value.toFixed(Number.isInteger(value) ? 0 : 1)}%`

const parseReset = (value: unknown) => {
  const resetAt = normalizeString(value)
  if (resetAt == null) return undefined
  const timestamp = Date.parse(resetAt)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

const formatReset = (timestamp: number) => {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `Resets ${year}-${month}-${day} ${hours}:${minutes}`
}

export const parseClaudeUsageQuota = (
  value: unknown,
  updatedAt: number,
  now = Date.now()
): AdapterAccountQuotaInfo | undefined => {
  if (!isRecord(value)) return undefined
  const metrics: NonNullable<AdapterAccountQuotaInfo['metrics']> = []
  const addWindow = (id: string, label: string, raw: unknown, primary = false) => {
    if (!isRecord(raw)) return
    const rawReset = Object.hasOwn(raw, 'resets_at') ? raw.resets_at : raw.resetsAt
    const resetAt = parseReset(rawReset)
    if (resetAt != null && resetAt <= now) return
    const percent = normalizePercent(raw.utilization) ?? normalizePercent(raw.used_percentage)
    if (percent == null) return
    metrics.push({
      id,
      label,
      value: formatPercent(percent),
      ...(resetAt != null
        ? { description: formatReset(resetAt) }
        : id === 'five-hour' && percent === 0 && rawReset === null
        ? { description: 'Starts when a message is sent.' }
        : {}),
      primary
    })
  }
  addWindow('five-hour', '5-hour usage', value.five_hour, true)
  addWindow('seven-day', '7-day usage', value.seven_day, true)
  addWindow('seven-day-opus', '7-day Opus usage', value.seven_day_opus)
  addWindow('seven-day-sonnet', '7-day Sonnet usage', value.seven_day_sonnet)
  if (isRecord(value.extra_usage) && value.extra_usage.is_enabled === true) {
    addWindow('extra-usage', 'Extra usage', value.extra_usage)
  }
  if (metrics.length === 0) return undefined
  const primary = metrics.filter(metric => metric.primary)
  return {
    summary: (primary.length > 0 ? primary : metrics)
      .map(metric => `${metric.label}: ${metric.value}`)
      .join(' · '),
    metrics,
    updatedAt
  }
}
