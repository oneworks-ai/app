import { Tooltip } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ConfigSource, ProviderAccountStatus } from '@oneworks/types'
import { getModelProviderDefinition, resolveModelProviderIdentity } from '@oneworks/utils/model-providers'

import { getModelServiceBalance } from '#~/api'

import { buildModelServiceQuotaRows } from './ModelServiceProviderPlanSummary'
import type { TranslationFn } from './configUtils'
import {
  getCachedModelServiceAccountStatus,
  setCachedModelServiceAccountStatus
} from './modelServiceAccountStatusCache'
import {
  buildServiceActionFingerprint,
  resolveProviderActionCapabilities,
  toModelServiceConfig
} from './modelServiceProviderActionUtils'

const previewCircleRadius = 7
const previewCircleCircumference = 2 * Math.PI * previewCircleRadius
const previewCircleMaxVisiblePercent = 90

const formatPreviewQuotaLabel = (label: string) =>
  label
    .replace(/^5\s*(?:小时|hour)s?(?:额度| quota)?$/i, '5 h')
    .replace(/^1\s*(?:周|week)(?:额度| quota)?$/i, '1 w')
    .replace(/\s*quota$/i, '')
    .replace(/额度$/, '')

export const ModelServiceProviderQuotaPreview = ({
  item,
  serviceKey,
  source,
  t,
  variant = 'compact'
}: {
  item: unknown
  serviceKey: string
  source: ConfigSource
  t: TranslationFn
  variant?: 'cardFooter' | 'compact'
}) => {
  const service = useMemo(() => toModelServiceConfig(item), [item])
  const identity = resolveModelProviderIdentity(service)
  const provider = identity.provider == null ? undefined : getModelProviderDefinition(identity.provider)
  const managementEnabled = service.management?.enabled !== false
  const actionCapabilities = resolveProviderActionCapabilities(provider?.capabilities, managementEnabled)
  const serviceFingerprint = buildServiceActionFingerprint(serviceKey, source, service)
  const canAutoQueryBalance = actionCapabilities.canQueryBalance
  const autoBalanceFingerprintRef = useRef<string | null>(null)
  const [accountStatus, setAccountStatus] = useState<ProviderAccountStatus | null>(() =>
    getCachedModelServiceAccountStatus(serviceFingerprint)
  )
  const [accountError, setAccountError] = useState<string | null>(null)
  const [loadingBalance, setLoadingBalance] = useState(false)

  useEffect(() => {
    setAccountStatus(getCachedModelServiceAccountStatus(serviceFingerprint))
    setAccountError(null)
    setLoadingBalance(false)
  }, [serviceFingerprint])

  const queryBalance = useCallback(async () => {
    setAccountError(null)
    setLoadingBalance(true)
    try {
      const result = await getModelServiceBalance(serviceKey, { service, source })
      setCachedModelServiceAccountStatus(serviceFingerprint, result.account)
      setAccountStatus(result.account)
    } catch {
      setAccountError(t('config.modelServices.plan.liveQuota.failed'))
    } finally {
      setLoadingBalance(false)
    }
  }, [service, serviceFingerprint, serviceKey, source, t])

  useEffect(() => {
    if (!canAutoQueryBalance) return
    const cachedAccountStatus = getCachedModelServiceAccountStatus(serviceFingerprint)
    if (cachedAccountStatus != null) {
      setAccountStatus(cachedAccountStatus)
      setAccountError(null)
      return
    }
    if (autoBalanceFingerprintRef.current === serviceFingerprint) return
    autoBalanceFingerprintRef.current = serviceFingerprint
    void queryBalance()
  }, [canAutoQueryBalance, queryBalance, serviceFingerprint])

  if (!canAutoQueryBalance) return null

  const quotaRows = buildModelServiceQuotaRows({
    accountError,
    accountStatus,
    canQueryBalance: actionCapabilities.canQueryBalance,
    loadingBalance,
    service,
    t
  }).slice(0, 2)
  if (quotaRows.length === 0) return null

  const quotaPreview = (
    <div
      className={`config-view__model-service-list-quota config-view__model-service-list-quota--${variant}`}
      aria-label={t('config.modelServices.plan.labels.liveQuota')}
    >
      {quotaRows.map(row => {
        const previewLabel = formatPreviewQuotaLabel(row.label)
        const percent = Math.max(0, Math.min(100, row.percent ?? 0))
        const visiblePercent = percent > previewCircleMaxVisiblePercent && percent < 100
          ? previewCircleMaxVisiblePercent
          : percent
        const strokeDashoffset = previewCircleCircumference * (1 - visiblePercent / 100)
        const isLoadingRow = row.percent == null && accountError == null && (loadingBalance || accountStatus == null)
        const isErrorRow = row.percent == null && accountError != null
        const circleClassName = [
          'config-view__model-service-list-quota-circle',
          isLoadingRow ? 'is-loading' : '',
          isErrorRow ? 'is-error' : '',
          row.percent == null && !isLoadingRow && !isErrorRow ? 'is-empty' : ''
        ].filter(Boolean).join(' ')
        const progressStyle = isLoadingRow
          ? {
            strokeDasharray: `${previewCircleCircumference * 0.32} ${previewCircleCircumference}`,
            strokeDashoffset: 0
          }
          : {
            strokeDasharray: previewCircleCircumference,
            strokeDashoffset
          }
        const quotaCircle = (
          <Tooltip title={[row.label, row.value].filter(Boolean).join(' ')}>
            <div
              className={circleClassName}
              aria-busy={isLoadingRow || undefined}
              role={row.percent == null ? undefined : 'progressbar'}
              aria-valuemin={row.percent == null ? undefined : 0}
              aria-valuemax={row.percent == null ? undefined : 100}
              aria-valuenow={row.percent}
              aria-label={[row.label, row.value].filter(Boolean).join(' ')}
            >
              <svg
                className='config-view__model-service-list-quota-svg'
                viewBox='0 0 20 20'
                aria-hidden='true'
                focusable='false'
              >
                <circle
                  className='config-view__model-service-list-quota-track'
                  cx='10'
                  cy='10'
                  r={previewCircleRadius}
                />
                <circle
                  className='config-view__model-service-list-quota-progress'
                  cx='10'
                  cy='10'
                  r={previewCircleRadius}
                  style={progressStyle}
                />
              </svg>
            </div>
          </Tooltip>
        )
        if (variant === 'cardFooter') {
          return (
            <div className='config-view__model-service-list-quota-row' key={row.key}>
              {row.percent != null && quotaCircle}
              <span className='config-view__model-service-list-quota-label'>{previewLabel}</span>
              <span className='config-view__model-service-list-quota-value'>{row.value}</span>
            </div>
          )
        }
        return (
          <div className='config-view__model-service-list-quota-row' key={row.key}>
            {quotaCircle}
            <div className='config-view__model-service-list-quota-label'>{previewLabel}</div>
          </div>
        )
      })}
    </div>
  )
  return variant === 'cardFooter'
    ? <div className='model-service-collection__quota-footer'>{quotaPreview}</div>
    : quotaPreview
}
