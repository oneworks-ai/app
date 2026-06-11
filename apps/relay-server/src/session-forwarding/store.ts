import type { RelayDeviceSession } from '../types.js'
import { isRecord, now } from '../utils.js'

const toString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const toOptionalString = (value: unknown) => {
  const text = toString(value)
  return text === '' ? undefined : text
}

const toTimestamp = (value: unknown) => toOptionalString(value) ?? now()

const normalizeDeviceSession = (
  deviceId: string,
  value: Record<string, unknown>
): RelayDeviceSession | undefined => {
  const id = toOptionalString(value.id)
  if (id == null) return undefined
  const timestamp = now()
  return {
    id,
    deviceId,
    userId: toOptionalString(value.userId),
    title: id,
    state: toOptionalString(value.state) ?? toOptionalString(value.status),
    lastActiveAt: toOptionalString(value.lastActiveAt),
    createdAt: toTimestamp(value.createdAt),
    updatedAt: toOptionalString(value.updatedAt) ?? timestamp
  }
}

export const normalizeForwardingSessions = (
  deviceId: string,
  value: unknown
): RelayDeviceSession[] => (
  Array.isArray(value)
    ? value.filter(isRecord).map(session => normalizeDeviceSession(deviceId, session))
      .filter((session): session is RelayDeviceSession => session != null)
    : []
)
