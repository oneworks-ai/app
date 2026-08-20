import './AdapterAccountPreview.scss'

import { useMemo } from 'react'

import type { AdapterAccountInfo } from '@oneworks/types'

import { QuotaUsageRing } from '#~/components/account-quota/QuotaUsageRing'
import { getAccountQuotaWindows } from '#~/utils/account-quota'

import { useAdapterAccountPreviewData } from './@hooks/use-adapter-account-preview-data'
import { getConfiguredAdapterAccounts, mergeAdapterAccounts } from './adapter-accounts'
import type { TranslationFn } from './configUtils'

const getDefaultAccountKey = (value: Record<string, unknown>) => {
  const defaultAccount = typeof value.defaultAccount === 'string' ? value.defaultAccount.trim() : ''
  return defaultAccount === '' ? undefined : defaultAccount
}

const getAccountStatusLabel = (account: AdapterAccountInfo, t: TranslationFn) => {
  const status = account.status === 'error' || account.status === 'missing'
    ? account.status
    : 'ready'
  return t(`config.accounts.status.${status}`)
}

const AccountQuotaStatus = ({
  account,
  t
}: {
  account: AdapterAccountInfo
  t: TranslationFn
}) => {
  const quotaWindow = getAccountQuotaWindows(account.quota)[0]
  if (quotaWindow != null) {
    const label = `${quotaWindow.label}: ${quotaWindow.value}`
    return (
      <span className='adapter-account-preview__quota' title={label}>
        <QuotaUsageRing compact value={quotaWindow.value} ariaLabel={label} />
      </span>
    )
  }

  const status = account.status === 'error' || account.status === 'missing'
    ? account.status
    : 'ready'
  const label = getAccountStatusLabel(account, t)
  return (
    <span
      className={`adapter-account-preview__status-ring adapter-account-preview__status-ring--${status}`}
      aria-label={label}
      title={label}
    />
  )
}

export const AdapterAccountPreview = ({
  adapterKey,
  adapterValue,
  supportsAccounts,
  onOpenAccount,
  onOpenAccounts,
  t
}: {
  adapterKey: string
  adapterValue: Record<string, unknown>
  supportsAccounts: boolean
  onOpenAccount: (accountKey: string) => void
  onOpenAccounts: () => void
  t: TranslationFn
}) => {
  const configuredAccounts = useMemo(
    () => getConfiguredAdapterAccounts(adapterValue),
    [adapterValue]
  )
  const defaultAccountKey = getDefaultAccountKey(adapterValue)
  const { data: accountData, isLoading } = useAdapterAccountPreviewData({
    adapter: adapterKey,
    enabled: supportsAccounts
  })
  const accounts = useMemo(
    () =>
      mergeAdapterAccounts(
        configuredAccounts,
        accountData?.accounts ?? [],
        defaultAccountKey ?? accountData?.defaultAccount
      ),
    [accountData?.accounts, accountData?.defaultAccount, configuredAccounts, defaultAccountKey]
  )
  const visibleAccounts = accounts.length > 3 ? accounts.slice(0, 2) : accounts.slice(0, 3)
  const hiddenAccountCount = accounts.length - visibleAccounts.length

  if (!supportsAccounts) {
    return null
  }

  if (accounts.length === 0) {
    return (
      <div className='adapter-account-preview adapter-account-preview--empty'>
        {isLoading ? t('config.accounts.loading') : t('config.accounts.empty')}
      </div>
    )
  }

  return (
    <div className='adapter-account-preview' aria-label={t('config.accounts.title')}>
      {visibleAccounts.map(account => (
        <button
          key={account.key}
          type='button'
          className='adapter-account-preview__row'
          data-account-key={account.key}
          onClick={() => onOpenAccount(account.key)}
        >
          <span className='adapter-account-preview__name' title={account.title}>
            {account.title}
          </span>
          <AccountQuotaStatus account={account} t={t} />
        </button>
      ))}
      {hiddenAccountCount > 0 && (
        <button
          type='button'
          className='adapter-account-preview__row adapter-account-preview__more'
          aria-label={t('config.accounts.previewMoreLabel', { count: hiddenAccountCount })}
          onClick={onOpenAccounts}
        >
          <span>{t('config.accounts.previewMore')}</span>
          <span className='adapter-account-preview__more-count'>+{hiddenAccountCount}</span>
        </button>
      )}
    </div>
  )
}
