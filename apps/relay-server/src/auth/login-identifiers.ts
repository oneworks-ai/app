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
