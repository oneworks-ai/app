import type { RelayInvite, RelayStore } from '../types.js'
import { now } from '../utils.js'

export const findUsableInvite = (store: RelayStore, inviteCode: string | undefined) => {
  if (inviteCode == null || inviteCode === '') return undefined
  const invite = store.invites.find(item => item.code === inviteCode)
  if (invite == null) return undefined
  if (invite.revokedAt != null) return undefined
  if (typeof invite.expiresAt === 'string' && Date.parse(invite.expiresAt) < Date.now()) return undefined
  if (invite.used >= invite.maxUses) return undefined
  return invite
}

export const consumeInvite = (invite: RelayInvite | undefined) => {
  if (invite == null) return
  invite.used += 1
  invite.updatedAt = now()
}
