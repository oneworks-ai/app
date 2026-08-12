/* eslint-disable max-lines -- account selection keeps storage, quota labels, and Auto session semantics together. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  quota?: AdapterAccountInfo['quota']
  quotaWindows?: AccountQuotaWindow[]
  automatic?: boolean
}
const ACCOUNT_STORAGE_KEY_PREFIX = 'oneworks_chat_adapter_account:'
const AUTOMATIC_ACCOUNT_STORAGE_VALUE = '__automatic__'
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

const readStoredSelection = (adapter: string | undefined) => {
  const normalizedAdapter = normalizeNonEmptyString(adapter)
  if (normalizedAdapter == null) {
    return { account: undefined, automatic: false }
  }

  try {
    const raw = localStorage.getItem(`${ACCOUNT_STORAGE_KEY_PREFIX}${normalizedAdapter}`)
    const value = raw?.trim()
    if (value === AUTOMATIC_ACCOUNT_STORAGE_VALUE) {
      return { account: undefined, automatic: true }
    }
    return { account: value == null || value === '' ? undefined : value, automatic: false }
  } catch {
    return { account: undefined, automatic: false }
  }
}

export function useChatAdapterAccountSelection({
  adapter,
  model
}: {
  adapter?: string
  model?: string
}) {
  const { t } = useTranslation()
  const normalizedAdapter = normalizeNonEmptyString(adapter)
  const initialSelection = readStoredSelection(adapter)
  const [selectedAccount, setSelectedAccountState] = useState<string | undefined>(initialSelection.account)
  const [automaticSelectionRequested, setAutomaticSelectionRequested] = useState(initialSelection.automatic)

  useEffect(() => {
    const stored = readStoredSelection(normalizedAdapter)
    setSelectedAccountState(stored.account)
    setAutomaticSelectionRequested(stored.automatic)
  }, [normalizedAdapter])

  const data = useAdapterAccountsWithQuota({ adapter: normalizedAdapter, model })
  const accountsDataReady = data != null
  const automaticSelectionEnabled = data?.automaticSelection?.enabled === true

  const accountOptions = useMemo<ChatAdapterAccountOption[]>(() => {
    const accounts = (data?.accounts ?? [])
      .filter(account => account.status !== 'missing')
      .map(account => ({
        value: account.key,
        label: inferAccountLabel(account),
        hint: account.description,
        meta: formatQuotaMeta(account.quota),
        email: inferAccountEmail(account),
        avatarUrl: account.avatarUrl,
        quota: account.quota,
        quotaWindows: getAccountQuotaWindows(account.quota)
      }))
    return automaticSelectionEnabled
      ? [{
        value: '',
        label: t('chat.accountSelectAutomatic'),
        hint: t('chat.accountSelectAutomaticHint'),
        meta: t('chat.accountSelectAutomaticHint'),
        automatic: true
      }, ...accounts]
      : accounts
  }, [automaticSelectionEnabled, data?.accounts, t])

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
    if (normalizedValue == null && automaticSelectionEnabled) {
      return undefined
    }
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
  }, [accountOptions, automaticSelectionEnabled, data?.defaultAccount, findAccountOptionByAlias])

  useEffect(() => {
    if (normalizedAdapter == null) {
      setSelectedAccountState(undefined)
      setAutomaticSelectionRequested(false)
      return
    }

    if (accountsDataReady && !automaticSelectionEnabled && automaticSelectionRequested) {
      setAutomaticSelectionRequested(false)
    }
    if (automaticSelectionEnabled && selectedAccount == null) {
      setAutomaticSelectionRequested(true)
      return
    }
    if (automaticSelectionRequested && automaticSelectionEnabled) {
      return
    }

    const nextValue = resolveSelectableAccount(selectedAccount)
    setSelectedAccountState((prev) => prev === nextValue ? prev : nextValue)
  }, [
    accountsDataReady,
    automaticSelectionEnabled,
    automaticSelectionRequested,
    normalizedAdapter,
    resolveSelectableAccount,
    selectedAccount
  ])

  useEffect(() => {
    if (normalizedAdapter == null || !accountsDataReady) {
      return
    }

    try {
      const storageKey = `${ACCOUNT_STORAGE_KEY_PREFIX}${normalizedAdapter}`
      if (automaticSelectionRequested && automaticSelectionEnabled) {
        localStorage.setItem(storageKey, AUTOMATIC_ACCOUNT_STORAGE_VALUE)
      } else if (selectedAccount == null || selectedAccount.trim() === '') {
        localStorage.removeItem(storageKey)
      } else {
        localStorage.setItem(storageKey, selectedAccount)
      }
    } catch {}
  }, [accountsDataReady, automaticSelectionEnabled, automaticSelectionRequested, normalizedAdapter, selectedAccount])

  const applySessionSelection = useCallback((params: { account?: string }) => {
    if (automaticSelectionRequested && automaticSelectionEnabled) {
      return
    }
    const nextAccount = resolveSelectableAccount(params.account, !accountsDataReady) ??
      normalizeNonEmptyString(params.account)
    setSelectedAccountState((prev) => prev === nextAccount ? prev : nextAccount)
  }, [accountsDataReady, automaticSelectionEnabled, automaticSelectionRequested, resolveSelectableAccount])

  const updateSelectedAccount = useCallback((value?: string) => {
    if (normalizeNonEmptyString(value) == null && automaticSelectionEnabled) {
      setAutomaticSelectionRequested(true)
      setSelectedAccountState(undefined)
      return
    }
    setAutomaticSelectionRequested(false)
    const nextAccount = resolveSelectableAccount(value)
    setSelectedAccountState((prev) => prev === nextAccount ? prev : nextAccount)
  }, [automaticSelectionEnabled, resolveSelectableAccount])

  return {
    accountOptions,
    selectedAccount: automaticSelectionRequested && automaticSelectionEnabled
      ? undefined
      : resolveSelectableAccount(selectedAccount, !accountsDataReady) ?? selectedAccount,
    setSelectedAccount: updateSelectedAccount,
    applySessionSelection,
    showAccountSelector: normalizedAdapter != null && accountOptions.length > 0
  }
}
