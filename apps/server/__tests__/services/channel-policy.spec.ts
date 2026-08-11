import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import {
  applyPolicyHit,
  buildChannelAccountPrincipal,
  evaluateInboundPolicy,
  getEffectivePolicyState,
  resolvePolicySubject,
  setOperatorPolicyState
} from '#~/services/channel-policy/index.js'
import { setModerationReviewInvokerForTests } from '#~/services/channel-policy/moderation-review.js'

vi.mock('#~/db/index.js', () => ({ getDb: vi.fn() }))

type PolicyState = NonNullable<ReturnType<typeof getEffectivePolicyState>>
const states = new Map<string, PolicyState>()
const events = new Map<string, { eventKey: string }>()

const actor = (overrides: Record<string, unknown> = {}) => ({
  accountId: 'account-1',
  canonicalUserId: 'user-1',
  channelLinkName: 'support',
  channelType: 'lark',
  isAdmin: false,
  issuerKey: 'lark:main',
  messageId: 'message-1',
  text: 'spam',
  moderation: {
    enabled: true,
    levels: [
      { action: 'warn' as const, hit: 1 },
      { action: 'mute' as const, durationMs: 60_000, hit: 2 },
      { action: 'mute_permanent' as const, hit: 3 }
    ]
  },
  ...overrides
})

beforeEach(() => {
  states.clear()
  events.clear()
  vi.mocked(getDb).mockReturnValue({
    appendChannelPolicyEvent: (input: { eventKey: string }) => {
      const event = events.get(input.eventKey) ?? { eventKey: input.eventKey }
      events.set(input.eventKey, event)
      return event
    },
    applyChannelPolicyHit: (input: any) => {
      if (events.has(input.event.eventKey)) return { applied: false, state: states.get(input.event.policyKey) }
      const current = states.get(input.event.policyKey)
      const state = { ...input.resolveState(current), revision: (current?.revision ?? 0) + 1 }
      states.set(state.policyKey, state)
      events.set(input.event.eventKey, { eventKey: input.event.eventKey })
      return { applied: true, state }
    },
    compareAndSetChannelPolicyState: (input: PolicyState & { expectedRevision?: number }) => {
      const current = states.get(input.policyKey)
      if (current?.revision !== input.expectedRevision && (current != null || input.expectedRevision != null)) {
        return undefined
      }
      const state = { ...input, revision: (current?.revision ?? 0) + 1 }
      states.set(state.policyKey, state)
      return state
    },
    getChannelPolicyState: (key: string) => states.get(key)
  } as any)
})

afterEach(() => {
  setModerationReviewInvokerForTests(undefined)
  vi.clearAllMocks()
})

describe('channel policy service', () => {
  it('uses issuer-scoped account subjects by default and canonical users only after verification', () => {
    expect(resolvePolicySubject(actor())).toMatchObject({
      scope: 'account',
      subjectKey: buildChannelAccountPrincipal('lark:main', 'account-1')
    })
    expect(resolvePolicySubject(actor({ moderation: { enabled: true, subjectScope: 'user' } }))).toMatchObject({
      scope: 'user',
      subjectKey: 'user-1'
    })
    expect(
      resolvePolicySubject(actor({ canonicalUserId: undefined, moderation: { enabled: true, subjectScope: 'user' } }))
    ).toMatchObject({ scope: 'account' })
  })

  it('escalates once per message, does not make permanent mute implicit, and expires temporary mute', async () => {
    expect(applyPolicyHit({ actor: actor(), now: 1_000, reason: 'spam' })).toMatchObject({ hits: 1, state: 'warned' })
    expect(applyPolicyHit({ actor: actor(), now: 1_001, reason: 'spam' })).toMatchObject({ hits: 1, state: 'warned' })
    const muted = applyPolicyHit({ actor: actor({ messageId: 'message-2' }), now: 2_000, reason: 'spam' })!
    expect(muted).toMatchObject({ hits: 2, state: 'muted_until' })
    expect(applyPolicyHit({ actor: actor({ messageId: 'message-3' }), now: 3_000, reason: 'spam' })).toMatchObject({
      state: 'normal'
    })
    states.set(muted.policyKey, { ...muted, mutedUntil: 1_500, state: 'muted_until' })
    await expect(evaluateInboundPolicy(actor({ messageId: 'message-4' }))).resolves.toMatchObject({ kind: 'allow' })
    expect(getEffectivePolicyState(actor(), 2_000)).toMatchObject({ state: 'normal' })
  })

  it('only accepts a permanent-mute confirmation from an administrator', () => {
    applyPolicyHit({ actor: actor(), now: 1_000, reason: 'spam' })
    applyPolicyHit({ actor: actor({ messageId: 'message-2' }), now: 2_000, reason: 'spam' })
    expect(
      applyPolicyHit({ actor: actor({ messageId: 'message-3' }), now: 3_000, reason: 'spam' })
    )
      .toMatchObject({ state: 'normal' })
    expect(
      applyPolicyHit({
        actor: actor({ messageId: 'message-4' }),
        now: 4_000,
        permanentConfirmedByAdmin: true,
        reason: 'spam'
      })
    )
      .toMatchObject({ state: 'muted_permanent' })
  })

  it('keeps same raw account ids isolated across issuers and recognizes only matching issuer bypasses', async () => {
    const first = applyPolicyHit({ actor: actor(), now: 1_000, reason: 'spam' })!
    const otherIssuer = actor({ issuerKey: 'lark:other', messageId: 'message-2' })
    expect(applyPolicyHit({ actor: otherIssuer, now: 1_000, reason: 'spam' })!.policyKey).not.toBe(first.policyKey)
    await expect(evaluateInboundPolicy(
      actor({ moderation: { bypassAccounts: [{ accountId: 'account-1', issuerKey: 'lark:other' }], enabled: true } })
    )).resolves.not.toHaveProperty('bypassed')
    await expect(
      evaluateInboundPolicy(
        actor({ moderation: { bypassAccounts: [{ accountId: 'account-1', issuerKey: 'lark:main' }], enabled: true } })
      )
    ).resolves.toMatchObject({ bypassed: true })
  })

  it.each([
    ['invalid', async () => ({ malformed: true })],
    ['timeout', async () => {
      throw new Error('timed out')
    }],
    [
      'low confidence',
      async () => ({ confidence: 0.2, reason: 'maybe', severity: 'mute', suggestedAction: { type: 'mute' } })
    ]
  ])('audits %s reviews without automatic mute', async (_label, invoker) => {
    setModerationReviewInvokerForTests(invoker)
    await expect(evaluateInboundPolicy(actor())).resolves.toMatchObject({ kind: 'allow' })
    expect(states.size).toBe(0)
    expect(events.size).toBeGreaterThan(0)
  })

  it('bypasses administrators and verified canonical-user configuration', async () => {
    await expect(evaluateInboundPolicy(actor({ isAdmin: true }))).resolves.toMatchObject({
      bypassed: true,
      kind: 'allow'
    })
    await expect(evaluateInboundPolicy(actor({ moderation: { bypassUsers: ['user-1'], enabled: true } }))).resolves
      .toMatchObject({ bypassed: true, kind: 'allow' })
  })

  it('applies operator mutations to the same canonical-user scope used by enforcement', () => {
    const userScopedActor = actor({ moderation: { enabled: true, subjectScope: 'user' } })

    const updated = setOperatorPolicyState({
      accountId: userScopedActor.accountId,
      action: 'mute',
      actor: userScopedActor,
      canonicalUserId: userScopedActor.canonicalUserId,
      durationMs: 60_000,
      now: 1_000,
      updatedBy: 'admin-1'
    })

    expect(updated).toMatchObject({ scope: 'user', state: 'muted_until', subjectKey: 'user-1' })
    expect(getEffectivePolicyState(userScopedActor, 2_000)).toMatchObject({
      policyKey: updated.policyKey,
      state: 'muted_until'
    })
  })
})
