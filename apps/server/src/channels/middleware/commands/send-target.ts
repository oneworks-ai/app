import type { ChannelDeliveryTarget } from '@oneworks/types'

import type { ChannelContext } from '../@types'

export type ChannelSendPayload = string | Record<string, unknown>

export interface ChannelSendTargetInput {
  accountLabel?: string
  channelId?: string
  channelKey?: string
  channelLinkName?: string
  channelType?: string
  conversationId?: string
  conversationKind?: ChannelDeliveryTarget['conversationKind']
  label?: string
  receiveId?: string
  receiveIdType?: string
  threadId?: string
}

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export const normalizePayload = (value: unknown): ChannelSendPayload => {
  if (typeof value === 'string') return value
  if (isRecord(value)) return value
  throw new Error('message must be a string or an object payload.')
}

export const summarizePayload = (payload: ChannelSendPayload) => {
  if (typeof payload === 'string') return payload
  const text = trimNonEmpty(payload.text) ?? trimNonEmpty(payload.content)
  return text ?? `[${trimNonEmpty(payload.type) ?? 'message'}]`
}

const conversationKind = (ctx: ChannelContext): ChannelDeliveryTarget['conversationKind'] => {
  switch (ctx.inbound.sessionType) {
    case 'direct':
      return 'direct'
    case 'group':
      return 'group'
    default:
      return 'unknown'
  }
}

export const resolveTarget = (
  ctx: ChannelContext,
  rawTarget: unknown
): ChannelDeliveryTarget => {
  const target = rawTarget == null ? {} : isRecord(rawTarget) ? rawTarget as ChannelSendTargetInput : undefined
  if (target == null) throw new Error('target must be an object when provided.')
  if (rawTarget == null && ctx.executionContext?.defaultReplyTarget != null) {
    return ctx.executionContext.defaultReplyTarget
  }

  const requested = Object.fromEntries(
    Object.entries(target).flatMap(([key, value]) => {
      const normalized = trimNonEmpty(value)
      return normalized == null ? [] : [[key, normalized]]
    })
  ) as Record<string, string>
  const matches = ctx.executionContext?.availableDeliveryTargets.filter(candidate => (
    (requested.accountLabel == null || candidate.accountLabel === requested.accountLabel) &&
    (requested.channelId == null || candidate.channelId === requested.channelId) &&
    (requested.channelKey == null || candidate.channelKey === requested.channelKey) &&
    (requested.channelLinkName == null || candidate.channelLinkName === requested.channelLinkName) &&
    (requested.channelType == null || candidate.channelType === requested.channelType) &&
    (requested.conversationId == null || candidate.channelId === requested.conversationId) &&
    (requested.conversationKind == null || candidate.conversationKind === requested.conversationKind) &&
    (requested.label == null || candidate.label === requested.label) &&
    (requested.receiveId == null || candidate.receiveId === requested.receiveId) &&
    (requested.receiveIdType == null || candidate.receiveIdType === requested.receiveIdType) &&
    (requested.threadId == null || candidate.threadId === requested.threadId)
  )) ?? []
  if (matches.length > 1) throw new Error('target is ambiguous; provide channelKey and receiveId.')
  if (matches.length === 1) return matches[0]!
  if (ctx.executionContext != null && rawTarget != null) {
    throw new Error('target is not available to the current entity in this Room.')
  }

  const channelKey = trimNonEmpty(target.channelKey) ?? ctx.channelKey
  const channelType = trimNonEmpty(target.channelType) ?? ctx.inbound.channelType
  if (channelKey !== ctx.channelKey || channelType !== ctx.inbound.channelType) {
    throw new Error(
      "Cross-channel delivery must use the target account's channel command context; it cannot inherit this channel account."
    )
  }

  const channelId = trimNonEmpty(target.channelId) ?? trimNonEmpty(target.conversationId) ?? ctx.inbound.channelId
  const receiveId = trimNonEmpty(target.receiveId) ?? ctx.inbound.replyTo?.receiveId ?? channelId
  const receiveIdType = trimNonEmpty(target.receiveIdType) ?? ctx.inbound.replyTo?.receiveIdType ?? 'chat_id'
  if (channelId.trim() === '' || receiveId.trim() === '') {
    throw new Error('target must provide channelId, conversationId, or receiveId.')
  }

  return {
    ...(trimNonEmpty(target.accountLabel) == null ? {} : { accountLabel: trimNonEmpty(target.accountLabel) }),
    channelId,
    channelKey,
    ...(trimNonEmpty(target.channelLinkName) == null
      ? {}
      : { channelLinkName: trimNonEmpty(target.channelLinkName) }),
    channelType,
    conversationKind: target.conversationKind ?? conversationKind(ctx),
    label: trimNonEmpty(target.label) ?? channelId,
    receiveId,
    receiveIdType,
    ...(trimNonEmpty(target.threadId) == null ? {} : { threadId: trimNonEmpty(target.threadId) })
  }
}

export const payloadSchema = {
  anyOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }]
}

export const targetSchema = {
  type: 'object',
  properties: {
    accountLabel: { type: 'string' },
    channelId: { type: 'string' },
    channelKey: { type: 'string' },
    channelLinkName: { type: 'string' },
    channelType: { type: 'string' },
    conversationId: { type: 'string' },
    conversationKind: { type: 'string', enum: ['direct', 'group', 'room', 'thread', 'unknown'] },
    label: { type: 'string' },
    receiveId: { type: 'string' },
    receiveIdType: { type: 'string' },
    threadId: { type: 'string' }
  },
  additionalProperties: false
}
