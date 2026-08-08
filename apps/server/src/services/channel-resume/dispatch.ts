import { getDb } from '#~/db/index.js'
import type { ChannelChildSessionRunRow, ChannelPendingIntentRow } from '#~/db/index.js'
import { processUserMessage } from '#~/services/session/index.js'

import { readResumePayload, trimNonEmpty, withUpdatedResume } from './payload.js'
import {
  buildChannelResumeRuntimeContent,
  buildResumeChannelContext,
  buildResumeUserContent
} from './runtime-content.js'
import type { ResumeChannelIntentResult } from './types.js'

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const hasDispatchFields = (intent: ChannelPendingIntentRow) => (
  trimNonEmpty(intent.channelKey) != null &&
  trimNonEmpty(intent.channelId) != null &&
  trimNonEmpty(intent.conversationStateId) != null &&
  trimNonEmpty(intent.sessionType) != null
)

export const resumeChannelPendingIntent = async (input: {
  intentId: string
  now?: number
}): Promise<ResumeChannelIntentResult> => {
  const db = getDb()
  const intent = db.getChannelPendingIntent(input.intentId)
  const resume = intent == null ? undefined : readResumePayload(intent)
  const now = input.now ?? Date.now()
  if (intent == null || intent.status !== 'resolved' || resume?.status !== 'ready') {
    return {
      intentId: input.intentId,
      status: 'skipped'
    }
  }

  if (!hasDispatchFields(intent)) {
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

  db.updateChannelPendingIntent(intent.id, {
    metadata: withUpdatedResume(intent, resume, {
      claimedAt: now,
      status: 'dispatching'
    })
  })

  let childRun: ChannelChildSessionRunRow | undefined
  try {
    childRun = db.createChannelChildSessionRun({
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
    if (childRun == null) {
      throw new Error('failed to create channel child resume run')
    }

    const channelContext = buildResumeChannelContext(intent, resume, childRun.id)
    const runtimeContent = buildChannelResumeRuntimeContent(intent, resume)
    await processUserMessage(resume.sessionId, buildResumeUserContent(resume), {
      channelContext,
      runtimeContent
    })

    db.appendChannelConversationTurn({
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
    db.finishChannelChildSessionRun(childRun.id, {
      sessionId: resume.sessionId,
      status: 'dispatched'
    })
    db.updateChannelPendingIntent(intent.id, {
      metadata: withUpdatedResume(intent, resume, {
        dispatchedAt: Date.now(),
        resumeChildRunId: childRun.id,
        status: 'dispatched'
      })
    })

    return {
      intentId: intent.id,
      resumeChildRunId: childRun.id,
      sessionId: resume.sessionId,
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
    db.updateChannelPendingIntent(intent.id, {
      metadata: withUpdatedResume(intent, resume, {
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
