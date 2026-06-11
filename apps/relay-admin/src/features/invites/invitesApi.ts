import { requestJson } from '../../shared/api/requestJson'
import type { CreateInviteInput, RelayAdminInvite } from '../../shared/model/adminTypes'

export const fetchRelayAdminInvites = async (token: string) =>
  await requestJson<{ invites: RelayAdminInvite[] }>(token, '/api/admin/invites')

export const createRelayAdminInvite = async (token: string, input: CreateInviteInput) =>
  await requestJson<{ invite: RelayAdminInvite }>(token, '/api/admin/invites', {
    body: JSON.stringify(input),
    method: 'POST'
  })

export const updateRelayAdminInvite = async (
  token: string,
  input: {
    code: string
    revoked?: boolean
    role?: RelayAdminInvite['role']
  }
) =>
  await requestJson<{ invite: RelayAdminInvite }>(token, '/api/admin/invites', {
    body: JSON.stringify(input),
    method: 'PATCH'
  })

export const deleteRelayAdminInvite = async (token: string, code: string) =>
  await requestJson<{ deleted: boolean }>(token, `/api/admin/invites?code=${encodeURIComponent(code)}`, {
    method: 'DELETE'
  })
