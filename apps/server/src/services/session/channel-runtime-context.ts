import type { ChannelExecutionContext } from '@oneworks/core'

export interface ChannelRuntimeContext {
  actorAccountId?: string
  actorUserId?: string
  channelId?: string
  channelKey?: string
  channelLinkName?: string
  channelType?: string
  childRunId?: string
  conversationStateId?: string
  entity?: string
  executionContext?: ChannelExecutionContext
  messageId?: string
  replyReceiveId?: string
  replyReceiveIdType?: string
  senderId?: string
  sessionId?: string
  sessionType?: string
  threadId?: string
  threadKey?: string
}

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeExecutionContext = (value: unknown): ChannelExecutionContext | undefined => {
  if (!isRecord(value) || !isRecord(value.entity) || !isRecord(value.source)) return undefined
  if (
    typeof value.entity.id !== 'string' ||
    typeof value.entity.label !== 'string' ||
    !Array.isArray(value.availableDeliveryTargets)
  ) return undefined
  return JSON.parse(JSON.stringify(value)) as ChannelExecutionContext
}

export const normalizeChannelRuntimeContext = (value: unknown): ChannelRuntimeContext | undefined => {
  if (!isRecord(value)) return undefined
  const context: ChannelRuntimeContext = {
    actorAccountId: trimNonEmpty(value.actorAccountId),
    actorUserId: trimNonEmpty(value.actorUserId),
    channelId: trimNonEmpty(value.channelId),
    channelKey: trimNonEmpty(value.channelKey),
    channelLinkName: trimNonEmpty(value.channelLinkName),
    channelType: trimNonEmpty(value.channelType),
    childRunId: trimNonEmpty(value.childRunId),
    conversationStateId: trimNonEmpty(value.conversationStateId),
    entity: trimNonEmpty(value.entity),
    executionContext: normalizeExecutionContext(value.executionContext),
    messageId: trimNonEmpty(value.messageId),
    replyReceiveId: trimNonEmpty(value.replyReceiveId),
    replyReceiveIdType: trimNonEmpty(value.replyReceiveIdType),
    senderId: trimNonEmpty(value.senderId),
    sessionId: trimNonEmpty(value.sessionId),
    sessionType: trimNonEmpty(value.sessionType),
    threadId: trimNonEmpty(value.threadId),
    threadKey: trimNonEmpty(value.threadKey)
  }
  return Object.values(context).some(item => item != null) ? context : undefined
}
