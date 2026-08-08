import { describe, expect, it } from 'vitest'

import {
  createChannelCommandInvocationToken,
  verifyChannelCommandInvocationToken
} from '#~/services/channel-commands/invocation-token.js'

describe('channel command invocation token', () => {
  it('binds authority to one child run, session, and channel issuer', () => {
    const token = createChannelCommandInvocationToken({
      channelKey: 'lark-main',
      childRunId: 'child-run-1',
      now: 1_000,
      sessionId: 'session-child-1',
      ttlMs: 5_000
    })

    expect(verifyChannelCommandInvocationToken(token, {
      channelKey: 'lark-main',
      now: 2_000
    })).toEqual({
      channelKey: 'lark-main',
      childRunId: 'child-run-1',
      expiresAt: 6_000,
      sessionId: 'session-child-1',
      version: 1
    })
    expect(verifyChannelCommandInvocationToken(token, {
      channelKey: 'lark-secondary',
      now: 2_000
    })).toBeUndefined()
  })

  it('rejects expired and tampered tokens', () => {
    const token = createChannelCommandInvocationToken({
      channelKey: 'lark-main',
      childRunId: 'child-run-1',
      now: 1_000,
      sessionId: 'session-child-1',
      ttlMs: 5_000
    })

    expect(verifyChannelCommandInvocationToken(token, {
      channelKey: 'lark-main',
      now: 6_000
    })).toBeUndefined()
    expect(verifyChannelCommandInvocationToken(`${token}x`, {
      channelKey: 'lark-main',
      now: 2_000
    })).toBeUndefined()
  })
})
