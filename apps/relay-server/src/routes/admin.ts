import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { PasswordValidationError, hashPassword } from '../auth/passwords.js'
import { requireAuthPermission } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import { isRelayRole, relayPermissions } from '../permissions/index.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayInvite, RelayServerArgs, RelayStore, RelayUser } from '../types.js'
import { createToken, normalizeRole, now } from '../utils.js'

const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const cleanEmail = (value: unknown) => cleanString(value).toLowerCase()

const hasOwn = (body: Record<string, unknown>, field: string) => Object.prototype.hasOwnProperty.call(body, field)

const readMaxDevices = (value: unknown) => {
  if (value == null || value === '') return undefined
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : undefined
}

const readMaxDevicesPatch = (value: unknown) => {
  if (value == null || value === '') return { ok: true as const, value: undefined }
  const count = Number(value)
  return Number.isFinite(count) && count >= 0
    ? { ok: true as const, value: Math.trunc(count) }
    : { error: 'User max devices must be a non-negative number.', ok: false as const }
}

const userDeviceCount = (store: RelayStore, user: RelayUser) =>
  store.devices.filter(device => device.userId === user.id).length

const redactUser = (user: RelayUser, store: RelayStore) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  avatarUrl: user.avatarUrl ?? null,
  disabled: user.disabledAt != null,
  disabledAt: user.disabledAt ?? null,
  deviceCount: userDeviceCount(store, user),
  maxDevices: user.maxDevices ?? null,
  passwordEnabled: user.passwordHash != null,
  provider: user.provider ?? null,
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt ?? null
})

const redactInvite = (invite: RelayInvite) => ({
  code: invite.code,
  role: invite.role,
  userId: invite.userId ?? null,
  maxUses: invite.maxUses,
  used: invite.used,
  expiresAt: invite.expiresAt ?? null,
  revokedAt: invite.revokedAt ?? null,
  createdAt: invite.createdAt,
  updatedAt: invite.updatedAt ?? null
})

const pathId = (url: URL, prefix: string) => {
  if (url.pathname === prefix) return undefined
  const escaped = url.pathname.slice(prefix.length + 1)
  return escaped === '' ? undefined : decodeURIComponent(escaped)
}

const duplicateEmail = (store: RelayStore, email: string, userId?: string) => (
  store.users.some(user => user.id !== userId && user.email.toLowerCase() === email)
)

const applyPasswordInput = async (
  user: RelayUser,
  passwordValue: unknown,
  fallbackProviderEmail: string
) => {
  if (passwordValue == null) {
    user.passwordHash = undefined
    if (user.provider === 'password') {
      user.provider = undefined
      user.providerUserId = undefined
    }
    return
  }
  if (typeof passwordValue !== 'string') {
    throw new PasswordValidationError()
  }
  user.passwordHash = await hashPassword(passwordValue)
  if (user.provider == null) {
    user.provider = 'password'
    user.providerUserId = fallbackProviderEmail
  }
}

const findUser = (store: RelayStore, body: Record<string, unknown>, userId: string | undefined) => {
  const id = userId ?? cleanString(body.id)
  if (id !== '') {
    return store.users.find(user => user.id === id)
  }
  const email = cleanEmail(body.email)
  if (email !== '') {
    return store.users.find(user => user.email.toLowerCase() === email)
  }
  return undefined
}

const inviteCodeFromRequest = async (req: IncomingMessage, url: URL, inviteCode: string | undefined) => {
  const queryCode = cleanString(url.searchParams.get('code'))
  if (inviteCode != null && inviteCode !== '') return inviteCode
  if (queryCode !== '') return queryCode
  const body = await readRequestBody(req)
  return cleanString(body.code)
}

const adminUnauthorizedError = 'Admin token required.'

export const handleAdminUsers = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
) => {
  const requiredPermission = req.method === 'GET'
    ? relayPermissions.adminUsersRead
    : relayPermissions.adminUsersWrite
  const auth = requireAuthPermission(req, res, args, store, requiredPermission, {
    unauthorizedError: adminUnauthorizedError
  })
  if (auth == null) {
    return
  }
  const userId = pathId(url, '/api/admin/users')
  if (req.method === 'GET' && userId == null) {
    sendJson(res, 200, { users: store.users.map(user => redactUser(user, store)) }, args.allowOrigin)
    return
  }
  if (req.method === 'POST' && userId == null) {
    const body = await readRequestBody(req)
    const email = cleanEmail(body.email)
    if (email === '') {
      sendJson(res, 400, { error: 'User email is required.' }, args.allowOrigin)
      return
    }
    if (duplicateEmail(store, email)) {
      sendJson(res, 409, { error: 'User email already exists.' }, args.allowOrigin)
      return
    }
    const id = cleanString(body.id)
    if (id !== '' && store.users.some(user => user.id === id)) {
      sendJson(res, 409, { error: 'User id already exists.' }, args.allowOrigin)
      return
    }
    const user: RelayUser = {
      id: id !== '' ? id : randomUUID(),
      email,
      name: cleanString(body.name),
      role: normalizeRole(body.role, 'member'),
      createdAt: now()
    }
    if (hasOwn(body, 'maxDevices')) {
      const maxDevices = readMaxDevices(body.maxDevices)
      if (maxDevices == null && body.maxDevices != null && body.maxDevices !== '') {
        sendJson(res, 400, { error: 'User max devices must be a non-negative number.' }, args.allowOrigin)
        return
      }
      user.maxDevices = maxDevices
    }
    if (hasOwn(body, 'password') && cleanString(body.password) !== '') {
      try {
        await applyPasswordInput(user, body.password, email)
      } catch (error) {
        if (error instanceof PasswordValidationError) {
          sendJson(res, 400, { error: error.message }, args.allowOrigin)
          return
        }
        throw error
      }
    }
    if (body.disabled === true) {
      user.disabledAt = now()
    }
    store.users.push(user)
    await storeRepository.write(store)
    sendJson(res, 200, { user: redactUser(user, store) }, args.allowOrigin)
    return
  }
  if (req.method === 'PATCH') {
    const body = await readRequestBody(req)
    const user = findUser(store, body, userId)
    if (user == null) {
      sendJson(res, 404, { error: 'User not found.' }, args.allowOrigin)
      return
    }
    if (hasOwn(body, 'email')) {
      const email = cleanEmail(body.email)
      if (email === '') {
        sendJson(res, 400, { error: 'User email is required.' }, args.allowOrigin)
        return
      }
      if (duplicateEmail(store, email, user.id)) {
        sendJson(res, 409, { error: 'User email already exists.' }, args.allowOrigin)
        return
      }
      user.email = email
    }
    if (hasOwn(body, 'name')) user.name = cleanString(body.name)
    if (hasOwn(body, 'password')) {
      try {
        await applyPasswordInput(user, body.password, user.email)
      } catch (error) {
        if (error instanceof PasswordValidationError) {
          sendJson(res, 400, { error: error.message }, args.allowOrigin)
          return
        }
        throw error
      }
    }
    if (hasOwn(body, 'role')) {
      if (!isRelayRole(body.role)) {
        sendJson(res, 400, { error: 'Invalid user role.' }, args.allowOrigin)
        return
      }
      if (auth.kind === 'session' && auth.user.id === user.id) {
        sendJson(res, 403, { error: 'Cannot change your own role.' }, args.allowOrigin)
        return
      }
      user.role = body.role
    }
    if (hasOwn(body, 'maxDevices')) {
      const maxDevices = readMaxDevicesPatch(body.maxDevices)
      if (!maxDevices.ok) {
        sendJson(res, 400, { error: maxDevices.error }, args.allowOrigin)
        return
      }
      user.maxDevices = maxDevices.value
    }
    if (hasOwn(body, 'disabled') && typeof body.disabled !== 'boolean') {
      sendJson(res, 400, { error: 'User disabled state must be a boolean.' }, args.allowOrigin)
      return
    }
    if (body.disabled === true && user.disabledAt == null) user.disabledAt = now()
    if (body.disabled === false) user.disabledAt = undefined
    if (body.disabled === true) {
      store.sessions = store.sessions.filter(session => session.userId !== user.id)
    }
    user.updatedAt = now()
    await storeRepository.write(store)
    sendJson(res, 200, { user: redactUser(user, store) }, args.allowOrigin)
    return
  }
  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
}

export const handleAdminInvites = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
) => {
  const requiredPermission = req.method === 'GET'
    ? relayPermissions.adminInvitesRead
    : relayPermissions.adminInvitesWrite
  if (
    requireAuthPermission(req, res, args, store, requiredPermission, { unauthorizedError: adminUnauthorizedError }) ==
      null
  ) {
    return
  }
  const inviteCode = pathId(url, '/api/admin/invites')
  if (req.method === 'GET' && inviteCode == null) {
    sendJson(res, 200, { invites: store.invites.map(redactInvite) }, args.allowOrigin)
    return
  }
  if (req.method === 'POST' && inviteCode == null) {
    const body = await readRequestBody(req)
    let code = cleanString(body.code)
    if (code === '') {
      code = createToken()
      for (let attempt = 0; attempt < 5 && store.invites.some(invite => invite.code === code); attempt += 1) {
        code = createToken()
      }
    }
    if (store.invites.some(invite => invite.code === code)) {
      sendJson(res, 409, { error: 'Invite code already exists.' }, args.allowOrigin)
      return
    }
    const invite: RelayInvite = {
      code,
      role: normalizeRole(body.role, 'member'),
      userId: cleanString(body.userId) !== '' ? cleanString(body.userId) : undefined,
      maxUses: Number.isFinite(Number(body.maxUses)) ? Math.max(1, Math.trunc(Number(body.maxUses))) : 1,
      used: 0,
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined,
      createdAt: now()
    }
    store.invites.push(invite)
    await storeRepository.write(store)
    sendJson(res, 200, { invite: redactInvite(invite) }, args.allowOrigin)
    return
  }
  if (req.method === 'PATCH') {
    const body = await readRequestBody(req)
    const code = inviteCode ?? cleanString(body.code)
    if (code === '') {
      sendJson(res, 400, { error: 'Invite code is required.' }, args.allowOrigin)
      return
    }
    const invite = store.invites.find(item => item.code === code)
    if (invite == null) {
      sendJson(res, 404, { error: 'Invite not found.' }, args.allowOrigin)
      return
    }
    if (body.revoked === true && invite.revokedAt == null) invite.revokedAt = now()
    if (body.revoked === false) invite.revokedAt = undefined
    if (hasOwn(body, 'role')) {
      if (!isRelayRole(body.role)) {
        sendJson(res, 400, { error: 'Invalid invite role.' }, args.allowOrigin)
        return
      }
      invite.role = body.role
    }
    if (Number.isFinite(Number(body.maxUses))) invite.maxUses = Math.max(1, Math.trunc(Number(body.maxUses)))
    invite.updatedAt = now()
    await storeRepository.write(store)
    sendJson(res, 200, { invite: redactInvite(invite) }, args.allowOrigin)
    return
  }
  if (req.method === 'DELETE') {
    const code = await inviteCodeFromRequest(req, url, inviteCode)
    if (code === '') {
      sendJson(res, 400, { error: 'Invite code is required.' }, args.allowOrigin)
      return
    }
    const invite = store.invites.find(item => item.code === code)
    if (invite == null) {
      sendJson(res, 404, { error: 'Invite not found.' }, args.allowOrigin)
      return
    }
    const before = store.invites.length
    store.invites = store.invites.filter(item => item.code !== code)
    if (store.invites.length === before) {
      sendJson(res, 404, { error: 'Invite not found.' }, args.allowOrigin)
      return
    }
    await storeRepository.write(store)
    sendJson(res, 200, { deleted: true, invite: redactInvite(invite) }, args.allowOrigin)
    return
  }
  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
}
