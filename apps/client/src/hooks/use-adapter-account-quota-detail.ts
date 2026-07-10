import useSWR from 'swr'

import type { AdapterAccountDetailResult } from '@oneworks/types'

import { getAdapterAccountDetail } from '#~/api'
import { ACCOUNT_QUOTA_CACHE_TTL_MS } from '#~/utils/account-quota'

const normalizeOptionalText = (value: string | undefined) => {
  const normalized = value?.trim()
  return normalized == null || normalized === '' ? undefined : normalized
}

export const getAdapterAccountQuotaCacheKey = (params: {
  adapter?: string
  account?: string
  model?: string
}) => {
  const adapter = normalizeOptionalText(params.adapter)
  const account = normalizeOptionalText(params.account)
  if (adapter == null || account == null) {
    return null
  }

  return ['/api/adapters/account-quota', adapter, account, normalizeOptionalText(params.model) ?? ''] as const
}

export const useAdapterAccountQuotaDetail = (params: {
  adapter?: string
  account?: string
  model?: string
}) => {
  const key = getAdapterAccountQuotaCacheKey(params)

  return useSWR<AdapterAccountDetailResult>(
    key,
    key == null
      ? null
      : () =>
        getAdapterAccountDetail(key[1], key[2], {
          ...(key[3] === '' ? {} : { model: key[3] }),
          refresh: true
        }),
    {
      dedupingInterval: ACCOUNT_QUOTA_CACHE_TTL_MS,
      revalidateOnFocus: false
    }
  )
}
