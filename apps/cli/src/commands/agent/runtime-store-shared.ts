import { randomUUID } from 'node:crypto'
import process from 'node:process'

import {
  DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  RuntimeCommandSchema,
  getCurrentProtocolVersion,
  hasRuntimeActivationPayload
} from '@oneworks/runtime-protocol'
import type {
  RuntimeActivationContentItem,
  RuntimeProjectConfigPolicy
} from '@oneworks/runtime-protocol'
import { FileRuntimeStore, resolveRuntimeRoot } from '@oneworks/runtime-store'
import type { RuntimeCommand } from '@oneworks/runtime-store'

export type RuntimeCommandType =
  | 'start'
  | 'send_message'
  | 'stop'
  | 'kill'
  | 'submit_input'
  | 'resume'

export interface CreateRuntimeSessionParams {
  cwd: string
  entity: string
  title?: string
  message?: string
  contentItems?: RuntimeActivationContentItem[]
  runtimeContentItems?: RuntimeActivationContentItem[]
  runtimeMessage?: string
  adapter?: string
  account?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
  fastMode?: boolean
  model?: string
  commandId?: string
  env?: NodeJS.ProcessEnv
  hostSessionId?: string
  memberAvatar?: string
  memberLabel?: string
  memberKey?: string
  now?: () => number
  parentSessionId?: string
  priority?: number
  roomId?: string
  roomTitle?: string
  runId?: string
  runTitle?: string
  sessionId?: string
  source?: string
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
  projectConfigPolicy?: RuntimeProjectConfigPolicy
  systemPrompt?: string
  updateConfiguredSkills?: boolean
}

export interface AppendRuntimeCommandParams {
  cwd: string
  sessionId: string
  type: Exclude<RuntimeCommandType, 'start'>
  commandId?: string
  message?: string
  contentItems?: RuntimeActivationContentItem[]
  runtimeContentItems?: RuntimeActivationContentItem[]
  runtimeMessage?: string
  memberKey?: string
  priority?: number
  projectConfigPolicy?: RuntimeProjectConfigPolicy
  requestId?: string
  roomId?: string
  runId?: string
  source?: string
  value?: unknown
  data?: string | string[]
  env?: NodeJS.ProcessEnv
  now?: () => number
}

export const trimRequired = (value: string | undefined, name: string) => {
  const normalized = value?.trim() ?? ''
  if (normalized === '') throw new Error(`${name} is required.`)
  return normalized
}

export const getStore = async (cwd: string, env: NodeJS.ProcessEnv = process.env) =>
  new FileRuntimeStore(await resolveRuntimeRoot({ cwd, env }))

const getCommandPriority = (type: RuntimeCommandType) => {
  switch (type) {
    case 'stop':
    case 'kill':
      return 0
    case 'submit_input':
      return 10
    case 'start':
    case 'send_message':
    case 'resume':
      return 20
  }
}

const commandTypeToMode = (type: RuntimeCommandType) => {
  if (type === 'stop') return 'graceful'
  if (type === 'kill') return 'force'
  return undefined
}

export const createSessionId = () => `sess_${randomUUID()}`

export const buildCommand = (params: {
  sessionId: string
  type: RuntimeCommandType
  ts: number
  content?: string
  contentItems?: RuntimeActivationContentItem[]
  commandId?: string
  requestId?: string
  value?: unknown
  data?: string | string[]
  entity?: string
  adapter?: string
  account?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
  fastMode?: boolean
  model?: string
  memberKey?: string
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
  projectConfigPolicy?: RuntimeProjectConfigPolicy
  systemPrompt?: string
  updateConfiguredSkills?: boolean
  runtimeContentItems?: RuntimeActivationContentItem[]
  runtimeMessage?: string
  roomId?: string
  runId?: string
  priority?: number
  source?: string
  title?: string
  messageDelivery?: 'bridge' | 'initial_prompt'
}): RuntimeCommand => {
  const command = {
    protocolVersion: getCurrentProtocolVersion(),
    supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
    id: `cmd_${params.type}_${randomUUID()}`,
    ts: params.ts,
    sessionId: params.sessionId,
    type: params.type,
    priority: params.priority ?? getCommandPriority(params.type),
    source: params.source ?? 'cli',
    ...(params.commandId != null ? { commandId: params.commandId } : {}),
    ...(params.content != null ? { content: params.content } : {}),
    ...(params.contentItems != null
      ? { contentItems: structuredClone(params.contentItems) }
      : {}),
    ...(params.requestId != null ? { requestId: params.requestId } : {}),
    ...(params.value != null ? { value: params.value } : {}),
    ...(params.data != null ? { data: params.data } : {}),
    ...(params.entity != null ? { entity: params.entity } : {}),
    ...(params.adapter != null ? { adapter: params.adapter } : {}),
    ...(params.account != null ? { account: params.account } : {}),
    ...(params.effort != null ? { effort: params.effort } : {}),
    ...(params.fastMode != null ? { fastMode: params.fastMode } : {}),
    ...(params.model != null ? { model: params.model } : {}),
    ...(params.permissionMode != null ? { permissionMode: params.permissionMode } : {}),
    ...(params.projectConfigPolicy != null
      ? { projectConfigPolicy: params.projectConfigPolicy }
      : {}),
    ...(params.systemPrompt != null ? { systemPrompt: params.systemPrompt } : {}),
    ...(params.updateConfiguredSkills != null
      ? { updateConfiguredSkills: params.updateConfiguredSkills }
      : {}),
    ...(params.runtimeContentItems != null
      ? { runtimeContentItems: structuredClone(params.runtimeContentItems) }
      : {}),
    ...(params.runtimeMessage != null ? { runtimeMessage: params.runtimeMessage } : {}),
    ...(params.memberKey != null ? { memberKey: params.memberKey } : {}),
    ...(params.roomId != null ? { roomId: params.roomId } : {}),
    ...(params.runId != null ? { runId: params.runId } : {}),
    ...(params.title != null ? { title: params.title } : {}),
    ...(params.messageDelivery != null ? { messageDelivery: params.messageDelivery } : {}),
    ...(commandTypeToMode(params.type) != null ? { mode: commandTypeToMode(params.type) } : {})
  }
  return RuntimeCommandSchema.parse(command)
}

export const assertRuntimeActivationPayload = (params: {
  content?: unknown
  contentItems?: unknown
  message?: unknown
  runtimeContentItems?: unknown
  runtimeMessage?: unknown
}) => {
  if (!hasRuntimeActivationPayload(params)) {
    throw new Error('message or supported content items are required.')
  }
}
