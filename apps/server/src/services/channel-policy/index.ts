/* eslint-disable max-lines -- moderation state transitions and audit events form one policy state machine. */
import { createHash } from 'node:crypto'

import type { ChannelLinkIssuerAccountRef, ChannelLinkModeration } from '@oneworks/types'

import { getDb } from '#~/db/index.js'
import type { ChannelPolicyScope, ChannelPolicyStateRow } from '#~/db/index.js'
import { encodeChannelRuntimeKey } from '#~/services/channel-runtime-key.js'

import { reviewModerationMessage } from './moderation-review'
import type { ModerationReview } from './moderation-review'

export { processOffhourBacklogDigest } from './backlog-digest'

const DEFAULT_HIT_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_MUTED_REPLY_TEXT =
  '当前消息已被暂时限制处理。原因：{reason}。剩余时间：{remaining}。下次可回复：{nextReplyAt}。如有异议请联系OneWorks 频道员。'
const MIN_CONFIDENCE = 0.75

export interface PolicySubject {
  accountId: string
  canonicalUserId?: string
  issuerKey: string
  scope: ChannelPolicyScope
  subjectKey: string
}

export interface PolicyActor {
  accountId: string
  canonicalUserId?: string
  issuerKey: string
  isAdmin: boolean
  isBoss?: boolean
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

export const buildChannelAccountPrincipal = (issuerKey: string, accountId: string) =>
  encodeChannelRuntimeKey(issuerKey, accountId)

const isIssuerAccount = (items: readonly ChannelLinkIssuerAccountRef[] | undefined, actor: PolicyActor) => (
  items?.some(item => item.issuerKey === actor.issuerKey && item.accountId === actor.accountId) === true
)

export const resolvePolicySubject = (
  input: Pick<PolicyActor, 'accountId' | 'canonicalUserId' | 'issuerKey' | 'moderation'>
): PolicySubject => {
  if (input.moderation?.subjectScope === 'user' && input.canonicalUserId != null) {
    return {
      accountId: input.accountId,
      canonicalUserId: input.canonicalUserId,
      issuerKey: input.issuerKey,
      scope: 'user',
      subjectKey: input.canonicalUserId
    }
  }
  return {
    accountId: input.accountId,
    canonicalUserId: input.canonicalUserId,
    issuerKey: input.issuerKey,
    scope: 'account',
    subjectKey: buildChannelAccountPrincipal(input.issuerKey, input.accountId)
  }
}

export const buildChannelPolicyKey = (channelLinkName: string, subject: PolicySubject) => (
  encodeChannelRuntimeKey(channelLinkName, subject.scope, subject.subjectKey)
)

const eventKey = (input: { type: string; policyKey: string; messageId?: string; revision?: number }) =>
  createHash('sha256')
    .update([input.type, input.policyKey, input.messageId ?? '', input.revision ?? ''].join('\0'))
    .digest('hex')

const isBypassed = (actor: PolicyActor) =>
  actor.isAdmin || actor.isBoss === true ||
  (actor.canonicalUserId != null && actor.moderation?.bypassUsers?.includes(actor.canonicalUserId) === true) ||
  isIssuerAccount(actor.moderation?.bypassAccounts, actor) ||
  isIssuerAccount(actor.moderation?.bypassSenders, actor)

const findLevel = (hits: number, moderation: ChannelLinkModeration) => (
  [...(moderation.levels ?? [])].sort((left, right) => right.hit - left.hit).find(level => hits >= level.hit)
)

const buildState = (input: {
  actor: PolicyActor
  current?: ChannelPolicyStateRow
  now: number
  reason: string
  permanentConfirmedByAdmin?: boolean
}) => {
  const subject = resolvePolicySubject(input.actor)
  const windowActive = input.current?.hitWindowStartedAt != null &&
    input.now - input.current.hitWindowStartedAt <= DEFAULT_HIT_WINDOW_MS
  const hits = windowActive ? (input.current?.hits ?? 0) + 1 : 1
  const level = findLevel(hits, input.actor.moderation!)
  const state = level?.action === 'mute_permanent' && (
      input.actor.moderation?.autoPermanentMute === true ||
      input.permanentConfirmedByAdmin === true
    )
    ? 'muted_permanent' as const
    : level?.action === 'mute'
    ? 'muted_until' as const
    : level?.action === 'warn'
    ? 'warned' as const
    : 'normal' as const
  return {
    channelLinkName: input.actor.channelLinkName,
    hitWindowStartedAt: windowActive ? input.current!.hitWindowStartedAt : input.now,
    hits,
    mutedUntil: state === 'muted_until' ? input.now + level!.durationMs! : null,
    policyKey: buildChannelPolicyKey(input.actor.channelLinkName, subject),
    reason: state === 'normal' ? null : input.reason,
    scope: subject.scope,
    state,
    subjectKey: subject.subjectKey,
    updatedAt: input.now,
    updatedBy: 'policy_engine'
  }
}

const normalizeExpiredState = (state: ChannelPolicyStateRow, now: number) => {
  if (state.state !== 'muted_until' || state.mutedUntil == null || state.mutedUntil > now) return state
  const restored = getDb().compareAndSetChannelPolicyState({
    ...state,
    mutedUntil: null,
    reason: null,
    state: 'normal',
    updatedAt: now,
    updatedBy: 'policy_engine',
    expectedRevision: state.revision
  })
  if (restored != null) {
    getDb().appendChannelPolicyEvent({
      actorAccountId: state.scope === 'account' ? state.subjectKey : undefined,
      actorUserId: state.scope === 'user' ? state.subjectKey : undefined,
      channelLinkName: state.channelLinkName,
      createdAt: now,
      eventKey: eventKey({ type: 'mute_expired', policyKey: state.policyKey, revision: restored.revision }),
      eventType: 'mute_expired',
      policyKey: state.policyKey
    })
  }
  return restored ?? getDb().getChannelPolicyState(state.policyKey) ?? state
}

export const applyPolicyHit = (input: {
  actor: PolicyActor
  reason: string
  /** Only a command path that verified the confirming administrator may set this. */
  permanentConfirmedByAdmin?: boolean
  now?: number
}) => {
  if (input.actor.moderation == null || input.actor.moderation.enabled === false || isBypassed(input.actor)) {
    return undefined
  }
  const now = input.now ?? Date.now()
  const subject = resolvePolicySubject(input.actor)
  const policyKey = buildChannelPolicyKey(input.actor.channelLinkName, subject)
  const hitEventKey = eventKey({ type: 'hit', policyKey, messageId: input.actor.messageId })
  const result = getDb().applyChannelPolicyHit({
    event: {
      actorAccountId: buildChannelAccountPrincipal(input.actor.issuerKey, input.actor.accountId),
      actorUserId: input.actor.canonicalUserId,
      channelLinkName: input.actor.channelLinkName,
      createdAt: now,
      eventKey: hitEventKey,
      eventType: 'hit',
      metadata: { reason: input.reason },
      policyKey
    },
    resolveState: current => buildState({ ...input, current, now })
  })
  return result.state
}

export const getEffectivePolicyState = (actor: PolicyActor, now = Date.now()) => {
  const state = getDb().getChannelPolicyState(buildChannelPolicyKey(actor.channelLinkName, resolvePolicySubject(actor)))
  return state == null ? undefined : normalizeExpiredState(state, now)
}

export const setOperatorPolicyState = (input: {
  actor: Pick<PolicyActor, 'channelLinkName' | 'issuerKey' | 'moderation'>
  accountId: string
  canonicalUserId?: string
  action: 'warn' | 'mute' | 'unmute'
  durationMs?: number
  reason?: string
  updatedBy: string
  now?: number
}) => {
  const now = input.now ?? Date.now()
  const subject = resolvePolicySubject({
    accountId: input.accountId,
    canonicalUserId: input.canonicalUserId,
    issuerKey: input.actor.issuerKey,
    moderation: input.actor.moderation
  })
  const policyKey = buildChannelPolicyKey(input.actor.channelLinkName, subject)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = getDb().getChannelPolicyState(policyKey)
    const state = input.action === 'warn' ? 'warned' : input.action === 'mute' ? 'muted_until' : 'normal'
    const next = getDb().compareAndSetChannelPolicyState({
      channelLinkName: input.actor.channelLinkName,
      expectedRevision: current?.revision,
      hitWindowStartedAt: current?.hitWindowStartedAt ?? now,
      hits: current?.hits ?? 0,
      mutedUntil: state === 'muted_until' ? now + (input.durationMs ?? 60 * 60 * 1000) : null,
      policyKey,
      reason: state === 'normal' ? null : input.reason?.trim() || null,
      scope: subject.scope,
      state,
      subjectKey: subject.subjectKey,
      updatedAt: now,
      updatedBy: input.updatedBy
    })
    if (next != null) {
      getDb().appendChannelPolicyEvent({
        actorAccountId: buildChannelAccountPrincipal(input.actor.issuerKey, input.accountId),
        actorUserId: input.canonicalUserId,
        channelLinkName: input.actor.channelLinkName,
        createdAt: now,
        eventKey: eventKey({ type: `operator_${input.action}`, policyKey, revision: next.revision }),
        eventType: `operator_${input.action}`,
        metadata: { reason: input.reason },
        policyKey
      })
      return next
    }
  }
  throw new Error('channel policy state changed concurrently; retry the command')
}

const auditReview = (actor: PolicyActor, type: string, now: number, metadata?: Record<string, unknown>) => {
  const policyKey = buildChannelPolicyKey(actor.channelLinkName, resolvePolicySubject(actor))
  getDb().appendChannelPolicyEvent({
    actorAccountId: buildChannelAccountPrincipal(actor.issuerKey, actor.accountId),
    actorUserId: actor.canonicalUserId,
    channelLinkName: actor.channelLinkName,
    createdAt: now,
    eventKey: eventKey({ type, policyKey, messageId: actor.messageId }),
    eventType: type,
    metadata,
    policyKey
  })
}

const reviewToHit = (review: ModerationReview, actor: PolicyActor, now: number) => {
  if (review.severity === 'none') return undefined
  if (review.confidence < MIN_CONFIDENCE) {
    auditReview(actor, 'low_confidence_review', now, { confidence: review.confidence, reason: review.reason })
    return undefined
  }
  return applyPolicyHit({ actor, now, reason: review.reason })
}

export const reviewAndApplyPolicy = async (actor: PolicyActor, recentBehaviorSummary = '') => {
  if (actor.moderation == null || actor.moderation.enabled === false || isBypassed(actor)) return undefined
  const now = Date.now()
  const result = await reviewModerationMessage({
    moderation: actor.moderation,
    recentBehaviorSummary,
    text: actor.text
  })
  if (result.kind !== 'review') {
    auditReview(actor, `moderation_${result.kind}`, now)
    return undefined
  }
  return reviewToHit(result.review, actor, now)
}

const formatRemaining = (until: number | null, now: number) =>
  until == null
    ? '长期限制'
    : `${Math.max(1, Math.ceil((until - now) / 60_000))} 分钟`

export const buildMutedNotice = (
  input: { state: ChannelPolicyStateRow; moderation?: ChannelLinkModeration; now?: number }
) => {
  const now = input.now ?? Date.now()
  const template = input.moderation?.replyText?.trim() || DEFAULT_MUTED_REPLY_TEXT
  return template
    .replace('{reason}', input.state.reason || '频道策略限制')
    .replace('{remaining}', formatRemaining(input.state.mutedUntil, now))
    .replace(
      '{nextReplyAt}',
      input.state.mutedUntil == null ? '请联系OneWorks 频道员' : new Date(input.state.mutedUntil).toISOString()
    )
}

export const evaluateInboundPolicy = async (actor: PolicyActor): Promise<PolicyDecision> => {
  if (isBypassed(actor)) return { bypassed: true, kind: 'allow' }
  const existing = getEffectivePolicyState(actor)
  if (existing?.state === 'muted_until' || existing?.state === 'muted_permanent') {
    auditReview(actor, 'drop', Date.now())
    return { kind: 'drop', state: existing }
  }
  const updated = await reviewAndApplyPolicy(actor)
  if (updated?.state === 'muted_until' || updated?.state === 'muted_permanent') return { kind: 'drop', state: updated }
  return updated?.state === 'warned' ? { kind: 'warn', state: updated } : { kind: 'allow', state: updated }
}

export const isPolicyBypassed = isBypassed
