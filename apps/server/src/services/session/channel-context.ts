import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { cwd as processCwd, env as processEnv } from 'node:process'

import { resolveProjectHomePath } from '@oneworks/utils'

import { getDb } from '#~/db/index.js'

export { buildChannelRuntimeSystemPrompt } from './channel-runtime-prompt.js'

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
  messageId?: string
  replyReceiveId?: string
  replyReceiveIdType?: string
  senderId?: string
  sessionId?: string
  sessionType?: string
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
    messageId: trimNonEmpty(value.messageId),
    replyReceiveId: trimNonEmpty(value.replyReceiveId),
    replyReceiveIdType: trimNonEmpty(value.replyReceiveIdType),
    senderId: trimNonEmpty(value.senderId),
    sessionId: trimNonEmpty(value.sessionId),
    sessionType: trimNonEmpty(value.sessionType),
    threadKey: trimNonEmpty(value.threadKey)
  }

  return Object.values(context).some(item => item != null) ? context : undefined
}

export const resolveChannelMemoryRoot = (
  cwd = processCwd(),
  env: NodeJS.ProcessEnv = processEnv
) => {
  const serverDataDir = env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__?.trim()
  return path.resolve(
    serverDataDir && serverDataDir !== ''
      ? serverDataDir
      : resolveProjectHomePath(cwd, env, 'server', 'data'),
    'channel-memory',
    'v1'
  )
}

const toSafeContextFileName = (value: string) => value.replace(/[^\w.-]/gu, '_')

export const resolveChannelContextPath = (
  sessionId: string,
  cwd = processCwd(),
  env: NodeJS.ProcessEnv = processEnv
) => path.resolve(resolveChannelMemoryRoot(cwd, env), 'runtime-context', `${toSafeContextFileName(sessionId)}.json`)

export const createChannelRuntimeEnv = (input: {
  context?: ChannelRuntimeContext
  cwd?: string
  env?: NodeJS.ProcessEnv
  sessionId: string
}): NodeJS.ProcessEnv => {
  const cwd = input.cwd ?? processCwd()
  const env = input.env ?? processEnv
  const contextPath = resolveChannelContextPath(input.sessionId, cwd, env)
  const context = normalizeChannelRuntimeContext(input.context)

  if (context == null && !existsSync(contextPath)) {
    return {}
  }

  const senderId = context?.senderId ?? (context?.sessionType === 'direct' ? context.channelId : undefined)

  return {
    __ONEWORKS_PROJECT_CHANNEL_MEMORY_ROOT__: resolveChannelMemoryRoot(cwd, env),
    __ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__: contextPath,
    __ONEWORKS_PROJECT_CHANNEL_TYPE__: context?.channelType ?? '',
    __ONEWORKS_PROJECT_CHANNEL_KEY__: context?.channelKey ?? '',
    __ONEWORKS_PROJECT_CHANNEL_LINK__: context?.channelLinkName ?? '',
    __ONEWORKS_PROJECT_CHANNEL_ENTITY__: context?.entity ?? '',
    __ONEWORKS_PROJECT_CHANNEL_SESSION_TYPE__: context?.sessionType ?? '',
    __ONEWORKS_PROJECT_CHANNEL_ID__: context?.channelId ?? '',
    __ONEWORKS_PROJECT_CHANNEL_SENDER_ID__: senderId ?? '',
    __ONEWORKS_PROJECT_CHANNEL_THREAD_KEY__: context?.threadKey ?? '',
    __ONEWORKS_PROJECT_CHANNEL_CONVERSATION_STATE_ID__: context?.conversationStateId ?? '',
    __ONEWORKS_PROJECT_CHANNEL_CHILD_RUN_ID__: context?.childRunId ?? ''
  }
}

export const createSessionChannelMemoryEnv = (sessionId: string) => {
  const binding = getDb().getChannelSessionBySessionId(sessionId)
  return createChannelRuntimeEnv({
    sessionId,
    context: binding == null
      ? undefined
      : {
        channelId: binding.channelId,
        channelKey: binding.channelKey,
        channelType: binding.channelType,
        senderId: binding.senderId,
        sessionId,
        sessionType: binding.sessionType
      }
  })
}

export const writeChannelMessageContext = async (
  sessionId: string,
  input: ChannelRuntimeContext
) => {
  const filePath = resolveChannelContextPath(sessionId)
  await mkdir(path.dirname(filePath), { recursive: true })
  const context = normalizeChannelRuntimeContext(input) ?? {}
  const actorAccountId = context.actorAccountId ?? context.senderId ?? (
    context.sessionType === 'direct'
      ? context.channelId
      : undefined
  )
  const capturedAt = Date.now()
  const content = JSON.stringify(
    {
      actorAccountId,
      actorUserId: context.actorUserId,
      channelId: context.channelId,
      channelKey: context.channelKey,
      channelLinkName: context.channelLinkName,
      channelType: context.channelType,
      childRunId: context.childRunId,
      conversationStateId: context.conversationStateId,
      entity: context.entity,
      messageId: context.messageId,
      replyReceiveId: context.replyReceiveId,
      replyReceiveIdType: context.replyReceiveIdType,
      senderId: context.senderId,
      sessionId,
      sessionType: context.sessionType,
      threadKey: context.threadKey,
      updatedAt: capturedAt
    },
    null,
    2
  )
  await writeFile(filePath, `${content}\n`, 'utf8')
  getDb().updateSessionRuntimeState(sessionId, {
    channelActorSnapshot: {
      ...context,
      actorAccountId,
      capturedAt,
      sessionId
    }
  })
}
