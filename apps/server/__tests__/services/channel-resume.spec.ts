import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import {
  listNextMessageChannelResumeIntents,
  listReadyChannelResumeIntents,
  resumeChannelPendingIntent,
  resumeReadyChannelIntents,
  runChannelResumeSchedulerOnce,
  startChannelResumeScheduler,
  stopChannelResumeScheduler
} from '#~/services/channel-resume/index.js'
import { processUserMessage } from '#~/services/session/index.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

vi.mock('#~/services/session/index.js', () => ({
  processUserMessage: vi.fn()
}))

const appendChannelConversationTurn = vi.fn()
const createChannelChildSessionRun = vi.fn()
const finishChannelChildSessionRun = vi.fn()
const getChannelPendingIntent = vi.fn()
const listResolvedChannelPendingIntents = vi.fn()
const updateChannelPendingIntent = vi.fn()

const readyIntent = {
  authorizationRequestId: 'auth-1',
  channelId: 'oc_1',
  channelKey: 'lark-main',
  channelLinkName: 'wan-ke-chat',
  channelType: 'lark',
  conversationStateId: 'conversation-1',
  createdByChildRunId: 'child-run-1',
  delivery: 'public_hint',
  deliveryMessageId: 'om_1',
  entity: 'owo-demo',
  expiresAt: null,
  id: 'pending-auth-1',
  kind: 'need_approval',
  metadata: {
    reasonCode: 'session-permission-required',
    resume: {
      authorizationRequestId: 'auth-1',
      authorizationStatus: 'granted',
      capability: 'Write',
      createdByChildRunId: 'child-run-1',
      readyAt: 123,
      resolvedByAccountId: 'admin1',
      sessionId: 'sess-1',
      status: 'ready',
      threadKey: 'group:owo-demo:actor:user-yijie'
    }
  },
  ownerAccountId: 'ou_1',
  ownerUserId: 'user-yijie',
  payload: {
    authorizationRequestId: 'auth-1',
    capability: 'Write'
  },
  requiredAction: 'grant_authorization',
  resolvedAt: 123,
  sessionType: 'group',
  status: 'resolved',
  threadKey: 'group:owo-demo:actor:user-yijie'
}

beforeEach(() => {
  vi.clearAllMocks()
  stopChannelResumeScheduler()
  appendChannelConversationTurn.mockReturnValue({ id: 'turn-1' })
  createChannelChildSessionRun.mockReturnValue({
    id: 'resume-run-1'
  })
  getChannelPendingIntent.mockReturnValue(readyIntent)
  listResolvedChannelPendingIntents.mockReturnValue([
    readyIntent,
    {
      ...readyIntent,
      id: 'pending-auth-2',
      metadata: {
        resume: {
          authorizationRequestId: 'auth-2',
          sessionId: 'sess-2',
          status: 'dispatched'
        }
      }
    }
  ])
  updateChannelPendingIntent.mockReturnValue(readyIntent)
  vi.mocked(processUserMessage).mockResolvedValue(undefined)
  vi.mocked(getDb).mockReturnValue({
    appendChannelConversationTurn,
    createChannelChildSessionRun,
    finishChannelChildSessionRun,
    getChannelPendingIntent,
    listResolvedChannelPendingIntents,
    updateChannelPendingIntent
  } as any)
})

afterEach(() => {
  stopChannelResumeScheduler()
  vi.useRealTimers()
})

describe('channel resume service', () => {
  it('lists only resolved intents with ready resume metadata', () => {
    const ready = listReadyChannelResumeIntents({
      channelType: 'lark'
    })

    expect(listResolvedChannelPendingIntents).toHaveBeenCalledWith({
      channelType: 'lark'
    })
    expect(ready).toHaveLength(1)
    expect(ready[0]).toMatchObject({
      intent: expect.objectContaining({ id: 'pending-auth-1' }),
      resume: expect.objectContaining({
        authorizationRequestId: 'auth-1',
        sessionId: 'sess-1',
        status: 'ready'
      })
    })
  })

  it('filters deferred resume intents from automatic ready scans', () => {
    const makeIntent = (
      id: string,
      resume: Record<string, unknown>
    ) => ({
      ...readyIntent,
      id,
      metadata: {
        resume: {
          authorizationRequestId: id.replace('pending-', 'auth-'),
          authorizationStatus: 'granted',
          sessionId: `sess-${id}`,
          status: 'ready',
          ...resume
        }
      }
    })
    listResolvedChannelPendingIntents.mockReturnValue([
      makeIntent('pending-auto', {
        mode: 'immediate',
        notBefore: 900
      }),
      makeIntent('pending-manual', {
        mode: 'manual'
      }),
      makeIntent('pending-next', {
        mode: 'next_message'
      }),
      makeIntent('pending-future', {
        mode: 'immediate',
        notBefore: 1_100
      })
    ])

    const automatic = listReadyChannelResumeIntents({}, { now: 1_000 })

    expect(automatic.map(item => item.intent.id)).toEqual(['pending-auto'])

    const allReady = listReadyChannelResumeIntents({}, {
      includeDeferred: true,
      now: 1_000
    })
    expect(allReady.map(item => item.intent.id)).toEqual([
      'pending-auto',
      'pending-manual',
      'pending-next',
      'pending-future'
    ])
  })

  it('lists due next-message resume intents separately from automatic scans', () => {
    const makeIntent = (
      id: string,
      resume: Record<string, unknown>
    ) => ({
      ...readyIntent,
      id,
      metadata: {
        resume: {
          authorizationRequestId: id.replace('pending-', 'auth-'),
          authorizationStatus: 'granted',
          sessionId: `sess-${id}`,
          status: 'ready',
          ...resume
        }
      }
    })
    listResolvedChannelPendingIntents.mockReturnValue([
      makeIntent('pending-auto', {
        mode: 'immediate'
      }),
      makeIntent('pending-next', {
        mode: 'next_message',
        notBefore: 900
      }),
      makeIntent('pending-next-future', {
        mode: 'next_message',
        notBefore: 1_100
      }),
      makeIntent('pending-manual', {
        mode: 'manual'
      })
    ])

    const ready = listNextMessageChannelResumeIntents({
      ownerAccountId: 'ou_1',
      threadKey: 'thread-1'
    }, { now: 1_000 })

    expect(listResolvedChannelPendingIntents).toHaveBeenCalledWith({
      ownerAccountId: 'ou_1',
      threadKey: 'thread-1'
    })
    expect(ready.map(item => item.intent.id)).toEqual(['pending-next'])
  })

  it('dispatches a ready resume intent back to the original session', async () => {
    const result = await resumeChannelPendingIntent({
      intentId: 'pending-auth-1',
      now: 1_000
    })

    expect(updateChannelPendingIntent).toHaveBeenNthCalledWith(1, 'pending-auth-1', {
      metadata: expect.objectContaining({
        resume: expect.objectContaining({
          claimedAt: 1_000,
          status: 'dispatching'
        })
      })
    })
    expect(createChannelChildSessionRun).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'oc_1',
      channelKey: 'lark-main',
      conversationStateId: 'conversation-1',
      dispatchMode: 'continue_session',
      sessionId: 'sess-1',
      threadKey: 'group:owo-demo:actor:user-yijie',
      triggerType: 'system_resume'
    }))
    expect(processUserMessage).toHaveBeenCalledWith(
      'sess-1',
      expect.stringContaining('auth-1'),
      expect.objectContaining({
        channelContext: expect.objectContaining({
          childRunId: 'resume-run-1',
          conversationStateId: 'conversation-1',
          sessionId: 'sess-1',
          threadKey: 'group:owo-demo:actor:user-yijie'
        }),
        runtimeContent: expect.stringContaining('<channel-authorization-resume>')
      })
    )
    expect(appendChannelConversationTurn).toHaveBeenCalledWith(expect.objectContaining({
      childRunId: 'resume-run-1',
      conversationStateId: 'conversation-1',
      role: 'system',
      threadKey: 'group:owo-demo:actor:user-yijie'
    }))
    expect(finishChannelChildSessionRun).toHaveBeenCalledWith('resume-run-1', {
      sessionId: 'sess-1',
      status: 'dispatched'
    })
    expect(updateChannelPendingIntent).toHaveBeenLastCalledWith('pending-auth-1', {
      metadata: expect.objectContaining({
        resume: expect.objectContaining({
          resumeChildRunId: 'resume-run-1',
          status: 'dispatched'
        })
      })
    })
    expect(result).toEqual({
      intentId: 'pending-auth-1',
      resumeChildRunId: 'resume-run-1',
      sessionId: 'sess-1',
      status: 'dispatched'
    })
  })

  it('marks malformed ready resume intents as skipped', async () => {
    getChannelPendingIntent.mockReturnValue({
      ...readyIntent,
      channelId: null
    })

    const result = await resumeChannelPendingIntent({
      intentId: 'pending-auth-1',
      now: 2_000
    })

    expect(processUserMessage).not.toHaveBeenCalled()
    expect(updateChannelPendingIntent).toHaveBeenCalledWith('pending-auth-1', {
      metadata: expect.objectContaining({
        resume: expect.objectContaining({
          skippedAt: 2_000,
          skipReason: 'missing-channel-context',
          status: 'skipped'
        })
      })
    })
    expect(result).toEqual({
      error: 'missing-channel-context',
      intentId: 'pending-auth-1',
      sessionId: 'sess-1',
      status: 'skipped'
    })
  })

  it('resumes ready intents in batches', async () => {
    const results = await resumeReadyChannelIntents({
      filter: { channelType: 'lark' },
      limit: 1,
      now: 1_000
    })

    expect(results).toEqual([
      expect.objectContaining({
        intentId: 'pending-auth-1',
        status: 'dispatched'
      })
    ])
    expect(getChannelPendingIntent).toHaveBeenCalledTimes(1)
  })

  it('can explicitly resume deferred ready intents', async () => {
    listResolvedChannelPendingIntents.mockReturnValue([
      {
        ...readyIntent,
        id: 'pending-manual',
        metadata: {
          resume: {
            authorizationRequestId: 'auth-manual',
            authorizationStatus: 'granted',
            mode: 'manual',
            sessionId: 'sess-manual',
            status: 'ready'
          }
        }
      }
    ])
    getChannelPendingIntent.mockImplementation((id: string) => ({
      ...readyIntent,
      id,
      metadata: {
        resume: {
          authorizationRequestId: 'auth-manual',
          authorizationStatus: 'granted',
          mode: 'manual',
          sessionId: 'sess-manual',
          status: 'ready'
        }
      }
    }))

    const results = await resumeReadyChannelIntents({
      filter: { authorizationRequestId: 'auth-manual' },
      includeDeferred: true,
      limit: 1,
      now: 1_000
    })

    expect(listResolvedChannelPendingIntents).toHaveBeenCalledWith({
      authorizationRequestId: 'auth-manual'
    })
    expect(getChannelPendingIntent).toHaveBeenCalledWith('pending-manual')
    expect(results).toEqual([
      expect.objectContaining({
        intentId: 'pending-manual',
        sessionId: 'sess-manual',
        status: 'dispatched'
      })
    ])
  })

  it('runs one scheduler tick against ready resume intents', async () => {
    const results = await runChannelResumeSchedulerOnce({
      limit: 1,
      now: 1_000
    })

    expect(results).toEqual([
      expect.objectContaining({
        intentId: 'pending-auth-1',
        status: 'dispatched'
      })
    ])
    expect(listResolvedChannelPendingIntents).toHaveBeenCalled()
  })

  it('starts and stops the resume scheduler timer', async () => {
    vi.useFakeTimers()
    const runtime = startChannelResumeScheduler({
      intervalMs: 1_000,
      limit: 1
    })

    await vi.runOnlyPendingTimersAsync()
    expect(listResolvedChannelPendingIntents).toHaveBeenCalled()
    const callsAfterTick = listResolvedChannelPendingIntents.mock.calls.length

    runtime.stop()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(listResolvedChannelPendingIntents).toHaveBeenCalledTimes(callsAfterTick)
    vi.useRealTimers()
  })
})
