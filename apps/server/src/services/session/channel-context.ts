import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { cwd as processCwd, env as processEnv } from 'node:process'

import { resolveProjectHomePath } from '@oneworks/utils'

import { getDb } from '#~/db/index.js'

export { buildChannelRuntimeSystemPrompt } from './channel-runtime-prompt.js'

export interface ChannelRuntimeContext {
  channelId?: string
  channelKey?: string
  channelType?: string
  messageId?: string
  replyReceiveId?: string
  replyReceiveIdType?: string
  senderId?: string
  sessionId?: string
  sessionType?: string
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
    channelId: trimNonEmpty(value.channelId),
    channelKey: trimNonEmpty(value.channelKey),
    channelType: trimNonEmpty(value.channelType),
    messageId: trimNonEmpty(value.messageId),
    replyReceiveId: trimNonEmpty(value.replyReceiveId),
    replyReceiveIdType: trimNonEmpty(value.replyReceiveIdType),
    senderId: trimNonEmpty(value.senderId),
    sessionId: trimNonEmpty(value.sessionId),
    sessionType: trimNonEmpty(value.sessionType)
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
    __ONEWORKS_PROJECT_CHANNEL_SESSION_TYPE__: context?.sessionType ?? '',
    __ONEWORKS_PROJECT_CHANNEL_ID__: context?.channelId ?? '',
    __ONEWORKS_PROJECT_CHANNEL_SENDER_ID__: senderId ?? ''
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
  const content = JSON.stringify(
    {
      channelId: input.channelId,
      channelKey: input.channelKey,
      channelType: input.channelType,
      messageId: input.messageId,
      replyReceiveId: input.replyReceiveId,
      replyReceiveIdType: input.replyReceiveIdType,
      senderId: input.senderId,
      sessionId,
      sessionType: input.sessionType,
      updatedAt: Date.now()
    },
    null,
    2
  )
  await writeFile(filePath, `${content}\n`, 'utf8')
}
