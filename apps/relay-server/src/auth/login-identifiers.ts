import type { RelayStore, RelayUser } from '../types.js'
import { findEnabledUserByLoginId, findEnabledUserByUniqueEmail } from './identities.js'

export const cleanLoginIdentifier = (value: unknown) => (
  typeof value === 'string' ? value.trim() : ''
)

export const loginIdentifierFromBody = (body: Record<string, unknown>) => (
  cleanLoginIdentifier(body.loginId) ||
  cleanLoginIdentifier(body.login_id) ||
  cleanLoginIdentifier(body.identifier) ||
  cleanLoginIdentifier(body.email)
)

export const cleanGeneratedLoginId = (value: string | undefined) => {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/@.+$/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return normalized === '' ? 'user' : normalized
}

export const generateUniqueLoginId = (store: RelayStore, candidate: string | undefined) => {
  const base = cleanGeneratedLoginId(candidate)
  let next = base
  let suffix = 2
  while (store.users.some(user => user.loginId?.trim().toLowerCase() === next)) {
    next = `${base}-${suffix}`
    suffix += 1
  }
  return next
}

export const findEnabledUserByLoginIdentifier = (
  store: RelayStore,
  loginId: string,
  input: {
    includeUser?: (user: RelayUser) => boolean
  } = {}
): RelayUser | undefined => {
  const normalized = loginId.trim().toLowerCase()
  if (normalized === '') return undefined

  const loginIdMatch = findEnabledUserByLoginId(store, normalized, input.includeUser)
  if (loginIdMatch != null) return loginIdMatch

  return findEnabledUserByUniqueEmail(store, normalized, input.includeUser)
}
