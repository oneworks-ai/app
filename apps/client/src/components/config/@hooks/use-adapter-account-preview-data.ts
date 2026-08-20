import useSWR from 'swr'

import type { AdapterAccountsResult } from '@oneworks/types'

import { getAdapterAccounts } from '#~/api'
import { ACCOUNT_QUOTA_CACHE_TTL_MS } from '#~/utils/account-quota'

export const useAdapterAccountPreviewData = ({
  adapter,
  enabled
}: {
  adapter: string
  enabled: boolean
}) => {
  const baseKey = enabled ? `/api/adapters/${adapter}/accounts` : null
  const base = useSWR<AdapterAccountsResult>(
    baseKey,
    () => getAdapterAccounts(adapter),
    {
      dedupingInterval: 30_000,
      keepPreviousData: true,
      revalidateOnFocus: false
    }
  )
  const refreshed = useSWR<AdapterAccountsResult>(
    enabled && (base.data?.accounts.length ?? 0) > 0
      ? ['/api/adapters/accounts-preview-quota', adapter]
      : null,
    () => getAdapterAccounts(adapter, { refresh: true }),
    {
      dedupingInterval: ACCOUNT_QUOTA_CACHE_TTL_MS,
      keepPreviousData: true,
      revalidateOnFocus: false
    }
  )

  return {
    data: refreshed.data ?? base.data,
    isLoading: base.isLoading && base.data == null
  }
}
