import type { RelayRememberedAccount } from './types'

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value != null && !Array.isArray(value)
)

export const readStringField = (record: Record<string, unknown>, key: string) => (
  typeof record[key] === 'string' ? record[key] : ''
)

const accountStorageKey = () => `oneWorks.relayLogin.accounts:${window.location.origin}`

const normalizeAccount = (value: unknown): RelayRememberedAccount | undefined => {
  if (!isRecord(value)) return undefined
  const provider = readStringField(value, 'provider')
  const email = readStringField(value, 'email')
  if (provider === '' || email === '') return undefined
  const name = readStringField(value, 'name') || email
  return {
    avatarUrl: readStringField(value, 'avatarUrl'),
    email,
    name,
    provider,
    updatedAt: readStringField(value, 'updatedAt')
  }
}

export const readAccounts = () => {
  try {
    const value = JSON.parse(window.localStorage.getItem(accountStorageKey()) ?? '[]') as unknown
    return Array.isArray(value)
      ? value.map(normalizeAccount).filter((account): account is RelayRememberedAccount => account != null)
      : []
  } catch {
    return []
  }
}

export const writeAccounts = (accounts: RelayRememberedAccount[]) => {
  try {
    window.localStorage.setItem(accountStorageKey(), JSON.stringify(accounts.slice(0, 12)))
  } catch {
    // Storage can be unavailable in hardened browsers; login still continues.
  }
}

export const accountFallback = (account: RelayRememberedAccount) => (
  (account.name || account.email || account.provider || '?').slice(0, 1).toUpperCase()
)
