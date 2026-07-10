import { useCallback, useEffect, useMemo, useState } from 'react'

import type { AdapterAccountInfo, AdapterAccountQuotaMetric } from '@oneworks/types'

import { useAdapterAccountsWithQuota } from '#~/hooks/use-adapter-accounts-with-quota'
import { getAccountQuotaWindows } from '#~/utils/account-quota'
import type { AccountQuotaWindow } from '#~/utils/account-quota'
import { normalizeNonEmptyString } from './model-selector'

export interface ChatAdapterAccountOption {
  value: string
  label: string
  hint?: string
  meta?: string
  email?: string
  avatarUrl?: string
  quotaWindows?: AccountQuotaWindow[]
}
const ACCOUNT_STORAGE_KEY_PREFIX = 'oneworks_chat_adapter_account:'
const EMAIL_PATTERN = /[\w.%+-]+@[\w.-]+\.[A-Z]{2,}/i
const GENERIC_ACCOUNT_TITLES = new Set(['codex'])
const formatQuotaMetric = (metric: AdapterAccountQuotaMetric) => {
  const label = normalizeNonEmptyString(metric.label) ??
    normalizeNonEmptyString(
      metric.id
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .replace(/\b\w/g, match => match.toUpperCase())
    )
  const value = normalizeNonEmptyString(metric.value)
  if (label != null && value != null) {
    return `${label}: ${value}`
  }
  return value ?? label
}

const formatQuotaMeta = (quota: AdapterAccountInfo['quota']) => {
  const metrics = (quota?.metrics ?? [])
    .slice()
    .sort((left, right) => Number(right.primary === true) - Number(left.primary === true))
    .map(formatQuotaMetric)
    .filter((value): value is string => value != null && value !== '')

  if (metrics.length > 0) {
    return metrics.slice(0, 2).join(' · ')
  }

  const summary = normalizeNonEmptyString(quota?.summary)
  return summary == null ? undefined : `Quota: ${summary}`
}

const inferAccountEmail = (account: AdapterAccountInfo) => {
  const explicitEmail = normalizeNonEmptyString(account.email)
  if (explicitEmail != null) {
    return explicitEmail
  }

  return account.title.match(EMAIL_PATTERN)?.[0] ??
    account.description?.match(EMAIL_PATTERN)?.[0]
}

const inferAccountLabel = (account: AdapterAccountInfo) => {
  const title = normalizeNonEmptyString(account.title)
  if (title != null && !GENERIC_ACCOUNT_TITLES.has(title.toLowerCase())) {
    return title
  }

  return inferAccountEmail(account) ?? title ?? account.key
}

const readStoredAccount = (adapter: string | undefined) => {
  const normalizedAdapter = normalizeNonEmptyString(adapter)
  if (normalizedAdapter == null) {
    return undefined
  }

  try {
    const raw = localStorage.getItem(`${ACCOUNT_STORAGE_KEY_PREFIX}${normalizedAdapter}`)
    return raw == null || raw.trim() === '' ? undefined : raw.trim()
  } catch {
    return undefined
  }
}

export function useChatAdapterAccountSelection({
  adapter,
  model
}: {
  adapter?: string
  model?: string
}) {
  const normalizedAdapter = normalizeNonEmptyString(adapter)
  const [selectedAccount, setSelectedAccountState] = useState<string | undefined>(() => readStoredAccount(adapter))

  useEffect(() => {
    setSelectedAccountState(readStoredAccount(normalizedAdapter))
  }, [normalizedAdapter])

  const data = useAdapterAccountsWithQuota({ adapter: normalizedAdapter, model })

  const accountOptions = useMemo<ChatAdapterAccountOption[]>(() => {
    return (data?.accounts ?? [])
      .filter(account => account.status !== 'missing')
      .map(account => ({
        value: account.key,
        label: inferAccountLabel(account),
        hint: account.description,
        meta: formatQuotaMeta(account.quota),
        email: inferAccountEmail(account),
        avatarUrl: account.avatarUrl,
        quotaWindows: getAccountQuotaWindows(account.quota)
      }))
  }, [data?.accounts])

  const findAccountOptionByAlias = useCallback((value?: string) => {
    const normalizedValue = normalizeNonEmptyString(value)
    if (normalizedValue == null) {
      return undefined
    }

    return accountOptions.find((option) => {
      const aliases = [
        option.value,
        option.label,
        option.email
      ]
      return aliases.some(alias => normalizeNonEmptyString(alias) === normalizedValue)
    })
  }, [accountOptions])

  const resolveSelectableAccount = useCallback((value?: string, preserveUnknown = false) => {
    const normalizedValue = normalizeNonEmptyString(value)
    const accountValues = new Set(accountOptions.map(option => option.value))
    if (normalizedValue != null) {
      const matchedOption = findAccountOptionByAlias(normalizedValue)
      if (matchedOption != null) {
        return matchedOption.value
      }
      if (preserveUnknown) {
        return normalizedValue
      }
    }

    const defaultAccount = normalizeNonEmptyString(data?.defaultAccount)
    if (defaultAccount != null && accountValues.has(defaultAccount)) {
      return defaultAccount
    }

    return accountOptions[0]?.value
  }, [accountOptions, data?.defaultAccount, findAccountOptionByAlias])

  useEffect(() => {
    if (normalizedAdapter == null) {
      setSelectedAccountState(undefined)
      return
    }

    const nextValue = resolveSelectableAccount(selectedAccount)
    setSelectedAccountState((prev) => prev === nextValue ? prev : nextValue)
  }, [normalizedAdapter, resolveSelectableAccount, selectedAccount])

  useEffect(() => {
    if (normalizedAdapter == null) {
      return
    }

    try {
      const storageKey = `${ACCOUNT_STORAGE_KEY_PREFIX}${normalizedAdapter}`
      if (selectedAccount == null || selectedAccount.trim() === '') {
        localStorage.removeItem(storageKey)
      } else {
        localStorage.setItem(storageKey, selectedAccount)
      }
    } catch {}
  }, [normalizedAdapter, selectedAccount])

  const applySessionSelection = useCallback((params: { account?: string }) => {
    const nextAccount = resolveSelectableAccount(params.account, data == null) ??
      normalizeNonEmptyString(params.account)
    setSelectedAccountState((prev) => prev === nextAccount ? prev : nextAccount)
  }, [data, resolveSelectableAccount])

  const updateSelectedAccount = useCallback((value?: string) => {
    const nextAccount = resolveSelectableAccount(value)
    setSelectedAccountState((prev) => prev === nextAccount ? prev : nextAccount)
  }, [resolveSelectableAccount])

  return {
    accountOptions,
    selectedAccount: resolveSelectableAccount(selectedAccount, data == null) ?? selectedAccount,
    setSelectedAccount: updateSelectedAccount,
    applySessionSelection,
    showAccountSelector: normalizedAdapter != null && accountOptions.length > 0
  }
}
