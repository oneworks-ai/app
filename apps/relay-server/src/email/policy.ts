/* eslint-disable max-lines -- Email risk policy keeps bucket accounting and challenge reuse in one transactional unit. */
import { Buffer } from 'node:buffer'
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'

import type {
  RelayEmailChallenge,
  RelayEmailConfig,
  RelayEmailPurpose,
  RelayEmailRiskBucket,
  RelayStore
} from '../types.js'
import { now } from '../utils.js'
import { evaluateRelayEmailDomain } from './domains.js'

export type RelayEmailRiskRejectCode =
  | 'domain_rejected'
  | 'email_budget_exceeded'
  | 'email_rate_limited'

export interface RelayEmailChallengeSendPrepared {
  allowed: true
  challenge: RelayEmailChallenge
  code?: string
  retryAfterSeconds?: number
  reused: boolean
}

export interface RelayEmailChallengeSendRejected {
  allowed: false
  code: RelayEmailRiskRejectCode
  retryAfterSeconds?: number
}

export type RelayEmailChallengeSendDecision =
  | RelayEmailChallengeSendPrepared
  | RelayEmailChallengeSendRejected

export type RelayEmailChallengeVerifyResult =
  | {
    challenge: RelayEmailChallenge
    verified: true
  }
  | {
    reason: 'expired' | 'invalid'
    verified: false
  }

interface RelayEmailLimitTarget {
  key: string
  max: number
  resetAtMs: number
}

const hashText = (value: string) => createHash('sha256').update(value).digest('hex')

export const hashRelayEmailAddress = (email: string) => hashText(email).slice(0, 32)

const hashRelayEmailCode = (input: {
  code: string
  emailHash: string
  purpose: RelayEmailPurpose
}) => hashText(`${input.purpose}:${input.emailHash}:${input.code}`)

const safeEqualHex = (left: string, right: string) => {
  if (left.length !== right.length) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

const createVerificationCode = () => randomInt(0, 1_000_000).toString().padStart(6, '0')

const parseTimeMs = (value: string | undefined) => {
  if (value == null) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const resetAtIso = (value: number) => new Date(value).toISOString()

const retryAfterSeconds = (resetAtMs: number, nowMs: number) => Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000))

const nextUtcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)

const nextUtcMonth = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)

const utcDayKey = (date: Date) => date.toISOString().slice(0, 10)

const utcMonthKey = (date: Date) => date.toISOString().slice(0, 7)

const activeChallenge = (
  store: RelayStore,
  input: {
    emailHash: string
    nowMs: number
    purpose: RelayEmailPurpose
  }
) =>
  store.emailRisk.challenges.find(challenge =>
    challenge.emailHash === input.emailHash &&
    challenge.purpose === input.purpose &&
    challenge.verifiedAt == null &&
    parseTimeMs(challenge.expiresAt) > input.nowMs
  )

const pruneEmailRiskState = (store: RelayStore, nowMs: number) => {
  store.emailRisk.buckets = store.emailRisk.buckets.filter(bucket => parseTimeMs(bucket.resetAt) > nowMs)
  store.emailRisk.challenges = store.emailRisk.challenges.filter(challenge => parseTimeMs(challenge.expiresAt) > nowMs)
}

const findBucket = (
  buckets: RelayEmailRiskBucket[],
  key: string,
  resetAtMs: number,
  nowMs: number
) => {
  const bucket = buckets.find(item => item.key === key)
  if (bucket != null && parseTimeMs(bucket.resetAt) > nowMs) return bucket
  if (bucket != null) {
    bucket.count = 0
    bucket.resetAt = resetAtIso(resetAtMs)
    bucket.updatedAt = now()
    return bucket
  }
  const nextBucket: RelayEmailRiskBucket = {
    count: 0,
    key,
    resetAt: resetAtIso(resetAtMs),
    updatedAt: now()
  }
  buckets.push(nextBucket)
  return nextBucket
}

const checkLimitTargets = (
  store: RelayStore,
  targets: RelayEmailLimitTarget[],
  nowMs: number
): RelayEmailChallengeSendRejected | undefined => {
  for (const target of targets) {
    const bucket = findBucket(store.emailRisk.buckets, target.key, target.resetAtMs, nowMs)
    if (bucket.count >= target.max) {
      return {
        allowed: false,
        code: target.key.startsWith('global:') ? 'email_budget_exceeded' : 'email_rate_limited',
        retryAfterSeconds: retryAfterSeconds(parseTimeMs(bucket.resetAt), nowMs)
      }
    }
  }
  return undefined
}

const incrementLimitTargets = (
  store: RelayStore,
  targets: RelayEmailLimitTarget[],
  nowMs: number
) => {
  const updatedAt = resetAtIso(nowMs)
  for (const target of targets) {
    const bucket = findBucket(store.emailRisk.buckets, target.key, target.resetAtMs, nowMs)
    bucket.count += 1
    bucket.updatedAt = updatedAt
  }
}

const limitTargets = (
  config: RelayEmailConfig,
  input: {
    domain: string
    emailHash: string
    ip: string
    nowMs: number
  }
): RelayEmailLimitTarget[] => {
  const nowDate = new Date(input.nowMs)
  return [
    {
      key: `email:${input.emailHash}`,
      max: config.risk.perEmail.max,
      resetAtMs: input.nowMs + config.risk.perEmail.windowMs
    },
    {
      key: `ip:${input.ip}`,
      max: config.risk.perIp.max,
      resetAtMs: input.nowMs + config.risk.perIp.windowMs
    },
    {
      key: `domain:${input.domain}`,
      max: config.risk.perDomain.max,
      resetAtMs: input.nowMs + config.risk.perDomain.windowMs
    },
    {
      key: `global:day:${utcDayKey(nowDate)}`,
      max: config.risk.dailyBudget,
      resetAtMs: nextUtcDay(nowDate)
    },
    {
      key: `global:month:${utcMonthKey(nowDate)}`,
      max: config.risk.monthlyBudget,
      resetAtMs: nextUtcMonth(nowDate)
    }
  ].filter(target => target.max >= 0)
}

export const prepareRelayEmailChallengeSend = (
  store: RelayStore,
  config: RelayEmailConfig,
  input: {
    email: string
    ip: string
    nowMs?: number
    purpose: RelayEmailPurpose
  }
): RelayEmailChallengeSendDecision => {
  const nowMs = input.nowMs ?? Date.now()
  pruneEmailRiskState(store, nowMs)
  const emailHash = hashRelayEmailAddress(input.email)
  const existingChallenge = activeChallenge(store, {
    emailHash,
    nowMs,
    purpose: input.purpose
  })
  if (existingChallenge != null) {
    const resendAtMs = parseTimeMs(existingChallenge.lastSentAt) + config.risk.resendCooldownMs
    const reusedDecision: RelayEmailChallengeSendPrepared = {
      allowed: true,
      challenge: existingChallenge,
      reused: true
    }
    if (resendAtMs > nowMs) reusedDecision.retryAfterSeconds = retryAfterSeconds(resendAtMs, nowMs)
    return reusedDecision
  }

  const domainDecision = evaluateRelayEmailDomain(input.email, {
    allowDomains: config.risk.allowDomains,
    blockDomains: config.risk.blockDomains,
    disposableBlocklist: config.risk.disposableBlocklist
  })
  if (!domainDecision.allowed) {
    return {
      allowed: false,
      code: 'domain_rejected'
    }
  }

  const targets = config.risk.enabled
    ? limitTargets(config, {
      domain: domainDecision.domain,
      emailHash,
      ip: input.ip,
      nowMs
    })
    : []
  const rejected = checkLimitTargets(store, targets, nowMs)
  if (rejected != null) return rejected

  const code = createVerificationCode()
  const timestamp = resetAtIso(nowMs)
  const challenge: RelayEmailChallenge = {
    codeHash: hashRelayEmailCode({
      code,
      emailHash,
      purpose: input.purpose
    }),
    createdAt: timestamp,
    domain: domainDecision.domain,
    emailHash,
    expiresAt: resetAtIso(nowMs + config.risk.codeTtlMs),
    id: randomUUID(),
    lastSentAt: timestamp,
    purpose: input.purpose,
    sendCount: 1
  }
  incrementLimitTargets(store, targets, nowMs)
  store.emailRisk.challenges.push(challenge)
  return {
    allowed: true,
    challenge,
    code,
    reused: false
  }
}

export const rememberRelayEmailProviderResult = (
  store: RelayStore,
  challengeId: string,
  messageId: string | undefined
) => {
  const challenge = store.emailRisk.challenges.find(item => item.id === challengeId)
  if (challenge == null) return
  challenge.providerMessageId = messageId
  challenge.updatedAt = now()
}

export const verifyRelayEmailChallengeCode = (
  store: RelayStore,
  input: {
    consume?: boolean
    code: string
    email: string
    nowMs?: number
    purpose: RelayEmailPurpose
  }
): RelayEmailChallengeVerifyResult => {
  const nowMs = input.nowMs ?? Date.now()
  pruneEmailRiskState(store, nowMs)
  const emailHash = hashRelayEmailAddress(input.email)
  const expectedHash = hashRelayEmailCode({
    code: input.code,
    emailHash,
    purpose: input.purpose
  })
  const challenge = store.emailRisk.challenges.find(item =>
    item.emailHash === emailHash &&
    item.purpose === input.purpose &&
    item.verifiedAt == null &&
    parseTimeMs(item.expiresAt) > nowMs &&
    safeEqualHex(item.codeHash, expectedHash)
  )
  if (challenge == null) return { reason: 'invalid', verified: false }
  if (input.consume === true) {
    challenge.verifiedAt = resetAtIso(nowMs)
    challenge.updatedAt = challenge.verifiedAt
  }
  return { challenge, verified: true }
}
