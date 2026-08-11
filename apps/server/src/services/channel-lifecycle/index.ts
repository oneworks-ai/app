import { getDb } from '#~/db/index.js'

import {
  recordTerminalMemoryAudit,
  resolveWorkspaceMemoryOrgScope,
  syncChannelFileMemories
} from '#~/services/channel-memory/index.js'

type TerminalStatus = 'blocked' | 'completed' | 'expired' | 'failed'

const isTerminalStatus = (status: string): status is TerminalStatus => (
  status === 'blocked' || status === 'completed' || status === 'expired' || status === 'failed'
)

export const commitChannelChildRunTerminal = (input: {
  error?: string
  sessionId: string
  status: TerminalStatus
}) => {
  const run = getDb().getChannelChildSessionRunBySessionId(input.sessionId)
  if (run == null || isTerminalStatus(run.status)) return run
  const sync = syncChannelFileMemories({
    accountId: run.actorAccountId ?? run.senderId ?? 'anonymous',
    canonicalUserId: run.actorUserId ?? undefined,
    channelId: run.channelId,
    channelKey: run.channelKey,
    channelType: run.channelType,
    childRunId: run.id,
    conversationStateId: run.conversationStateId ?? undefined,
    entity: run.entity ?? undefined,
    issuer: run.channelKey,
    orgId: resolveWorkspaceMemoryOrgScope(),
    senderId: run.senderId ?? undefined,
    sessionType: run.sessionType,
    sourceMessageId: run.messageId ?? undefined,
    threadKey: run.threadKey ?? ''
  })
  recordTerminalMemoryAudit(run.id, input.status, sync.changedMemoryIds)
  return getDb().finishChannelChildSessionRun(run.id, {
    error: input.error,
    sessionId: input.sessionId,
    status: input.status
  })
}

export const recordChannelOutboundTurn = (input: {
  messageId?: string
  sessionId: string
  text: string
}) => {
  if (input.messageId == null) return
  const run = getDb().getChannelChildSessionRunBySessionId(input.sessionId)
  if (run == null || run.conversationStateId == null || run.threadKey == null) return
  const existing = getDb().listRecentChannelConversationTurns(run.conversationStateId, 40)
    .some(turn => turn.role === 'outbound' && turn.messageId === input.messageId)
  if (existing) return
  getDb().appendChannelConversationTurn({
    channelId: run.channelId,
    channelKey: run.channelKey,
    channelLinkName: run.channelLinkName,
    channelType: run.channelType,
    childRunId: run.id,
    conversationStateId: run.conversationStateId,
    entity: run.entity,
    messageId: input.messageId,
    role: 'outbound',
    sessionType: run.sessionType,
    summary: input.text.slice(0, 1000),
    text: input.text.slice(0, 1000),
    threadKey: run.threadKey
  })
}
