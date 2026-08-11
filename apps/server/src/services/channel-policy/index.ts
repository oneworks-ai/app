import { createHash } from 'node:crypto'

import type { ChannelLinkModeration } from '@oneworks/types'

import { getDb } from '#~/db/index.js'
import type { ChannelPolicyScope, ChannelPolicyState, ChannelPolicyStateRow } from '#~/db/index.js'

import { reviewModerationMessage } from './moderation-review'
import type { ModerationReview } from './moderation-review'

const DEFAULT_HIT_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_MUTED_REPLY_TEXT =
  '当前消息已被暂时限制处理。原因：{reason}。剩余时间：{remaining}。下次可回复：{nextReplyAt}。如有异议请联系频道管理员。'

export interface PolicySubject {
  accountId: string
  canonicalUserId?: string
  scope: ChannelPolicyScope
  subjectKey: string
}

export interface PolicyActor {
  accountId: string
  canonicalUserId?: string
  isAdmin: boolean
  moderation?: ChannelLinkModeration
  channelLinkName: string
  channelType: string
  messageId?: string
  text: string
}

export interface PolicyDecision {
  bypassed?: boolean
  kind: 'allow' | 'drop' | 'warn'
  notice?: string
  state?: ChannelPolicyStateRow
}

const canonicalListIncludes = (items: readonly string[] | undefined, userId: string | undefined) => (
  userId != null && items?.includes(userId) === true
)

const accountListIncludes = (items: readonly string[] | undefined, accountId: string) => (
  items?.includes(accountId) === true
)

export const resolvePolicySubject = (input: {
  accountId: string
  canonicalUserId?: string
  moderation?: ChannelLinkModeration
}): PolicySubject => {
  const canonicalUserId = input.canonicalUserId
  const userScope = input.moderation?.subjectScope === 'user' && canonicalUserId != null
  return userScope && canonicalUserId != null
    ? {
      accountId: input.accountId,
      canonicalUserId,
      scope: 'user',
      subjectKey: canonicalUserId
    }
    : {
      accountId: input.accountId,
      canonicalUserId: input.canonicalUserId,
      scope: 'account',
      subjectKey: input.accountId
    }
}

export const buildChannelPolicyKey = (channelLinkName: string, subject: PolicySubject) => (
  [channelLinkName, subject.scope, subject.subjectKey].join('\0')
)

const eventKey = (input: { type: string; policyKey: string; messageId?: string; revision?: number }) =>
  createHash('sha256')
    .update([input.type, input.policyKey, input.messageId ?? '', input.revision ?? ''].join('\0'))
    .digest('hex')

const isBypassed = (actor: PolicyActor) =>
  actor.isAdmin ||
  canonicalListIncludes(actor.moderation?.bypassUsers, actor.canonicalUserId) ||
  accountListIncludes(actor.moderation?.bypassAccounts, actor.accountId) ||
  accountListIncludes(actor.moderation?.bypassSenders, actor.accountId)

const normalizeExpiredState = (state: ChannelPolicyStateRow, now: number) => {
  if (state.state !== 'muted_until' || state.mutedUntil == null || state.mutedUntil > now) return state
  const restored = getDb().compareAndSetChannelPolicyState({
    ...state,
    state: 'normal',
    mutedUntil: null,
    reason: null,
    updatedAt: now,
    updatedBy: 'policy_engine',
    expectedRevision: state.revision
  })
  const next = restored ?? getDb().getChannelPolicyState(state.policyKey) ?? state
  getDb().appendChannelPolicyEvent({
    eventKey: eventKey({ type: 'mute_expired', policyKey: state.policyKey, revision: next.revision }),
    policyKey: state.policyKey,
    channelLinkName: state.channelLinkName,
    eventType: 'mute_expired',
    actorAccountId: state.scope === 'account' ? state.subjectKey : undefined,
    actorUserId: state.scope === 'user' ? state.subjectKey : undefined,
    createdAt: now
  })
  return next
}

const findLevel = (hits: number, moderation: ChannelLinkModeration) => (
  [...(moderation.levels ?? [])]
    .sort((left, right) => right.hit - left.hit)
    .find(level => hits >= level.hit)
)

const stateForLevel = (input: {
  current?: ChannelPolicyStateRow
  level?: NonNullable<ReturnType<typeof findLevel>>
  subject: PolicySubject
  channelLinkName: string
  reason: string
  now: number
  updatedBy: string
  allowPermanent: boolean
}) => {
  const oldWindowStart = input.current?.hitWindowStartedAt
  const windowActive = oldWindowStart != null && input.now - oldWindowStart <= DEFAULT_HIT_WINDOW_MS
  const hits = windowActive ? (input.current?.hits ?? 0) + 1 : 1
  const base = {
    channelLinkName: input.channelLinkName,
    hitWindowStartedAt: windowActive ? oldWindowStart : input.now,
    hits,
    policyKey: buildChannelPolicyKey(input.channelLinkName, input.subject),
    reason: input.reason,
    scope: input.subject.scope,
    subjectKey: input.subject.subjectKey,
    updatedAt: input.now,
    updatedBy: input.updatedBy
  } satisfies Omit<ChannelPolicyStateRow, 'state' | 'mutedUntil' | 'revision'>
  if (input.level?.action === 'mute_permanent' && input.allowPermanent) {
    return { ...base, state: 'muted_permanent' as const, mutedUntil: null }
  }
  if (input.level?.action === 'mute') {
    return { ...base, state: 'muted_until' as const, mutedUntil: input.now + input.level.durationMs! }
  }
  return { ...base, state: input.level?.action === 'warn' ? 'warned' as const : 'normal' as const, mutedUntil: null }
}

export const applyPolicyHit = (input: {
  actor: PolicyActor
  reason: string
  permanentConfirmed?: boolean
  now?: number
}): ChannelPolicyStateRow | undefined => {
  const moderation = input.actor.moderation
  if (moderation == null || moderation.enabled === false || isBypassed(input.actor)) return undefined
  const now = input.now ?? Date.now()
  const subject = resolvePolicySubject(input.actor)
  const policyKey = buildChannelPolicyKey(input.actor.channelLinkName, subject)
  const hitEventKey = eventKey({ type: 'hit', policyKey, messageId: input.actor.messageId })
  const existingEvent = getDb().getChannelPolicyEventByEventKey(hitEventKey)
  if (existingEvent != null) return getDb().getChannelPolicyState(policyKey)
  const current = getDb().getChannelPolicyState(policyKey)
  const normalized = current == null ? undefined : normalizeExpiredState(current, now)
  const hits = normalized != null && normalized.hitWindowStartedAt != null &&
      now - normalized.hitWindowStartedAt <= DEFAULT_HIT_WINDOW_MS
    ? normalized.hits + 1
    : 1
  const level = findLevel(hits, moderation)
  const next = stateForLevel({
    channelLinkName: input.actor.channelLinkName,
    current: normalized,
    level,
    subject,
    reason: input.reason,
    now,
    updatedBy: 'policy_engine',
    allowPermanent: moderation.autoPermanentMute === true || input.permanentConfirmed === true
  })
  const saved = getDb().compareAndSetChannelPolicyState({
    ...next,
    expectedRevision: normalized?.revision
  })
  if (saved == null) return getDb().getChannelPolicyState(policyKey)
  getDb().appendChannelPolicyEvent({
    eventKey: hitEventKey,
    policyKey,
    channelLinkName: input.actor.channelLinkName,
    eventType: saved.state === 'muted_permanent' ? 'muted_permanent' : saved.state,
    actorAccountId: input.actor.accountId,
    actorUserId: input.actor.canonicalUserId,
    metadata: { hits: saved.hits, reason: input.reason },
    createdAt: now
  })
  return saved
}

export const getEffectivePolicyState = (actor: PolicyActor, now = Date.now()) => {
  const subject = resolvePolicySubject(actor)
  const key = buildChannelPolicyKey(actor.channelLinkName, subject)
  const state = getDb().getChannelPolicyState(key)
  return state == null ? undefined : normalizeExpiredState(state, now)
}

const formatRemaining = (until: number | null, now: number) => {
  if (until == null) return '长期限制'
  const remainingMinutes = Math.max(1, Math.ceil((until - now) / 60_000))
  return `${remainingMinutes} 分钟`
}

export const buildMutedNotice = (
  input: { state: ChannelPolicyStateRow; moderation?: ChannelLinkModeration; now?: number }
) => {
  const now = input.now ?? Date.now()
  const template = input.moderation?.replyText?.trim() || DEFAULT_MUTED_REPLY_TEXT
  const nextReplyAt = input.state.mutedUntil == null
    ? '请联系频道管理员'
    : new Date(input.state.mutedUntil).toISOString()
  return template
    .replace('{reason}', input.state.reason || '频道策略限制')
    .replace('{remaining}', formatRemaining(input.state.mutedUntil, now))
    .replace('{nextReplyAt}', nextReplyAt)
}

const reviewToHit = (review: ModerationReview, actor: PolicyActor, now: number) => {
  if (review.severity === 'none') return undefined
  if (review.confidence < 0.75) {
    const subject = resolvePolicySubject(actor)
    const policyKey = buildChannelPolicyKey(actor.channelLinkName, subject)
    getDb().appendChannelPolicyEvent({
      eventKey: eventKey({ type: 'low_confidence_review', policyKey, messageId: actor.messageId }),
      policyKey,
      channelLinkName: actor.channelLinkName,
      eventType: 'low_confidence_review',
      actorAccountId: actor.accountId,
      actorUserId: actor.canonicalUserId,
      metadata: { confidence: review.confidence, reason: review.reason },
      createdAt: now
    })
    return undefined
  }
  return applyPolicyHit({ actor, reason: review.reason, now })
}

export const reviewAndApplyPolicy = async (actor: PolicyActor, recentBehaviorSummary = '') => {
  const moderation = actor.moderation
  if (moderation == null || moderation.enabled === false || isBypassed(actor)) return undefined
  const now = Date.now()
  const result = await reviewModerationMessage({
    moderation,
    recentBehaviorSummary,
    text: actor.text
  })
  if (result.kind !== 'review') {
    const subject = resolvePolicySubject(actor)
    const policyKey = buildChannelPolicyKey(actor.channelLinkName, subject)
    getDb().appendChannelPolicyEvent({
      eventKey: eventKey({ type: `moderation_${result.kind}`, policyKey, messageId: actor.messageId }),
      policyKey,
      channelLinkName: actor.channelLinkName,
      eventType: `moderation_${result.kind}`,
      actorAccountId: actor.accountId,
      actorUserId: actor.canonicalUserId,
      createdAt: now
    })
    return undefined
  }
  return reviewToHit(result.review, actor, now)
}

export const evaluateInboundPolicy = async (actor: PolicyActor): Promise<PolicyDecision> => {
  if (isBypassed(actor)) {
    return { bypassed: true, kind: 'allow' }
  }
  const state = getEffectivePolicyState(actor)
  if (state?.state === 'muted_until' || state?.state === 'muted_permanent') {
    const subject = resolvePolicySubject(actor)
    getDb().appendChannelPolicyEvent({
      eventKey: eventKey({
        type: 'drop',
        policyKey: buildChannelPolicyKey(actor.channelLinkName, subject),
        messageId: actor.messageId
      }),
      policyKey: state.policyKey,
      channelLinkName: actor.channelLinkName,
      eventType: 'drop',
      actorAccountId: actor.accountId,
      actorUserId: actor.canonicalUserId,
      createdAt: Date.now()
    })
    return { kind: 'drop', state }
  }
  const reviewed = await reviewAndApplyPolicy(actor)
  if (reviewed?.state === 'muted_until' || reviewed?.state === 'muted_permanent') {
    return { kind: 'drop', state: reviewed }
  }
  return reviewed?.state === 'warned' ? { kind: 'warn', state: reviewed } : { kind: 'allow', state: reviewed }
}

export const isPolicyBypassed = isBypassed
