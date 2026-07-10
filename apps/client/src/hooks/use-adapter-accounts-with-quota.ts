import useSWR from 'swr'

import type { AdapterAccountsResult } from '@oneworks/types'

import { getAdapterAccounts } from '#~/api'
import { ACCOUNT_QUOTA_CACHE_TTL_MS } from '#~/utils/account-quota'

const normalizeOptionalText = (value: string | undefined) => {
  const normalized = value?.trim()
  return normalized == null || normalized === '' ? undefined : normalized
}

export const useAdapterAccountsWithQuota = ({
  adapter,
  model
}: {
  adapter?: string
  model?: string
}) => {
  const normalizedAdapter = normalizeOptionalText(adapter)
  const normalizedModel = normalizeOptionalText(model)
  const { data: baseData } = useSWR<AdapterAccountsResult>(
    normalizedAdapter == null ? null : ['/api/adapters/accounts', normalizedAdapter, normalizedModel ?? ''],
    normalizedAdapter == null ? null : () => getAdapterAccounts(normalizedAdapter, { model: normalizedModel })
  )
  const { data: refreshedData } = useSWR<AdapterAccountsResult>(
    normalizedAdapter == null || baseData == null || baseData.accounts.length === 0
      ? null
      : ['/api/adapters/accounts-quota', normalizedAdapter, normalizedModel ?? ''],
    normalizedAdapter == null
      ? null
      : () => getAdapterAccounts(normalizedAdapter, { model: normalizedModel, refresh: true }),
    {
      dedupingInterval: ACCOUNT_QUOTA_CACHE_TTL_MS,
      revalidateOnFocus: false
    }
  )

  return refreshedData ?? baseData
}
