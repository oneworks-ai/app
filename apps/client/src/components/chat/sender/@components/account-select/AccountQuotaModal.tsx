/* eslint-disable max-lines -- modal, reset-credit action, and quota summary share one focused surface. */
import './AccountQuotaModal.scss'

import { App, Modal, Popconfirm, Spin, Tooltip } from 'antd'
import type { MouseEvent, ReactElement } from 'react'
import { cloneElement, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSWRConfig } from 'swr'

import type {
  AdapterAccountQuotaInfo,
  AdapterAccountRateLimitResetCredit,
  AdapterManageAccountResult
} from '@oneworks/types'

import { getApiErrorMessage } from '#~/api'
import { QuotaUsageRing } from '#~/components/account-quota/QuotaUsageRing'
import { InlineActionButton } from '#~/components/inline-action-button'
import {
  getAdapterResetCreditOutcome,
  getAdapterResetCreditOutcomeTone,
  useAdapterAccountQuotaDetail
} from '#~/hooks/use-adapter-account-quota-detail'
import { parseQuotaPercent } from '#~/utils/account-quota'

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
  const normalizedStatus = credit?.status?.trim().toLowerCase() ?? ''
  const disabled = canConsume !== true ||
    availableCount <= 0 ||
    consumePending ||
    ['redeemed', 'used', 'expired'].includes(normalizedStatus) ||
    (credit?.expiresAt != null && credit.expiresAt <= Date.now() / 1000)
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
        <div className='account-quota-modal__credit-title'>
          {creditTitle}
        </div>
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
      <Tooltip
        title={disabled
          ? t('config.accounts.resetCredits.unavailable')
          : actionLabel}
      >
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

export function AccountQuotaModal({
  adapter,
  account,
  quota,
  trigger
}: {
  adapter?: string
  account?: string
  quota?: AdapterAccountQuotaInfo
  trigger: ReactElement<{ onClick?: (event: MouseEvent) => void }>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <>
      {cloneElement(trigger, {
        onClick: (event) => {
          trigger.props.onClick?.(event)
          setOpen(true)
        }
      })}
      {open && (
        <Modal
          open
          title={t('chat.accountQuotaModal.title')}
          footer={null}
          centered
          destroyOnHidden
          className='account-quota-modal'
          onCancel={() => setOpen(false)}
        >
          <AccountQuotaModalBody adapter={adapter} account={account} quota={quota} />
        </Modal>
      )}
    </>
  )
}

export function AccountQuotaModalBody({
  adapter,
  account,
  quota: initialQuota
}: {
  adapter?: string
  account?: string
  quota?: AdapterAccountQuotaInfo
}) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { mutate: mutateCache } = useSWRConfig()
  const {
    consumeResetCredit,
    data,
    isLoading,
    refreshAccountDetail,
    setAccountDetail
  } = useAdapterAccountQuotaDetail({ adapter, account })
  const [loadingCreditKey, setLoadingCreditKey] = useState<string>()
  const quota = data?.account.quota ?? initialQuota
  const windows = useMemo(() =>
    (quota?.metrics ?? []).flatMap(metric => {
      const percent = parseQuotaPercent(metric.value)
      if (percent == null || metric.value == null) return []
      return [{
        id: metric.id,
        label: metric.label ?? metric.id,
        value: metric.value,
        percent,
        description: metric.description
      }]
    }), [quota?.metrics])
  const credits = quota?.rateLimitResetCredits?.credits ?? []
  const availableCredits = quota?.rateLimitResetCredits?.availableCount ?? 0
  const missingCreditCount = Math.max(0, availableCredits - credits.length)
  const consumePending = loadingCreditKey != null
  const refreshAccountListQuota = async () => {
    await mutateCache((key) => (
      Array.isArray(key) &&
      key[0] === '/api/adapters/accounts-quota' &&
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

  if (isLoading && quota == null) {
    return (
      <div className='account-quota-modal__state'>
        <Spin size='small' />
      </div>
    )
  }

  return (
    <div className='account-quota-modal__body'>
      <section className='account-quota-modal__summary'>
        <div className='account-quota-modal__section-title'>{t('chat.accountQuotaModal.weekly')}</div>
        {windows.map(window => (
          <div key={window.id} className='account-quota-modal__window'>
            <div className='account-quota-modal__window-copy'>
              <strong>{window.label}</strong>
              {window.description != null && <span>{window.description}</span>}
            </div>
            <div className='account-quota-modal__window-value'>
              <span>{window.value}</span>
              <QuotaUsageRing value={window.value} />
            </div>
          </div>
        ))}
      </section>
      <section className='account-quota-modal__credits'>
        <div className='account-quota-modal__credits-heading'>
          <div className='account-quota-modal__section-title'>{t('config.accounts.resetCredits.title')}</div>
          <span className='account-quota-modal__available'>
            {t('chat.accountQuotaModal.available', { count: availableCredits })}
          </span>
        </div>
        {credits.length === 0 && missingCreditCount === 0
          ? <div className='account-quota-modal__empty'>{t('config.accounts.resetCredits.noCredits')}</div>
          : credits.map((credit, index) => (
            <ResetCreditRow
              key={credit.id}
              credit={credit}
              displayIndex={index}
              fallbackKey={credit.id}
              availableCount={availableCredits}
              canConsume={adapter != null &&
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
              canConsume={adapter != null &&
                account != null &&
                quota?.rateLimitResetCredits?.canConsume === true}
              consumePending={consumePending}
              loading={loadingCreditKey === fallbackKey}
              onConsume={handleConsumeResetCredit}
            />
          )
        })}
      </section>
    </div>
  )
}
