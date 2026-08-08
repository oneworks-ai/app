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
  threadKey?: string
}

export interface ChannelCommandInvocationInput {
  context?: ChannelCommandInvocationContext
  input?: unknown
  sessionId?: string
  toolName: string
}
