import { getDb } from '#~/db/index.js'
import type { ChannelAuthorizationRequestRow } from '#~/db/index.js'
import { handleInteractionResponse } from '#~/services/session/interaction.js'

import { buildResolvedAuthorizationResume } from './pending-intents.js'

const resolveMirroredInteraction = async (
  request: ChannelAuthorizationRequestRow,
  response: string
) => {
  const sessionId = typeof request.metadata?.sessionId === 'string' ? request.metadata.sessionId : undefined
  const interactionId = typeof request.metadata?.interactionId === 'string' ? request.metadata.interactionId : undefined
  if (sessionId == null || sessionId === '' || interactionId == null || interactionId === '') {
    return false
  }

  return await handleInteractionResponse(sessionId, interactionId, response)
}

export const resolveChannelAuthorizationRequest = async (input: {
  id: string
  interactionResponse?: 'allow_once' | 'deny_once'
  message?: string | null
  resolvedAt?: number
  resolvedByAccountId?: string
  resolvedByUserId?: string
  status: 'granted' | 'denied'
}) => {
  const db = getDb()
  const request = db.getChannelAuthorizationRequest(input.id)
  if (request == null) return undefined

  const resolvedAt = input.resolvedAt ?? Date.now()
  const updatedRequest = db.updateChannelAuthorizationRequest(input.id, {
    status: input.status,
    ...(input.message === undefined ? {} : { message: input.message }),
    resolvedAt
  }) ?? request

  const interactionHandled = input.interactionResponse == null
    ? false
    : await resolveMirroredInteraction(request, input.interactionResponse).catch(() => false)

  const pendingIntents = db.listOpenChannelPendingIntents({
    authorizationRequestId: input.id
  })
  for (const intent of pendingIntents) {
    db.updateChannelPendingIntent(intent.id, {
      metadata: {
        ...(intent.metadata ?? {}),
        authorizationStatus: input.status,
        resume: buildResolvedAuthorizationResume({
          interactionHandled,
          intent,
          interactionResponse: input.interactionResponse,
          request,
          resolvedAt,
          resolvedByAccountId: input.resolvedByAccountId,
          resolvedByUserId: input.resolvedByUserId,
          status: input.status
        }),
        resolvedByAccountId: input.resolvedByAccountId,
        resolvedByUserId: input.resolvedByUserId
      },
      resolvedAt,
      status: 'resolved'
    })
  }

  return {
    interactionHandled,
    pendingIntentIds: pendingIntents.map(intent => intent.id),
    request: updatedRequest
  }
}
