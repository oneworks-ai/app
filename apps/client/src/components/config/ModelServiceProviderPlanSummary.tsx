/* eslint-disable max-lines -- plan quota rendering and provider plan link helpers share quota metadata helpers. */
import type { ModelServiceConfig, ModelServiceQuotaWindow, ProviderAccountStatus } from '@oneworks/types'
import { resolveModelServiceBilling, resolveModelServiceCodingPlan } from '@oneworks/utils/model-providers'

import type { TranslationFn } from './configUtils'
import { formatBalance, formatCurrencyAmount, normalizePortalUrl } from './modelServiceProviderActionUtils'

const translatePlanValue = (t: TranslationFn, namespace: string, value: string | undefined) => (
  value == null ? undefined : t(`config.modelServices.plan.${namespace}.${value}`, { defaultValue: value })
)

export interface ModelServicePlanLink {
  label: string
  url: string
}

const uniqueLinks = (
  links: Array<{ label: string; url: string | undefined }>
): ModelServicePlanLink[] => {
  const seen = new Set<string>()
  return links.flatMap((link) => {
    const url = normalizePortalUrl(link.url)
    if (url == null || seen.has(url)) return []
    seen.add(url)
    return [{ ...link, url }]
  })
}

export interface ModelServiceQuotaDisplayRow {
  key: string
  label: string
  percent?: number
  resetTime?: string
  showProgress?: boolean
  value?: string
}

const formatQuotaAmount = ({
  currency,
  limit,
  remaining,
  t,
  unit,
  unlimited
}: {
  limit?: number
  remaining?: number
  t: TranslationFn
  unit?: string
  currency?: string
  unlimited?: boolean
}) => {
  if (unlimited === true) return t('config.modelServices.results.unlimitedQuota')
  if (unit === 'percent') {
    const value = remaining ?? limit
    return typeof value === 'number'
      ? t('config.modelServices.plan.quotaProgress.percentValue', { value })
      : t('config.modelServices.results.amountUnknown')
  }
  const unknownAmount = t('config.modelServices.results.amountUnknown')
  const formatAmount = (amount: number | string) => formatCurrencyAmount(currency, String(amount))
  const suffix = translatePlanValue(t, 'quotaUnit', unit) ?? unit
  const amount = remaining == null || limit == null
    ? remaining ?? limit ?? unknownAmount
    : `${remaining} / ${limit}`
  const displayAmount = typeof amount === 'number' || (typeof amount === 'string' && amount !== unknownAmount)
    ? formatAmount(amount)
    : amount
  return [displayAmount, suffix]
    .filter(Boolean)
    .join(' ')
}

const formatQuotaDuration = (duration: number | undefined, t: TranslationFn, timeUnit?: string) => {
  if (duration == null) return t('config.modelServices.plan.labels.window')
  if (timeUnit === 'minute' && duration % 60 === 0) {
    return t('config.modelServices.plan.duration.hours', { count: duration / 60 })
  }
  const unitLabel = timeUnit == null
    ? undefined
    : t(`config.modelServices.plan.timeUnit.${timeUnit}`, { defaultValue: timeUnit })
  return unitLabel == null
    ? String(duration)
    : t('config.modelServices.plan.duration.generic', { count: duration, unit: unitLabel })
}

const getQuotaPercent = (remaining: number | undefined, limit: number | undefined) => {
  if (limit == null || limit <= 0 || remaining == null) return undefined
  return Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)))
}

const getPeriodQuotaWindow = (billing: ReturnType<typeof resolveModelServiceBilling> | undefined) => {
  const windows = billing?.quotaWindows ?? []
  return windows.includes('weekly')
    ? 'weekly'
    : windows.includes('monthly')
    ? 'monthly'
    : undefined
}

const getPeriodQuotaLabel = (billing: ReturnType<typeof resolveModelServiceBilling> | undefined, t: TranslationFn) => {
  const period = getPeriodQuotaWindow(billing)
  if (period == null) return t('config.modelServices.plan.labels.periodQuota')
  return t(`config.modelServices.plan.quotaProgress.${period}`)
}

const getRollingQuotaWindows = (
  billing: ReturnType<typeof resolveModelServiceBilling> | undefined
): ModelServiceQuotaWindow[] => (
  (billing?.quotaWindows ?? []).filter(window => window !== getPeriodQuotaWindow(billing))
)

const formatConfiguredQuotaWindowLabel = (window: ModelServiceQuotaWindow, t: TranslationFn) => {
  const label = translatePlanValue(t, 'quotaWindow', window) ?? window
  return t('config.modelServices.plan.quotaProgress.window', { duration: label })
}

const findQuotaWindow = (
  windows: NonNullable<Extract<ProviderAccountStatus, { kind: 'quota' }>['windows']>,
  configuredWindow: ModelServiceQuotaWindow
) => (
  configuredWindow === '5h'
    ? windows.find(window => window.timeUnit === 'minute' && window.duration === 300)
    : undefined
)

const formatResetTime = (resetTime: string | undefined, t: TranslationFn) => {
  if (resetTime == null || resetTime.trim() === '') return undefined
  const date = new Date(resetTime)
  const time = Number.isNaN(date.getTime()) ? resetTime : date.toLocaleString()
  return t('config.modelServices.plan.quotaProgress.resetAt', { time })
}

export const buildModelServiceQuotaRows = ({
  accountError,
  accountStatus,
  canQueryBalance = false,
  loadingBalance = false,
  service,
  t
}: {
  accountError?: string | null
  accountStatus?: ProviderAccountStatus | null
  canQueryBalance?: boolean
  loadingBalance?: boolean
  service: ModelServiceConfig
  t: TranslationFn
}): ModelServiceQuotaDisplayRow[] => {
  const billing = resolveModelServiceBilling(service)
  const plan = resolveModelServiceCodingPlan(service)
  const shouldShowAccountSummary = plan != null || billing?.kind != null || canQueryBalance || accountStatus != null
  if (!shouldShowAccountSummary) return []

  const pendingQuotaValue = (() => {
    if (loadingBalance || (canQueryBalance && accountStatus == null && accountError == null)) {
      return t('config.modelServices.plan.liveQuota.loading')
    }
    if (accountError != null) return accountError
    return undefined
  })()
  const fallbackAccountValue = (() => {
    if (pendingQuotaValue != null) return pendingQuotaValue
    if (accountStatus == null) return undefined
    return formatBalance(accountStatus, t)
  })()
  const fallbackAccountLabel = (() => {
    if (accountStatus?.kind === 'cost') {
      return t('config.modelServices.results.cost')
    }
    if (accountStatus?.kind === 'balance' || (plan == null && billing?.kind == null)) {
      return t('config.modelServices.results.balance')
    }
    return t('config.modelServices.plan.labels.liveQuota')
  })()
  return (() => {
    if (accountStatus?.kind === 'balance' || accountStatus?.kind === 'cost') {
      return [
        {
          key: 'balance',
          label: accountStatus.kind === 'cost'
            ? t('config.modelServices.results.cost')
            : t('config.modelServices.results.balance'),
          value: formatBalance(accountStatus, t)
        }
      ]
    }

    const configuredWindowRows = getRollingQuotaWindows(billing)
    if (accountStatus?.kind === 'quota') {
      if (plan == null && billing?.kind == null && configuredWindowRows.length === 0) {
        return [
          {
            key: 'quota',
            label: t('config.modelServices.results.quota'),
            percent: getQuotaPercent(accountStatus.remaining, accountStatus.limit),
            resetTime: formatResetTime(accountStatus.resetTime, t),
            showProgress: accountStatus.unlimited !== true && accountStatus.limit != null,
            value: formatQuotaAmount({
              currency: accountStatus.currency,
              limit: accountStatus.limit,
              remaining: accountStatus.remaining,
              t,
              unit: accountStatus.unit,
              unlimited: accountStatus.unlimited
            })
          }
        ]
      }
      const accountWindows = accountStatus.windows ?? []
      const quotaUnit = billing?.quotaUnit ?? accountStatus.unit
      const windowRows = configuredWindowRows.length > 0
        ? configuredWindowRows.map((configuredWindow) => {
          const window = findQuotaWindow(accountWindows, configuredWindow)
          return {
            key: `window-${configuredWindow}`,
            label: window == null
              ? formatConfiguredQuotaWindowLabel(configuredWindow, t)
              : t('config.modelServices.plan.quotaProgress.window', {
                duration: formatQuotaDuration(window.duration, t, window.timeUnit)
              }),
            percent: getQuotaPercent(window?.remaining, window?.limit),
            resetTime: formatResetTime(window?.resetTime, t),
            showProgress: true,
            value: formatQuotaAmount({
              limit: window?.limit,
              remaining: window?.remaining,
              t,
              unit: quotaUnit,
              unlimited: accountStatus.unlimited
            })
          }
        })
        : accountWindows.map((window, index) => ({
          key: `window-${index}`,
          label: t('config.modelServices.plan.quotaProgress.window', {
            duration: formatQuotaDuration(window.duration, t, window.timeUnit)
          }),
          percent: getQuotaPercent(window.remaining, window.limit),
          resetTime: formatResetTime(window.resetTime, t),
          showProgress: true,
          value: formatQuotaAmount({
            limit: window.limit,
            remaining: window.remaining,
            t,
            unit: quotaUnit,
            unlimited: accountStatus.unlimited
          })
        }))
      return [
        ...windowRows,
        {
          key: 'period',
          label: getPeriodQuotaLabel(billing, t),
          percent: getQuotaPercent(accountStatus.remaining, accountStatus.limit),
          resetTime: formatResetTime(accountStatus.resetTime, t),
          showProgress: true,
          value: formatQuotaAmount({
            limit: accountStatus.limit,
            remaining: accountStatus.remaining,
            t,
            unit: quotaUnit,
            unlimited: accountStatus.unlimited
          })
        }
      ]
    }
    if (pendingQuotaValue != null && configuredWindowRows.length > 0) {
      return [
        ...configuredWindowRows.map(window => ({
          key: `window-${window}`,
          label: formatConfiguredQuotaWindowLabel(window, t),
          percent: undefined,
          showProgress: true,
          value: pendingQuotaValue
        })),
        {
          key: 'period',
          label: getPeriodQuotaLabel(billing, t),
          percent: undefined,
          showProgress: true,
          value: pendingQuotaValue
        }
      ]
    }
    return [
      {
        key: 'fallback',
        label: fallbackAccountLabel,
        percent: undefined,
        showProgress: plan != null || billing?.kind != null,
        value: fallbackAccountValue
      }
    ].filter(row => row.value != null && row.value !== '')
  })()
}

export const ModelServiceProviderPlanSummary = ({
  accountError,
  accountStatus,
  canQueryBalance = false,
  loadingBalance = false,
  service,
  t
}: {
  accountError?: string | null
  accountStatus?: ProviderAccountStatus | null
  canQueryBalance?: boolean
  loadingBalance?: boolean
  service: ModelServiceConfig
  t: TranslationFn
}) => {
  const quotaRows = buildModelServiceQuotaRows({
    accountError,
    accountStatus,
    canQueryBalance,
    loadingBalance,
    service,
    t
  })
  if (quotaRows.length === 0) return null

  return (
    <div className='config-view__model-service-plan'>
      <div className='config-view__model-service-quota-list'>
        {quotaRows.map((row) => {
          const showProgress = row.showProgress ?? row.percent != null
          return (
            <div className='config-view__model-service-quota-row' key={row.key}>
              <div className='config-view__model-service-quota-head'>
                <span>{row.label}</span>
                {row.value != null && row.value !== '' && <strong>{row.value}</strong>}
              </div>
              {showProgress && (
                <div
                  className='config-view__model-service-quota-progress'
                  role={row.percent == null ? undefined : 'progressbar'}
                  aria-valuemin={row.percent == null ? undefined : 0}
                  aria-valuemax={row.percent == null ? undefined : 100}
                  aria-valuenow={row.percent}
                  aria-label={[row.label, row.value].filter(Boolean).join(' ')}
                >
                  <span style={{ width: `${row.percent ?? 0}%` }} />
                </div>
              )}
              {row.resetTime != null && (
                <div className='config-view__model-service-quota-meta'>{row.resetTime}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export const getModelServicePlanLinks = ({
  service,
  t
}: {
  service: ModelServiceConfig
  t: TranslationFn
}) => {
  const plan = resolveModelServiceCodingPlan(service)
  return uniqueLinks([
    { label: t('config.modelServices.plan.links.purchase'), url: plan?.planHomeUrl },
    { label: t('config.modelServices.plan.links.key'), url: plan?.keyHomeUrl },
    { label: t('config.modelServices.plan.links.docs'), url: plan?.docsUrl }
  ])
}
