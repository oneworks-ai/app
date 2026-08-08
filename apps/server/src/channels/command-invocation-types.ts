export interface ChannelCommandInvocationContext {
  actorAccountId?: string
  actorUserId?: string
  channelId?: string
  channelKey?: string
  channelLinkName?: string
  channelType?: string
  entity?: string
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
  toolName: string
}
