import useSWR from 'swr'

import type { AdapterAccountsResult } from '@oneworks/types'

import { getAdapterAccounts } from '#~/api'

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
  const { data } = useSWR<AdapterAccountsResult>(
    normalizedAdapter == null ? null : ['/api/adapters/accounts', normalizedAdapter, normalizedModel ?? ''],
    normalizedAdapter == null ? null : () => getAdapterAccounts(normalizedAdapter, { model: normalizedModel })
  )

  return data
}
