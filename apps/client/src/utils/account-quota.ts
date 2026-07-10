import type { AdapterAccountInfo, AdapterAccountQuotaMetric } from '@oneworks/types'

export const ACCOUNT_QUOTA_CACHE_TTL_MS = 5 * 60 * 1000

export interface AccountQuotaWindow {
  id: string
  label: string
  value: string
  percent: number
  description?: string
  primary?: boolean
}

const normalizeOptionalText = (value: string | undefined) => {
  const normalized = value?.trim()
  return normalized == null || normalized === '' ? undefined : normalized
}

export const parseQuotaPercent = (value: string | undefined) => {
  if (value == null) return undefined

  const normalized = value.trim()
  if (!normalized.endsWith('%')) return undefined

  const parsed = Number(normalized.slice(0, -1))
  if (!Number.isFinite(parsed)) return undefined

  return Math.min(100, Math.max(0, parsed))
}

export const getQuotaPercentColor = (percent: number) => {
  if (percent >= 85) return 'var(--error-color, #ff4d4f)'
  if (percent >= 60) return 'var(--warning-color, #faad14)'
  return 'var(--success-color, #52c41a)'
}

const getQuotaWindowLabel = (metric: AdapterAccountQuotaMetric) => {
  const label = normalizeOptionalText(metric.label)
  if (label == null) return undefined

  const normalized = label.replace(/\s+(?:used|已使用|已用)$/i, '').trim()
  return normalized === '' ? undefined : normalized
}

export const getAccountQuotaWindows = (quota: AdapterAccountInfo['quota']): AccountQuotaWindow[] => (
  (quota?.metrics ?? [])
    .filter(metric => metric.id === 'primary-usage' || metric.id === 'secondary-usage')
    .flatMap((metric): AccountQuotaWindow[] => {
      const label = getQuotaWindowLabel(metric)
      const value = normalizeOptionalText(metric.value)
      const percent = parseQuotaPercent(value)
      const description = normalizeOptionalText(metric.description)
      if (label == null || value == null || percent == null) return []

      return [{
        id: metric.id,
        label,
        value,
        percent,
        ...(description == null ? {} : { description }),
        ...(metric.primary == null ? {} : { primary: metric.primary })
      }]
    })
    .sort((left, right) => Number(right.primary === true) - Number(left.primary === true))
    .slice(0, 2)
)
