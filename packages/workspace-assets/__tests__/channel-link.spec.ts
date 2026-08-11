import { describe, expect, it, vi } from 'vitest'

import { normalizeChannelLink } from '#~/channel-link.js'

const baseLink = {
  channel: 'lark-main',
  entity: 'release-bot',
  external: { chatId: 'chat-1', type: 'group' }
}

describe('channel link normalization', () => {
  it('applies ingress defaults and preserves complete valid routing fields', () => {
    const link = normalizeChannelLink({
      ...baseLink,
      description: 'Release room',
      ingress: {
        observeWindow: { maxTurns: 8, ttlSeconds: 60 },
        routerAdapter: 'gemini',
        routerModel: 'gemini-2.5-flash'
      },
      routing: {
        accounts: { 'lark-main': { 'account-1': { adapter: 'gemini', model: 'gemini-2.5', visibility: 'dm' } } },
        default: { adapter: 'codex', effort: 'medium', model: 'gpt-5.4', visibility: 'public' },
        modes: { clarify: { model: 'gpt-5.4-mini' } },
        users: { 'user-1': { effort: 'high' } }
      }
    }, vi.fn())

    expect(link).toMatchObject({
      description: 'Release room',
      ingress: {
        ambientRouting: false,
        createOnCommand: true,
        createOnMention: true,
        createOnPendingIntent: true,
        createOnReplyToBot: true,
        routerAdapter: 'gemini',
        routerModel: 'gemini-2.5-flash',
        observeWindow: { maxTurns: 8, ttlSeconds: 60 }
      },
      routing: {
        accounts: { 'lark-main': { 'account-1': { adapter: 'gemini', model: 'gemini-2.5', visibility: 'dm' } } },
        default: { adapter: 'codex', effort: 'medium', model: 'gpt-5.4', visibility: 'public' },
        modes: { clarify: { model: 'gpt-5.4-mini' } },
        users: { 'user-1': { effort: 'high' } }
      }
    })
  })

  it.each([
    [{ ingress: { ambientRouting: 'false' } }, /ambientRouting must be a boolean/],
    [{ ingress: { observeWindow: { maxTurns: -1 } } }, /maxTurns must be a non-negative integer/],
    [{ ingress: { unexpected: true } }, /ingress contains unknown field unexpected/],
    [{ routing: { default: { unexpected: true } } }, /unknown route field unexpected/],
    [{ routing: { accounts: { '': { account: { model: 'gpt-5.4' } } } } }, /accounts has an empty issuer/],
    [{ routing: { accounts: { issuer: { '': { model: 'gpt-5.4' } } } } }, /routing.accounts.issuer has an empty key/],
    [{ availability: { bypassSenders: ['bare-account'] } }, /issuerKey and accountId/],
    [{ moderation: { levels: [{ action: 'mute', hit: 1 }] } }, /durationMs is required/],
    [{ moderation: { bypassAccounts: [{ accountId: 'bare' }] } }, /issuerKey/]
  ])('rejects invalid channel link configuration %#', (invalid, error) => {
    expect(() => normalizeChannelLink({ ...baseLink, ...invalid }, vi.fn())).toThrow(error)
  })

  it('normalizes safe policy defaults and issuer-qualified account bypasses', () => {
    const link = normalizeChannelLink({
      ...baseLink,
      availability: { bypassAccounts: [{ accountId: 'a1', issuerKey: 'lark:main' }], offHours: { mode: 'drop' } },
      moderation: { levels: [{ action: 'mute', durationMs: 1_000, hit: 2 }] }
    }, vi.fn())
    expect(link).toMatchObject({
      availability: { bypassAccounts: [{ accountId: 'a1', issuerKey: 'lark:main' }], enabled: true },
      moderation: { autoPermanentMute: false, enabled: true, subjectScope: 'account' }
    })
  })
})
