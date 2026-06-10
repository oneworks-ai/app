/* eslint-disable max-lines */

import { z } from 'zod'

import { isValidProtocolVersion } from '#~/version.js'

export const RuntimeVisibilitySchema = z.enum([
  'private',
  'room',
  'audit',
  'system'
])

export const RuntimeStatusSchema = z.enum([
  'pending',
  'starting',
  'running',
  'waiting_input',
  'stopping',
  'stopped',
  'cancelled',
  'killed',
  'completed',
  'failed',
  'crashed'
])

export const RuntimeCommandTypeSchema = z.enum([
  'start',
  'send_message',
  'steer_message',
  'submit_input',
  'approve',
  'deny',
  'resume',
  'stop',
  'kill',
  'cancel',
  'pause'
])

export const RuntimeSessionCommandEnvelopeTypeSchema = z.enum([
  'session.start',
  'session.message',
  'session.resume',
  'session.stop',
  'session.submit',
  'session.status',
  'session.events'
])

export const RuntimeEventTypeSchema = z.enum([
  'command_ack',
  'command_failed',
  'command_cancelled',
  'input_submitted',
  'session_started',
  'session_resumed',
  'session_stopped',
  'session_completed',
  'session_failed',
  'status_changed',
  'message',
  'approval_requested',
  'approval_resolved',
  'input_requested',
  'artifact_created',
  'operation_started',
  'operation_completed',
  'operation_failed',
  'heartbeat'
])

export const RuntimeRoleSchema = z.enum(['system', 'user', 'assistant', 'tool'])

export const RuntimeRequestKindSchema = z.enum(['confirmation', 'input', 'progress'])

export const RuntimeInteractionKindSchema = z.enum(['question', 'permission'])

export const RuntimeMemberKindSchema = z.enum(['host', 'entity', 'task'])

export const RuntimePermissionModeSchema = z.enum([
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions'
])

export const RuntimeContentItemSchema = z.object({
  type: z.string()
}).passthrough()

export const RuntimeInteractionOptionSchema = z.object({
  label: z.string(),
  value: z.string().optional(),
  description: z.string().optional()
}).passthrough()

export const RuntimeMemberSchema = z.object({
  key: z.string(),
  kind: RuntimeMemberKindSchema,
  label: z.string(),
  avatar: z.string().optional(),
  subtitle: z.string().optional()
}).passthrough()

export const RuntimeProtocolVersionSchema = z
  .string()
  .refine(isValidProtocolVersion, 'protocolVersion must be a valid semver string')

export const RuntimeCorrelationFieldsSchema = z.object({
  commandId: z.string().optional(),
  causedByCommandId: z.string().optional(),
  inReplyToCommandId: z.string().optional(),
  parentEventId: z.string().optional(),
  runId: z.string().optional(),
  operationId: z.string().optional(),
  roomId: z.string().optional(),
  memberKey: z.string().optional(),
  visibility: RuntimeVisibilitySchema.optional()
})

export const RuntimeCommandSchema = RuntimeCorrelationFieldsSchema.extend({
  protocolVersion: RuntimeProtocolVersionSchema,
  supportedProtocolRange: z.string().optional(),
  id: z.string(),
  ts: z.number(),
  sessionId: z.string(),
  type: RuntimeCommandTypeSchema,
  priority: z.number(),
  source: z.string(),
  actorId: z.string().optional(),
  ackTimeoutMs: z.number().optional(),
  resultTimeoutMs: z.number().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  taskType: z.string().optional(),
  name: z.string().optional(),
  entity: z.string().optional(),
  adapter: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
  model: z.string().optional(),
  permissionMode: RuntimePermissionModeSchema.optional(),
  background: z.boolean().optional(),
  content: z.string().optional(),
  message: z.string().optional(),
  mode: z.string().optional(),
  interactionId: z.string().optional(),
  requestId: z.string().optional(),
  value: z.unknown().optional(),
  data: z.union([z.string(), z.array(z.string())]).optional()
}).passthrough()

export const RuntimeSessionCommandEnvelopeSchema = RuntimeCorrelationFieldsSchema.extend({
  protocolVersion: RuntimeProtocolVersionSchema,
  supportedProtocolRange: z.string().optional(),
  commandId: z.string(),
  type: RuntimeSessionCommandEnvelopeTypeSchema,
  priority: z.number().optional(),
  source: z.string().optional(),
  sessionId: z.string().optional(),
  entity: z.string().optional(),
  title: z.string().optional(),
  message: z.string().optional(),
  content: z.string().optional(),
  requestId: z.string().optional(),
  interactionId: z.string().optional(),
  value: z.unknown().optional(),
  data: z.union([z.string(), z.array(z.string())]).optional(),
  payload: z.record(z.unknown()).optional(),
  mode: z.string().optional(),
  adapter: z.string().optional(),
  model: z.string().optional(),
  account: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
  background: z.boolean().optional(),
  permissionMode: RuntimePermissionModeSchema.optional(),
  hostSessionId: z.string().optional(),
  parentSessionId: z.string().optional(),
  roomTitle: z.string().optional(),
  memberAvatar: z.string().optional(),
  memberLabel: z.string().optional(),
  runTitle: z.string().optional()
}).passthrough()

export const RuntimeSessionResultEnvelopeSchema = RuntimeCorrelationFieldsSchema.extend({
  protocolVersion: RuntimeProtocolVersionSchema,
  supportedProtocolRange: z.string().optional(),
  commandId: z.string(),
  type: z.string().refine(type => type.endsWith('.result'), 'type must be a result envelope type'),
  ok: z.boolean(),
  sessionId: z.string().optional(),
  status: z.string().optional(),
  storePath: z.string().optional(),
  error: z.string().optional(),
  result: z.unknown().optional()
}).passthrough()

export const RuntimeCommandDraftSchema = RuntimeCommandSchema.extend({
  protocolVersion: RuntimeProtocolVersionSchema.optional(),
  ts: z.number().optional(),
  priority: z.number().optional()
})

export const RuntimeEventSchema = RuntimeCorrelationFieldsSchema.extend({
  protocolVersion: RuntimeProtocolVersionSchema,
  supportedProtocolRange: z.string().optional(),
  id: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.number(),
  sessionId: z.string(),
  type: RuntimeEventTypeSchema,
  title: z.string().optional(),
  parentSessionId: z.string().optional(),
  status: RuntimeStatusSchema.optional(),
  role: RuntimeRoleSchema.optional(),
  content: z.union([z.string(), z.array(RuntimeContentItemSchema)]).optional(),
  summary: z.string().optional(),
  publicSummary: z.string().optional(),
  requestId: z.string().optional(),
  requestKind: RuntimeRequestKindSchema.optional(),
  kind: RuntimeInteractionKindSchema.optional(),
  question: z.string().optional(),
  options: z.array(RuntimeInteractionOptionSchema).optional(),
  multiselect: z.boolean().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
  fatal: z.boolean().optional(),
  adapter: z.string().optional(),
  model: z.string().optional(),
  artifactId: z.string().optional(),
  path: z.string().optional(),
  mimeType: z.string().optional(),
  roomTitle: z.string().optional(),
  hostSessionId: z.string().optional(),
  memberKind: RuntimeMemberKindSchema.optional(),
  memberLabel: z.string().optional(),
  memberAvatar: z.string().optional(),
  memberSubtitle: z.string().optional(),
  runTitle: z.string().optional(),
  member: RuntimeMemberSchema.optional()
}).passthrough()

export const RuntimeEventDraftSchema = RuntimeEventSchema.extend({
  protocolVersion: RuntimeProtocolVersionSchema.optional(),
  id: z.string().optional(),
  seq: z.number().int().nonnegative().optional(),
  ts: z.number().optional()
})

export const RuntimeMetaSchema = z.object({
  protocolVersion: RuntimeProtocolVersionSchema,
  supportedProtocolRange: z.string().optional(),
  sessionId: z.string(),
  title: z.string().optional(),
  entity: z.string().optional(),
  adapter: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
  model: z.string().optional(),
  permissionMode: RuntimePermissionModeSchema.optional(),
  cwd: z.string().optional(),
  parentSessionId: z.string().optional(),
  roomId: z.string().optional(),
  roomTitle: z.string().optional(),
  hostSessionId: z.string().optional(),
  memberKey: z.string().optional(),
  memberKind: RuntimeMemberKindSchema.optional(),
  memberLabel: z.string().optional(),
  memberAvatar: z.string().optional(),
  memberSubtitle: z.string().optional(),
  runId: z.string().optional(),
  runTitle: z.string().optional(),
  operationId: z.string().optional(),
  createdAt: z.number()
}).passthrough()

export const RuntimeStateSchema = RuntimeCorrelationFieldsSchema.extend({
  protocolVersion: RuntimeProtocolVersionSchema,
  supportedProtocolRange: z.string().optional(),
  sessionId: z.string(),
  status: RuntimeStatusSchema,
  title: z.string().optional(),
  lastSeq: z.number().int().nonnegative(),
  lastMessage: z.string().optional(),
  pendingInput: z
    .object({
      requestId: z.string(),
      kind: z.string().optional()
    })
    .passthrough()
    .optional(),
  updatedAt: z.number()
}).passthrough()

export const RuntimeHeartbeatSchema = z.object({
  protocolVersion: RuntimeProtocolVersionSchema,
  supportedProtocolRange: z.string().optional(),
  sessionId: z.string().optional(),
  runtimeId: z.string(),
  pid: z.number().int().positive().optional(),
  host: z.string().optional(),
  status: RuntimeStatusSchema,
  updatedAt: z.number()
}).passthrough()

export const RuntimeJsonlRecordSchema = z.object({
  protocolVersion: RuntimeProtocolVersionSchema
}).passthrough()
