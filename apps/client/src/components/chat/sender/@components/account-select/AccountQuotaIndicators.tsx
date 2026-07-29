import './AccountQuotaIndicators.scss'

import { Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

import type { AdapterAccountQuotaInfo } from '@oneworks/types'

import { QuotaUsageRing } from '#~/components/account-quota/QuotaUsageRing'
import type { AccountQuotaWindow } from '#~/utils/account-quota'

import { AccountQuotaModal } from './AccountQuotaModal'

export function AccountQuotaIndicators({
  adapter,
  account,
  quota,
  windows
}: {
  adapter?: string
  account?: string
  quota?: AdapterAccountQuotaInfo
  windows?: AccountQuotaWindow[]
}) {
  const { t } = useTranslation()
  const visibleWindows = windows?.slice(0, 2) ?? []
  if (visibleWindows.length === 0) return null

  return (
    <AccountQuotaModal
      adapter={adapter}
      account={account}
      quota={quota}
      trigger={
        <button
          type='button'
          className='account-quota-indicators'
          aria-label={t('chat.accountQuota')}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          {visibleWindows.map((window) => {
            const ariaLabel = t('chat.accountQuotaWindow', {
              window: window.label,
              value: window.value
            })

            return (
              <Tooltip
                key={window.id}
                title={
                  <div className='account-quota-indicator__tooltip'>
                    <div className='account-quota-indicator__tooltip-title'>{ariaLabel}</div>
                    {window.description != null && (
                      <div className='account-quota-indicator__tooltip-description'>{window.description}</div>
                    )}
                  </div>
                }
              >
                <span className='account-quota-indicator__tooltip-target' aria-label={ariaLabel}>
                  <QuotaUsageRing compact label={window.label} value={window.value} />
                </span>
              </Tooltip>
            )
          })}
        </button>
      }
    />
  )
}
