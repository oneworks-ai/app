import { randomUUID } from 'node:crypto'

import type { RelayRole, RelayStore, RelayUser } from '../types.js'
import { now } from '../utils.js'
import { consumeInvite, findUsableInvite } from './invites.js'

export interface InviteLoginInput {
  email: string
  inviteCode: string
  name?: string
  passwordHash?: string
}

export class InviteLoginError extends Error {
  readonly status: number

  constructor(message: string, status = 403) {
    super(message)
    this.name = 'InviteLoginError'
    this.status = status
  }
}

const roleRank: Record<RelayRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3
}

const normalizeName = (value: string | undefined, email: string) => {
  const name = value?.trim() ?? ''
  if (name !== '') return name
  return email.split('@', 1)[0] || email
}

const shouldUpgradeRole = (currentRole: RelayRole, inviteRole: RelayRole) => (
  roleRank[inviteRole] > roleRank[currentRole]
)

const updateExistingInviteUser = (
  user: RelayUser,
  input: InviteLoginInput,
  inviteRole: RelayRole,
  timestamp: string
) => {
  if (user.disabledAt != null) {
    throw new InviteLoginError('User disabled.')
  }
  if ((user.name == null || user.name.trim() === '') && input.name != null) {
    user.name = input.name.trim()
  }
  if (input.passwordHash != null) {
    user.passwordHash = input.passwordHash
    if (user.provider == null || user.provider === 'invite') user.provider = 'password'
  } else if (user.provider == null) {
    user.provider = 'invite'
  }
  if (user.providerUserId == null) user.providerUserId = input.email
  if (shouldUpgradeRole(user.role, inviteRole)) user.role = inviteRole
  user.updatedAt = timestamp
  return user
}

export const upsertInviteLoginUser = (store: RelayStore, input: InviteLoginInput) => {
  const invite = findUsableInvite(store, input.inviteCode)
  if (invite == null) {
    throw new InviteLoginError('Invite required.')
  }

  const timestamp = now()
  const existing = store.users.find(user => user.email.toLowerCase() === input.email.toLowerCase())
  if (existing != null) {
    const user = updateExistingInviteUser(existing, input, invite.role, timestamp)
    consumeInvite(invite)
    return user
  }

  const userId = invite.userId ?? randomUUID()
  if (store.users.some(user => user.id === userId)) {
    throw new InviteLoginError('Invite user id already exists.', 409)
  }

  const user: RelayUser = {
    id: userId,
    email: input.email,
    name: normalizeName(input.name, input.email),
    passwordHash: input.passwordHash,
    provider: input.passwordHash == null ? 'invite' : 'password',
    providerUserId: input.email,
    role: invite.role,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  consumeInvite(invite)
  store.users.push(user)
  return user
}
