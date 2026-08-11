import { describe, expect, it, vi } from 'vitest'

import type { ChannelContext } from '#~/channels/middleware/@types/index.js'
import { policyGateMiddleware } from '#~/channels/middleware/policy-gate.js'
import * as policy from '#~/services/channel-policy/index.js'

vi.mock('#~/services/channel-policy/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('#~/services/channel-policy/index.js')>(),
  evaluateInboundPolicy: vi.fn(),
  resolvePolicySubject: vi.fn(() => ({ scope: 'account', subjectKey: '["lark:main","account-1"]' }))
}))
vi.mock('#~/db/index.js', () => ({ getDb: vi.fn(() => ({ consumeChannelReplyThrottle: vi.fn(() => true) })) }))

const ctx = (): ChannelContext => ({
  actor: {
    account: {
      accountId: 'account-1',
      accountKey: 'lark:main:account-1',
      avatarUrl: null,
      channelType: 'lark',
      createdAt: 1,
      displayName: null,
      issuerKey: 'lark:main',
      metadata: null,
      updatedAt: 1
    }
  },
  bindSession: vi.fn(() => ({ alreadyBound: false })),
  channelAdapter: undefined,
  channelEffort: undefined,
  channelKey: 'lark:main',
  channelLink: {
    channelKey: 'lark:main',
    definition: {} as never,
    entity: 'bot',
    external: { type: 'chat' },
    ingress: {
      ambientRouting: true,
      createOnCommand: true,
      createOnMention: true,
      createOnPendingIntent: true,
      createOnReplyToBot: true
    },
    moderation: { enabled: true },
    name: 'support',
    path: '/tmp/channel.json',
    routing: { accounts: {}, default: {}, modes: {}, users: {} }
  },
  channelPermissionMode: undefined,
  commandText: 'hello',
  config: { type: 'lark' } as any,
  connection: undefined,
  contentItems: undefined,
  defineMessages: vi.fn(),
  getBoundSession: vi.fn(),
  getChannelAdapterPreference: vi.fn(),
  getChannelEffortPreference: vi.fn(),
  getChannelPermissionModePreference: vi.fn(),
  inbound: {
    channelId: 'chat-1',
    channelType: 'lark',
    messageId: 'm1',
    raw: {},
    senderId: 'account-1',
    sessionType: 'direct',
    text: 'hello'
  } as any,
  pushFollowUps: vi.fn(),
  reply: vi.fn(),
  resetSession: vi.fn(),
  resolveSessionWorkspace: vi.fn(),
  restartSession: vi.fn(),
  searchSessions: vi.fn(() => []),
  sessionId: undefined,
  setChannelAdapterPreference: vi.fn(),
  setChannelEffortPreference: vi.fn(),
  setChannelPermissionModePreference: vi.fn(),
  stopSession: vi.fn(),
  t: vi.fn(),
  unbindSession: vi.fn(() => ({})),
  updateSession: vi.fn()
})

describe('policyGateMiddleware', () => {
  it('short-circuits before the ingress router or child dispatch path', async () => {
    vi.mocked(policy.evaluateInboundPolicy).mockResolvedValue({
      kind: 'drop',
      state: { mutedUntil: null, policyKey: 'p', reason: 'spam', state: 'muted_permanent' } as any
    })
    const next = vi.fn()
    await policyGateMiddleware(ctx(), next)
    expect(next).not.toHaveBeenCalled()
  })
})
