import { randomUUID } from 'node:crypto'

import type { RelayAuthProvider, RelayInvite, RelayRole, RelayStore } from '../types.js'
import { now } from '../utils.js'
import {
  ensureAuthIdentity,
  findEnabledUserByAuthIdentity,
  generateUniqueLoginId,
  touchAuthIdentity
} from './identities.js'
import { consumeInvite, findUsableInvite } from './invites.js'

export interface OAuthUserProfile {
  avatarUrl?: string
  email: string
  emailVerified?: boolean
  id: string
  loginId?: string
  name: string
  provider: RelayAuthProvider
}

const roleForNewUser = (store: RelayStore, invite: RelayInvite | undefined): RelayRole => {
  if (store.users.length === 0) return 'owner'
  return invite?.role ?? 'member'
}

export const upsertOAuthUser = (store: RelayStore, profile: OAuthUserProfile, inviteCode?: string) => {
  const timestamp = now()
  const existing = findEnabledUserByAuthIdentity(store, profile.provider, profile.id)
  if (existing != null) {
    existing.email = profile.email
    existing.name = profile.name
    existing.avatarUrl = profile.avatarUrl
    existing.provider = profile.provider
    existing.providerUserId = profile.id
    existing.updatedAt = timestamp
    touchAuthIdentity(store, profile.provider, profile.id, {
      email: profile.email,
      emailVerified: profile.emailVerified
    })
    return existing
  }

  const invite = findUsableInvite(store, inviteCode)
  if (store.users.length > 0 && invite == null) {
    throw new Error('Invite required.')
  }

  const user = {
    id: invite?.userId ?? randomUUID(),
    email: profile.email,
    loginId: generateUniqueLoginId(store, profile.loginId ?? profile.email),
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    provider: profile.provider,
    providerUserId: profile.id,
    role: roleForNewUser(store, invite),
    createdAt: timestamp,
    updatedAt: timestamp
  }
  consumeInvite(invite)
  store.users.push(user)
  ensureAuthIdentity(store, {
    email: profile.email,
    emailVerified: profile.emailVerified,
    provider: profile.provider,
    providerUserId: profile.id,
    userId: user.id
  })
  return user
}
