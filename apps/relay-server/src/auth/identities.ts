import { randomUUID } from 'node:crypto'

import type { RelayAuthIdentity, RelayStore, RelayUser } from '../types.js'
import { now } from '../utils.js'

export const emailCodeProvider = 'email_code'

export const nonSsoAuthProviders = new Set([
  emailCodeProvider,
  'invite',
  'passkey',
  'password'
])

export const cleanEmailIdentity = (value: string) => value.trim().toLowerCase()

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

const authIdentityKey = (input: Pick<RelayAuthIdentity, 'provider' | 'providerUserId'>) =>
  `${input.provider.toLowerCase()}:${input.providerUserId.toLowerCase()}`

export const findAuthIdentity = (
  store: RelayStore,
  provider: string,
  providerUserId: string
) => {
  const key = authIdentityKey({ provider, providerUserId })
  return store.authIdentities.find(identity => authIdentityKey(identity) === key)
}

export const findEnabledUserByAuthIdentity = (
  store: RelayStore,
  provider: string,
  providerUserId: string
) => {
  const identity = findAuthIdentity(store, provider, providerUserId)
  if (identity != null) {
    const user = store.users.find(item => item.id === identity.userId)
    return user == null || user.disabledAt != null ? undefined : user
  }

  const legacyUser = store.users.find(user =>
    user.provider?.toLowerCase() === provider.toLowerCase() &&
    user.providerUserId?.toLowerCase() === providerUserId.toLowerCase()
  )
  if (legacyUser == null || legacyUser.disabledAt != null) return undefined
  ensureAuthIdentity(store, {
    email: legacyUser.email,
    provider,
    providerUserId,
    userId: legacyUser.id
  })
  return legacyUser
}

export const ensureAuthIdentity = (
  store: RelayStore,
  input: {
    email?: string
    emailVerified?: boolean
    provider: string
    providerUserId: string
    userId: string
  }
) => {
  const timestamp = now()
  const existing = findAuthIdentity(store, input.provider, input.providerUserId)
  if (existing != null) {
    if (existing.userId !== input.userId) {
      throw new Error('Auth identity already belongs to another user.')
    }
    existing.email = input.email == null || input.email.trim() === ''
      ? existing.email
      : cleanEmailIdentity(input.email)
    existing.emailVerified = input.emailVerified ?? existing.emailVerified
    existing.updatedAt = timestamp
    return existing
  }
  const identity: RelayAuthIdentity = {
    createdAt: timestamp,
    email: input.email == null || input.email.trim() === '' ? undefined : cleanEmailIdentity(input.email),
    emailVerified: input.emailVerified,
    id: randomUUID(),
    provider: input.provider,
    providerUserId: input.providerUserId,
    userId: input.userId
  }
  store.authIdentities.push(identity)
  return identity
}

export const touchAuthIdentity = (
  store: RelayStore,
  provider: string,
  providerUserId: string,
  input: {
    email?: string
    emailVerified?: boolean
  } = {}
) => {
  const identity = findAuthIdentity(store, provider, providerUserId)
  if (identity == null) return undefined
  const timestamp = now()
  identity.email = input.email == null || input.email.trim() === ''
    ? identity.email
    : cleanEmailIdentity(input.email)
  identity.emailVerified = input.emailVerified ?? identity.emailVerified
  identity.lastUsedAt = timestamp
  identity.updatedAt = timestamp
  return identity
}

export const hasEmailCodeIdentity = (store: RelayStore, userId: string) =>
  store.authIdentities.some(identity => identity.userId === userId && identity.provider === emailCodeProvider)

export const ensureEmailCodeIdentity = (store: RelayStore, user: RelayUser) => {
  const email = cleanEmailIdentity(user.email)
  if (email === '') return undefined
  const conflicting = store.authIdentities.find(identity =>
    identity.provider === emailCodeProvider &&
    identity.providerUserId.toLowerCase() === email &&
    identity.userId !== user.id
  )
  if (conflicting != null) {
    throw new Error('Email code login already belongs to another user.')
  }
  const existing = store.authIdentities.find(identity =>
    identity.provider === emailCodeProvider &&
    identity.userId === user.id
  )
  if (existing != null) {
    const timestamp = now()
    existing.email = email
    existing.emailVerified = true
    existing.providerUserId = email
    existing.updatedAt = timestamp
    return existing
  }
  return ensureAuthIdentity(store, {
    email,
    emailVerified: true,
    provider: emailCodeProvider,
    providerUserId: email,
    userId: user.id
  })
}

const enabledUsers = (
  store: RelayStore,
  includeUser: (user: RelayUser) => boolean = () => true
) => store.users.filter(user => user.disabledAt == null && includeUser(user))

export const findEnabledUserByLoginId = (
  store: RelayStore,
  loginId: string,
  includeUser?: (user: RelayUser) => boolean
) => {
  const normalized = loginId.trim().toLowerCase()
  if (normalized === '') return undefined
  return enabledUsers(store, includeUser).find(user => user.loginId?.trim().toLowerCase() === normalized)
}

export const findEnabledUserByUniqueEmail = (
  store: RelayStore,
  email: string,
  includeUser?: (user: RelayUser) => boolean
) => {
  const normalized = cleanEmailIdentity(email)
  if (normalized === '') return undefined
  const matches = enabledUsers(store, includeUser).filter(user => user.email.toLowerCase() === normalized)
  return matches.length === 1 ? matches[0] : undefined
}

export const findEnabledEmailCodeUserByIdentifier = (
  store: RelayStore,
  identifier: string
) => {
  const normalized = identifier.trim().toLowerCase()
  if (normalized === '') return undefined
  const loginIdUser = findEnabledUserByLoginId(store, normalized, user => hasEmailCodeIdentity(store, user.id))
  if (loginIdUser != null) return loginIdUser
  const identity = store.authIdentities.find(item =>
    item.provider === emailCodeProvider &&
    item.providerUserId.toLowerCase() === normalized
  )
  if (identity == null) return undefined
  const user = store.users.find(item => item.id === identity.userId)
  return user == null || user.disabledAt != null ? undefined : user
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
