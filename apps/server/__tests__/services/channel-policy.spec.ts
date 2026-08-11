import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import type { ChannelPolicyEventRow } from '#~/db/channelPolicies/policy-record.js'
import {
  applyPolicyHit,
  evaluateInboundPolicy,
  getEffectivePolicyState,
  resolvePolicySubject
} from '#~/services/channel-policy/index.js'
import { setModerationReviewInvokerForTests } from '#~/services/channel-policy/moderation-review.js'

vi.mock('#~/db/index.js', () => ({ getDb: vi.fn() }))

type PolicyState = NonNullable<ReturnType<typeof getEffectivePolicyState>>

const states = new Map<string, PolicyState>()
const events = new Map<string, ChannelPolicyEventRow>()

const actor = (overrides: Record<string, unknown> = {}) => ({
  accountId: 'account-1',
  canonicalUserId: 'user-1',
  channelLinkName: 'support',
  channelType: 'lark',
  isAdmin: false,
  messageId: 'message-1',
  text: 'spam',
  moderation: {
    enabled: true,
    levels: [
      { hit: 1, action: 'warn' as const },
      { hit: 2, action: 'mute' as const, durationMs: 60_000 },
      { hit: 3, action: 'mute_permanent' as const }
    ]
  },
  ...overrides
})

beforeEach(() => {
  states.clear()
  events.clear()
  vi.mocked(getDb).mockReturnValue({
    appendChannelPolicyEvent: (input: { eventKey: string }) => {
      const existing = events.get(input.eventKey)
      if (existing != null) return existing
      const event: ChannelPolicyEventRow = {
        id: `event-${input.eventKey}`,
        eventKey: input.eventKey,
        policyKey: null,
        channelLinkName: 'support',
        eventType: 'policy-hit',
        actorUserId: null,
        actorAccountId: 'account-1',
        metadata: null,
        createdAt: 1_000
      }
      events.set(input.eventKey, event)
      return event
    },
    compareAndSetChannelPolicyState: (input: PolicyState & { expectedRevision?: number }) => {
      const current = states.get(input.policyKey)
      if (current != null && input.expectedRevision != null && current.revision !== input.expectedRevision) {
        return undefined
      }
      if (current == null && input.expectedRevision != null) return undefined
      const saved: PolicyState = { ...input, revision: (current?.revision ?? 0) + 1 }
      states.set(saved.policyKey, saved)
      return saved
    },
    getChannelPolicyEventByEventKey: (eventKey: string) => events.get(eventKey),
    getChannelPolicyState: (policyKey: string) => states.get(policyKey)
  } as never)
})

afterEach(() => {
  setModerationReviewInvokerForTests(undefined)
  vi.clearAllMocks()
})

describe('channel policy service', () => {
  it('uses account scope by default and only uses a verified canonical user for user scope', () => {
    expect(resolvePolicySubject(actor())).toMatchObject({ scope: 'account', subjectKey: 'account-1' })
    expect(resolvePolicySubject(actor({ moderation: { enabled: true, subjectScope: 'user' } }))).toMatchObject({
      scope: 'user',
      subjectKey: 'user-1'
    })
    expect(resolvePolicySubject(actor({ canonicalUserId: undefined, moderation: { enabled: true, subjectScope: 'user' } })))
      .toMatchObject({ scope: 'account', subjectKey: 'account-1' })
  })

  it('escalates once per unique message and requires explicit confirmation for permanent mute', () => {
    const first = applyPolicyHit({ actor: actor(), reason: 'spam', now: 1_000 })
    const duplicate = applyPolicyHit({ actor: actor(), reason: 'spam', now: 1_000 })
    const second = applyPolicyHit({ actor: actor({ messageId: 'message-2' }), reason: 'spam', now: 2_000 })
    const third = applyPolicyHit({ actor: actor({ messageId: 'message-3' }), reason: 'spam', now: 3_000 })

    expect(first).toMatchObject({ state: 'warned', hits: 1 })
    expect(duplicate).toMatchObject({ state: 'warned', hits: 1 })
    expect(second).toMatchObject({ state: 'muted_until', hits: 2 })
    expect(third).toMatchObject({ state: 'normal', hits: 3 })
  })

  it('restores expired temporary mute before evaluating an inbound message', async () => {
    const muted = applyPolicyHit({ actor: actor(), reason: 'spam', now: 1_000 })!
    states.set(muted.policyKey, { ...muted, mutedUntil: 1_500, state: 'muted_until' })

    await expect(evaluateInboundPolicy(actor({ messageId: 'message-4' }))).resolves.toMatchObject({ kind: 'allow' })
    expect(getEffectivePolicyState(actor(), 2_000)).toMatchObject({ state: 'normal' })
  })

  it('bypasses admins and audits invalid structured review without muting', async () => {
    setModerationReviewInvokerForTests(async () => ({ malformed: true }))
    await expect(evaluateInboundPolicy(actor())).resolves.toMatchObject({ kind: 'allow' })
    expect(events.size).toBeGreaterThan(0)
    await expect(evaluateInboundPolicy(actor({ isAdmin: true }))).resolves.toMatchObject({
      kind: 'allow',
      bypassed: true
    })
  })
})
