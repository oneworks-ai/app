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

export const RUNTIME_ACTIVATION_COMMAND_TYPES = [
  'start',
  'resume',
  'send_message'
] as const

export const isRuntimeActivationCommand = (
  command: { type?: string } | undefined
) => command != null && (
  RUNTIME_ACTIVATION_COMMAND_TYPES as readonly string[]
).includes(command.type)

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
  'command_delivery_prepared',
  'command_delivery_accepted',
  'command_delivery_completed',
  'project_config_recovery_granted',
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

export const RuntimeProjectConfigPolicySchema = z.enum([
  'include',
  'global-only'
])

export const CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE = 'codex_project_config_invalid'
export const CODEX_PROJECT_CONFIG_RELATIVE_PATH = '.codex/config.toml'

const PositiveSourceLocationSchema = z.number().int().positive()
const SafeDiagnosticReasonSchema = z.string()
  .min(1)
  .max(2000)
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), 'reason contains control characters')

export const CodexProjectConfigInvalidDetailsSchema = z.object({
  adapter: z.string().trim().min(1),
  runtimeAdapter: z.literal('codex'),
  configSource: z.literal('project'),
  configPath: z.literal(CODEX_PROJECT_CONFIG_RELATIVE_PATH),
  workspaceSource: z.literal('active-session-workspace'),
  workspaceFolder: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  reason: SafeDiagnosticReasonSchema,
  line: PositiveSourceLocationSchema.optional(),
  column: PositiveSourceLocationSchema.optional()
}).strict()

export const ProjectedCodexProjectConfigInvalidDetailsSchema =
  CodexProjectConfigInvalidDetailsSchema.extend({
    runtimeEventId: z.string().trim().min(1),
    runtimeEventSeq: z.number().int().nonnegative()
  }).strict()

export const RuntimeKnownErrorDataSchema = z.object({
  code: z.literal(CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE),
  details: CodexProjectConfigInvalidDetailsSchema,
  message: z.string(),
  fatal: z.literal(true)
}).strict()

export const ProjectedRuntimeKnownErrorDataSchema = z.object({
  code: z.literal(CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE),
  details: ProjectedCodexProjectConfigInvalidDetailsSchema,
  message: z.string(),
  fatal: z.literal(true)
}).strict()

export const RuntimeExtensibleErrorDataSchema = z.object({
  code: z.string().refine(
    code => code !== CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE,
    `Use RuntimeKnownErrorDataSchema for ${CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE}`
  ),
  message: z.string(),
  fatal: z.boolean().optional()
}).strict()

export const RuntimeStructuredErrorDataSchema = z.union([
  RuntimeKnownErrorDataSchema,
  RuntimeExtensibleErrorDataSchema
])

const RuntimePublicErrorEnvelopeSchema = z.object({
  code: z.string().trim().min(1).refine(
    code => code !== CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE,
    `Use the strict known-error schema for ${CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE}`
  ),
  message: z.string(),
  fatal: z.boolean().optional()
}).strict()

export const RuntimePublicErrorDataSchema = z.union([
  RuntimeKnownErrorDataSchema,
  RuntimePublicErrorEnvelopeSchema
])

export const ProjectedRuntimePublicErrorDataSchema = z.union([
  ProjectedRuntimeKnownErrorDataSchema,
  RuntimePublicErrorEnvelopeSchema
])

export const sanitizeRuntimePublicErrorData = (
  value: unknown,
  malformedKnownCode = 'session_failed'
) => {
  const projectedKnown = ProjectedRuntimeKnownErrorDataSchema.safeParse(value)
  if (projectedKnown.success) {
    return projectedKnown.data
  }
  const known = RuntimeKnownErrorDataSchema.safeParse(value)
  if (known.success) {
    return known.data
  }

  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const envelope = RuntimePublicErrorEnvelopeSchema.safeParse({
    code: record.code === CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE
      ? malformedKnownCode
      : typeof record.code === 'string' && record.code.trim() !== ''
      ? record.code
      : 'session_failed',
    message: typeof record.message === 'string' ? record.message : 'Session failed',
    ...(typeof record.fatal === 'boolean' ? { fatal: record.fatal } : {})
  })
  return envelope.success ? envelope.data : undefined
}

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

export const RuntimeRecoveryContextSchema = z.object({
  kind: z.literal('codex-project-config'),
  attemptCommandId: z.string().trim().min(1),
  replacedActivationCommandId: z.string().trim().min(1),
  failureEventId: z.string().trim().min(1),
  failureEventSeq: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(1),
  grantEventId: z.string().trim().min(1),
  grantEventSeq: z.number().int().positive(),
  grantAuthorizationId: z.string().uuid(),
  grantCommandIndex: z.number().int().nonnegative()
}).strict()

// Content passed to an adapter is intentionally JSON-only.  Keeping this
// recursive schema here (rather than accepting `unknown`) means a command
// replay can never turn a class instance, function, or cyclic host object
// into an adapter payload.
const RuntimeJsonValueSchema: z.ZodType<
  string | number | boolean | null | RuntimeJsonValue[] | { [key: string]: RuntimeJsonValue }
> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(RuntimeJsonValueSchema),
  z.record(RuntimeJsonValueSchema)
]))
type RuntimeJsonValue =
  | string
  | number
  | boolean
  | null
  | RuntimeJsonValue[]
  | { [key: string]: RuntimeJsonValue }

const RuntimeActivationContentItemDiscriminatedSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1) }).strict(),
  z.object({
    type: z.literal('image'),
    url: z.string().min(1),
    path: z.string().optional(),
    name: z.string().optional(),
    size: z.number().optional(),
    mimeType: z.string().optional()
  }).strict(),
  z.object({
    type: z.literal('file'),
    path: z.string().min(1),
    name: z.string().optional(),
    size: z.number().optional()
  }).strict(),
  z.object({
    type: z.literal('tool_use'),
    id: z.string().min(1),
    name: z.string().min(1),
    input: RuntimeJsonValueSchema
  }).strict(),
  z.object({
    type: z.literal('tool_result'),
    tool_use_id: z.string().min(1),
    content: RuntimeJsonValueSchema,
    is_error: z.boolean().optional()
  }).strict()
])

export const RuntimeActivationContentItemSchema =
  RuntimeActivationContentItemDiscriminatedSchema.superRefine((item, context) => {
    if (item.type === 'tool_use' && !Object.hasOwn(item, 'input')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tool_use.input is required',
        path: ['input']
      })
    }
    if (item.type === 'tool_result' && !Object.hasOwn(item, 'content')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tool_result.content is required',
        path: ['content']
      })
    }
  })

const NonEmptyActivationStringSchema = z.string().refine(
  value => value.trim() !== '',
  'activation text must not be empty'
)

export const hasRuntimeActivationPayload = (command: {
  content?: unknown
  contentItems?: unknown
  message?: unknown
  runtimeContentItems?: unknown
  runtimeMessage?: unknown
}) => (
  [command.runtimeMessage, command.content, command.message].some(
    value => typeof value === 'string' && value.trim() !== ''
  ) ||
  (
    Array.isArray(command.runtimeContentItems) &&
    command.runtimeContentItems.length > 0 &&
    command.runtimeContentItems.every(
      item => RuntimeActivationContentItemSchema.safeParse(item).success
    )
  ) ||
  (
    Array.isArray(command.contentItems) &&
    command.contentItems.length > 0 &&
    command.contentItems.every(
      item => RuntimeActivationContentItemSchema.safeParse(item).success
    )
  )
)

const RuntimeCommandCommonSchema = RuntimeCorrelationFieldsSchema.extend({
  protocolVersion: RuntimeProtocolVersionSchema,
  supportedProtocolRange: z.string().optional(),
  id: z.string(),
  ts: z.number(),
  sessionId: z.string(),
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
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional(),
  fastMode: z.boolean().optional(),
  model: z.string().optional(),
  permissionMode: RuntimePermissionModeSchema.optional(),
  background: z.boolean().optional()
}).strict()

const RuntimeActivationCommandFields = {
  content: NonEmptyActivationStringSchema.optional(),
  contentItems: z.array(RuntimeActivationContentItemSchema).min(1).optional(),
  message: NonEmptyActivationStringSchema.optional(),
  runtimeContentItems: z.array(RuntimeActivationContentItemSchema).min(1).optional(),
  runtimeMessage: NonEmptyActivationStringSchema.optional()
}

const RuntimeControlCommandFields = {
  mode: z.string().optional(),
  interactionId: z.string().optional(),
  requestId: z.string().optional(),
  value: z.unknown().optional(),
  data: z.union([z.string(), z.array(z.string())]).optional()
}

const RuntimeForbiddenStartOnlyFields = {
  account: z.never().optional(),
  systemPrompt: z.never().optional(),
  updateConfiguredSkills: z.never().optional()
}

const RuntimeForbiddenActivationFields = {
  content: z.never().optional(),
  contentItems: z.never().optional(),
  message: z.never().optional(),
  runtimeContentItems: z.never().optional(),
  runtimeMessage: z.never().optional()
}

const RuntimeForbiddenControlFields = {
  mode: z.never().optional(),
  interactionId: z.never().optional(),
  requestId: z.never().optional(),
  value: z.never().optional(),
  data: z.never().optional()
}

const RuntimeForbiddenRecoveryFields = {
  projectConfigPolicy: z.never().optional(),
  recovery: z.never().optional(),
  messageDelivery: z.never().optional()
}

interface RuntimeCommandValidationInput {
  type: z.infer<typeof RuntimeCommandTypeSchema>
  account?: string
  systemPrompt?: string
  updateConfiguredSkills?: boolean
  projectConfigPolicy?: z.infer<typeof RuntimeProjectConfigPolicySchema>
  recovery?: z.infer<typeof RuntimeRecoveryContextSchema>
  content?: string
  contentItems?: z.infer<typeof RuntimeActivationContentItemSchema>[]
  message?: string
  runtimeContentItems?: z.infer<typeof RuntimeActivationContentItemSchema>[]
  runtimeMessage?: string
  messageDelivery?: 'bridge' | 'initial_prompt'
  mode?: string
  interactionId?: string
  requestId?: string
  value?: unknown
  data?: string | string[]
}

const validateRuntimeCommand = (
  command: RuntimeCommandValidationInput,
  ctx: z.RefinementCtx
) => {
  const requiresActivationPayload =
    command.type === 'resume' ||
    command.type === 'send_message' ||
    (command.type === 'start' && command.messageDelivery != null)
  if (requiresActivationPayload && !hasRuntimeActivationPayload(command)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${command.type} requires a supported nonempty activation payload`,
      path: ['message']
    })
  }
  if (
    command.recovery != null &&
    command.recovery.replacedActivationCommandId !== command.recovery.attemptCommandId
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'recovery must replace the exact failed activation command',
      path: ['recovery', 'replacedActivationCommandId']
    })
  }
  if (command.recovery != null && command.type !== 'resume') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'recovery is only valid on resume commands',
      path: ['recovery']
    })
  }
  if (
    command.projectConfigPolicy != null &&
    command.type !== 'start' &&
    command.type !== 'resume'
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'projectConfigPolicy is only valid on start or resume commands',
      path: ['projectConfigPolicy']
    })
  }
  if (command.type !== 'start') {
    for (const field of ['account', 'systemPrompt', 'updateConfiguredSkills'] as const) {
      if (command[field] != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} is only valid on start commands`,
          path: [field]
        })
      }
    }
  }
  const activationOnlyFields = [
    'content',
    'contentItems',
    'message',
    'runtimeContentItems',
    'runtimeMessage',
    'messageDelivery'
  ] as const
  if (!isRuntimeActivationCommand(command)) {
    for (const field of activationOnlyFields) {
      if (command[field] != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} is only valid on activation commands`,
          path: [field]
        })
      }
    }
  }
  if (isRuntimeActivationCommand(command)) {
    for (const field of ['data', 'interactionId', 'requestId', 'value'] as const) {
      if (command[field] != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} is not a supported activation field`,
          path: [field]
        })
      }
    }
  }
  if (
    command.messageDelivery != null &&
    command.type !== 'start' &&
    !(command.type === 'resume' && command.messageDelivery === 'bridge')
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'messageDelivery is not supported by this activation type',
      path: ['messageDelivery']
    })
  }
  if (
    command.mode != null &&
    command.type !== 'send_message' &&
    command.type !== 'steer_message' &&
    command.type !== 'stop'
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'mode is not supported by this command type',
      path: ['mode']
    })
  }
}

export const RuntimeStartCommandSchema = RuntimeCommandCommonSchema.extend({
  type: z.literal('start'),
  ...RuntimeActivationCommandFields,
  account: z.string().optional(),
  projectConfigPolicy: RuntimeProjectConfigPolicySchema.optional(),
  systemPrompt: z.string().optional(),
  updateConfiguredSkills: z.boolean().optional(),
  messageDelivery: z.enum(['bridge', 'initial_prompt']).optional(),
  recovery: z.never().optional(),
  ...RuntimeForbiddenControlFields
}).strict().superRefine(validateRuntimeCommand)

export const RuntimeResumeCommandSchema = RuntimeCommandCommonSchema.extend({
  type: z.literal('resume'),
  ...RuntimeActivationCommandFields,
  projectConfigPolicy: RuntimeProjectConfigPolicySchema.optional(),
  recovery: RuntimeRecoveryContextSchema.optional(),
  messageDelivery: z.literal('bridge').optional(),
  ...RuntimeForbiddenStartOnlyFields,
  ...RuntimeForbiddenControlFields
}).strict().superRefine(validateRuntimeCommand)

export const RuntimeSendMessageCommandSchema = RuntimeCommandCommonSchema.extend({
  type: z.literal('send_message'),
  ...RuntimeActivationCommandFields,
  mode: z.string().optional(),
  ...RuntimeForbiddenStartOnlyFields,
  projectConfigPolicy: z.never().optional(),
  recovery: z.never().optional(),
  messageDelivery: z.never().optional(),
  interactionId: z.never().optional(),
  requestId: z.never().optional(),
  value: z.never().optional(),
  data: z.never().optional()
}).strict().superRefine(validateRuntimeCommand)

export const RuntimeControlCommandSchema = RuntimeCommandCommonSchema.extend({
  type: z.enum([
    'steer_message',
    'submit_input',
    'approve',
    'deny',
    'stop',
    'kill',
    'cancel',
    'pause'
  ]),
  ...RuntimeControlCommandFields,
  ...RuntimeForbiddenStartOnlyFields,
  ...RuntimeForbiddenActivationFields,
  ...RuntimeForbiddenRecoveryFields
}).strict().superRefine(validateRuntimeCommand)

export const RuntimeActivationCommandSchema = z.union([
  RuntimeStartCommandSchema,
  RuntimeResumeCommandSchema,
  RuntimeSendMessageCommandSchema
])

export const RuntimeCommandSchema = z.union([
  RuntimeActivationCommandSchema,
  RuntimeControlCommandSchema
])

const RuntimeSessionPayloadCommonFields = {
  sessionId: z.string().optional(),
  entity: z.string().optional(),
  title: z.string().optional(),
  adapter: z.string().optional(),
  model: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional(),
  fastMode: z.boolean().optional(),
  background: z.boolean().optional(),
  permissionMode: RuntimePermissionModeSchema.optional(),
  hostSessionId: z.string().optional(),
  parentSessionId: z.string().optional(),
  roomTitle: z.string().optional(),
  memberAvatar: z.string().optional(),
  memberLabel: z.string().optional(),
  runTitle: z.string().optional()
}

const RuntimeSessionActivationFields = {
  message: NonEmptyActivationStringSchema.optional(),
  content: NonEmptyActivationStringSchema.optional(),
  contentItems: z.array(RuntimeActivationContentItemSchema).min(1).optional(),
  runtimeContentItems: z.array(RuntimeActivationContentItemSchema).min(1).optional(),
  runtimeMessage: NonEmptyActivationStringSchema.optional()
}

const RuntimeSessionControlFields = {
  requestId: z.string().optional(),
  interactionId: z.string().optional(),
  value: z.unknown().optional(),
  data: z.union([z.string(), z.array(z.string())]).optional(),
  mode: z.string().optional()
}

const RuntimeSessionForbiddenStartOnlyFields = {
  account: z.never().optional(),
  systemPrompt: z.never().optional(),
  updateConfiguredSkills: z.never().optional()
}

const RuntimeSessionForbiddenActivationFields = {
  message: z.never().optional(),
  content: z.never().optional(),
  contentItems: z.never().optional(),
  runtimeContentItems: z.never().optional(),
  runtimeMessage: z.never().optional()
}

const RuntimeSessionForbiddenControlFields = {
  requestId: z.never().optional(),
  interactionId: z.never().optional(),
  value: z.never().optional(),
  data: z.never().optional(),
  mode: z.never().optional()
}

export const RuntimeSessionStartCommandPayloadSchema = z.object({
  type: z.literal('session.start'),
  ...RuntimeSessionPayloadCommonFields,
  ...RuntimeSessionActivationFields,
  account: z.string().optional(),
  systemPrompt: z.string().optional(),
  updateConfiguredSkills: z.boolean().optional(),
  projectConfigPolicy: RuntimeProjectConfigPolicySchema.optional(),
  ...RuntimeSessionForbiddenControlFields
}).strict()

export const RuntimeSessionResumeCommandPayloadSchema = z.object({
  type: z.literal('session.resume'),
  ...RuntimeSessionPayloadCommonFields,
  ...RuntimeSessionActivationFields,
  projectConfigPolicy: RuntimeProjectConfigPolicySchema.optional(),
  ...RuntimeSessionForbiddenStartOnlyFields,
  ...RuntimeSessionForbiddenControlFields
}).strict()

export const RuntimeSessionMessageCommandPayloadSchema = z.object({
  type: z.literal('session.message'),
  ...RuntimeSessionPayloadCommonFields,
  ...RuntimeSessionActivationFields,
  mode: z.string().optional(),
  ...RuntimeSessionForbiddenStartOnlyFields,
  projectConfigPolicy: z.never().optional(),
  requestId: z.never().optional(),
  interactionId: z.never().optional(),
  value: z.never().optional(),
  data: z.never().optional()
}).strict()

export const RuntimeSessionControlCommandPayloadSchema = z.object({
  type: z.enum(['session.stop', 'session.submit', 'session.status', 'session.events']),
  ...RuntimeSessionPayloadCommonFields,
  ...RuntimeSessionControlFields,
  ...RuntimeSessionForbiddenStartOnlyFields,
  ...RuntimeSessionForbiddenActivationFields,
  projectConfigPolicy: z.never().optional()
}).strict()

export const RuntimeSessionCommandPayloadSchema = z.union([
  RuntimeSessionStartCommandPayloadSchema,
  RuntimeSessionResumeCommandPayloadSchema,
  RuntimeSessionMessageCommandPayloadSchema,
  RuntimeSessionControlCommandPayloadSchema
])

const RuntimeSessionEnvelopeCommonSchema = RuntimeCorrelationFieldsSchema.extend({
  protocolVersion: RuntimeProtocolVersionSchema,
  supportedProtocolRange: z.string().optional(),
  commandId: z.string(),
  priority: z.number().optional(),
  source: z.string().optional(),
  ...RuntimeSessionPayloadCommonFields
}).strict()

export const RuntimeSessionStartCommandEnvelopeSchema = RuntimeSessionEnvelopeCommonSchema.extend({
  type: z.literal('session.start'),
  ...RuntimeSessionActivationFields,
  payload: RuntimeSessionStartCommandPayloadSchema.optional(),
  account: z.string().optional(),
  systemPrompt: z.string().optional(),
  updateConfiguredSkills: z.boolean().optional(),
  projectConfigPolicy: RuntimeProjectConfigPolicySchema.optional(),
  ...RuntimeSessionForbiddenControlFields
}).strict()

export const RuntimeSessionResumeCommandEnvelopeSchema = RuntimeSessionEnvelopeCommonSchema.extend({
  type: z.literal('session.resume'),
  ...RuntimeSessionActivationFields,
  payload: RuntimeSessionResumeCommandPayloadSchema.optional(),
  projectConfigPolicy: RuntimeProjectConfigPolicySchema.optional(),
  ...RuntimeSessionForbiddenStartOnlyFields,
  ...RuntimeSessionForbiddenControlFields
}).strict()

export const RuntimeSessionMessageCommandEnvelopeSchema = RuntimeSessionEnvelopeCommonSchema.extend({
  type: z.literal('session.message'),
  ...RuntimeSessionActivationFields,
  payload: RuntimeSessionMessageCommandPayloadSchema.optional(),
  mode: z.string().optional(),
  ...RuntimeSessionForbiddenStartOnlyFields,
  projectConfigPolicy: z.never().optional(),
  requestId: z.never().optional(),
  interactionId: z.never().optional(),
  value: z.never().optional(),
  data: z.never().optional()
}).strict()

export const RuntimeSessionControlCommandEnvelopeSchema = RuntimeSessionEnvelopeCommonSchema.extend({
  type: z.enum(['session.stop', 'session.submit', 'session.status', 'session.events']),
  ...RuntimeSessionControlFields,
  payload: RuntimeSessionControlCommandPayloadSchema.optional(),
  ...RuntimeSessionForbiddenStartOnlyFields,
  ...RuntimeSessionForbiddenActivationFields,
  projectConfigPolicy: z.never().optional()
}).strict()

const RuntimeSessionCommandEnvelopeVariantSchema = z.union([
  RuntimeSessionStartCommandEnvelopeSchema,
  RuntimeSessionResumeCommandEnvelopeSchema,
  RuntimeSessionMessageCommandEnvelopeSchema,
  RuntimeSessionControlCommandEnvelopeSchema
]).superRefine((command, ctx) => {
  const activation = {
    ...(command.payload ?? {}),
    ...command
  }
  if (
    (command.type === 'session.message' || command.type === 'session.resume') &&
    !hasRuntimeActivationPayload(activation)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${command.type} requires a supported nonempty activation payload`,
      path: ['message']
    })
  }
  // A start envelope may be structured-only (for example an entity/spec
  // launch).  If it does carry prompt data it must use the same strict
  // activation shapes as resume/send_message; a start never falls back to an
  // empty text delivery.
  if (command.type === 'session.start' &&
      [activation.message, activation.content, activation.runtimeMessage,
        activation.contentItems, activation.runtimeContentItems].some(value => value != null) &&
      !hasRuntimeActivationPayload(activation)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'session.start payload must be supported and nonempty',
      path: ['message']
    })
  }
})

export const RuntimeSessionCommandEnvelopeSchema = z.preprocess((value) => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return value
  const command = value as Record<string, unknown>
  const payload = command.payload
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return value
  const payloadRecord = payload as Record<string, unknown>
  return payloadRecord.type == null && typeof command.type === 'string'
    ? { ...command, payload: { ...payloadRecord, type: command.type } }
    : value
}, RuntimeSessionCommandEnvelopeVariantSchema)

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

const RuntimeCommandDraftCommonSchema = RuntimeCommandCommonSchema.extend({
  protocolVersion: RuntimeProtocolVersionSchema.optional(),
  ts: z.number().optional(),
  priority: z.number().optional()
})

export const RuntimeStartCommandDraftSchema = RuntimeCommandDraftCommonSchema.extend({
  type: z.literal('start'),
  ...RuntimeActivationCommandFields,
  account: z.string().optional(),
  projectConfigPolicy: RuntimeProjectConfigPolicySchema.optional(),
  systemPrompt: z.string().optional(),
  updateConfiguredSkills: z.boolean().optional(),
  messageDelivery: z.enum(['bridge', 'initial_prompt']).optional(),
  recovery: z.never().optional(),
  ...RuntimeForbiddenControlFields
}).strict().superRefine(validateRuntimeCommand)

export const RuntimeResumeCommandDraftSchema = RuntimeCommandDraftCommonSchema.extend({
  type: z.literal('resume'),
  ...RuntimeActivationCommandFields,
  projectConfigPolicy: RuntimeProjectConfigPolicySchema.optional(),
  recovery: RuntimeRecoveryContextSchema.optional(),
  messageDelivery: z.literal('bridge').optional(),
  ...RuntimeForbiddenStartOnlyFields,
  ...RuntimeForbiddenControlFields
}).strict().superRefine(validateRuntimeCommand)

export const RuntimeSendMessageCommandDraftSchema = RuntimeCommandDraftCommonSchema.extend({
  type: z.literal('send_message'),
  ...RuntimeActivationCommandFields,
  mode: z.string().optional(),
  ...RuntimeForbiddenStartOnlyFields,
  projectConfigPolicy: z.never().optional(),
  recovery: z.never().optional(),
  messageDelivery: z.never().optional(),
  interactionId: z.never().optional(),
  requestId: z.never().optional(),
  value: z.never().optional(),
  data: z.never().optional()
}).strict().superRefine(validateRuntimeCommand)

export const RuntimeControlCommandDraftSchema = RuntimeCommandDraftCommonSchema.extend({
  type: z.enum([
    'steer_message',
    'submit_input',
    'approve',
    'deny',
    'stop',
    'kill',
    'cancel',
    'pause'
  ]),
  ...RuntimeControlCommandFields,
  ...RuntimeForbiddenStartOnlyFields,
  ...RuntimeForbiddenActivationFields,
  ...RuntimeForbiddenRecoveryFields
}).strict().superRefine(validateRuntimeCommand)

export const RuntimeCommandDraftSchema = z.union([
  RuntimeStartCommandDraftSchema,
  RuntimeResumeCommandDraftSchema,
  RuntimeSendMessageCommandDraftSchema,
  RuntimeControlCommandDraftSchema
])

/** Internal-only server recovery authority. Never project this to history/live clients. */
export const RuntimeProjectConfigRecoveryGrantSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('project_config_recovery_grant'),
  recoveryCommandId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  attemptCommandId: z.string().trim().min(1),
  failureEventId: z.string().trim().min(1),
  failureEventSeq: z.number().int().positive(),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  authorizationId: z.string().uuid(),
  commandIndex: z.number().int().nonnegative(),
  workspaceFolder: z.string().trim().min(1),
  adapter: z.string().trim().min(1),
  runtimeAdapter: z.literal('codex')
}).strict()

const RuntimeEventFieldsSchema = RuntimeCorrelationFieldsSchema.extend({
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
  code: z.string().optional(),
  details: z.unknown().optional(),
  message: z.string().optional(),
  fatal: z.boolean().optional(),
  adapter: z.string().optional(),
  model: z.string().optional(),
  artifactId: z.string().optional(),
  deliveryId: z.string().optional(),
  deliveryState: z.enum(['prepared', 'accepted', 'completed']).optional(),
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
})

const RuntimeProjectConfigRecoveryGrantEventFieldsSchema =
  RuntimeCorrelationFieldsSchema.extend({
    sessionId: z.string().trim().min(1),
    type: z.literal('project_config_recovery_granted'),
    source: z.literal('server:project-config-recovery'),
    recoveryGrant: RuntimeProjectConfigRecoveryGrantSchema
  })

const validateKnownRuntimeEventDetails = (
  value: { code?: string; details?: unknown; fatal?: boolean; type: string; recoveryGrant?: unknown },
  context: z.RefinementCtx
) => {
  const hasRecoveryGrant = 'recoveryGrant' in value && value.recoveryGrant != null
  if (value.type === 'project_config_recovery_granted') {
    if (!hasRecoveryGrant) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Recovery grant event requires recoveryGrant', path: ['recoveryGrant'] })
    }
    return
  }
  if (hasRecoveryGrant) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'recoveryGrant is only valid on internal grant events', path: ['recoveryGrant'] })
  }
  if (value.code !== CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE) {
    if (
      value.details != null &&
      (
        value.code != null ||
        value.type === 'session_failed' ||
        value.type === 'command_failed'
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Runtime event details are only public for a validated known error code',
        path: ['details']
      })
    }
    return
  }
  if (value.type !== 'session_failed') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE} must be a session_failed event`,
      path: ['type']
    })
  }
  if (value.fatal !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE} must be fatal`,
      path: ['fatal']
    })
  }
  const result = CodexProjectConfigInvalidDetailsSchema.safeParse(value.details)
  if (result.success) return
  for (const issue of result.error.issues) {
    context.addIssue({
      ...issue,
      path: ['details', ...issue.path]
    })
  }
}

const RuntimeNonGrantEventSchema = RuntimeEventFieldsSchema.extend({
  protocolVersion: RuntimeProtocolVersionSchema,
  supportedProtocolRange: z.string().optional(),
  id: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.number()
}).passthrough().superRefine((value, context) => {
  if (value.type === 'project_config_recovery_granted') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Use the strict internal recovery grant event variant',
      path: ['type']
    })
    return
  }
  validateKnownRuntimeEventDetails(value, context)
})

export const RuntimeProjectConfigRecoveryGrantEventSchema =
  RuntimeProjectConfigRecoveryGrantEventFieldsSchema.extend({
    protocolVersion: RuntimeProtocolVersionSchema,
    supportedProtocolRange: z.string().optional(),
    id: z.string().trim().min(1),
    seq: z.number().int().nonnegative(),
    ts: z.number()
  }).strict()

export const RuntimeEventSchema = z.union([
  RuntimeProjectConfigRecoveryGrantEventSchema,
  RuntimeNonGrantEventSchema
])

const RuntimeNonGrantEventDraftSchema = RuntimeEventFieldsSchema.extend({
  protocolVersion: RuntimeProtocolVersionSchema.optional(),
  supportedProtocolRange: z.string().optional(),
  id: z.string().optional(),
  seq: z.number().int().nonnegative().optional(),
  ts: z.number().optional()
}).passthrough().superRefine((value, context) => {
  if (value.type === 'project_config_recovery_granted') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Use the strict internal recovery grant event draft variant',
      path: ['type']
    })
    return
  }
  validateKnownRuntimeEventDetails(value, context)
})

export const RuntimeProjectConfigRecoveryGrantEventDraftSchema =
  RuntimeProjectConfigRecoveryGrantEventFieldsSchema.extend({
    protocolVersion: RuntimeProtocolVersionSchema.optional(),
    supportedProtocolRange: z.string().optional(),
    id: z.string().optional(),
    seq: z.number().int().nonnegative().optional(),
    ts: z.number().optional()
  }).strict()

export const RuntimeEventDraftSchema = z.union([
  RuntimeProjectConfigRecoveryGrantEventDraftSchema,
  RuntimeNonGrantEventDraftSchema
])

export const RuntimeMetaSchema = z.object({
  protocolVersion: RuntimeProtocolVersionSchema,
  supportedProtocolRange: z.string().optional(),
  sessionId: z.string(),
  title: z.string().optional(),
  entity: z.string().optional(),
  adapter: z.string().optional(),
  account: z.string().optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional(),
  fastMode: z.boolean().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  updateConfiguredSkills: z.boolean().optional(),
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
