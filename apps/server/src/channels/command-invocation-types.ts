import type { ChannelExecutionContext } from '@oneworks/core'

export interface ChannelCommandInvocationContext {
  actorAccountId?: string
  actorUserId?: string
  channelId?: string
  channelKey?: string
  channelLinkName?: string
  channelType?: string
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

export interface ChannelCommandInvocationInput {
  /** Server-derived only. Caller-provided values are discarded by the authority resolver. */
  context?: ChannelCommandInvocationContext
  input?: unknown
  invocationToken?: string
  /** Stable for retries of one CLI/tool invocation; new intentional calls must use a new id. */
  requestId?: string
  toolName: string
}
