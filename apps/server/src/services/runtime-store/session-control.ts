import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env as processEnv } from 'node:process'

import { v4 as uuidv4 } from 'uuid'

import type { ChatMessageContent, EffortLevel, SessionPermissionMode } from '@oneworks/core'
import {
  DEFAULT_RUNTIME_PROTOCOL_VERSION,
  DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  FileRuntimeStore
} from '@oneworks/runtime-store'
import type { RuntimeCommand, RuntimeHeartbeat, RuntimeMeta, RuntimeState } from '@oneworks/runtime-store'
import type { SessionPromptType } from '@oneworks/types'
import { resolveProjectPrimaryWorkspaceFolder } from '@oneworks/utils/project-cache-path'

import type { ChannelRuntimeContext } from '#~/services/session/channel-context.js'
import { normalizeChannelRuntimeContext } from '#~/services/session/channel-context.js'

import { watchRuntimeStoreRoot } from './watcher.js'
import { createWorkspaceRuntimeEnv, resolveWorkspaceRuntimeStoreRoot } from './workspace-env.js'

const PENDING_RUNTIME_ID = 'pending_engine_consumer'
export const RUNTIME_SYSTEM_PROMPT_FILENAME = 'system-prompt.txt'

export type ServerRuntimeSessionContent = string | ChatMessageContent[]

const cloneContentItems = (content: ChatMessageContent[]) => structuredClone(content)

const INITIAL_PROMPT_DELIVERY = 'initial_prompt'
const BRIDGE_MESSAGE_DELIVERY = 'bridge'

export const summarizeRuntimeSessionContent = (content: ServerRuntimeSessionContent) => {
  if (typeof content === 'string') {
    return content.trim()
  }

  const parts: string[] = []
  for (const item of content) {
    if (item.type === 'text') {
      const text = item.text.trim()
      if (text !== '') parts.push(text)
    }
    if (item.type === 'file') parts.push(`Context file: ${item.path}`)
    if (item.type === 'image') {
      parts.push(item.name?.trim() ? `[图片:${item.name.trim()}]` : '[图片]')
    }
  }

  return parts.join('\n').trim()
}

export const resolveSessionRuntimeStoreRoot = (workspaceFolder: string, env: NodeJS.ProcessEnv = processEnv) =>
  resolveWorkspaceRuntimeStoreRoot(workspaceFolder, env)

export async function createServerRuntimeSession(params: {
  account?: string
  adapter?: string
  channelContext?: ChannelRuntimeContext
  content?: ServerRuntimeSessionContent
  cwd: string
  effort?: EffortLevel
  message?: string
  model?: string
  permissionMode?: SessionPermissionMode
  promptName?: string
  promptType?: SessionPromptType
  sessionId: string
  start?: boolean
  systemPrompt?: string
  runtimeContent?: ServerRuntimeSessionContent
  title?: string
  updateConfiguredSkills?: boolean
}) {
  const ts = Date.now()
  const runtimeRoot = resolveSessionRuntimeStoreRoot(params.cwd)
  const store = new FileRuntimeStore(runtimeRoot)
  const shouldStart = params.start !== false
  const content = params.content ?? params.message ?? ''
  const message = params.message?.trim() || summarizeRuntimeSessionContent(content)
  const runtimeContent = params.runtimeContent ?? content
  const runtimeMessage = summarizeRuntimeSessionContent(runtimeContent)
  const title = params.title?.trim() || message.split('\n')[0]?.trim() || params.sessionId
  const messageDelivery = typeof content === 'string' &&
      typeof runtimeContent === 'string' &&
      runtimeMessage === message
    ? INITIAL_PROMPT_DELIVERY
    : BRIDGE_MESSAGE_DELIVERY
  const runtimeEnv = createWorkspaceRuntimeEnv(params.cwd, processEnv)
  const channelContext = normalizeChannelRuntimeContext(params.channelContext)
  const primaryWorkspaceFolder = resolveProjectPrimaryWorkspaceFolder(params.cwd, runtimeEnv) ??
    runtimeEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__?.trim() ??
    params.cwd
  const session = await store.createSession(
    {
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: params.sessionId,
      title,
      cwd: params.cwd,
      ...(params.account != null ? { account: params.account } : {}),
      ...(params.adapter != null ? { adapter: params.adapter } : {}),
      ...(params.effort != null ? { effort: params.effort } : {}),
      ...(params.model != null ? { model: params.model } : {}),
      ...(params.permissionMode != null ? { permissionMode: params.permissionMode } : {}),
      ...(params.promptType != null ? { promptType: params.promptType } : {}),
      ...(params.promptName != null ? { promptName: params.promptName } : {}),
      ...(params.systemPrompt != null ? { systemPrompt: params.systemPrompt } : {}),
      ...(params.updateConfiguredSkills === true ? { updateConfiguredSkills: true } : {}),
      ...(channelContext != null ? { channelContext } : {}),
      createdAt: ts,
      needsEngineConsumer: true,
      primaryWorkspaceFolder
    } satisfies RuntimeMeta
  )

  const startCommand: RuntimeCommand = {
    protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
    supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
    id: `cmd_start_${uuidv4()}`,
    ts,
    sessionId: params.sessionId,
    type: 'start',
    priority: 20,
    source: 'web',
    commandId: `session-start-${uuidv4()}`,
    content: message,
    message,
    title,
    messageDelivery,
    ...(Array.isArray(content) ? { contentItems: cloneContentItems(content) } : {}),
    ...(typeof runtimeContent === 'string' && runtimeMessage !== message ? { runtimeMessage } : {}),
    ...(Array.isArray(runtimeContent) ? { runtimeContentItems: cloneContentItems(runtimeContent) } : {}),
    ...(params.account != null ? { account: params.account } : {}),
    ...(params.adapter != null ? { adapter: params.adapter } : {}),
    ...(params.effort != null ? { effort: params.effort } : {}),
    ...(params.model != null ? { model: params.model } : {}),
    ...(params.permissionMode != null ? { permissionMode: params.permissionMode } : {}),
    ...(params.promptType != null ? { taskType: params.promptType } : {}),
    ...(params.promptName != null ? { name: params.promptName } : {}),
    ...(params.systemPrompt != null ? { systemPrompt: params.systemPrompt } : {}),
    ...(params.updateConfiguredSkills === true ? { updateConfiguredSkills: true } : {})
  }
  const state: RuntimeState = {
    protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
    supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
    sessionId: params.sessionId,
    status: shouldStart ? 'starting' : 'completed',
    title,
    lastSeq: 0,
    needsEngineConsumer: true,
    updatedAt: ts
  }
  const heartbeat: RuntimeHeartbeat = {
    protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
    supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
    sessionId: params.sessionId,
    runtimeId: PENDING_RUNTIME_ID,
    status: shouldStart ? 'starting' : 'completed',
    updatedAt: ts
  }

  await Promise.all([
    shouldStart ? session.appendCommand(startCommand) : Promise.resolve(undefined),
    session.writeState(state),
    session.writeHeartbeat(heartbeat),
    params.systemPrompt == null
      ? Promise.resolve(undefined)
      : writeFile(path.join(session.sessionPath, RUNTIME_SYSTEM_PROMPT_FILENAME), params.systemPrompt, 'utf8'),
    shouldStart ? Promise.resolve(undefined) : store.updateIndex(params.sessionId, {
      storePath: path.relative(runtimeRoot, session.sessionPath),
      cwd: params.cwd,
      status: 'completed',
      updatedAt: ts
    })
  ])
  await watchRuntimeStoreRoot(runtimeRoot)

  return {
    runtimeRoot,
    sessionId: params.sessionId,
    storePath: session.sessionPath
  }
}
