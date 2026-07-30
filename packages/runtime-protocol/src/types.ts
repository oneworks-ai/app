/* eslint-disable max-lines */

import type { z } from 'zod'

import type {
  CodexProjectConfigInvalidDetailsSchema,
  ProjectedCodexProjectConfigInvalidDetailsSchema,
  ProjectedRuntimeKnownErrorDataSchema,
  ProjectedRuntimePublicErrorDataSchema,
  RuntimeCommandDraftSchema,
  RuntimeCommandSchema,
  RuntimeCommandTypeSchema,
  RuntimeActivationContentItemSchema,
  RuntimeEventTypeSchema,
  RuntimeInteractionKindSchema,
  RuntimeMemberKindSchema,
  RuntimePermissionModeSchema,
  RuntimeProjectConfigPolicySchema,
  RuntimeRequestKindSchema,
  RuntimeRecoveryContextSchema,
  RuntimeProjectConfigRecoveryGrantEventDraftSchema,
  RuntimeProjectConfigRecoveryGrantEventSchema,
  RuntimeProjectConfigRecoveryGrantSchema,
  RuntimePublicErrorDataSchema,
  RuntimeRoleSchema,
  RuntimeStructuredErrorDataSchema,
  RuntimeSessionCommandEnvelopeSchema,
  RuntimeSessionCommandEnvelopeTypeSchema,
  RuntimeSessionCommandPayloadSchema,
  RuntimeStatusSchema,
  RuntimeVisibilitySchema
} from '#~/schemas.js'

export type RuntimeJsonObject = Record<string, unknown>
export type RuntimeVisibility = z.infer<typeof RuntimeVisibilitySchema>
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>
export type RuntimeCommandType = z.infer<typeof RuntimeCommandTypeSchema>
export type RuntimeActivationContentItem = z.infer<typeof RuntimeActivationContentItemSchema>
export type RuntimeEventType = z.infer<typeof RuntimeEventTypeSchema>
export type RuntimeRole = z.infer<typeof RuntimeRoleSchema>
export type RuntimeSessionCommandEnvelopeType = z.infer<typeof RuntimeSessionCommandEnvelopeTypeSchema>
export type RuntimeSessionCommandPayload = z.infer<typeof RuntimeSessionCommandPayloadSchema>
export type RuntimeSessionCommandEnvelope = z.infer<typeof RuntimeSessionCommandEnvelopeSchema>
export type RuntimeRequestKind = z.infer<typeof RuntimeRequestKindSchema>
export type RuntimeInteractionKind = z.infer<typeof RuntimeInteractionKindSchema>
export type RuntimeMemberKind = z.infer<typeof RuntimeMemberKindSchema>
export type RuntimePermissionMode = z.infer<typeof RuntimePermissionModeSchema>
export type RuntimeProjectConfigPolicy = z.infer<typeof RuntimeProjectConfigPolicySchema>
export type RuntimeRecoveryContext = z.infer<typeof RuntimeRecoveryContextSchema>
export type RuntimeProjectConfigRecoveryGrant = z.infer<typeof RuntimeProjectConfigRecoveryGrantSchema>
export type RuntimeProjectConfigRecoveryGrantEvent =
  z.infer<typeof RuntimeProjectConfigRecoveryGrantEventSchema>
export type RuntimeProjectConfigRecoveryGrantEventDraft =
  z.infer<typeof RuntimeProjectConfigRecoveryGrantEventDraftSchema>
export type CodexProjectConfigInvalidDetails = z.infer<typeof CodexProjectConfigInvalidDetailsSchema>
export type ProjectedCodexProjectConfigInvalidDetails =
  z.infer<typeof ProjectedCodexProjectConfigInvalidDetailsSchema>
export type ProjectedRuntimeKnownErrorData = z.infer<typeof ProjectedRuntimeKnownErrorDataSchema>
export type ProjectedRuntimePublicErrorData = z.infer<typeof ProjectedRuntimePublicErrorDataSchema>
export type RuntimePublicErrorData = z.infer<typeof RuntimePublicErrorDataSchema>
export type RuntimeStructuredErrorData = z.infer<typeof RuntimeStructuredErrorDataSchema>
export type TaskDefinitionType = 'default' | 'entity' | 'spec' | 'workspace'

export interface RuntimeProtocolEnvelope {
  protocolVersion: string
  supportedProtocolRange?: string
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

export type RuntimeActivationPayload =
  | { runtimeContentItems: RuntimeActivationContentItem[] }
  | { contentItems: RuntimeActivationContentItem[] }
  | { runtimeMessage: string }
  | { content: string }
  | { message: string }

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

export type RuntimeCommand = z.infer<typeof RuntimeCommandSchema>
export type RuntimeCommandDraft = z.infer<typeof RuntimeCommandDraftSchema>

export interface RuntimeEvent extends RuntimeJsonObject, RuntimeCorrelationFields, RuntimeProtocolEnvelope {
  id: string
  seq: number
  ts: number
  sessionId: string
  type: RuntimeEventType
  source?: string
  recoveryGrant?: RuntimeProjectConfigRecoveryGrant
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
  code?: string
  details?: unknown
  message?: string
  fatal?: boolean
  adapter?: string
  model?: string
  artifactId?: string
  deliveryId?: string
  deliveryState?: 'prepared' | 'accepted' | 'completed'
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
  source?: string
  recoveryGrant?: RuntimeProjectConfigRecoveryGrant
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
  code?: string
  details?: unknown
  message?: string
  fatal?: boolean
  adapter?: string
  model?: string
  artifactId?: string
  deliveryId?: string
  deliveryState?: 'prepared' | 'accepted' | 'completed'
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
  account?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
  fastMode?: boolean
  model?: string
  systemPrompt?: string
  updateConfiguredSkills?: boolean
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

export type StartRuntimeCommand = RuntimeCommandBase & {
  type: 'start'
  description: string
  content?: string
  contentItems?: RuntimeActivationContentItem[]
  message?: string
  title?: string
  taskType?: TaskDefinitionType
  name?: string
  adapter?: string
  account?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra'
  fastMode?: boolean
  model?: string
  projectConfigPolicy?: RuntimeProjectConfigPolicy
  permissionMode?: RuntimePermissionMode
  background?: boolean
  systemPrompt?: string
  updateConfiguredSkills?: boolean
  runtimeContentItems?: RuntimeActivationContentItem[]
  runtimeMessage?: string
} & (
  // Structured starts intentionally carry no deliverable prompt.  Any start
  // that declares a delivery mode must carry one of the strict payload forms.
  | { messageDelivery?: undefined }
  | ({ messageDelivery: 'initial_prompt' } & RuntimeActivationPayload)
  | ({ messageDelivery: 'bridge' } & RuntimeActivationPayload)
)

export type SendMessageRuntimeCommand = RuntimeCommandBase & {
  type: 'send_message'
  content?: string
  contentItems?: RuntimeActivationContentItem[]
  message?: string
  mode?: 'direct' | 'steer'
  runtimeContentItems?: RuntimeActivationContentItem[]
  runtimeMessage?: string
} & RuntimeActivationPayload

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

export type ResumeRuntimeCommand = RuntimeCommandBase & {
  type: 'resume'
  content?: string
  contentItems?: RuntimeActivationContentItem[]
  message?: string
  messageDelivery?: 'bridge'
  projectConfigPolicy?: RuntimeProjectConfigPolicy
  recovery?: RuntimeRecoveryContext
  runtimeContentItems?: RuntimeActivationContentItem[]
  runtimeMessage?: string
} & RuntimeActivationPayload

export type TaskRuntimeCommand =
  | ResumeRuntimeCommand
  | SendMessageRuntimeCommand
  | StartRuntimeCommand
  | StopRuntimeCommand
  | SubmitInputRuntimeCommand
