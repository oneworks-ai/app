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
const CHANNEL_SESSION_TYPE_ENV = '__ONEWORKS_PROJECT_CHANNEL_SESSION_TYPE__'
const CHANNEL_SENDER_ID_ENV = '__ONEWORKS_PROJECT_CHANNEL_SENDER_ID__'
const CHANNEL_CONTEXT_PATH_ENV = '__ONEWORKS_PROJECT_CHANNEL_CONTEXT_PATH__'
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
  if (contextPath == null) return undefined

  try {
    const parsed = JSON.parse(readFileSync(contextPath, 'utf8')) as unknown
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

export const resolveContext = (options: MemoryCommandOptions): MemoryContext => {
  const cwd = options.cwd ?? process.cwd()
  const env = mergeProcessEnvWithProjectEnv(options.env, { workspaceFolder: cwd }) as NodeJS.ProcessEnv
  const channelContext = readChannelContext(env)
  const contextChannelType = trimNonEmpty(channelContext?.channelType)
  const contextChannelKey = trimNonEmpty(channelContext?.channelKey)
  const contextSessionType = trimNonEmpty(channelContext?.sessionType)
  const contextChannelId = trimNonEmpty(channelContext?.channelId)
  const contextSenderId = trimNonEmpty(channelContext?.senderId)
  const contextSessionId = trimNonEmpty(channelContext?.sessionId)
  const channelRef = trimNonEmpty(options.channel) ?? contextChannelType ?? trimNonEmpty(env[CHANNEL_TYPE_ENV])
  const channelParts = channelRef?.split(':') ?? []
  const channelType = channelParts[0] || contextChannelType || trimNonEmpty(env[CHANNEL_TYPE_ENV])
  const channelKey = channelParts[1] || contextChannelKey || trimNonEmpty(env[CHANNEL_KEY_ENV])
  const channelId = contextChannelId ?? trimNonEmpty(env[CHANNEL_ID_ENV])
  const channelSessionType = contextSessionType ?? trimNonEmpty(env[CHANNEL_SESSION_TYPE_ENV])
  const senderId = contextSenderId ?? (
    channelSessionType === 'group'
      ? undefined
      : trimNonEmpty(env[CHANNEL_SENDER_ID_ENV])
  ) ??
    (channelSessionType === 'direct' ? channelId : undefined)

  return {
    channelId,
    channelKey,
    channelRef,
    channelSessionType,
    channelType,
    root: resolveRoot(cwd, env),
    senderId,
    sessionId: contextSessionId ?? trimNonEmpty(env[SESSION_ID_ENV]) ?? trimNonEmpty(env.__ONEWORKS_PROJECT_CTX_ID__)
  }
}
