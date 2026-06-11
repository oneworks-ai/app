import { deviceTokenMatches, hashDeviceToken } from '../devices/private-metadata.js'
import type { RelayDevice, RelaySession, RelayStore } from '../types.js'
import { createToken, now } from '../utils.js'

export type RelayTokenKind = 'admin' | 'device' | 'session'

export interface RelayTokenOperationInput {
  deviceId?: unknown
  kind?: unknown
  sessionToken?: unknown
  token?: unknown
  userId?: unknown
}

export type RelayTokenOperationResult =
  | {
    kind: 'device'
    ok: true
    operation: 'revoke'
    deviceId: string
    revoked: true
  }
  | {
    kind: 'device'
    ok: true
    operation: 'rotate'
    deviceId: string
    deviceToken: string
    rotated: true
  }
  | {
    kind: 'session'
    ok: true
    operation: 'revoke'
    revokedSessions: number
    revoked: true
    userId?: string
  }
  | {
    kind: 'session'
    ok: true
    operation: 'rotate'
    sessionToken: string
    rotated: true
    userId: string
  }
  | {
    kind?: RelayTokenKind
    ok: false
    status: 400 | 404 | 409
    error: string
  }

const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const readKind = (input: RelayTokenOperationInput): RelayTokenKind | undefined => {
  const kind = cleanString(input.kind)
  if (kind === 'admin' || kind === 'device' || kind === 'session') return kind
  return undefined
}

const readSessionToken = (input: RelayTokenOperationInput) => {
  const token = cleanString(input.sessionToken)
  return token === '' ? cleanString(input.token) : token
}

const findDevice = (store: RelayStore, input: RelayTokenOperationInput): RelayDevice | undefined => {
  const deviceId = cleanString(input.deviceId)
  if (deviceId !== '') return store.devices.find(device => device.id === deviceId)
  const token = cleanString(input.token)
  if (token !== '') return store.devices.find(device => deviceTokenMatches(device, token))
  return undefined
}

const findSession = (store: RelayStore, input: RelayTokenOperationInput): RelaySession | undefined => {
  const token = readSessionToken(input)
  if (token === '') return undefined
  return store.sessions.find(session => session.token === token)
}

const unsupportedAdminToken = (): RelayTokenOperationResult => ({
  error: 'Admin token rotation is managed by ONEWORKS_RELAY_ADMIN_TOKEN; update the secret and restart the relay.',
  kind: 'admin',
  ok: false,
  status: 409
})

export const rotateRelayToken = (
  store: RelayStore,
  input: RelayTokenOperationInput,
  sessionTtlMs?: number
): RelayTokenOperationResult => {
  const kind = readKind(input)
  if (kind == null) {
    return {
      error: 'Token kind must be "admin", "device", or "session".',
      ok: false,
      status: 400
    }
  }
  if (kind === 'admin') return unsupportedAdminToken()
  if (kind === 'device') {
    const device = findDevice(store, input)
    if (device == null) {
      return {
        error: 'Device token target not found.',
        kind,
        ok: false,
        status: 404
      }
    }
    const deviceToken = createToken()
    device.deviceTokenHash = hashDeviceToken(deviceToken)
    delete device.deviceToken
    device.lastSeenAt = now()
    return {
      deviceId: device.id,
      deviceToken,
      kind,
      ok: true,
      operation: 'rotate',
      rotated: true
    }
  }
  const session = findSession(store, input)
  if (session == null) {
    return {
      error: 'Session token target not found.',
      kind,
      ok: false,
      status: 404
    }
  }
  const timestamp = now()
  session.token = createToken()
  session.createdAt = timestamp
  session.lastSeenAt = timestamp
  if (sessionTtlMs != null && Number.isFinite(sessionTtlMs) && sessionTtlMs > 0) {
    session.expiresAt = new Date(Date.now() + sessionTtlMs).toISOString()
  }
  return {
    kind,
    ok: true,
    operation: 'rotate',
    rotated: true,
    sessionToken: session.token,
    userId: session.userId
  }
}

export const revokeRelayToken = (
  store: RelayStore,
  input: RelayTokenOperationInput
): RelayTokenOperationResult => {
  const kind = readKind(input)
  if (kind == null) {
    return {
      error: 'Token kind must be "admin", "device", or "session".',
      ok: false,
      status: 400
    }
  }
  if (kind === 'admin') return unsupportedAdminToken()
  if (kind === 'device') {
    const device = findDevice(store, input)
    if (device == null) {
      return {
        error: 'Device token target not found.',
        kind,
        ok: false,
        status: 404
      }
    }
    device.deviceTokenHash = hashDeviceToken(createToken())
    delete device.deviceToken
    device.lastSeenAt = now()
    return {
      deviceId: device.id,
      kind,
      ok: true,
      operation: 'revoke',
      revoked: true
    }
  }
  const token = readSessionToken(input)
  const userId = cleanString(input.userId)
  if (token === '' && userId === '') {
    return {
      error: 'Session token or userId is required.',
      kind,
      ok: false,
      status: 400
    }
  }
  const before = store.sessions.length
  store.sessions = store.sessions.filter(session => {
    if (token !== '') return session.token !== token
    return session.userId !== userId
  })
  const revokedSessions = before - store.sessions.length
  if (revokedSessions === 0) {
    return {
      error: 'Session token target not found.',
      kind,
      ok: false,
      status: 404
    }
  }
  return {
    kind,
    ok: true,
    operation: 'revoke',
    revoked: true,
    revokedSessions,
    ...(userId === '' ? {} : { userId })
  }
}
