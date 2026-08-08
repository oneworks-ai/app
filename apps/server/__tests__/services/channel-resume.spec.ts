/* eslint-disable max-lines -- resume claim, dispatch, and scheduler cases share one transactional fixture. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bindChannelSession } from '#~/channels/middleware/bind-session.js'
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
import { createSessionWithInitialMessage, discardIncompleteSessionCreation } from '#~/services/session/create.js'
import { writeChannelMessageContext } from '#~/services/session/index.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

vi.mock('#~/services/session/create.js', () => ({
  createSessionWithInitialMessage: vi.fn(),
  discardIncompleteSessionCreation: vi.fn()
}))

vi.mock('#~/services/session/index.js', () => ({
  writeChannelMessageContext: vi.fn()
}))

vi.mock('#~/channels/middleware/bind-session.js', () => ({
  bindChannelSession: vi.fn()
}))

const appendChannelConversationTurn = vi.fn()
const claimChannelPendingIntentResume = vi.fn()
const createChannelChildSessionRun = vi.fn()
const finishChannelPendingIntentResumeClaim = vi.fn()
const finishChannelChildSessionRun = vi.fn()
const getChannelChildSessionRun = vi.fn()
const getChannelConversationTurn = vi.fn()
const getChannelPendingIntent = vi.fn()
const getChannelSessionBySessionId = vi.fn()
const getSession = vi.fn()
const getSessionRuntimeState = vi.fn()
const listResolvedChannelPendingIntents = vi.fn()
const updateChannelPendingIntent = vi.fn()
const transferSessionPermissionState = vi.fn()

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
  claimChannelPendingIntentResume.mockReturnValue(readyIntent)
  createChannelChildSessionRun.mockReturnValue({
    id: 'resume-run-1'
  })
  finishChannelPendingIntentResumeClaim.mockReturnValue(readyIntent)
  getChannelPendingIntent.mockReturnValue(readyIntent)
  getChannelSessionBySessionId.mockReturnValue({
    replyReceiveId: 'oc_1',
    replyReceiveIdType: 'chat_id'
  })
  getChannelChildSessionRun.mockReturnValue(undefined)
  getChannelConversationTurn.mockReturnValue(undefined)
  getSession.mockImplementation((id: string) =>
    id === 'sess-1'
      ? {
        adapter: 'codex',
        effort: 'medium',
        id: 'sess-1',
        model: 'terra'
      }
      : undefined
  )
  getSessionRuntimeState.mockReturnValue({
    channelActorSnapshot: {
      actorAccountId: 'ou_1',
      actorUserId: 'user-yijie',
      channelKey: 'lark-main',
      threadId: 'omt_1'
    }
  })
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
  vi.mocked(createSessionWithInitialMessage).mockImplementation(async (options) => {
    await options.beforeStart?.('resume-sess-new')
    return { id: 'resume-sess-new' } as any
  })
  vi.mocked(discardIncompleteSessionCreation).mockResolvedValue(undefined)
  vi.mocked(getDb).mockReturnValue({
    appendChannelConversationTurn,
    claimChannelPendingIntentResume,
    createChannelChildSessionRun,
    finishChannelPendingIntentResumeClaim,
    finishChannelChildSessionRun,
    getChannelChildSessionRun,
    getChannelConversationTurn,
    getChannelPendingIntent,
    getChannelSessionBySessionId,
    getSession,
    getSessionRuntimeState,
    listResolvedChannelPendingIntents,
    transferSessionPermissionState,
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
      makeIntent('pending-next-expired-lease', {
        mode: 'next_message',
        status: 'dispatching',
        leaseExpiresAt: 999
      }),
      makeIntent('pending-next-active-lease', {
        mode: 'next_message',
        status: 'dispatching',
        leaseExpiresAt: 1_001
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
    expect(ready.map(item => item.intent.id)).toEqual(['pending-next', 'pending-next-expired-lease'])
  })

  it('dispatches a ready resume intent in a fresh child session', async () => {
    const result = await resumeChannelPendingIntent({
      intentId: 'pending-auth-1',
      now: 1_000
    })

    expect(claimChannelPendingIntentResume).toHaveBeenCalledWith({
      id: 'pending-auth-1',
      metadata: expect.objectContaining({
        resume: expect.objectContaining({
          claimId: expect.any(String),
          claimedAt: 1_000,
          status: 'dispatching'
        })
      }),
      now: 1_000
    })
    expect(createChannelChildSessionRun).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^channel_resume_run_[a-f0-9]{32}$/u),
      channelId: 'oc_1',
      channelKey: 'lark-main',
      conversationStateId: 'conversation-1',
      dispatchMode: 'continue_session',
      sessionId: 'sess-1',
      threadKey: 'group:owo-demo:actor:user-yijie',
      triggerType: 'system_resume'
    }))
    expect(createSessionWithInitialMessage).toHaveBeenCalledWith(expect.objectContaining({
      adapter: 'codex',
      channelContext: expect.objectContaining({ threadId: 'omt_1' }),
      initialMessage: expect.stringContaining('auth-1'),
      initialRuntimeContent: expect.stringContaining('<channel-authorization-resume>'),
      model: 'terra',
      parentSessionId: 'sess-1',
      id: expect.stringMatching(/^channel_resume_session_[a-f0-9]{32}$/u),
      workspace: {
        createWorktree: false,
        sourceSessionId: 'sess-1'
      }
    }))
    expect(bindChannelSession).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'oc_1',
      channelKey: 'lark-main',
      sessionId: 'resume-sess-new'
    }))
    expect(transferSessionPermissionState).toHaveBeenCalledWith('sess-1', 'resume-sess-new')
    expect(writeChannelMessageContext).toHaveBeenCalledWith(
      'resume-sess-new',
      expect.objectContaining({
        childRunId: 'resume-run-1',
        sessionId: 'resume-sess-new'
      })
    )
    expect(appendChannelConversationTurn).toHaveBeenCalledWith(expect.objectContaining({
      childRunId: 'resume-run-1',
      conversationStateId: 'conversation-1',
      role: 'system',
      threadKey: 'group:owo-demo:actor:user-yijie'
    }))
    expect(finishChannelChildSessionRun).toHaveBeenCalledWith('resume-run-1', {
      sessionId: 'resume-sess-new',
      status: 'dispatched'
    })
    expect(finishChannelPendingIntentResumeClaim).toHaveBeenCalledWith({
      claimId: expect.any(String),
      id: 'pending-auth-1',
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
      sessionId: 'resume-sess-new',
      status: 'dispatched'
    })
  })

  it('reports a lost finalization claim without claiming dispatch success', async () => {
    finishChannelPendingIntentResumeClaim.mockReturnValueOnce(undefined)

    await expect(resumeChannelPendingIntent({
      intentId: 'pending-auth-1',
      now: 1_000
    })).resolves.toEqual({
      error: 'resume-claim-lost',
      intentId: 'pending-auth-1',
      resumeChildRunId: 'resume-run-1',
      sessionId: 'resume-sess-new',
      status: 'skipped'
    })
  })

  it('does not transfer parent permissions when the pending owner is a different actor', async () => {
    getSessionRuntimeState.mockReturnValueOnce({
      channelActorSnapshot: {
        actorUserId: 'different-user',
        channelKey: 'lark-main'
      }
    })

    await resumeChannelPendingIntent({ intentId: 'pending-auth-1', now: 1_000 })

    expect(transferSessionPermissionState).not.toHaveBeenCalled()
  })

  it('reuses deterministic resume artifacts after an expired lease', async () => {
    getChannelChildSessionRun.mockReturnValue({ id: 'resume-run-existing' })
    getSession.mockImplementation((id: string) =>
      id === 'sess-1'
        ? { id: 'sess-1' }
        : { id, status: 'running' }
    )

    const result = await resumeChannelPendingIntent({
      intentId: 'pending-auth-1',
      now: 1_000
    })

    expect(createChannelChildSessionRun).not.toHaveBeenCalled()
    expect(createSessionWithInitialMessage).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({
      resumeChildRunId: 'resume-run-existing',
      sessionId: expect.stringMatching(/^channel_resume_session_[a-f0-9]{32}$/u),
      status: 'dispatched'
    }))
  })

  it('rebuilds a deterministic resume session that never started', async () => {
    getChannelChildSessionRun.mockReturnValue({ id: 'resume-run-existing' })
    getSession.mockImplementation((id: string) =>
      id === 'sess-1'
        ? { id: 'sess-1' }
        : { id }
    )

    await resumeChannelPendingIntent({ intentId: 'pending-auth-1', now: 1_000 })

    expect(discardIncompleteSessionCreation).toHaveBeenCalledWith(
      expect.stringMatching(/^channel_resume_session_[a-f0-9]{32}$/u)
    )
    expect(createSessionWithInitialMessage).toHaveBeenCalledOnce()
  })

  it('skips a ready resume intent when another worker wins the atomic claim', async () => {
    claimChannelPendingIntentResume.mockReturnValueOnce(undefined)

    await expect(resumeChannelPendingIntent({
      intentId: 'pending-auth-1',
      now: 1_000
    })).resolves.toEqual({
      intentId: 'pending-auth-1',
      sessionId: 'sess-1',
      status: 'skipped'
    })
    expect(createChannelChildSessionRun).not.toHaveBeenCalled()
    expect(createSessionWithInitialMessage).not.toHaveBeenCalled()
  })

  it('reclaims a dispatching resume intent after its lease expires', async () => {
    const staleIntent = {
      ...readyIntent,
      metadata: {
        ...readyIntent.metadata,
        resume: {
          ...readyIntent.metadata.resume,
          claimId: 'stale-claim',
          leaseExpiresAt: 900,
          status: 'dispatching'
        }
      }
    }
    getChannelPendingIntent.mockReturnValueOnce(staleIntent)
    claimChannelPendingIntentResume.mockReturnValueOnce(staleIntent)

    await expect(resumeChannelPendingIntent({
      intentId: 'pending-auth-1',
      now: 1_000
    })).resolves.toEqual(expect.objectContaining({
      sessionId: 'resume-sess-new',
      status: 'dispatched'
    }))
    expect(claimChannelPendingIntentResume).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pending-auth-1',
      now: 1_000
    }))
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

    expect(createSessionWithInitialMessage).not.toHaveBeenCalled()
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
        sessionId: 'resume-sess-new',
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
