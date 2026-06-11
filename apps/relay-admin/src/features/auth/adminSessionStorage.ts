import type { RelayAdminCurrentUser } from '../../shared/model/adminTypes'
import { resolveAdminSessionUserAvatar } from './rememberedLoginAccounts'

const ADMIN_SESSION_TOKEN_STORAGE_KEY = 'oneworks-relay-admin-session-token'
const ADMIN_SESSION_ACCOUNTS_STORAGE_KEY = 'oneworks-relay-admin-session-accounts'
const MAX_ADMIN_SESSION_ACCOUNTS = 8

export interface InitialAdminSession {
  error?: string
  token: string
}

export interface AdminSessionAccount {
  savedAt: string
  token: string
  user: RelayAdminCurrentUser
}

let cachedInitialSession: InitialAdminSession | undefined

const readStoredSessionToken = () => {
  try {
    return window.localStorage.getItem(ADMIN_SESSION_TOKEN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

const persistAdminSessionToken = (token: string) => {
  try {
    if (token === '') {
      window.localStorage.removeItem(ADMIN_SESSION_TOKEN_STORAGE_KEY)
    } else {
      window.localStorage.setItem(ADMIN_SESSION_TOKEN_STORAGE_KEY, token)
    }
  } catch {
    // localStorage can be unavailable in locked-down browser contexts.
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const parseAdminSessionAccount = (value: unknown): AdminSessionAccount | undefined => {
  if (!isRecord(value)) return undefined
  const { savedAt, token, user } = value
  if (typeof savedAt !== 'string' || typeof token !== 'string' || !isRecord(user)) return undefined
  if (
    typeof user.email !== 'string' ||
    typeof user.id !== 'string' ||
    typeof user.name !== 'string' ||
    typeof user.role !== 'string'
  ) {
    return undefined
  }
  return {
    savedAt,
    token,
    user: resolveAdminSessionUserAvatar(user as unknown as RelayAdminCurrentUser)
  }
}

const readStoredAdminSessionAccounts = () => {
  try {
    const raw = window.localStorage.getItem(ADMIN_SESSION_ACCOUNTS_STORAGE_KEY)
    const parsed = raw == null ? [] : JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(parseAdminSessionAccount).filter(account => account != null) : []
  } catch {
    return []
  }
}

const persistAdminSessionAccounts = (accounts: AdminSessionAccount[]) => {
  try {
    window.localStorage.setItem(ADMIN_SESSION_ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts))
  } catch {
    // localStorage can be unavailable in locked-down browser contexts.
  }
}

const stripRelayLoginParams = (url: URL, hashParams: URLSearchParams) => {
  url.searchParams.delete('relay_token')
  url.searchParams.delete('relay_error')
  hashParams.delete('relay_token')
  hashParams.delete('relay_error')
  url.hash = hashParams.toString()
}

const consumeRelayLoginCallback = (): InitialAdminSession => {
  const url = new URL(window.location.href)
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''))
  const token = hashParams.get('relay_token') || url.searchParams.get('relay_token') || ''
  const error = hashParams.get('relay_error') || url.searchParams.get('relay_error') || ''
  if (token === '' && error === '') return { token: readStoredSessionToken() }

  stripRelayLoginParams(url, hashParams)
  window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`)
  if (token !== '') persistAdminSessionToken(token)
  return { error: error === '' ? undefined : error, token: token || readStoredSessionToken() }
}

export const readInitialAdminSession = (): InitialAdminSession => {
  if (cachedInitialSession != null) return cachedInitialSession
  cachedInitialSession = typeof window === 'undefined' ? { token: '' } : consumeRelayLoginCallback()
  return cachedInitialSession
}

export const clearAdminSessionToken = () => {
  persistAdminSessionToken('')
}

export const saveAdminSessionToken = (token: string) => {
  persistAdminSessionToken(token)
}

export const listAdminSessionAccounts = () => {
  if (typeof window === 'undefined') return []
  return readStoredAdminSessionAccounts()
}

export const saveAdminSession = (token: string, user: RelayAdminCurrentUser) => {
  persistAdminSessionToken(token)
  const resolvedUser = resolveAdminSessionUserAvatar(user)
  const nextAccount: AdminSessionAccount = {
    savedAt: new Date().toISOString(),
    token,
    user: resolvedUser
  }
  const accounts = [
    nextAccount,
    ...readStoredAdminSessionAccounts().filter(account => account.user.id !== user.id && account.token !== token)
  ].slice(0, MAX_ADMIN_SESSION_ACCOUNTS)
  persistAdminSessionAccounts(accounts)
  return accounts
}

export const selectAdminSessionAccount = (token: string) => {
  const account = readStoredAdminSessionAccounts().find(item => item.token === token)
  if (account == null) return undefined
  persistAdminSessionToken(account.token)
  return {
    ...account,
    user: resolveAdminSessionUserAvatar(account.user)
  }
}

export const removeAdminSessionAccount = (token: string) => {
  const accounts = readStoredAdminSessionAccounts().filter(account => account.token !== token)
  persistAdminSessionAccounts(accounts)
  persistAdminSessionToken('')
  return accounts
}

export const buildAdminLoginUrl = () => {
  if (typeof window === 'undefined') return '/login'

  const redirectUrl = new URL(window.location.href)
  const hashParams = new URLSearchParams(redirectUrl.hash.replace(/^#/, ''))
  stripRelayLoginParams(redirectUrl, hashParams)

  const loginUrl = new URL('/login', window.location.origin)
  loginUrl.searchParams.set('redirect_uri', redirectUrl.toString())
  return `${loginUrl.pathname}${loginUrl.search}`
}

export const redirectToAdminLogin = (loginUrl = buildAdminLoginUrl()) => {
  if (typeof window === 'undefined') return
  window.location.assign(loginUrl)
}
