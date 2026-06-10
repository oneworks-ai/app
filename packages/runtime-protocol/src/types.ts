/* eslint-disable max-lines */

import type { z } from 'zod'

import type {
  RuntimeCommandTypeSchema,
  RuntimeEventTypeSchema,
  RuntimeInteractionKindSchema,
  RuntimeMemberKindSchema,
  RuntimePermissionModeSchema,
  RuntimeRequestKindSchema,
  RuntimeRoleSchema,
  RuntimeSessionCommandEnvelopeTypeSchema,
  RuntimeStatusSchema,
  RuntimeVisibilitySchema
} from '#~/schemas.js'

export type RuntimeJsonObject = Record<string, unknown>
export type RuntimeVisibility = z.infer<typeof RuntimeVisibilitySchema>
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>
export type RuntimeCommandType = z.infer<typeof RuntimeCommandTypeSchema>
export type RuntimeEventType = z.infer<typeof RuntimeEventTypeSchema>
export type RuntimeRole = z.infer<typeof RuntimeRoleSchema>
export type RuntimeSessionCommandEnvelopeType = z.infer<typeof RuntimeSessionCommandEnvelopeTypeSchema>
export type RuntimeRequestKind = z.infer<typeof RuntimeRequestKindSchema>
export type RuntimeInteractionKind = z.infer<typeof RuntimeInteractionKindSchema>
export type RuntimeMemberKind = z.infer<typeof RuntimeMemberKindSchema>
export type RuntimePermissionMode = z.infer<typeof RuntimePermissionModeSchema>
export type TaskDefinitionType = 'default' | 'entity' | 'spec' | 'workspace'

export interface RuntimeProtocolEnvelope {
  protocolVersion: string
  supportedProtocolRange?: string
}

export interface RuntimeSessionCommandEnvelope
  extends RuntimeJsonObject, RuntimeCorrelationFields, RuntimeProtocolEnvelope
{
  commandId: string
  type: RuntimeSessionCommandEnvelopeType
  priority?: number
  source?: string
  sessionId?: string
  entity?: string
  title?: string
  message?: string
  content?: string
  requestId?: string
  interactionId?: string
  value?: unknown
  data?: string | string[]
  payload?: RuntimeJsonObject
  mode?: string
  adapter?: string
  model?: string
  account?: string
  effort?: 'low' | 'medium' | 'high' | 'max'
  background?: boolean
  permissionMode?: RuntimePermissionMode
  hostSessionId?: string
  parentSessionId?: string
  roomTitle?: string
  memberAvatar?: string
  memberLabel?: string
  runTitle?: string
}

export interface RuntimeSessionResultEnvelope
  extends RuntimeJsonObject, RuntimeCorrelationFields, RuntimeProtocolEnvelope
{
  commandId: string
  type: `${RuntimeSessionCommandEnvelopeType}.result`
  ok: boolean
  sessionId?: string
  status?: string
  storePath?: string
  error?: string
  result?: unknown
}

export interface RuntimeCorrelationFields {
  commandId?: string
  causedByCommandId?: string
  inReplyToCommandId?: string
  parentEventId?: string
  runId?: string
  operationId?: string
  roomId?: string
  memberKey?: string
  visibility?: RuntimeVisibility
}

export interface RuntimeContentItem extends RuntimeJsonObject {
  type: string
}

export interface RuntimeInteractionOption extends RuntimeJsonObject {
  label: string
  value?: string
  description?: string
}

export interface RuntimeMember extends RuntimeJsonObject {
  key: string
  kind: RuntimeMemberKind
  label: string
  avatar?: string
  subtitle?: string
}

export interface RuntimeCommand extends RuntimeJsonObject, RuntimeCorrelationFields, RuntimeProtocolEnvelope {
  id: string
  ts: number
  sessionId: string
  type: RuntimeCommandType
  priority: number
  source: string
  actorId?: string
  ackTimeoutMs?: number
  resultTimeoutMs?: number
  title?: string
  description?: string
  taskType?: string
  name?: string
  entity?: string
  adapter?: string
  effort?: 'low' | 'medium' | 'high' | 'max'
  model?: string
  permissionMode?: RuntimePermissionMode
  background?: boolean
  content?: string
  message?: string
  mode?: string
  interactionId?: string
  requestId?: string
  value?: unknown
  data?: string | string[]
}

export interface RuntimeCommandDraft
  extends RuntimeJsonObject, RuntimeCorrelationFields, Partial<RuntimeProtocolEnvelope>
{
  id: string
  ts?: number
  sessionId: string
  type: RuntimeCommandType
  priority?: number
  source: string
  actorId?: string
  ackTimeoutMs?: number
  resultTimeoutMs?: number
  title?: string
  description?: string
  taskType?: string
  name?: string
  entity?: string
  adapter?: string
  effort?: 'low' | 'medium' | 'high' | 'max'
  model?: string
  permissionMode?: RuntimePermissionMode
  background?: boolean
  content?: string
  message?: string
  mode?: string
  interactionId?: string
  requestId?: string
  value?: unknown
  data?: string | string[]
}

export interface RuntimeEvent extends RuntimeJsonObject, RuntimeCorrelationFields, RuntimeProtocolEnvelope {
  id: string
  seq: number
  ts: number
  sessionId: string
  type: RuntimeEventType
  title?: string
  parentSessionId?: string
  status?: RuntimeStatus
  role?: RuntimeRole
  content?: string | RuntimeContentItem[]
  summary?: string
  publicSummary?: string
  requestId?: string
  requestKind?: RuntimeRequestKind
  kind?: RuntimeInteractionKind
  question?: string
  options?: RuntimeInteractionOption[]
  multiselect?: boolean
  error?: string
  message?: string
  fatal?: boolean
  adapter?: string
  model?: string
  artifactId?: string
  path?: string
  mimeType?: string
  roomTitle?: string
  hostSessionId?: string
  memberKind?: RuntimeMemberKind
  memberLabel?: string
  memberAvatar?: string
  memberSubtitle?: string
  runTitle?: string
  member?: RuntimeMember
}

export interface RuntimeEventDraft
  extends RuntimeJsonObject, RuntimeCorrelationFields, Partial<RuntimeProtocolEnvelope>
{
  id?: string
  seq?: number
  ts?: number
  sessionId: string
  type: RuntimeEventType
  title?: string
  parentSessionId?: string
  status?: RuntimeStatus
  role?: RuntimeRole
  content?: string | RuntimeContentItem[]
  summary?: string
  publicSummary?: string
  requestId?: string
  requestKind?: RuntimeRequestKind
  kind?: RuntimeInteractionKind
  question?: string
  options?: RuntimeInteractionOption[]
  multiselect?: boolean
  error?: string
  message?: string
  fatal?: boolean
  adapter?: string
  model?: string
  artifactId?: string
  path?: string
  mimeType?: string
  roomTitle?: string
  hostSessionId?: string
  memberKind?: RuntimeMemberKind
  memberLabel?: string
  memberAvatar?: string
  memberSubtitle?: string
  runTitle?: string
  member?: RuntimeMember
}

export interface RuntimeMeta extends RuntimeJsonObject, RuntimeProtocolEnvelope {
  sessionId: string
  title?: string
  entity?: string
  adapter?: string
  effort?: 'low' | 'medium' | 'high' | 'max'
  model?: string
  permissionMode?: RuntimePermissionMode
  cwd?: string
  parentSessionId?: string
  roomId?: string
  roomTitle?: string
  hostSessionId?: string
  memberKey?: string
  memberKind?: RuntimeMemberKind
  memberLabel?: string
  memberAvatar?: string
  memberSubtitle?: string
  runId?: string
  runTitle?: string
  operationId?: string
  createdAt: number
}

export interface RuntimeState extends RuntimeJsonObject, RuntimeCorrelationFields, RuntimeProtocolEnvelope {
  sessionId: string
  status: RuntimeStatus
  title?: string
  lastSeq: number
  lastMessage?: string
  pendingInput?: {
    requestId: string
    kind?: string
  } & RuntimeJsonObject
  updatedAt: number
}

export interface RuntimeHeartbeat extends RuntimeJsonObject, RuntimeProtocolEnvelope {
  sessionId?: string
  runtimeId: string
  pid?: number
  host?: string
  status: RuntimeStatus
  updatedAt: number
}

export interface RuntimeJsonlRecord extends RuntimeJsonObject {
  protocolVersion: string
}

export type RuntimeCommandSource = RuntimeCommand['source']

export interface RuntimeCommandBase extends Partial<RuntimeProtocolEnvelope> {
  id: string
  ts?: number
  sessionId: string
  priority?: number
  source: RuntimeCommandSource
}

export interface StartRuntimeCommand extends RuntimeCommandBase {
  type: 'start'
  description: string
  title?: string
  taskType?: TaskDefinitionType
  name?: string
  adapter?: string
  effort?: 'low' | 'medium' | 'high' | 'max'
  model?: string
  permissionMode?: RuntimePermissionMode
  background?: boolean
}

export interface SendMessageRuntimeCommand extends RuntimeCommandBase {
  type: 'send_message'
  content?: string
  message: string
  mode?: 'direct' | 'steer'
}

export interface StopRuntimeCommand extends RuntimeCommandBase {
  type: 'stop'
  mode?: 'graceful' | 'kill' | string
}

export interface SubmitInputRuntimeCommand extends RuntimeCommandBase {
  type: 'submit_input'
  interactionId?: string
  requestId?: string
  data: string | string[]
  value?: unknown
}

export interface ResumeRuntimeCommand extends RuntimeCommandBase {
  type: 'resume'
  content?: string
  message: string
}

export type TaskRuntimeCommand =
  | ResumeRuntimeCommand
  | SendMessageRuntimeCommand
  | StartRuntimeCommand
  | StopRuntimeCommand
  | SubmitInputRuntimeCommand
