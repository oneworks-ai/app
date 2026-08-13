/* eslint-disable max-lines -- Dispatch keeps continuity, memory, child-run audit, and session creation in one transaction. */
import { getDb } from '#~/db/index.js'
import {
  hydrateChannelContinuity,
  loadAmbientChannelTurns,
  renderChannelContinuity
} from '#~/services/channel-continuity/index.js'
import {
  renderChannelMemorySnapshot,
  resolveChannelMemorySnapshot,
  resolveWorkspaceMemoryOrgScope
} from '#~/services/channel-memory/index.js'
import { getWorkspaceFolder } from '#~/services/config/index.js'
import { canTransferChannelPermissionState } from '#~/services/session/channel-permission-transfer.js'
import { createSessionWithInitialMessage } from '#~/services/session/create.js'
import { writeChannelMessageContext } from '#~/services/session/index.js'
import { DefinitionLoader } from '@oneworks/definition-loader'
import { buildServiceModelSelector } from '@oneworks/utils'

import type { ChannelMiddleware } from '../@types'
import { stripSpeakerPrefix } from '../@utils'
import { syncChannelSessionBinding } from '../bind-session'
import { appendInboundConversationTurn, createStartedChannelChildRun, finishStartedChannelChildRun } from './child-run'
import {
  buildChannelExecutionContext,
  buildChannelMessageContext,
  buildChannelTags,
  ensureDispatchConversation,
  projectInboundMessageToRoom,
  resolveChannelThread,
  summarizeDispatchContent
} from './context'
import { buildSessionSystemPrompt } from './prompt'
import { prepareNextMessageResumes } from './resume'
import { appendRuntimeText, buildRuntimeContentForAgent, resolveChannelMultimodalModel } from './runtime-content'

export const dispatchMiddleware: ChannelMiddleware = async (ctx, next) => {
  const { inbound, connection, config } = ctx
  const entityDefinition = ctx.channelLink?.entity == null
    ? undefined
    : (await new DefinitionLoader(getWorkspaceFolder()).loadEntityDocumentSet(ctx.channelLink.entity))?.definition
  const entityRuntime = entityDefinition?.attributes.runtime
  const entityMemory = entityDefinition?.attributes.memory
  const hasContent = ctx.contentItems != null && ctx.contentItems.length > 0
  const entityModel = entityRuntime?.model == null
    ? undefined
    : entityRuntime.modelService == null || entityRuntime.model.includes(',')
    ? entityRuntime.model
    : buildServiceModelSelector(entityRuntime.modelService, entityRuntime.model)
  const multimodalModel = ctx.ingressRoute?.model ?? entityModel ?? resolveChannelMultimodalModel(ctx)
  const dispatchContent = hasContent ? ctx.contentItems! : inbound.text ?? ''
  const executionContext = buildChannelExecutionContext(ctx)
  await projectInboundMessageToRoom(ctx, executionContext, summarizeDispatchContent(dispatchContent))
  const thread = resolveChannelThread(ctx)
  const conversationState = ensureDispatchConversation(ctx, thread)
  const nextMessageResumes = prepareNextMessageResumes(ctx, {
    conversationStateId: conversationState.id,
    threadKey: thread.threadKey
  })
  const actorAccountId = ctx.actor?.account.accountId ?? inbound.senderId ?? 'anonymous'
  const continuitySnapshot = hydrateChannelContinuity({
    accountId: actorAccountId,
    canonicalUserId: ctx.actor?.user?.id,
    conversationStateId: conversationState.id
  })
  const ambientTurns = ctx.channelLink == null ? [] : loadAmbientChannelTurns({
    channelId: inbound.channelId,
    channelKey: ctx.channelKey,
    channelType: inbound.channelType,
    entity: ctx.channelLink.entity,
    maxTurns: ctx.channelLink.ingress?.observeWindow?.maxTurns ?? 20,
    ttlSeconds: ctx.channelLink.ingress?.observeWindow?.ttlSeconds ?? 1800
  })
  const hydratedContinuity = continuitySnapshot == null || ambientTurns.length === 0
    ? continuitySnapshot
    : { ...continuitySnapshot, ambientRecentTurns: ambientTurns }
  const memorySnapshot = resolveChannelMemorySnapshot({
    accountId: actorAccountId,
    canonicalUserId: ctx.actor?.user?.id,
    channelId: inbound.channelId,
    channelKey: ctx.channelKey,
    channelType: inbound.channelType,
    conversationStateId: conversationState.id,
    entity: ctx.channelLink?.entity,
    issuer: ctx.channelKey,
    memoryPolicy: entityMemory,
    orgId: resolveWorkspaceMemoryOrgScope(),
    maxCandidates: entityMemory?.maxCandidatesPerTurn,
    budget: entityMemory?.maxItemsPerTurn == null && entityMemory?.maxTokensPerTurn == null
      ? undefined
      : {
        maxItems: entityMemory.maxItemsPerTurn ?? 20,
        maxTokens: entityMemory.maxTokensPerTurn ?? 3000
      },
    groupBudget: {
      maxItemsPerGroup: entityMemory?.maxItemsPerGroup,
      maxTokensPerGroup: entityMemory?.maxTokensPerGroup
    },
    roomId: executionContext.room?.id,
    query: typeof dispatchContent === 'string' ? dispatchContent : inbound.text ?? '',
    senderId: inbound.senderId,
    sessionType: inbound.sessionType,
    sourceMessageId: inbound.messageId,
    threadKey: thread.threadKey
  })
  const baseRuntimeContent = await buildRuntimeContentForAgent(inbound, dispatchContent)
  const hydrationText = [
    nextMessageResumes.runtimeText,
    renderChannelContinuity(hydratedContinuity),
    ambientTurns.length === 0 ? undefined : [
      '<ambient-channel-context>',
      ...ambientTurns.map(turn => (
        `${turn.role}: ${turn.summary ?? turn.text ?? ''}`
      )),
      '</ambient-channel-context>'
    ].join('\n'),
    renderChannelMemorySnapshot(memorySnapshot)
  ].filter((item): item is string => item != null).join('\n\n')
  const runtimeContent = hydrationText === ''
    ? baseRuntimeContent
    : appendRuntimeText(baseRuntimeContent, dispatchContent, hydrationText)
  const dispatchMode = ctx.sessionId == null ? 'create_session' : 'continue_session'
  const parentSessionId = ctx.sessionId
  const transferParentPermission = parentSessionId != null && canTransferChannelPermissionState(
    getDb().getSessionRuntimeState(parentSessionId)?.channelActorSnapshot,
    {
      actorAccountId: ctx.actor?.account.accountId,
      actorUserId: ctx.actor?.user?.id,
      channelKey: ctx.channelKey,
      senderId: ctx.inbound.senderId
    }
  )
  const childRun = createStartedChannelChildRun(ctx, {
    conversationStateId: conversationState.id,
    contentKind: hasContent ? 'rich' : 'text',
    dispatchMode,
    executionContext,
    memoryPolicy: entityMemory,
    model: multimodalModel,
    runtimeContent,
    threadKey: thread.threadKey,
    threadReason: thread.reason,
    nextMessageResumeIntentIds: nextMessageResumes.items.map(item => item.intent.id),
    continuitySnapshot: hydratedContinuity,
    memorySnapshotId: memorySnapshot.id
  })
  if (childRun != null) {
    getDb().attachChannelMemorySnapshotToChildRun(memorySnapshot.id, childRun.id)
    if (ctx.ingressRouterRunId != null) {
      getDb().attachChannelIngressRouterRunChild(ctx.ingressRouterRunId, childRun.id)
    }
  }
  const channelContext = buildChannelMessageContext(ctx, {
    childRunId: childRun?.id,
    conversationStateId: conversationState.id,
    executionContext,
    memoryPolicy: entityMemory,
    threadKey: thread.threadKey
  })

  try {
    const systemPrompt = await buildSessionSystemPrompt(inbound, config, connection, executionContext)
    const session = await createSessionWithInitialMessage({
      title: stripSpeakerPrefix(inbound.text ?? '').split('\n')[0],
      initialMessage: hasContent ? undefined : inbound.text,
      initialContent: hasContent ? ctx.contentItems : undefined,
      initialRuntimeContent: runtimeContent,
      parentSessionId,
      shouldStart: true,
      adapter: ctx.ingressRoute?.adapter ?? entityRuntime?.adapter ?? ctx.channelAdapter,
      effort: ctx.ingressRoute?.effort ?? ctx.channelEffort,
      model: multimodalModel,
      permissionMode: ctx.channelPermissionMode,
      promptType: ctx.channelLink == null ? undefined : 'entity',
      promptName: ctx.channelLink?.entity,
      tags: buildChannelTags(inbound),
      systemPrompt,
      channelContext,
      beforeStart: async (sessionId) => {
        if (parentSessionId != null && transferParentPermission) {
          getDb().transferSessionPermissionState(parentSessionId, sessionId)
        }
        syncChannelSessionBinding({ channelKey: ctx.channelKey, inbound, sessionId })
        await writeChannelMessageContext(sessionId, channelContext)
      },
      ...(parentSessionId == null
        ? {}
        : {
          workspace: {
            createWorktree: false,
            sourceSessionId: parentSessionId
          }
        })
    })
    ctx.sessionId = session.id

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
