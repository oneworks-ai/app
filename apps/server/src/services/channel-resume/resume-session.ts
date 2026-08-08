import { bindChannelSession } from '#~/channels/middleware/bind-session.js'
import { getDb } from '#~/db/index.js'
import type { ChannelPendingIntentRow } from '#~/db/index.js'
import { canTransferChannelPermissionState } from '#~/services/session/channel-permission-transfer.js'
import { createSessionWithInitialMessage, discardIncompleteSessionCreation } from '#~/services/session/create.js'
import { writeChannelMessageContext } from '#~/services/session/index.js'

import {
  buildChannelResumeRuntimeContent,
  buildResumeChannelContext,
  buildResumeUserContent
} from './runtime-content.js'
import type { ChannelResumePayload } from './types.js'

const hasStarted = (session: { status?: string }) => session.status != null && session.status.trim() !== ''

export const createChannelResumeSession = async (input: {
  childRunId: string
  intent: ChannelPendingIntentRow
  resume: ChannelResumePayload
  sessionId: string
}) => {
  const db = getDb()
  const { childRunId, intent, resume, sessionId } = input
  const existing = db.getSession(sessionId)
  if (existing != null && hasStarted(existing)) return existing
  if (existing != null) await discardIncompleteSessionCreation(sessionId)
  const channelContext = buildResumeChannelContext(intent, resume, childRunId)
  const parentSession = db.getSession(resume.sessionId)
  const parentActorSnapshot = db.getSessionRuntimeState(resume.sessionId)?.channelActorSnapshot
  channelContext.threadId = parentActorSnapshot?.threadId
  const deliveryBinding = db.getChannelSessionBySessionId(resume.sessionId)

  try {
    return await createSessionWithInitialMessage({
      account: parentSession?.account,
      adapter: parentSession?.adapter,
      effort: parentSession?.effort,
      fastMode: parentSession?.fastMode,
      initialMessage: buildResumeUserContent(resume),
      initialRuntimeContent: buildChannelResumeRuntimeContent(intent, resume),
      model: parentSession?.model,
      parentSessionId: resume.sessionId,
      id: sessionId,
      permissionMode: parentSession?.permissionMode,
      promptName: parentSession?.promptName,
      promptType: parentSession?.promptType,
      shouldStart: true,
      title: `Resume ${resume.authorizationRequestId}`,
      channelContext,
      beforeStart: async (sessionId) => {
        if (canTransferChannelPermissionState(parentActorSnapshot, channelContext)) {
          db.transferSessionPermissionState(resume.sessionId, sessionId)
        }
        channelContext.sessionId = sessionId
        bindChannelSession({
          channelId: intent.channelId!,
          channelKey: intent.channelKey!,
          channelType: intent.channelType,
          replyReceiveId: deliveryBinding?.replyReceiveId,
          replyReceiveIdType: deliveryBinding?.replyReceiveIdType,
          senderId: intent.ownerAccountId ?? undefined,
          sessionId,
          sessionType: intent.sessionType!,
          threadId: parentActorSnapshot?.threadId
        })
        await writeChannelMessageContext(sessionId, channelContext)
      },
      workspace: {
        createWorktree: false,
        sourceSessionId: resume.sessionId
      }
    })
  } catch (error) {
    const racedSession = db.getSession(sessionId)
    if (racedSession != null) return racedSession
    throw error
  }
}
