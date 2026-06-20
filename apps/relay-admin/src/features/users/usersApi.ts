import { requestJson } from '../../shared/api/requestJson'
import type { CreateUserInput, RelayAdminUser, UpdateUserInput } from '../../shared/model/adminTypes'

const readDeviceCount = (user: RelayAdminUser) => {
  const count = Number((user as { deviceCount?: unknown }).deviceCount)
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
}

const readMaxDevices = (user: RelayAdminUser) => {
  const value = (user as { maxDevices?: unknown }).maxDevices
  if (value == null || value === '') return null
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : null
}

const normalizeRelayAdminUser = (user: RelayAdminUser): RelayAdminUser => ({
  ...user,
  deviceCount: readDeviceCount(user),
  effectiveAccess: user.effectiveAccess ?? { capabilities: [], deniedCapabilities: [], quotas: {}, sources: [] },
  groupIds: Array.isArray(user.groupIds) ? user.groupIds : [`platform:${user.role}`],
  loginId: typeof user.loginId === 'string' && user.loginId.trim() !== '' ? user.loginId.trim() : null,
  maxDevices: readMaxDevices(user)
})

export const fetchRelayAdminUsers = async (token: string) =>
  await requestJson<{ users: RelayAdminUser[] }>(token, '/api/admin/users')
    .then(body => ({ users: body.users.map(normalizeRelayAdminUser) }))

export const createRelayAdminUser = async (token: string, input: CreateUserInput) =>
  await requestJson<{ user: RelayAdminUser }>(token, '/api/admin/users', {
    body: JSON.stringify(input),
    method: 'POST'
  }).then(body => ({ user: normalizeRelayAdminUser(body.user) }))

export const updateRelayAdminUser = async (
  token: string,
  input: UpdateUserInput
) =>
  await requestJson<{ user: RelayAdminUser }>(token, '/api/admin/users', {
    body: JSON.stringify(input),
    method: 'PATCH'
  }).then(body => ({ user: normalizeRelayAdminUser(body.user) }))
