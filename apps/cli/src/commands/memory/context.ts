import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { mergeProcessEnvWithProjectEnv, resolveProjectHomePath } from '@oneworks/utils'

import type { MemoryCommandOptions, MemoryContext } from './shared'
import { trimNonEmpty } from './shared'

const MEMORY_ROOT_ENV = '__ONEWORKS_PROJECT_CHANNEL_MEMORY_ROOT__'
const CHANNEL_TYPE_ENV = '__ONEWORKS_PROJECT_CHANNEL_TYPE__'
const CHANNEL_KEY_ENV = '__ONEWORKS_PROJECT_CHANNEL_KEY__'
const CHANNEL_ID_ENV = '__ONEWORKS_PROJECT_CHANNEL_ID__'
const CHANNEL_ENTITY_ENV = '__ONEWORKS_PROJECT_CHANNEL_ENTITY__'
const CHANNEL_CONVERSATION_STATE_ID_ENV = '__ONEWORKS_PROJECT_CHANNEL_CONVERSATION_STATE_ID__'
const CHANNEL_SESSION_TYPE_ENV = '__ONEWORKS_PROJECT_CHANNEL_SESSION_TYPE__'
const CHANNEL_SENDER_ID_ENV = '__ONEWORKS_PROJECT_CHANNEL_SENDER_ID__'
const CHANNEL_CONTEXT_PATH_ENV = '__ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__'
const CHANNEL_CHILD_RUN_ID_ENV = '__ONEWORKS_PROJECT_CHANNEL_CHILD_RUN_ID__'
const SESSION_ID_ENV = '__ONEWORKS_PROJECT_SESSION_ID__'

const resolveRoot = (cwd: string, env: NodeJS.ProcessEnv) => {
  const explicitRoot = trimNonEmpty(env[MEMORY_ROOT_ENV])
  if (explicitRoot != null) return path.resolve(explicitRoot)

  const serverDataDir = trimNonEmpty(env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__)
  const dataRoot = serverDataDir == null
    ? resolveProjectHomePath(cwd, env, 'server', 'data')
    : path.resolve(serverDataDir)
  return path.resolve(dataRoot, 'channel-memory', 'v1')
}

const readChannelContext = (env: NodeJS.ProcessEnv) => {
  const contextPath = trimNonEmpty(env[CHANNEL_CONTEXT_PATH_ENV])
  if (contextPath == null) return { context: undefined, contextPath: undefined }

  try {
    const parsed = JSON.parse(readFileSync(contextPath, 'utf8')) as unknown
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { context: undefined, contextPath }
    }
    return { context: parsed as Record<string, unknown>, contextPath }
  } catch {
    return { context: undefined, contextPath }
  }
}

const readRoomId = (channelContext: Record<string, unknown> | undefined) => {
  const executionContext = channelContext?.executionContext
  if (executionContext == null || typeof executionContext !== 'object' || Array.isArray(executionContext)) {
    return undefined
  }
  const room = (executionContext as Record<string, unknown>).room
  if (room == null || typeof room !== 'object' || Array.isArray(room)) return undefined
  return trimNonEmpty((room as Record<string, unknown>).id)
}

export const resolveContext = (options: MemoryCommandOptions): MemoryContext => {
  const cwd = options.cwd ?? process.cwd()
  const env = mergeProcessEnvWithProjectEnv(options.env, { workspaceFolder: cwd }) as NodeJS.ProcessEnv
  const { context: channelContext, contextPath: channelContextPath } = readChannelContext(env)
  const hasChannelContext = channelContextPath != null
  const contextChannelType = trimNonEmpty(channelContext?.channelType)
  const contextChannelKey = trimNonEmpty(channelContext?.channelKey)
  const contextSessionType = trimNonEmpty(channelContext?.sessionType)
  const contextChannelId = trimNonEmpty(channelContext?.channelId)
  const contextConversationStateId = trimNonEmpty(channelContext?.conversationStateId)
  const contextEntity = trimNonEmpty(channelContext?.entity)
  const contextSenderId = trimNonEmpty(channelContext?.senderId)
  const contextSessionId = trimNonEmpty(channelContext?.sessionId)
  const requestedChannelRef = trimNonEmpty(options.channel)
  const fallbackChannelType = contextChannelType ??
    (hasChannelContext ? undefined : trimNonEmpty(env[CHANNEL_TYPE_ENV]))
  const fallbackChannelKey = contextChannelKey ?? (hasChannelContext ? undefined : trimNonEmpty(env[CHANNEL_KEY_ENV]))
  const requestedChannelParts = requestedChannelRef?.split(':') ?? []
  const channelType = hasChannelContext ? fallbackChannelType : requestedChannelParts[0] || fallbackChannelType
  const channelKey = hasChannelContext
    ? fallbackChannelKey
    : requestedChannelParts.slice(1).join(':') || fallbackChannelKey
  const channelRef = !hasChannelContext && requestedChannelRef != null && requestedChannelRef.includes(':')
    ? requestedChannelRef
    : channelType != null && channelKey != null
    ? `${channelType}:${channelKey}`
    : hasChannelContext
    ? channelType
    : requestedChannelRef ?? channelType
  const channelId = contextChannelId ?? (hasChannelContext ? undefined : trimNonEmpty(env[CHANNEL_ID_ENV]))
  const channelSessionType = contextSessionType ?? (
    hasChannelContext ? undefined : trimNonEmpty(options.sessionType) ?? trimNonEmpty(env[CHANNEL_SESSION_TYPE_ENV])
  )
  const senderId = contextSenderId ?? (
    channelSessionType === 'group'
      ? undefined
      : hasChannelContext
      ? undefined
      : trimNonEmpty(env[CHANNEL_SENDER_ID_ENV])
  ) ??
    (channelSessionType === 'direct' ? channelId : undefined)

  return {
    channelContextPath,
    channelId,
    channelKey,
    channelRef,
    channelSessionType,
    channelType,
    childRunId: trimNonEmpty(channelContext?.childRunId) ?? (
      hasChannelContext ? undefined : trimNonEmpty(env[CHANNEL_CHILD_RUN_ID_ENV])
    ),
    conversationStateId: contextConversationStateId ?? (
      hasChannelContext ? undefined : trimNonEmpty(env[CHANNEL_CONVERSATION_STATE_ID_ENV])
    ),
    entity: contextEntity ?? (hasChannelContext ? undefined : trimNonEmpty(env[CHANNEL_ENTITY_ENV])),
    invocationToken: trimNonEmpty(channelContext?.invocationToken),
    root: resolveRoot(cwd, env),
    roomId: readRoomId(channelContext),
    senderId,
    sessionId: contextSessionId ?? (
      hasChannelContext
        ? undefined
        : trimNonEmpty(env[SESSION_ID_ENV]) ?? trimNonEmpty(env.__ONEWORKS_PROJECT_CTX_ID__)
    )
  }
}
