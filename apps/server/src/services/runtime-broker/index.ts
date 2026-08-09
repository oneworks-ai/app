import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { RuntimeBroker } from '@oneworks/runtime-broker'
import type { RuntimeBrokerDriver, RuntimeBrokerHttpConnection } from '@oneworks/runtime-broker'

import { logger } from '#~/utils/logger.js'

export type RuntimeBrokerPrincipal =
  | { kind: 'workspace'; ownerId: string }
  | { driverId: string; kind: 'driver'; leaseId?: string; profileKey: string }

const WORKSPACE_TOKEN_PREFIX = 'workspace'
const DRIVER_TOKEN_PREFIX = 'driver'
const secret = randomBytes(32)
const createCallbackGeneration = () => randomBytes(16).toString('base64url')
const createBroker = () =>
  new RuntimeBroker({
    onError: error => logger.warn({ error }, '[runtime-broker] background operation failed')
  })

let broker = createBroker()
let brokerUrl: string | undefined
let callbackGeneration = createCallbackGeneration()

const signWorkspaceToken = (payload: string) => createHmac('sha256', secret).update(payload).digest('base64url')

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export const configureRuntimeBrokerTransport = (serverBaseUrl: string | undefined) => {
  brokerUrl = serverBaseUrl == null
    ? undefined
    : new URL('/api/internal/runtime-broker', `${serverBaseUrl.replace(/\/+$/u, '')}/`).toString()
}

export const getRuntimeBroker = () => broker

export const registerRuntimeBrokerDriver = (driver: RuntimeBrokerDriver) => broker.registerDriver(driver)

export const getRuntimeBrokerWorkspaceConnection = (
  ownerId: string
): RuntimeBrokerHttpConnection | undefined => {
  if (brokerUrl == null) return undefined
  const encodedOwner = Buffer.from(ownerId, 'utf8').toString('base64url')
  const payload = `${WORKSPACE_TOKEN_PREFIX}.${encodedOwner}`
  return {
    token: `${payload}.${signWorkspaceToken(payload)}`,
    url: brokerUrl
  }
}

export const getRuntimeBrokerCallbackConnection = (
  driverId: string,
  profileKey: string,
  leaseId?: string
): RuntimeBrokerHttpConnection | undefined => {
  if (brokerUrl == null) return undefined
  const encodedDriver = Buffer.from(driverId, 'utf8').toString('base64url')
  const encodedProfile = Buffer.from(profileKey, 'utf8').toString('base64url')
  const encodedLease = leaseId == null ? undefined : Buffer.from(leaseId, 'utf8').toString('base64url')
  const payload = encodedLease == null
    ? `${DRIVER_TOKEN_PREFIX}.${callbackGeneration}.${encodedDriver}.${encodedProfile}`
    : `${DRIVER_TOKEN_PREFIX}.${callbackGeneration}.${encodedDriver}.${encodedProfile}.${encodedLease}`
  return { token: `${payload}.${signWorkspaceToken(payload)}`, url: brokerUrl }
}

export const authenticateRuntimeBrokerToken = (token: string | undefined): RuntimeBrokerPrincipal | undefined => {
  const normalized = token?.trim()
  if (normalized == null || normalized === '') return undefined
  const parts = normalized.split('.')
  try {
    if (parts[0] === WORKSPACE_TOKEN_PREFIX && parts.length === 3) {
      const payload = `${parts[0]}.${parts[1]}`
      if (!safeEqual(parts[2]!, signWorkspaceToken(payload))) return undefined
      const ownerId = Buffer.from(parts[1]!, 'base64url').toString('utf8').trim()
      return ownerId === '' ? undefined : { kind: 'workspace', ownerId }
    }
    if (parts[0] === DRIVER_TOKEN_PREFIX && (parts.length === 5 || parts.length === 6)) {
      const signatureIndex = parts.length - 1
      const payload = parts.slice(0, signatureIndex).join('.')
      if (!safeEqual(parts[signatureIndex]!, signWorkspaceToken(payload))) return undefined
      if (!safeEqual(parts[1]!, callbackGeneration)) return undefined
      const driverId = Buffer.from(parts[2]!, 'base64url').toString('utf8').trim()
      const profileKey = Buffer.from(parts[3]!, 'base64url').toString('utf8').trim()
      const leaseId = parts.length === 6
        ? Buffer.from(parts[4]!, 'base64url').toString('utf8').trim()
        : undefined
      return driverId === '' || profileKey === ''
        ? undefined
        : { driverId, kind: 'driver', profileKey, ...(leaseId == null || leaseId === '' ? {} : { leaseId }) }
    }
    return undefined
  } catch {
    return undefined
  }
}

export const disposeRuntimeBroker = async () => {
  configureRuntimeBrokerTransport(undefined)
  const disposingBroker = broker
  broker = createBroker()
  callbackGeneration = createCallbackGeneration()
  await disposingBroker.dispose()
}
