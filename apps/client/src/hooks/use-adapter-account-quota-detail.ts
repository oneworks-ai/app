import { useCallback } from 'react'
import useSWR from 'swr'

import type { AdapterAccountDetail, AdapterAccountDetailResult, AdapterManageAccountResult } from '@oneworks/types'

import { createAdapterAccountOperationId, getAdapterAccountDetail, manageAdapterAccount } from '#~/api'
import { ACCOUNT_QUOTA_CACHE_TTL_MS } from '#~/utils/account-quota'

export type AdapterResetCreditOutcome = 'reset' | 'alreadyRedeemed' | 'nothingToReset' | 'noCredit'
export type AdapterResetCreditOutcomeTone = 'success' | 'info' | 'warning'

const RESET_CREDIT_OUTCOMES = new Set<AdapterResetCreditOutcome>([
  'reset',
  'alreadyRedeemed',
  'nothingToReset',
  'noCredit'
])
const pendingConsumeOperationIds = new Map<string, string>()

export const getAdapterResetCreditOutcome = (
  outcome: string | undefined
): AdapterResetCreditOutcome | undefined => (
  outcome != null && RESET_CREDIT_OUTCOMES.has(outcome as AdapterResetCreditOutcome)
    ? outcome as AdapterResetCreditOutcome
    : undefined
)

export const getAdapterResetCreditOutcomeTone = (
  outcome: AdapterResetCreditOutcome | undefined
): AdapterResetCreditOutcomeTone => {
  switch (outcome) {
    case 'reset':
      return 'success'
    case 'noCredit':
      return 'warning'
    case 'alreadyRedeemed':
    case 'nothingToReset':
    default:
      return 'info'
  }
}

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
  const adapter = key?.[1]
  const account = key?.[2]
  const model = key?.[3]

  const swr = useSWR<AdapterAccountDetailResult>(
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

  const setAccountDetail = useCallback(async (nextAccount: AdapterAccountDetail) => {
    await swr.mutate({ account: nextAccount }, { revalidate: false })
  }, [swr.mutate])

  const refreshAccountDetail = useCallback(async () => {
    return await swr.mutate()
  }, [swr.mutate])

  const consumeResetCredit = useCallback(async ({
    creditId,
    fallbackKey = 'next'
  }: {
    creditId?: string
    fallbackKey?: string
  }): Promise<AdapterManageAccountResult> => {
    if (adapter == null || account == null) {
      throw new Error('Reset credit consumption requires an adapter and account.')
    }

    const operationKey = JSON.stringify([
      adapter,
      account,
      normalizeOptionalText(creditId) ?? `anonymous:${fallbackKey}`
    ])
    const existingOperationId = pendingConsumeOperationIds.get(operationKey)
    const operationId = existingOperationId ?? createAdapterAccountOperationId()
    if (existingOperationId == null) {
      pendingConsumeOperationIds.set(operationKey, operationId)
    }

    const result = await manageAdapterAccount(adapter, {
      action: 'consume-reset-credit',
      account,
      creditId: normalizeOptionalText(creditId),
      ...(model === '' ? {} : { model }),
      operationId
    })
    if (getAdapterResetCreditOutcome(result.outcome) != null) {
      pendingConsumeOperationIds.delete(operationKey)
    }
    return result
  }, [account, adapter, model])

  return {
    ...swr,
    consumeResetCredit,
    refreshAccountDetail,
    setAccountDetail
  }
}
