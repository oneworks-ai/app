import type { RelayAdminCurrentUser } from '../../shared/model/adminTypes'

const RELAY_LOGIN_ACCOUNTS_STORAGE_KEY_PREFIX = 'oneWorks.relayLogin.accounts:'

interface StoredRelayLoginAccount {
  avatarUrl: string
  email: string
  provider: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const readStringField = (record: Record<string, unknown>, key: string) => (
  typeof record[key] === 'string' ? record[key] : ''
)

const readOptionalString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const parseStoredRelayLoginAccount = (value: unknown): StoredRelayLoginAccount | undefined => {
  if (!isRecord(value)) return undefined
  const avatarUrl = readStringField(value, 'avatarUrl').trim()
  const email = readStringField(value, 'email').trim()
  const provider = readStringField(value, 'provider').trim()
  if (avatarUrl === '' || email === '') return undefined
  return {
    avatarUrl,
    email,
    provider
  }
}

const readStoredRelayLoginAccounts = () => {
  if (typeof window === 'undefined') return []
  try {
    const keys = new Set([
      `${RELAY_LOGIN_ACCOUNTS_STORAGE_KEY_PREFIX}${window.location.origin}`,
      ...Array.from({ length: window.localStorage.length }, (_value, index) => window.localStorage.key(index) ?? '')
        .filter(key => key.startsWith(RELAY_LOGIN_ACCOUNTS_STORAGE_KEY_PREFIX))
    ])
    return Array.from(keys).flatMap(key => {
      const raw = window.localStorage.getItem(key)
      const parsed = raw == null ? [] : JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.map(parseStoredRelayLoginAccount).filter(account => account != null)
        : []
    })
  } catch {
    return []
  }
}

export const resolveAdminSessionUserAvatar = <T extends RelayAdminCurrentUser>(user: T): T => {
  if (readOptionalString(user.avatarUrl) != null) return user

  const userProvider = readOptionalString(user.provider)
  const userEmail = user.email.toLowerCase()
  const rememberedAccounts = readStoredRelayLoginAccounts().filter(account => account.email.toLowerCase() === userEmail)
  const rememberedAccount =
    rememberedAccounts.find(account => userProvider == null || account.provider === userProvider) ??
      rememberedAccounts[0]

  return rememberedAccount == null ? user : { ...user, avatarUrl: rememberedAccount.avatarUrl }
}
