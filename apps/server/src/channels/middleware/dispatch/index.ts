import { createSessionWithInitialMessage } from '#~/services/session/create.js'
import { processUserMessage, writeChannelMessageContext } from '#~/services/session/index.js'

import type { ChannelMiddleware } from '../@types'
import { stripSpeakerPrefix } from '../@utils'
import { syncChannelSessionBinding } from '../bind-session'
import {
  appendInboundConversationTurn,
  createStartedChannelChildRun,
  finishStartedChannelChildRun,
  markStartedChannelChildRunDispatching
} from './child-run'
import {
  buildChannelMessageContext,
  buildChannelTags,
  ensureDispatchConversation,
  resolveChannelThread
} from './context'
import { buildSessionSystemPrompt } from './prompt'
import { prepareNextMessageResumes } from './resume'
import { appendRuntimeText, buildRuntimeContentForAgent, resolveChannelMultimodalModel } from './runtime-content'

export const dispatchMiddleware: ChannelMiddleware = async (ctx, next) => {
  const { inbound, connection, config } = ctx
  const hasContent = ctx.contentItems != null && ctx.contentItems.length > 0
  const multimodalModel = resolveChannelMultimodalModel(ctx)
  const dispatchContent = hasContent ? ctx.contentItems! : inbound.text ?? ''
  const thread = resolveChannelThread(ctx)
  const conversationState = ensureDispatchConversation(ctx, thread)
  const nextMessageResumes = prepareNextMessageResumes(ctx, {
    conversationStateId: conversationState.id,
    threadKey: thread.threadKey
  })
  const baseRuntimeContent = await buildRuntimeContentForAgent(inbound, dispatchContent)
  const runtimeContent = nextMessageResumes.runtimeText == null
    ? baseRuntimeContent
    : appendRuntimeText(baseRuntimeContent, dispatchContent, nextMessageResumes.runtimeText)
  const dispatchMode = ctx.sessionId == null ? 'create_session' : 'continue_session'
  const childRun = createStartedChannelChildRun(ctx, {
    conversationStateId: conversationState.id,
    contentKind: hasContent ? 'rich' : 'text',
    dispatchMode,
    model: multimodalModel,
    runtimeContent,
    sessionId: ctx.sessionId,
    threadKey: thread.threadKey,
    threadReason: thread.reason,
    nextMessageResumeIntentIds: nextMessageResumes.items.map(item => item.intent.id)
  })
  const channelContext = buildChannelMessageContext(ctx, {
    childRunId: childRun?.id,
    conversationStateId: conversationState.id,
    threadKey: thread.threadKey
  })

  try {
    markStartedChannelChildRunDispatching(childRun, nextMessageResumes.items)
    if (!ctx.sessionId) {
      const systemPrompt = await buildSessionSystemPrompt(inbound, config, connection)
      const session = await createSessionWithInitialMessage({
        title: stripSpeakerPrefix(inbound.text ?? '').split('\n')[0],
        initialMessage: hasContent ? undefined : inbound.text,
        initialContent: hasContent ? ctx.contentItems : undefined,
        initialRuntimeContent: runtimeContent,
        shouldStart: true,
        adapter: ctx.channelAdapter,
        effort: ctx.channelEffort,
        model: multimodalModel,
        permissionMode: ctx.channelPermissionMode,
        promptType: ctx.channelLink == null ? undefined : 'entity',
        promptName: ctx.channelLink?.entity,
        tags: buildChannelTags(inbound),
        systemPrompt,
        channelContext,
        beforeStart: async (sessionId) => {
          syncChannelSessionBinding({ channelKey: ctx.channelKey, inbound, sessionId })
          await writeChannelMessageContext(sessionId, channelContext)
        }
      })
      ctx.sessionId = session.id
    } else {
      await processUserMessage(ctx.sessionId, dispatchContent, {
        channelContext,
        ...(runtimeContent == null ? {} : { runtimeContent }),
        ...(multimodalModel == null ? {} : { model: multimodalModel })
      })
    }

    finishStartedChannelChildRun(childRun, {
      intents: nextMessageResumes.items,
      sessionId: ctx.sessionId,
      status: 'dispatched'
    })
    appendInboundConversationTurn(ctx, {
      childRunId: childRun?.id,
      conversationStateId: conversationState.id,
      dispatchContent,
      dispatchMode,
      threadKey: thread.threadKey,
      threadReason: thread.reason
    })
  } catch (error) {
    finishStartedChannelChildRun(childRun, {
      error,
      intents: nextMessageResumes.items,
      sessionId: ctx.sessionId,
      status: 'failed'
    })
    throw error
  }

  await next()
}
