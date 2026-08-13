import type { ChannelInboundEvent } from '@oneworks/core/channel'

import { getDb } from '#~/db/index.js'
import { resolveChannelLinkBinding } from '#~/services/channel-links/index.js'
import type { ResolvedChannelLink } from '#~/services/channel-links/index.js'

import type { ChannelCommandInvocationInput } from './command-invocation-types'
import type { ChannelContext } from './middleware/@types'
import type { ChannelRuntimeState } from './types'

export const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

export const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const resolveActor = (
  inbound: ChannelInboundEvent,
  issuerKey: string,
  actorUserId?: string
): ChannelContext['actor'] => {
  const senderId = inbound.senderId?.trim()
  if (senderId == null || senderId === '') return undefined

  const db = getDb()
  const account = db.upsertChannelAccount({
    issuerKey,
    channelType: inbound.channelType,
    accountId: senderId
  })
  const identityLink = db.getChannelIdentityLink(issuerKey, senderId)
  const user = actorUserId != null
    ? db.getCanonicalUser(actorUserId)
    : identityLink?.status === 'verified'
    ? db.resolveCanonicalUserByChannelAccount(issuerKey, senderId)
    : undefined

  if (account == null) return undefined
  return { account, identityLink, user }
}

export const resolveInboundForCommand = (
  state: ChannelRuntimeState,
  input: ChannelCommandInvocationInput
): { inbound?: ChannelInboundEvent; message?: string } => {
  const context = input.context ?? {}
  const senderId = trimNonEmpty(context.senderId)
  const channelId = trimNonEmpty(context.channelId) ?? (context.sessionType === 'direct' ? senderId : undefined)
  if (channelId == null) {
    return { message: 'Missing channelId in channel command context.' }
  }

  const sessionType = trimNonEmpty(context.sessionType) ?? 'direct'
  const replyReceiveId = trimNonEmpty(context.replyReceiveId)
  const replyReceiveIdType = trimNonEmpty(context.replyReceiveIdType)

  return {
    inbound: {
      channelType: trimNonEmpty(context.channelType) ?? state.type,
      channelId,
      messageId: trimNonEmpty(context.messageId) ?? `channel-command-${Date.now()}`,
      raw: { entity: trimNonEmpty(context.entity), source: 'channel_command_tool' },
      ...(senderId == null ? {} : { senderId }),
      sessionType,
      ...(trimNonEmpty(context.threadId) == null ? {} : { threadId: trimNonEmpty(context.threadId) }),
      ...(replyReceiveId == null
        ? {}
        : {
          replyTo: {
            receiveId: replyReceiveId,
            receiveIdType: replyReceiveIdType ?? 'chat_id'
          }
        })
    }
  }
}

export const resolveChannelLinkForCommand = (
  state: ChannelRuntimeState,
  inbound: ChannelInboundEvent
): ResolvedChannelLink | undefined => {
  const match = resolveChannelLinkBinding(state.channelLinks ?? [], {
    channelId: inbound.channelId,
    channelKey: state.key,
    senderId: inbound.senderId,
    sessionType: inbound.sessionType,
    threadId: inbound.threadId
  })
  if (match == null) return undefined
  const requestedEntity = inbound.raw != null && typeof inbound.raw === 'object'
    ? trimNonEmpty((inbound.raw as Record<string, unknown>).entity)
    : undefined
  const candidates = [match.link, ...match.duplicates]
  return requestedEntity == null
    ? match.link
    : candidates.find(link => link.entity === requestedEntity)
}
