import { getDb } from '#~/db/index.js'
import type { ChannelPendingIntentDelivery } from '#~/db/index.js'

import { readStringMetadata, trimNonEmpty } from './metadata.js'

const AUTHORIZATION_DELIVERY_THROTTLE_MS = 20 * 60 * 1000

const buildAuthorizationDeliveryThrottleKey = (authorizationRequestId: string) =>
  `authorization-request-delivery\0${authorizationRequestId}`

export const markChannelAuthorizationRequestDelivered = (input: {
  delivery: ChannelPendingIntentDelivery
  deliveryMessageId?: string | null
  id: string
  now?: number
  windowMs?: number
}) => {
  const db = getDb()
  const pendingIntents = db.listOpenChannelPendingIntents({
    authorizationRequestId: input.id
  })
  const deliveredAt = input.now ?? Date.now()

  for (const intent of pendingIntents) {
    db.updateChannelPendingIntent(intent.id, {
      delivery: input.delivery,
      deliveryMessageId: trimNonEmpty(input.deliveryMessageId) ?? null,
      metadata: {
        ...(intent.metadata ?? {}),
        deliveredAt
      }
    })
  }

  return pendingIntents.map(intent => intent.id)
}

export const reserveChannelAuthorizationRequestDelivery = (input: {
  id: string
  now?: number
  windowMs?: number
}) => {
  const db = getDb()
  const request = db.getChannelAuthorizationRequest(input.id)
  if (request == null) return undefined
  const firstIntent = db.listOpenChannelPendingIntents({
    authorizationRequestId: input.id
  })[0]
  const reservedAt = input.now ?? Date.now()
  const reserved = db.consumeChannelReplyThrottle({
    throttleKey: buildAuthorizationDeliveryThrottleKey(input.id),
    policyType: 'authorization_request_delivery',
    channelType: request.channelType,
    channelId: firstIntent?.channelId ??
      readStringMetadata(request.metadata, 'channelId') ??
      input.id,
    channelLinkName: firstIntent?.channelLinkName ?? request.channelLinkName,
    actorUserId: firstIntent?.ownerUserId ?? request.credentialSubjectUserId ?? request.requesterUserId,
    actorAccountId: firstIntent?.ownerAccountId ?? request.requesterAccountId,
    metadata: {
      authorizationRequestId: input.id,
      reservation: true
    },
    now: reservedAt,
    windowMs: input.windowMs ?? AUTHORIZATION_DELIVERY_THROTTLE_MS
  })
  return reserved ? { reservedAt } : undefined
}

export const releaseChannelAuthorizationRequestDelivery = (input: {
  id: string
  reservedAt: number
}) =>
  getDb().releaseChannelReplyThrottle({
    lastSentAt: input.reservedAt,
    throttleKey: buildAuthorizationDeliveryThrottleKey(input.id)
  })

export const shouldDeliverChannelAuthorizationRequest = (input: {
  id: string
  now?: number
  windowMs?: number
}) => {
  const windowMs = input.windowMs ?? AUTHORIZATION_DELIVERY_THROTTLE_MS
  if (windowMs <= 0) return true

  const throttle = getDb().getChannelReplyThrottle(buildAuthorizationDeliveryThrottleKey(input.id))
  if (throttle == null) return true

  return (input.now ?? Date.now()) - throttle.lastSentAt >= windowMs
}
