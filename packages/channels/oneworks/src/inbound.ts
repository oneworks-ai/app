import { randomUUID } from 'node:crypto'

import type { ChannelInboundEvent, ChannelNavigationReference } from '@oneworks/core/channel'

import { oneworksInboundWebhookSchema } from '#~/types.js'

const resolveChannelId = (payload: { channelId?: string; roomId?: string; senderId: string; threadId?: string }) =>
  payload.channelId ?? payload.roomId ?? payload.threadId ?? `direct:${payload.senderId}`

const resolveSessionType = (payload: { roomId?: string; sessionType?: 'direct' | 'group' }) =>
  payload.sessionType ?? (payload.roomId == null ? 'direct' : 'group')

export const normalizeInboundEvent = (
  payload: unknown,
  source: 'insecure_simulation' | 'native' | 'product_simulation',
  navigation?: ChannelNavigationReference
): ChannelInboundEvent | undefined => {
  const parsed = oneworksInboundWebhookSchema.safeParse(payload)
  if (!parsed.success) return undefined

  const data = parsed.data
  const channelId = resolveChannelId(data)
  const sessionType = resolveSessionType(data)
  return {
    channelType: 'oneworks',
    sessionType,
    channelId,
    senderId: source === 'native' ? data.senderId : `oneworks-simulation:${data.senderId}`,
    messageId: data.messageId ?? `oneworks-in-${randomUUID()}`,
    ...(navigation != null ? { navigation } : {}),
    mentionedBot: sessionType === 'group' ? data.mentionedBot : undefined,
    replyMessageId: data.replyMessageId,
    rootMessageId: data.rootMessageId,
    text: data.text,
    threadId: data.threadId,
    synthetic: source === 'product_simulation' && data.simulation != null
      ? {
        actorRole: data.simulation.actorRole,
        kind: 'product_simulation',
        userLabel: data.simulation.userLabel
      }
      : undefined,
    replyTo: data.replyTo ?? {
      receiveId: channelId,
      receiveIdType: sessionType === 'group' ? 'room' : 'direct'
    },
    raw: {
      ...data,
      contentItems: data.contentItems,
      mentions: data.mentions,
      source: source === 'native' ? 'oneworks-native' : `oneworks-${source}`
    }
  }
}
