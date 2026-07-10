import './QuotaUsageRing.scss'

import type { CSSProperties, ReactNode } from 'react'

import { getQuotaPercentColor, parseQuotaPercent } from '#~/utils/account-quota'

type QuotaUsageRingStyle = CSSProperties & {
  '--quota-usage-ring-color': string
  '--quota-usage-ring-percent': string
}

export function QuotaUsageRing({
  ariaLabel,
  compact = false,
  label,
  value
}: {
  ariaLabel?: string
  compact?: boolean
  label?: ReactNode
  value?: string
}) {
  const percent = parseQuotaPercent(value)
  if (percent == null) return null

  const style: QuotaUsageRingStyle = {
    '--quota-usage-ring-color': getQuotaPercentColor(percent),
    '--quota-usage-ring-percent': `${percent}%`
  }

  return (
    <span
      className={`quota-usage-ring${compact ? ' quota-usage-ring--compact' : ''}`}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel == null}
      style={style}
    >
      <span className='quota-usage-ring__inner'>{label}</span>
    </span>
  )
}
