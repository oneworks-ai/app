import type { IncomingMessage, ServerResponse } from 'node:http'
import process from 'node:process'

import type { RelayServerArgs } from '../types.js'
import { auditStatusFromHttpStatus, recordRequestAuditEvent } from './audit.js'
import { classifyRateLimitedRequest } from './rate-limit-classifier.js'

export type RelayRateLimitCategory =
  | 'admin-mutation'
  | 'auth'
  | 'device-registration'
  | 'device-session-claim'

interface RelayRateLimitRule {
  category: RelayRateLimitCategory
  key: string
  max: number
  windowMs: number
}

export interface RelayRateLimitDecision {
  allowed: boolean
  category?: RelayRateLimitCategory
  limit?: number
  remaining?: number
  resetAt?: number
  retryAfterSeconds?: number
}

interface RelayRateLimitBucket {
  count: number
  resetAt: number
}

const DEFAULT_LIMITS: Record<RelayRateLimitCategory, { max: number; windowSeconds: number }> = {
  'admin-mutation': { max: 60, windowSeconds: 60 },
  auth: { max: 20, windowSeconds: 60 },
  'device-registration': { max: 20, windowSeconds: 60 },
  'device-session-claim': { max: 120, windowSeconds: 60 }
}

const ENV_PREFIX: Record<RelayRateLimitCategory, string> = {
  'admin-mutation': 'ONEWORKS_RELAY_RATE_LIMIT_ADMIN_MUTATION',
  auth: 'ONEWORKS_RELAY_RATE_LIMIT_AUTH',
  'device-registration': 'ONEWORKS_RELAY_RATE_LIMIT_DEVICE_REGISTER',
  'device-session-claim': 'ONEWORKS_RELAY_RATE_LIMIT_DEVICE_CLAIM'
}

const disabledValues = new Set(['0', 'false', 'no', 'off'])

const enabledFromEnv = () => {
  const value = process.env.ONEWORKS_RELAY_RATE_LIMIT_ENABLED?.trim().toLowerCase()
  return value == null || !disabledValues.has(value)
}

const readPositiveInteger = (name: string, fallback: number) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

const readNonNegativeInteger = (name: string, fallback: number) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

const readRuleSettings = (category: RelayRateLimitCategory) => {
  const defaults = DEFAULT_LIMITS[category]
  const prefix = ENV_PREFIX[category]
  return {
    max: readNonNegativeInteger(`${prefix}_MAX`, defaults.max),
    windowMs: readPositiveInteger(`${prefix}_WINDOW_SECONDS`, defaults.windowSeconds) * 1000
  }
}

export const createRelayRateLimiter = () => {
  const enabled = enabledFromEnv()
  const buckets = new Map<string, RelayRateLimitBucket>()
  const rules = new Map<RelayRateLimitCategory, { max: number; windowMs: number }>(
    Object.keys(DEFAULT_LIMITS).map(category => [
      category as RelayRateLimitCategory,
      readRuleSettings(category as RelayRateLimitCategory)
    ])
  )

  const pruneExpiredBuckets = (nowMs: number) => {
    if (buckets.size < 10_000) return
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= nowMs) buckets.delete(key)
    }
  }

  const check = (req: IncomingMessage, url: URL): RelayRateLimitDecision => {
    if (!enabled) return { allowed: true }
    const target = classifyRateLimitedRequest(req, url)
    if (target == null) return { allowed: true }
    const rule = rules.get(target.category)
    if (rule == null || rule.max <= 0 || rule.windowMs <= 0) return { allowed: true }
    const nowMs = Date.now()
    pruneExpiredBuckets(nowMs)
    const key = `${target.category}:${target.key}`
    const bucket = buckets.get(key)
    const nextBucket = bucket == null || bucket.resetAt <= nowMs
      ? { count: 1, resetAt: nowMs + rule.windowMs }
      : { count: bucket.count + 1, resetAt: bucket.resetAt }
    buckets.set(key, nextBucket)
    const remaining = Math.max(0, rule.max - nextBucket.count)
    if (nextBucket.count <= rule.max) {
      return {
        allowed: true,
        category: target.category,
        limit: rule.max,
        remaining,
        resetAt: nextBucket.resetAt
      }
    }
    return {
      allowed: false,
      category: target.category,
      limit: rule.max,
      remaining: 0,
      resetAt: nextBucket.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((nextBucket.resetAt - nowMs) / 1000))
    }
  }

  return { check }
}

export const sendRateLimitExceeded = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  decision: RelayRateLimitDecision
) => {
  const status = 429
  const retryAfterSeconds = decision.retryAfterSeconds ?? 1
  recordRequestAuditEvent(req, {
    actor: 'anonymous',
    action: 'rate_limit.blocked',
    resource: decision.category ?? 'unknown',
    status: auditStatusFromHttpStatus(status)
  })
  res.writeHead(status, {
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-origin': args.allowOrigin,
    'content-type': 'application/json; charset=utf-8',
    'retry-after': String(retryAfterSeconds),
    'x-ratelimit-limit': String(decision.limit ?? ''),
    'x-ratelimit-remaining': '0',
    'x-ratelimit-reset': decision.resetAt == null ? '' : new Date(decision.resetAt).toISOString()
  })
  res.end(`${
    JSON.stringify({
      error: 'Too many requests.',
      rateLimit: {
        category: decision.category,
        retryAfterSeconds
      }
    })
  }\n`)
}
