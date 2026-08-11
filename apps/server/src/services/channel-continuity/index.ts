import type { ChannelConversationTurnRow, ChannelPendingIntentRow } from '#~/db/index.js'
import { getDb } from '#~/db/index.js'

export interface ChannelContinuitySnapshot {
  ambientRecentTurns?: ChannelConversationTurnRow[]
  conversationStateId: string
  lastBotReply: { childRunId: string; createdAt: number; messageId: string; summary: string } | null
  participants: string[]
  pendingIntents: ChannelPendingIntentRow[]
  recentTurns: ChannelConversationTurnRow[]
  summary: string | null
  threadKey: string
  topic: string | null
}

export interface HydrateChannelContinuityInput {
  accountId: string
  canonicalUserId?: string
  conversationStateId: string
  now?: number
}

export const resolveAmbientChannelThreadKey = (input: { channelId: string; channelKey: string; entity: string }) => (
  `ambient:${input.channelKey}:${input.entity}:${input.channelId}`
)

export const loadAmbientChannelTurns = (input: {
  channelId: string
  channelKey: string
  channelType: string
  entity: string
  maxTurns: number
  ttlSeconds: number
  now?: number
}) => {
  const now = input.now ?? Date.now()
  if (input.maxTurns <= 0 || input.ttlSeconds <= 0) return []
  const threadKey = resolveAmbientChannelThreadKey(input)
  const state = getDb().getChannelConversationStateByThread({
    channelId: input.channelId,
    channelKey: input.channelKey,
    channelType: input.channelType,
    entity: input.entity,
    threadKey
  })
  if (state == null) return []
  const cutoff = now - input.ttlSeconds * 1000
  return getDb().listRecentChannelConversationTurns(state.id, input.maxTurns)
    .filter(turn => turn.createdAt >= cutoff)
}

export const hydrateChannelContinuity = (
  input: HydrateChannelContinuityInput
): ChannelContinuitySnapshot | undefined => {
  const now = input.now ?? Date.now()
  const state = getDb().getChannelConversationState(input.conversationStateId)
  if (state == null || state.expiresAt != null && state.expiresAt <= now) return undefined
  const pendingIntents = getDb().listOpenChannelPendingIntents({ conversationStateId: state.id }).filter(intent => (
    (intent.expiresAt == null || intent.expiresAt > now) &&
    (intent.ownerUserId == null || intent.ownerUserId === input.canonicalUserId) &&
    (intent.ownerAccountId == null || intent.ownerAccountId === input.accountId)
  ))
  return {
    conversationStateId: state.id,
    lastBotReply: state.lastBotReply,
    participants: state.activeParticipants,
    pendingIntents,
    recentTurns: getDb().listRecentChannelConversationTurns(state.id, 12),
    summary: state.summary,
    threadKey: state.threadKey,
    topic: state.topic
  }
}

export const renderChannelContinuity = (snapshot: ChannelContinuitySnapshot | undefined) => {
  if (snapshot == null) return undefined
  return [
    '<channel-continuity>',
    ...(snapshot.summary == null ? [] : [`Summary: ${snapshot.summary}`]),
    ...snapshot.recentTurns.map(turn => `${turn.role}: ${turn.summary ?? turn.text ?? ''}`),
    ...snapshot.pendingIntents.map(intent => `Pending: ${intent.kind} (${intent.requiredAction ?? 'action required'})`),
    '</channel-continuity>'
  ].join('\n')
}
