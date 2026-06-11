import { randomUUID } from 'node:crypto'
import process from 'node:process'

import { DEFAULT_SUPPORTED_PROTOCOL_RANGE, getCurrentProtocolVersion } from '@oneworks/runtime-protocol'
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
  message: string
  adapter?: string
  effort?: 'low' | 'medium' | 'high' | 'max'
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
}

export interface AppendRuntimeCommandParams {
  cwd: string
  sessionId: string
  type: Exclude<RuntimeCommandType, 'start'>
  commandId?: string
  message?: string
  memberKey?: string
  priority?: number
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
  commandId?: string
  requestId?: string
  value?: unknown
  data?: string | string[]
  entity?: string
  adapter?: string
  effort?: 'low' | 'medium' | 'high' | 'max'
  model?: string
  memberKey?: string
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions'
  roomId?: string
  runId?: string
  priority?: number
  source?: string
  title?: string
}): RuntimeCommand => {
  const command: RuntimeCommand = {
    protocolVersion: getCurrentProtocolVersion(),
    supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
    id: `cmd_${params.type}_${randomUUID()}`,
    ts: params.ts,
    sessionId: params.sessionId,
    type: params.type,
    priority: params.priority ?? getCommandPriority(params.type),
    source: params.source ?? 'cli'
  }
  if (params.commandId != null) command.commandId = params.commandId
  if (params.content != null) command.content = params.content
  if (params.requestId != null) command.requestId = params.requestId
  if (params.value != null) command.value = params.value
  if (params.data != null) command.data = params.data
  if (params.entity != null) command.entity = params.entity
  if (params.adapter != null) command.adapter = params.adapter
  if (params.effort != null) command.effort = params.effort
  if (params.model != null) command.model = params.model
  if (params.permissionMode != null) command.permissionMode = params.permissionMode
  if (params.memberKey != null) command.memberKey = params.memberKey
  if (params.roomId != null) command.roomId = params.roomId
  if (params.runId != null) command.runId = params.runId
  if (params.title != null) command.title = params.title
  const mode = commandTypeToMode(params.type)
  if (mode != null) command.mode = mode
  return command
}
