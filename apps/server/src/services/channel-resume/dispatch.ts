import { randomUUID } from 'node:crypto'

import { getDb } from '#~/db/index.js'
import type { ChannelChildSessionRunRow } from '#~/db/index.js'

import { buildResumeArtifactId, hasResumeDispatchFields } from './artifacts.js'
import { readResumePayload, withUpdatedResume } from './payload.js'
import { createChannelResumeSession } from './resume-session.js'
import { buildResumeUserContent } from './runtime-content.js'
import type { ResumeChannelIntentResult } from './types.js'

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const resumeChannelPendingIntent = async (input: {
  intentId: string
  now?: number
}): Promise<ResumeChannelIntentResult> => {
  const db = getDb()
  const intent = db.getChannelPendingIntent(input.intentId)
  const resume = intent == null ? undefined : readResumePayload(intent)
  const now = input.now ?? Date.now()
  const claimable = resume?.status === 'ready' || (
    resume?.status === 'dispatching' && (resume.leaseExpiresAt ?? Infinity) <= now
  )
  if (intent == null || intent.status !== 'resolved' || !claimable) {
    return {
      intentId: input.intentId,
      status: 'skipped'
    }
  }

  if (!hasResumeDispatchFields(intent)) {
    db.updateChannelPendingIntent(intent.id, {
      metadata: withUpdatedResume(intent, resume, {
        skippedAt: now,
        skipReason: 'missing-channel-context',
        status: 'skipped'
      })
    })
    return {
      error: 'missing-channel-context',
      intentId: intent.id,
      sessionId: resume.sessionId,
      status: 'skipped'
    }
  }

  const claimId = randomUUID()
  const claimedIntent = db.claimChannelPendingIntentResume({
    id: intent.id,
    metadata: withUpdatedResume(intent, resume, {
      claimId,
      claimedAt: now,
      leaseExpiresAt: now + 5 * 60 * 1000,
      status: 'dispatching'
    }),
    now
  })
  if (claimedIntent == null) {
    return {
      intentId: intent.id,
      sessionId: resume.sessionId,
      status: 'skipped'
    }
  }

  let childRun: ChannelChildSessionRunRow | undefined
  try {
    const childRunId = buildResumeArtifactId('run', intent.id)
    childRun = db.getChannelChildSessionRun(childRunId)
    if (childRun == null) {
      try {
        childRun = db.createChannelChildSessionRun({
          id: childRunId,
          actorAccountId: intent.ownerAccountId,
          actorUserId: intent.ownerUserId,
          channelId: intent.channelId!,
          channelKey: intent.channelKey!,
          channelLinkName: intent.channelLinkName,
          channelType: intent.channelType,
          conversationStateId: intent.conversationStateId,
          dispatchMode: 'continue_session',
          entity: intent.entity,
          metadata: {
            authorizationRequestId: resume.authorizationRequestId,
            authorizationStatus: resume.authorizationStatus,
            pendingIntentId: intent.id,
            resumeFromChildRunId: resume.createdByChildRunId ?? intent.createdByChildRunId
          },
          senderId: intent.ownerAccountId,
          sessionId: resume.sessionId,
          sessionType: intent.sessionType!,
          threadKey: intent.threadKey,
          triggerType: 'system_resume'
        }) ?? undefined
      } catch (error) {
        childRun = db.getChannelChildSessionRun(childRunId)
        if (childRun == null) throw error
      }
    }
    if (childRun == null) {
      throw new Error('failed to create channel child resume run')
    }

    const resumedSession = await createChannelResumeSession({
      childRunId: childRun.id,
      intent,
      resume,
      sessionId: buildResumeArtifactId('session', intent.id)
    })

    const turnId = buildResumeArtifactId('turn', intent.id)
    if (db.getChannelConversationTurn(turnId) == null) {
      try {
        db.appendChannelConversationTurn({
          id: turnId,
          actorAccountId: intent.ownerAccountId,
          actorUserId: intent.ownerUserId,
          channelId: intent.channelId!,
          channelKey: intent.channelKey!,
          channelLinkName: intent.channelLinkName,
          channelType: intent.channelType,
          childRunId: childRun.id,
          conversationStateId: intent.conversationStateId!,
          entity: intent.entity,
          metadata: {
            authorizationRequestId: resume.authorizationRequestId,
            pendingIntentId: intent.id,
            resumeStatus: resume.authorizationStatus
          },
          role: 'system',
          senderId: intent.ownerAccountId,
          sessionType: intent.sessionType!,
          summary: `Authorization ${resume.authorizationRequestId} resumed`,
          text: buildResumeUserContent(resume),
          threadKey: intent.threadKey
        })
      } catch (error) {
        if (db.getChannelConversationTurn(turnId) == null) throw error
      }
    }
    db.markChannelChildSessionRunDispatched(childRun.id, { sessionId: resumedSession.id })
    db.markChannelChildSessionRunRunning(childRun.id)
    const finishedIntent = db.finishChannelPendingIntentResumeClaim({
      claimId,
      id: intent.id,
      metadata: withUpdatedResume(claimedIntent, resume, {
        claimId,
        dispatchedAt: Date.now(),
        resumeChildRunId: childRun.id,
        status: 'dispatched'
      })
    })
    if (finishedIntent == null) {
      return {
        error: 'resume-claim-lost',
        intentId: intent.id,
        resumeChildRunId: childRun.id,
        sessionId: resumedSession.id,
        status: 'skipped'
      }
    }

    return {
      intentId: intent.id,
      resumeChildRunId: childRun.id,
      sessionId: resumedSession.id,
      status: 'dispatched'
    }
  } catch (error) {
    const message = getErrorMessage(error)
    if (childRun != null) {
      db.finishChannelChildSessionRun(childRun.id, {
        error: message,
        sessionId: resume.sessionId,
        status: 'failed'
      })
    }
    db.finishChannelPendingIntentResumeClaim({
      claimId,
      id: intent.id,
      metadata: withUpdatedResume(claimedIntent, resume, {
        claimId,
        error: message,
        failedAt: Date.now(),
        resumeChildRunId: childRun?.id,
        status: 'failed'
      })
    })
    return {
      error: message,
      intentId: intent.id,
      resumeChildRunId: childRun?.id,
      sessionId: resume.sessionId,
      status: 'failed'
    }
  }
}
