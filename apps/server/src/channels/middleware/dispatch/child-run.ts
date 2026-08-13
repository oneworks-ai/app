import type { ChannelExecutionContext, ChatMessageContent } from '@oneworks/core'
import type { EntityMemoryPolicy } from '@oneworks/types'

import { getDb } from '#~/db/index.js'
import { finishChannelResumeIntentsForChildRun } from '#~/services/channel-resume/index.js'
import type { ChannelResumeIntent } from '#~/services/channel-resume/index.js'

import type { ChannelMiddleware } from '../@types'
import { summarizeDispatchContent } from './context'

type DispatchMode = 'create_session' | 'continue_session'

export const createStartedChannelChildRun = (
  ctx: Parameters<ChannelMiddleware>[0],
  input: {
    conversationStateId: string
    contentKind: 'text' | 'rich'
    continuitySnapshot?: unknown
    dispatchMode: DispatchMode
    executionContext: ChannelExecutionContext
    memoryPolicy?: EntityMemoryPolicy
    model?: string
    memorySnapshotId?: string
    nextMessageResumeIntentIds?: string[]
    runtimeContent?: string | ChatMessageContent[]
    threadKey: string
    threadReason: string
  }
) =>
  getDb().createChannelChildSessionRun({
    actorAccountId: ctx.actor?.account.accountId ?? ctx.inbound.senderId,
    actorUserId: ctx.actor?.user?.id,
    channelId: ctx.inbound.channelId,
    channelKey: ctx.channelKey,
    channelLinkName: ctx.channelLink?.name,
    channelType: ctx.inbound.channelType,
    dispatchMode: input.dispatchMode,
    entity: ctx.channelLink?.entity,
    messageId: ctx.inbound.messageId,
    conversationStateId: input.conversationStateId,
    metadata: {
      adapter: ctx.ingressRoute?.adapter ?? ctx.channelAdapter,
      contentKind: input.contentKind,
      effort: ctx.ingressRoute?.effort ?? ctx.channelEffort,
      executionContext: input.executionContext,
      hasRuntimeContent: input.runtimeContent != null,
      memoryPolicy: input.memoryPolicy,
      model: input.model,
      ingressRoute: ctx.ingressRoute,
      ...(input.nextMessageResumeIntentIds == null || input.nextMessageResumeIntentIds.length === 0
        ? {}
        : { nextMessageResumeIntentIds: input.nextMessageResumeIntentIds }),
      permissionMode: ctx.channelPermissionMode,
      threadReason: input.threadReason
    },
    continuitySnapshot: input.continuitySnapshot,
    memorySnapshotId: input.memorySnapshotId,
    senderId: ctx.inbound.senderId,
    sessionType: ctx.inbound.sessionType,
    threadKey: input.threadKey,
    triggerType: 'message'
  })

type StartedChildRun = ReturnType<typeof createStartedChannelChildRun>

export const finishStartedChannelChildRun = (
  childRun: StartedChildRun,
  input: {
    error?: unknown
    intents: ChannelResumeIntent[]
    sessionId?: string
    status: 'dispatched' | 'failed'
  }
) => {
  if (childRun == null) return
  const error = input.error == null
    ? undefined
    : input.error instanceof Error
    ? input.error.message
    : String(input.error)
  if (input.status === 'dispatched') {
    getDb().markChannelChildSessionRunDispatched(childRun.id, { sessionId: input.sessionId })
    getDb().markChannelChildSessionRunRunning(childRun.id)
  } else {
    getDb().finishChannelChildSessionRun(childRun.id, {
      ...(error == null ? {} : { error }),
      sessionId: input.sessionId,
      status: 'failed'
    })
  }
  if (input.intents.length > 0) {
    finishChannelResumeIntentsForChildRun({
      childRunId: childRun.id,
      dispatchReason: 'next_message',
      ...(error == null ? {} : { error }),
      intents: input.intents,
      sessionId: input.sessionId,
      status: input.status
    })
  }
}

export const appendInboundConversationTurn = (
  ctx: Parameters<ChannelMiddleware>[0],
  input: {
    childRunId?: string
    conversationStateId: string
    dispatchContent: string | ChatMessageContent[]
    dispatchMode: DispatchMode
    threadKey: string
    threadReason: string
  }
) => {
  const { inbound } = ctx
  const summary = summarizeDispatchContent(input.dispatchContent)
  return getDb().appendChannelConversationTurn({
    actorAccountId: ctx.actor?.account.accountId ?? inbound.senderId,
    actorUserId: ctx.actor?.user?.id,
    channelId: inbound.channelId,
    channelKey: ctx.channelKey,
    channelLinkName: ctx.channelLink?.name,
    channelType: inbound.channelType,
    childRunId: input.childRunId,
    conversationStateId: input.conversationStateId,
    entity: ctx.channelLink?.entity,
    messageId: inbound.messageId,
    metadata: { dispatchMode: input.dispatchMode, threadReason: input.threadReason },
    role: 'inbound',
    senderId: inbound.senderId,
    sessionType: inbound.sessionType,
    summary,
    text: summary,
    threadKey: input.threadKey
  })
}
