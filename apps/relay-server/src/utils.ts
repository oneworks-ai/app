import { randomBytes } from 'node:crypto'

import type { RelayRole } from './types.js'

const relayRoles = new Set<RelayRole>(['owner', 'admin', 'member', 'viewer'])

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

export const now = () => new Date().toISOString()

export const createToken = () => randomBytes(32).toString('base64url')

export const normalizeRole = (value: unknown, fallback: RelayRole): RelayRole => (
  typeof value === 'string' && relayRoles.has(value as RelayRole) ? value as RelayRole : fallback
)
