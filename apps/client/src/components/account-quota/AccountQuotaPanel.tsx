/* eslint-disable max-lines -- reset-credit actions and quota summary share one reusable surface. */
import './AccountQuotaPanel.scss'

import { App, Popconfirm, Tooltip } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSWRConfig } from 'swr'

import type {
  AdapterAccountQuotaInfo,
  AdapterAccountRateLimitResetCredit,
  AdapterManageAccountResult
} from '@oneworks/types'

import { getApiErrorMessage } from '#~/api'
import { InlineActionButton } from '#~/components/inline-action-button'
import {
  getAdapterResetCreditOutcome,
  getAdapterResetCreditOutcomeTone,
  useAdapterAccountQuotaDetail
} from '#~/hooks/use-adapter-account-quota-detail'
import { isUsableAdapterResetCredit, parseQuotaPercent } from '#~/utils/account-quota'

import { QuotaUsageRing } from './QuotaUsageRing'

const formatRemaining = (
  expiresAt: number | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
) => {
  if (expiresAt == null || !Number.isFinite(expiresAt) || expiresAt <= 0) return undefined
  const remainingMs = expiresAt * 1000 - Date.now()
  if (remainingMs <= 0) return t('config.accounts.resetCredits.remaining.expired')
  const totalHours = Math.max(1, Math.ceil(remainingMs / 3_600_000))
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days > 0 && hours > 0) {
    return t('config.accounts.resetCredits.remaining.daysHours', { days, hours })
  }
  if (days > 0) {
    return t('config.accounts.resetCredits.remaining.days', { count: days })
  }
  return t('config.accounts.resetCredits.remaining.hours', { count: totalHours })
}

const formatEpochSeconds = (value: number | undefined) => {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value * 1000))
}

const parseLegacyResetDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value)
  if (match == null) return undefined

  const [, year, month, day, hours, minutes] = match
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes)
  )
  return Number.isNaN(date.getTime()) ? undefined : date
}

const localizeQuotaDescription = (
  description: string | undefined,
  language: string,
  t: (key: string, options?: Record<string, unknown>) => string
) => {
  const resetPrefix = 'resets'
  if (description == null || description.slice(0, resetPrefix.length).toLowerCase() !== resetPrefix) {
    return description
  }

  const rawDate = description.slice(resetPrefix.length).trim()
  if (rawDate === '') return description
  const resetDate = parseLegacyResetDate(rawDate)
  const date = resetDate == null
    ? rawDate
    : new Intl.DateTimeFormat(language, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(resetDate)
  return t('chat.accountQuotaModal.resetsAt', { date })
}

const localizeQuotaWindowLabel = (
  label: string,
  t: (key: string, options?: Record<string, unknown>) => string
) => {
  const separatorIndex = label.lastIndexOf(' · ')
  const scope = separatorIndex === -1 ? undefined : label.slice(0, separatorIndex)
  const usageLabel = separatorIndex === -1 ? label : label.slice(separatorIndex + 3)
  const match = /^(\d+)([dhm]) used$/i.exec(usageLabel)
  if (match == null) return label

  const [, rawCount, rawUnit] = match
  const count = Number(rawCount)
  const unitKey = rawUnit.toLowerCase() === 'd'
    ? 'days'
    : rawUnit.toLowerCase() === 'h'
    ? 'hours'
    : 'minutes'
  const duration = t(`chat.accountQuotaModal.windowDuration.${unitKey}`, { count })
  const localizedLabel = t('chat.accountQuotaModal.windowUsage', { window: duration })
  return scope == null || scope.trim() === ''
    ? localizedLabel
    : `${scope.trim()} · ${localizedLabel}`
}

const getQuotaWindowIcon = (id: string, label: string) => (
  /spark|model/i.test(`${id} ${label}`) ? 'bolt' : 'schedule'
)

function ResetCreditRow({
  credit,
  displayIndex,
  fallbackKey,
  availableCount,
  canConsume,
  consumePending,
  loading,
  onConsume
}: {
  credit?: AdapterAccountRateLimitResetCredit
  displayIndex: number
  fallbackKey: string
  availableCount: number
  canConsume?: boolean
  consumePending: boolean
  loading: boolean
  onConsume: (credit: AdapterAccountRateLimitResetCredit | undefined, fallbackKey: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const disabled = canConsume !== true ||
    availableCount <= 0 ||
    consumePending ||
    (credit != null && !isUsableAdapterResetCredit(credit))
  const remaining = formatRemaining(credit?.expiresAt, t)
  const timeDetails = [
    {
      key: 'grantedAt',
      label: t('config.accounts.resetCredits.fields.grantedAt'),
      value: formatEpochSeconds(credit?.grantedAt)
    },
    {
      key: 'expiresAt',
      label: t('config.accounts.resetCredits.fields.expiresAt'),
      value: formatEpochSeconds(credit?.expiresAt)
    }
  ].filter((item): item is typeof item & { value: string } => (
    item.value != null && item.value !== ''
  ))
  const actionLabel = t('config.accounts.resetCredits.use')
  const creditTitle = credit == null
    ? t('config.accounts.resetCredits.fullResetTitle')
    : credit.title?.trim().toLowerCase() === 'full reset'
    ? t('config.accounts.resetCredits.fullResetTitle')
    : credit.title ?? t('config.accounts.resetCredits.itemTitle', { index: displayIndex + 1 })

  return (
    <div className='account-quota-modal__credit'>
      <div className='account-quota-modal__credit-copy'>
        <div className='account-quota-modal__credit-title'>{creditTitle}</div>
        {remaining != null
          ? (
            <Tooltip
              placement='top'
              title={timeDetails.length > 0
                ? (
                  <div className='account-quota-modal__time-tooltip'>
                    {timeDetails.map(item => (
                      <div key={item.key} className='account-quota-modal__time-tooltip-row'>
                        <span className='account-quota-modal__time-tooltip-label'>{item.label}</span>
                        <span className='account-quota-modal__time-tooltip-value'>{item.value}</span>
                      </div>
                    ))}
                  </div>
                )
                : undefined}
              trigger={['hover', 'focus']}
            >
              <span
                className='account-quota-modal__credit-meta'
                tabIndex={timeDetails.length > 0 ? 0 : undefined}
              >
                {remaining}
              </span>
            </Tooltip>
          )
          : credit == null && (
            <div className='account-quota-modal__credit-meta'>
              {t('config.accounts.resetCredits.summaryDescription')}
            </div>
          )}
      </div>
      <Tooltip title={disabled ? t('config.accounts.resetCredits.unavailable') : actionLabel}>
        <span className='account-quota-modal__credit-action-wrap'>
          <Popconfirm
            title={t('config.accounts.resetCredits.confirmTitle')}
            description={t('config.accounts.resetCredits.confirmDescription')}
            okText={t('config.accounts.resetCredits.confirmAction')}
            cancelText={t('common.cancel')}
            disabled={disabled}
            onConfirm={() => onConsume(credit, fallbackKey)}
          >
            <InlineActionButton
              className='account-quota-modal__credit-action'
              icon='restart_alt'
              loading={loading}
              disabled={disabled}
              aria-label={actionLabel}
            />
          </Popconfirm>
        </span>
      </Tooltip>
    </div>
  )
}

export function AccountQuotaPanel({
  adapter,
  account,
  quota: initialQuota
}: {
  adapter?: string
  account?: string
  quota?: AdapterAccountQuotaInfo
}) {
  const { i18n, t } = useTranslation()
  const { message } = App.useApp()
  const { mutate: mutateCache } = useSWRConfig()
  const {
    consumeResetCredit,
    data,
    error,
    isLoading,
    isValidating,
    refreshAccountDetail,
    setAccountDetail
  } = useAdapterAccountQuotaDetail({ adapter, account })
  const [loadingCreditKey, setLoadingCreditKey] = useState<string>()
  const quota = data?.account.quota ?? initialQuota
  const language = i18n?.resolvedLanguage ?? i18n?.language ?? 'en'
  const windows = useMemo(() =>
    (quota?.metrics ?? []).flatMap(metric => {
      const percent = parseQuotaPercent(metric.value)
      if (percent == null || metric.value == null) return []
      return [{
        id: metric.id,
        icon: getQuotaWindowIcon(metric.id, metric.label ?? metric.id),
        label: localizeQuotaWindowLabel(metric.label ?? metric.id, t),
        value: metric.value,
        percent,
        description: localizeQuotaDescription(
          metric.description,
          language,
          t
        )
      }]
    }), [language, quota?.metrics, t])
  const credits = quota?.rateLimitResetCredits?.credits ?? []
  const availableCredits = quota?.rateLimitResetCredits?.availableCount ?? 0
  const usableDetailedCreditCount = credits.filter(credit => isUsableAdapterResetCredit(credit)).length
  const missingCreditCount = Math.max(0, availableCredits - usableDetailedCreditCount)
  const consumePending = loadingCreditKey != null
  const detailRefreshing = isLoading || isValidating === true
  const accountStatus = data?.account.status
  const requiresLogin = accountStatus === 'missing' || accountStatus === 'error'
  const hasFreshQuotaDetail = data?.account.quota != null &&
    error == null &&
    !detailRefreshing &&
    !requiresLogin
  const freshnessMessageKey = requiresLogin
    ? 'chat.accountQuotaModal.loginRequired'
    : error != null
    ? 'chat.accountQuotaModal.refreshFailed'
    : detailRefreshing
    ? 'chat.accountQuotaModal.refreshing'
    : 'chat.accountQuotaModal.stale'
  const refreshQuotaDetail = () => {
    void refreshAccountDetail().catch(() => undefined)
  }
  const refreshAccountListQuota = async () => {
    await mutateCache((key) => (
      Array.isArray(key) &&
      key[0] === '/api/adapters/accounts' &&
      key[1] === adapter
    ))
  }
  const handleConsumeResetCredit = async (
    credit: AdapterAccountRateLimitResetCredit | undefined,
    fallbackKey: string
  ) => {
    const loadingKey = credit?.id ?? fallbackKey
    setLoadingCreditKey(loadingKey)
    let result: AdapterManageAccountResult
    try {
      result = await consumeResetCredit({
        creditId: credit?.id,
        fallbackKey
      })
    } catch (error) {
      void message.error(getApiErrorMessage(
        error,
        t('config.accounts.actionFailed.consumeResetCredit')
      ))
      setLoadingCreditKey(undefined)
      return
    }

    const outcome = getAdapterResetCreditOutcome(result.outcome)
    const resultMessage = outcome == null
      ? result.message ?? t('config.accounts.resetCredits.outcomes.reset')
      : t(`config.accounts.resetCredits.outcomes.${outcome}`, {
        defaultValue: result.message
      })
    const outcomeTone = getAdapterResetCreditOutcomeTone(outcome)
    if (outcomeTone === 'success') {
      void message.success(resultMessage)
    } else if (outcomeTone === 'warning') {
      void message.warning(resultMessage)
    } else {
      void message.info(resultMessage)
    }

    const refreshResults = await Promise.allSettled([
      result.account == null
        ? refreshAccountDetail()
        : setAccountDetail(result.account),
      refreshAccountListQuota()
    ])
    if (refreshResults.some(refreshResult => refreshResult.status === 'rejected')) {
      void message.warning(t('config.accounts.resetCredits.refreshFailed'))
    }
    setLoadingCreditKey(undefined)
  }

  return (
    <div className='account-quota-modal__body'>
      <div className='account-quota-modal__panel'>
        <section className='account-quota-modal__summary'>
          <div className='account-quota-modal__heading-copy'>
            <span className='material-symbols-rounded account-quota-modal__heading-icon' aria-hidden='true'>
              query_stats
            </span>
            <span className='account-quota-modal__section-title'>{t('chat.accountQuotaModal.weekly')}</span>
          </div>
          {!hasFreshQuotaDetail && (
            <div
              className={[
                'account-quota-modal__freshness',
                error == null && !requiresLogin ? 'is-refreshing' : 'is-error'
              ].join(' ')}
              role={error == null && !requiresLogin ? 'status' : 'alert'}
            >
              <span>{t(freshnessMessageKey)}</span>
              {!detailRefreshing && !requiresLogin && (
                <InlineActionButton
                  icon='refresh'
                  aria-label={t('chat.accountQuotaModal.retryRefresh')}
                  onClick={refreshQuotaDetail}
                />
              )}
            </div>
          )}
          {windows.map(window => (
            <div key={window.id} className='account-quota-modal__window'>
              <div className='account-quota-modal__window-copy'>
                <span className='material-symbols-rounded account-quota-modal__window-icon' aria-hidden='true'>
                  {window.icon}
                </span>
                <span className='account-quota-modal__window-copy-content'>
                  <strong>{window.label}</strong>
                  {window.description != null && <span>{window.description}</span>}
                </span>
              </div>
              <div className='account-quota-modal__window-value'>
                <span>{window.value}</span>
                <QuotaUsageRing value={window.value} />
              </div>
            </div>
          ))}
        </section>
        <details className='account-quota-modal__credits'>
          <summary className='account-quota-modal__credits-heading'>
            <span className='account-quota-modal__heading-copy'>
              <span className='material-symbols-rounded account-quota-modal__credits-chevron' aria-hidden='true'>
                chevron_right
              </span>
              <span className='account-quota-modal__section-title'>{t('config.accounts.resetCredits.title')}</span>
            </span>
            <span className='account-quota-modal__available'>
              {t('chat.accountQuotaModal.available', { count: availableCredits })}
            </span>
          </summary>
          <div className='account-quota-modal__credits-content'>
            {credits.length === 0 && missingCreditCount === 0
              ? <div className='account-quota-modal__empty'>{t('config.accounts.resetCredits.noCredits')}</div>
              : credits.map((credit, index) => (
                <ResetCreditRow
                  key={credit.id}
                  credit={credit}
                  displayIndex={index}
                  fallbackKey={credit.id}
                  availableCount={availableCredits}
                  canConsume={hasFreshQuotaDetail &&
                    adapter != null &&
                    account != null &&
                    quota?.rateLimitResetCredits?.canConsume === true}
                  consumePending={consumePending}
                  loading={loadingCreditKey === credit.id}
                  onConsume={handleConsumeResetCredit}
                />
              ))}
            {Array.from({ length: missingCreditCount }, (_, index) => {
              const fallbackKey = `next-${index}`
              return (
                <ResetCreditRow
                  key={fallbackKey}
                  displayIndex={credits.length + index}
                  fallbackKey={fallbackKey}
                  availableCount={availableCredits}
                  canConsume={hasFreshQuotaDetail &&
                    adapter != null &&
                    account != null &&
                    quota?.rateLimitResetCredits?.canConsume === true}
                  consumePending={consumePending}
                  loading={loadingCreditKey === fallbackKey}
                  onConsume={handleConsumeResetCredit}
                />
              )
            })}
          </div>
        </details>
      </div>
    </div>
  )
}
