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
  return useAdapterAccountsWithQuotaState({ adapter, model }).data
}

export const useAdapterAccountsWithQuotaState = ({
  adapter,
  model
}: {
  adapter?: string
  model?: string
}) => {
  const normalizedAdapter = normalizeOptionalText(adapter)
  const normalizedModel = normalizeOptionalText(model)
  const { data: baseData, error: baseError } = useSWR<AdapterAccountsResult>(
    normalizedAdapter == null ? null : ['/api/adapters/accounts', normalizedAdapter, normalizedModel ?? ''],
    normalizedAdapter == null ? null : () => getAdapterAccounts(normalizedAdapter, { model: normalizedModel })
  )
  const { data: refreshedData, error: refreshError } = useSWR<AdapterAccountsResult>(
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

  const data = refreshedData ?? baseData
  return {
    data,
    error: data == null ? baseError ?? refreshError : undefined,
    pending: normalizedAdapter != null && baseData == null && baseError == null
  }
}
