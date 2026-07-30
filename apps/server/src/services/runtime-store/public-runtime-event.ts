import type { ChatMessage, ChatMessageContent, WSEvent } from '@oneworks/core'
import { Buffer } from 'node:buffer'
import {
  CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE,
  RuntimeEventDraftSchema,
  RuntimeEventTypeSchema,
  sanitizeRuntimePublicErrorData
} from '@oneworks/runtime-protocol'

import type { RuntimeEvent } from './types.js'

const FAILURE_EVENT_TYPES = new Set([
  'command_failed',
  'operation_failed',
  'session_failed'
])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

const asNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
)

const asBoolean = (value: unknown) => typeof value === 'boolean' ? value : undefined

/**
 * Copy an intentionally-public JSON value without retaining references to an
 * adapter, database record, or channel payload.  Opaque payload fields are
 * still bounded JSON only: host objects, unsafe keys, deep graphs and huge
 * collections are rejected rather than becoming an accidental public API.
 */
const PUBLIC_JSON_MAX_STRING_BYTES = 16 * 1024
// Aggregate bytes are UTF-8 bytes of public string values. Object-key growth
// is bounded independently by key length plus the shared item/node limits.
const PUBLIC_JSON_MAX_TOTAL_BYTES = 128 * 1024
const PUBLIC_JSON_MAX_NODES = 2_048
const PUBLIC_JSON_MAX_ITEMS = 1_024

export interface PublicProjectionContext {
  bytes: number
  items: number
  nodes: number
}

export const createPublicProjectionContext = (): PublicProjectionContext => ({
  bytes: 0,
  items: 0,
  nodes: 0
})

const copyBoundedJson = (
  value: unknown,
  depth: number,
  budget: PublicProjectionContext,
  secretPolicy: 'reject' | 'strip',
  ancestors: Set<object>
): unknown | undefined => {
  budget.nodes += 1
  if (budget.nodes > PUBLIC_JSON_MAX_NODES) return undefined
  if (value == null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const bytes = Buffer.byteLength(value, 'utf8')
    if (bytes > PUBLIC_JSON_MAX_STRING_BYTES || budget.bytes + bytes > PUBLIC_JSON_MAX_TOTAL_BYTES) {
      return undefined
    }
    budget.bytes += bytes
    return value
  }
  if (typeof value !== 'object' || depth >= 12 || ancestors.has(value)) return undefined
  ancestors.add(value)
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > 256 ||
      budget.items + value.length > PUBLIC_JSON_MAX_ITEMS
    ) {
      ancestors.delete(value)
      return undefined
    }
    budget.items += value.length
    const copied: unknown[] = []
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (descriptor == null || !descriptor.enumerable || !('value' in descriptor)) {
        ancestors.delete(value)
        return undefined
      }
      const item = copyBoundedJson(
        descriptor.value,
        depth + 1,
        budget,
        secretPolicy,
        ancestors
      )
      if (item === undefined) {
        ancestors.delete(value)
        return undefined
      }
      copied.push(item)
    }
    ancestors.delete(value)
    return copied
  }
  if (!isRecord(value)) {
    ancestors.delete(value)
    return undefined
  }
  const prototype = Object.getPrototypeOf(value)
  const ownKeys = Reflect.ownKeys(value)
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.some(key => typeof key !== 'string') ||
    ownKeys.length > 128 ||
    budget.items + ownKeys.length > PUBLIC_JSON_MAX_ITEMS
  ) {
    ancestors.delete(value)
    return undefined
  }
  budget.items += ownKeys.length
  const target: Record<string, unknown> = {}
  for (const keyValue of ownKeys) {
    const key = keyValue as string
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      descriptor == null ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      Buffer.byteLength(key, 'utf8') > 128 ||
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype'
    ) {
      ancestors.delete(value)
      return undefined
    }
    // Opaque tool/plugin/result JSON is public only as data, never as a
    // credential transport.  Known secret-bearing keys are deliberately not
    // projected even when nested inside an otherwise supported public field.
    if (/(?:token|secret|password|authorization|cookie|credential|api[_-]?key|private)/iu.test(key)) {
      if (secretPolicy === 'strip') continue
      ancestors.delete(value)
      return undefined
    }
    const copied = copyBoundedJson(
      descriptor.value,
      depth + 1,
      budget,
      secretPolicy,
      ancestors
    )
    if (copied === undefined) {
      ancestors.delete(value)
      return undefined
    }
    target[key] = copied
  }
  ancestors.delete(value)
  return target
}

const copyPublicJson = (
  value: unknown,
  depth: number,
  _context: PublicProjectionContext
): unknown | undefined => {
  // Nested constructors perform only per-value shape/secret/size validation.
  // They intentionally do not charge the response context: the outer response
  // traversal below is the single occurrence-counting owner and fresh-clones
  // every emitted occurrence, including repeated references.
  try {
    return copyBoundedJson(
      value,
      depth,
      { bytes: 0, items: 0, nodes: 0 },
      'strip',
      new Set<object>()
    )
  } catch {
    return undefined
  }
}

/**
 * Final response-root guard. All public HTTP response bodies pass through this
 * once, so arrays of individually-valid sessions/queues cannot reset their
 * aggregate byte/node/item budget. It returns a fresh, bounded JSON graph.
 */
export const projectPublicResponse = (
  value: unknown,
  context: PublicProjectionContext
) => {
  try {
    return copyBoundedJson(value, 0, context, 'reject', new Set<object>())
  } catch {
    return undefined
  }
}

const finalizeLocalProjection = <T>(
  value: T | undefined,
  context: PublicProjectionContext
): T | undefined => value == null
  ? undefined
  : copyPublicJson(value, 0, context) as T | undefined

const copyPublicJsonRecord = (value: unknown, context: PublicProjectionContext) => {
  const copied = copyPublicJson(value, 0, context)
  return isRecord(copied) ? copied : undefined
}

const copyOptionalString = (
  source: Record<string, unknown>,
  key: string,
  context: PublicProjectionContext
) => {
  const value = asString(source[key])
  const copied = value == null ? undefined : copyPublicJson(value, 0, context)
  return typeof copied === 'string' ? { [key]: copied } : {}
}

const copyOptionalNumber = (
  source: Record<string, unknown>,
  key: string,
  context: PublicProjectionContext
) => {
  const value = asNumber(source[key])
  const copied = value == null ? undefined : copyPublicJson(value, 0, context)
  return typeof copied === 'number' ? { [key]: copied } : {}
}

const copyRequiredString = (value: unknown, context: PublicProjectionContext) => {
  if (typeof value !== 'string') return undefined
  const copied = copyPublicJson(value, 0, context)
  return typeof copied === 'string' ? copied : undefined
}

const sanitizeContentItem = (
  value: unknown,
  context: PublicProjectionContext
): ChatMessageContent | undefined => {
  if (!isRecord(value)) return undefined
  switch (value.type) {
    case 'text': {
      const text = copyRequiredString(value.text, context)
      return text == null ? undefined : { type: 'text', text }
    }
    case 'image': {
      const url = copyRequiredString(value.url, context)
      return url != null
        ? {
            type: 'image',
            url,
            ...copyOptionalString(value, 'path', context),
            ...copyOptionalString(value, 'name', context),
            ...copyOptionalNumber(value, 'size', context),
            ...copyOptionalString(value, 'mimeType', context)
          }
        : undefined
    }
    case 'file': {
      const filePath = copyRequiredString(value.path, context)
      return filePath != null
        ? {
            type: 'file',
            path: filePath,
            ...copyOptionalString(value, 'name', context),
            ...copyOptionalNumber(value, 'size', context)
          }
        : undefined
    }
    case 'tool_use': {
      const input = copyPublicJson(value.input, 0, context)
      const id = copyRequiredString(asString(value.id), context)
      const name = copyRequiredString(asString(value.name), context)
      return id != null && name != null && input !== undefined
        ? { type: 'tool_use', id, name, input }
        : undefined
    }
    case 'tool_result': {
      const content = copyPublicJson(value.content, 0, context)
      const toolUseId = copyRequiredString(asString(value.tool_use_id), context)
      return toolUseId != null && content !== undefined
        ? {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content,
            ...(asBoolean(value.is_error) != null ? { is_error: asBoolean(value.is_error) } : {})
          }
        : undefined
    }
    default:
      return undefined
  }
}

const sanitizeContent = (
  value: unknown,
  context: PublicProjectionContext
): RuntimeEvent['content'] | undefined => {
  if (typeof value === 'string') {
    const copied = copyPublicJson(value, 0, context)
    return typeof copied === 'string' ? copied : undefined
  }
  if (!Array.isArray(value)) return undefined
  const items = value.map(item => sanitizeContentItem(item, context))
  return items.every(item => item != null) ? items as ChatMessageContent[] : undefined
}

const sanitizeOptions = (
  value: unknown,
  context: PublicProjectionContext
): RuntimeEvent['options'] | undefined => {
  if (!Array.isArray(value)) return undefined
  const options = value.map((item) => {
    if (!isRecord(item) || asString(item.label) == null) return undefined
    const label = copyRequiredString(asString(item.label), context)
    if (label == null) return undefined
    return {
      label,
      ...copyOptionalString(item, 'value', context),
      ...copyOptionalString(item, 'description', context)
    }
  })
  return options.every(option => option != null) ? options as RuntimeEvent['options'] : undefined
}

const sanitizePermissionContext = (
  value: unknown,
  context: PublicProjectionContext
): RuntimeEvent['permissionContext'] | undefined => {
  if (!isRecord(value)) return undefined
  const modes = ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions']
  const strings = (key: string) => {
    if (!Array.isArray(value[key]) || !value[key].every(item => typeof item === 'string')) return {}
    const copied = copyPublicJson(value[key], 0, context)
    return Array.isArray(copied) ? { [key]: copied as string[] } : {}
  }
  const currentMode = typeof value.currentMode === 'string' && modes.includes(value.currentMode)
    ? copyRequiredString(value.currentMode, context)
    : undefined
  const suggestedMode = typeof value.suggestedMode === 'string' && modes.includes(value.suggestedMode)
    ? copyRequiredString(value.suggestedMode, context)
    : undefined
  return {
    ...copyOptionalString(value, 'adapter', context),
    ...(currentMode != null
      ? { currentMode: currentMode as NonNullable<RuntimeEvent['permissionContext']>['currentMode'] }
      : {}),
    ...(suggestedMode != null
      ? { suggestedMode: suggestedMode as NonNullable<RuntimeEvent['permissionContext']>['suggestedMode'] }
      : {}),
    ...strings('deniedTools'),
    ...strings('reasons'),
    ...strings('subjectLookupKeys'),
    ...copyOptionalString(value, 'subjectKey', context),
    ...copyOptionalString(value, 'subjectLabel', context),
    ...(value.scope === 'tool' ? { scope: 'tool' as const } : {}),
    ...copyOptionalString(value, 'projectConfigPath', context)
  }
}

const sanitizeMember = (
  value: unknown,
  context: PublicProjectionContext
): RuntimeEvent['member'] | undefined => {
  if (!isRecord(value)) return undefined
  const key = copyRequiredString(asString(value.key), context)
  const label = copyRequiredString(asString(value.label), context)
  if (key == null || label == null || !['host', 'entity', 'task'].includes(String(value.kind))) {
    return undefined
  }
  return {
    key,
    kind: value.kind as 'host' | 'entity' | 'task',
    label,
    ...copyOptionalString(value, 'avatar', context),
    ...copyOptionalString(value, 'subtitle', context)
  }
}

const copyRuntimeEventFields = (
  source: Record<string, unknown>,
  base: Pick<RuntimeEvent, 'id' | 'sessionId' | 'type'>,
  context: PublicProjectionContext
) => {
  const id = copyRequiredString(base.id, context)
  const sessionId = copyRequiredString(base.sessionId, context)
  const type = copyRequiredString(base.type, context)
  if (id == null || sessionId == null || type == null) return undefined
  const event: RuntimeEvent = { id, sessionId, type: type as RuntimeEvent['type'] }
  const copyString = (key: keyof RuntimeEvent) => {
    const value = asString(source[key])
    const copied = value == null ? undefined : copyPublicJson(value, 0, context)
    if (typeof copied === 'string') (event as Record<string, unknown>)[String(key)] = copied
  }
  const copyBoolean = (key: keyof RuntimeEvent) => {
    const value = asBoolean(source[key])
    if (value != null) (event as Record<string, unknown>)[String(key)] = value
  }
  const copyNumber = (key: keyof RuntimeEvent) => {
    const value = asNumber(source[key])
    if (value != null) (event as Record<string, unknown>)[String(key)] = value
  }

  for (const key of [
    'protocolVersion',
    'supportedProtocolRange',
    'visibility',
    'title',
    'parentSessionId',
    'status',
    'role',
    'summary',
    'publicSummary',
    'question',
    'requestId',
    'requestKind',
    'kind',
    'commandId',
    'causedByCommandId',
    'source',
    'sourceLabel',
    'error',
    'message',
    'adapter',
    'model',
    'artifactId',
    'path',
    'mimeType',
    'deliveryId',
    'deliveryState',
    'operationId',
    'roomId',
    'roomTitle',
    'hostSessionId',
    'memberKey',
    'memberKind',
    'memberLabel',
    'memberAvatar',
    'memberSubtitle',
    'runId',
    'runTitle'
  ] as const) copyString(key)
  for (const key of ['fatal', 'multiselect'] as const) copyBoolean(key)
  for (const key of ['seq', 'ts'] as const) copyNumber(key)

  const content = sanitizeContent(source.content, context)
  if (content != null) event.content = content
  const options = sanitizeOptions(source.options, context)
  if (options != null) event.options = options
  const permissionContext = sanitizePermissionContext(source.permissionContext, context)
  if (permissionContext != null) event.permissionContext = permissionContext
  const member = sanitizeMember(source.member, context)
  if (member != null) event.member = member
  return event
}

const buildPublicRuntimeAuditEvent = (
  event: RuntimeEvent,
  context: PublicProjectionContext
): RuntimeEvent | undefined => {
  if (!FAILURE_EVENT_TYPES.has(event.type)) {
    return copyRuntimeEventFields(event, {
      id: event.id,
      sessionId: event.sessionId,
      type: event.type
    }, context)
  }
  const publicError = sanitizeRuntimePublicErrorData({
    code: event.type === 'session_failed'
      ? event.code
      : event.code === CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE
      ? 'session_failed'
      : event.code,
    details: event.type === 'session_failed' ? event.details : undefined,
    fatal: event.fatal,
    message: asString(event.message) ??
      asString(event.error) ??
      asString(event.summary) ??
      asString(event.publicSummary) ??
      'Runtime operation failed'
  })
  const id = copyRequiredString(event.id, context)
  const sessionId = copyRequiredString(event.sessionId, context)
  if (id == null || sessionId == null) return undefined
  const publicMessage = publicError?.message == null
    ? undefined
    : copyRequiredString(publicError.message, context)
  const publicErrorMessage = publicError?.message == null
    ? undefined
    : copyRequiredString(publicError.message, context)
  return {
    id,
    sessionId,
    type: event.type,
    ...copyOptionalString(event, 'protocolVersion', context),
    ...copyOptionalString(event, 'supportedProtocolRange', context),
    ...(event.seq != null ? { seq: event.seq } : {}),
    ...(event.ts != null ? { ts: event.ts } : {}),
    ...copyOptionalString(event, 'visibility', context),
    ...copyOptionalString(event, 'commandId', context),
    ...copyOptionalString(event, 'causedByCommandId', context),
    ...copyOptionalString(event, 'operationId', context),
    ...copyOptionalString(event, 'runId', context),
    ...copyOptionalString(event, 'roomId', context),
    ...copyOptionalString(event, 'memberKey', context),
    ...(publicError?.code != null
      ? copyOptionalString({ code: publicError.code }, 'code', context)
      : {}),
    ...(publicMessage != null && publicErrorMessage != null
      ? { error: publicErrorMessage, message: publicMessage }
      : {}),
    ...(publicError?.fatal != null ? { fatal: publicError.fatal } : {}),
    ...(publicError != null && 'details' in publicError
      ? { details: copyPublicJson(publicError.details, 0, context) }
      : {})
  }
}

export const sanitizePublicRuntimeAuditEvent = (
  event: RuntimeEvent,
  context: PublicProjectionContext
) => projectPublicResponse(
  buildPublicRuntimeAuditEvent(event, context),
  context
) as RuntimeEvent | undefined

export const normalizePublicRuntimeEvent = (
  value: unknown,
  expectedSessionId: string | undefined,
  expectedWorkspaceFolder: string | undefined,
  expectedAdapter: string | undefined,
  context: PublicProjectionContext
): RuntimeEvent | undefined => {
  if (!isRecord(value)) return undefined
  const id = asString(value.id)
  const sessionId = asString(value.sessionId)
  const type = RuntimeEventTypeSchema.safeParse(value.type)
  if (
    id == null ||
    sessionId == null ||
    !type.success ||
    (expectedSessionId != null && sessionId !== expectedSessionId)
  ) return undefined
  // Server recovery grants are internal authorization records.  They must
  // never enter history, live channels, or any public transport envelope.
  if (type.data === 'project_config_recovery_granted') return undefined
  if (
    expectedAdapter != null &&
    asString(value.adapter) != null &&
    asString(value.adapter) !== expectedAdapter
  ) return undefined

  const publicEvent = FAILURE_EVENT_TYPES.has(type.data)
    ? buildPublicRuntimeAuditEvent(value as RuntimeEvent, context)
    : copyRuntimeEventFields(value, { id, sessionId, type: type.data }, context)
  if (publicEvent == null) return undefined
  if (
    expectedSessionId != null &&
    isRecord(publicEvent.details) &&
    publicEvent.details.sessionId !== expectedSessionId
  ) return undefined
  if (
    expectedWorkspaceFolder != null &&
    isRecord(publicEvent.details) &&
    publicEvent.details.workspaceFolder !== expectedWorkspaceFolder
  ) return undefined
  if (
    expectedAdapter != null &&
    isRecord(publicEvent.details) &&
    publicEvent.details.adapter !== expectedAdapter
  ) return undefined
  const validated = RuntimeEventDraftSchema.safeParse(publicEvent)
  return validated.success
    ? finalizeLocalProjection(validated.data as RuntimeEvent, context)
    : undefined
}

const sanitizeMessageContent = (
  value: unknown,
  context: PublicProjectionContext
): ChatMessage['content'] | undefined => {
  return sanitizeContent(value, context) as ChatMessage['content'] | undefined
}

const sanitizeChannelMessage = (
  value: unknown,
  context: PublicProjectionContext
): ChatMessage | undefined => {
  if (!isRecord(value)) return undefined
  const id = copyRequiredString(asString(value.id), context)
  const role = value.role
  const content = sanitizeMessageContent(value.content, context)
  if (id == null || !['system', 'user', 'assistant'].includes(String(role)) || content == null) {
    return undefined
  }
  return {
    id,
    role: role as ChatMessage['role'],
    content,
    ...(asNumber(value.createdAt) != null ? { createdAt: asNumber(value.createdAt)! } : {}),
    ...(asString(value.model) != null ? { model: asString(value.model)! } : {})
  }
}

const sanitizePublicChatMessage = (
  value: unknown,
  context: PublicProjectionContext
): ChatMessage | undefined => {
  if (!isRecord(value)) return undefined
  const id = copyRequiredString(asString(value.id), context)
  const content = sanitizeMessageContent(value.content, context)
  const createdAt = asNumber(value.createdAt)
  if (
    id == null ||
    content == null ||
    createdAt == null ||
    !['system', 'user', 'assistant'].includes(String(value.role))
  ) return undefined
  const agentRoomSource = isRecord(value.agentRoom) ? value.agentRoom : undefined
  const agentRoom = agentRoomSource != null
    ? Object.fromEntries([
        'source',
        'sourceLabel',
        'roomId',
        'hostSessionId',
        'memberKey',
        'runKey',
        'commandId',
        'causedByCommandId'
      ].flatMap(key => {
        const field = asString(agentRoomSource[key])
        const copied = field == null ? undefined : copyRequiredString(field, context)
        return copied == null ? [] : [[key, copied]]
      }))
    : undefined
  const usage = isRecord(value.usage) &&
      asNumber(value.usage.input_tokens) != null &&
      asNumber(value.usage.output_tokens) != null
    ? {
        input_tokens: asNumber(value.usage.input_tokens)!,
        output_tokens: asNumber(value.usage.output_tokens)!,
        ...copyOptionalNumber(value.usage, 'cache_read_input_tokens', context),
        ...copyOptionalNumber(value.usage, 'cache_creation_input_tokens', context)
      }
    : undefined
  const toolCallSource = isRecord(value.toolCall) ? value.toolCall : undefined
  const toolCallArgs = toolCallSource != null
    ? copyPublicJsonRecord(toolCallSource.args, context)
    : undefined
  const toolCallOutput = toolCallSource != null && 'output' in toolCallSource
    ? copyPublicJson(toolCallSource.output, 0, context)
    : undefined
  const toolCall = toolCallSource != null &&
      asString(toolCallSource.name) != null &&
      toolCallArgs != null
    ? (() => {
        const name = copyRequiredString(asString(toolCallSource.name), context)
        const status = toolCallSource.status === 'pending' ||
            toolCallSource.status === 'success' ||
            toolCallSource.status === 'error'
          ? copyRequiredString(toolCallSource.status, context)
          : undefined
        return name == null
          ? undefined
          : {
              ...copyOptionalString(toolCallSource, 'id', context),
              name,
              args: toolCallArgs,
              ...(status != null ? { status: status as 'pending' | 'success' | 'error' } : {}),
              ...(toolCallOutput !== undefined ? { output: toolCallOutput } : {})
            }
      })()
    : undefined
  const roomEventSource = isRecord(value.roomEvent) ? value.roomEvent : undefined
  const roomEventMember = sanitizeMember(roomEventSource?.member, context)
  const roomEventRunSource = isRecord(roomEventSource?.run) ? roomEventSource.run : undefined
  const roomEventRun = roomEventRunSource == null
    ? undefined
    : (() => {
        const key = copyRequiredString(asString(roomEventRunSource.key), context)
        const sessionId = copyRequiredString(asString(roomEventRunSource.sessionId), context)
        const title = copyRequiredString(asString(roomEventRunSource.title), context)
        return key == null || sessionId == null || title == null
          ? undefined
          : { key, sessionId, title }
      })()
  const roomEvent = roomEventSource != null && roomEventMember != null
    ? (() => {
        const summary = copyRequiredString(asString(roomEventSource.summary), context)
        const requestKind = roomEventSource.requestKind
        switch (roomEventSource.type) {
          case 'member_joined':
            return { type: 'member_joined' as const, member: roomEventMember }
          case 'assignment_sent':
            return roomEventRun != null && summary != null
              ? { type: 'assignment_sent' as const, member: roomEventMember, run: roomEventRun, summary }
              : undefined
          case 'attention_requested': {
            const options = sanitizeOptions(roomEventSource.options, context)
            return roomEventRun != null &&
                summary != null &&
                ['confirmation', 'input', 'progress'].includes(String(requestKind))
              ? {
                  type: 'attention_requested' as const,
                  member: roomEventMember,
                  run: roomEventRun,
                  summary,
                  requestKind: requestKind as 'confirmation' | 'input' | 'progress',
                  ...copyOptionalString(roomEventSource, 'interactionId', context),
                  ...(options != null ? { options } : {}),
                  ...(asBoolean(roomEventSource.multiselect) != null
                    ? { multiselect: asBoolean(roomEventSource.multiselect) }
                    : {})
                }
              : undefined
          }
          case 'run_replied':
            return roomEventRun != null &&
                summary != null &&
                ['confirmation', 'input', 'progress'].includes(String(requestKind))
              ? {
                  type: 'run_replied' as const,
                  member: roomEventMember,
                  run: roomEventRun,
                  summary,
                  requestKind: requestKind as 'confirmation' | 'input' | 'progress'
                }
              : undefined
          case 'run_resumed':
            return roomEventRun != null &&
                ['message', 'confirmation', 'input', 'permission_recovery']
                  .includes(String(roomEventSource.resumeKind))
              ? {
                  type: 'run_resumed' as const,
                  member: roomEventMember,
                  run: roomEventRun,
                  resumeKind: roomEventSource.resumeKind as
                    'message' | 'confirmation' | 'input' | 'permission_recovery',
                  ...(summary != null ? { summary } : {})
                }
              : undefined
          case 'run_completed':
            return roomEventRun != null
              ? {
                  type: 'run_completed' as const,
                  member: roomEventMember,
                  run: roomEventRun,
                  ...(summary != null ? { summary } : {})
                }
              : undefined
          case 'run_failed':
            return roomEventRun != null && summary != null
              ? { type: 'run_failed' as const, member: roomEventMember, run: roomEventRun, summary }
              : undefined
          default:
            return undefined
        }
      })()
    : undefined
  return {
    id,
    role: value.role as ChatMessage['role'],
    content,
    createdAt,
    ...copyOptionalString(value, 'model', context),
    ...(agentRoom != null && Object.keys(agentRoom).length > 0 ? { agentRoom } : {}),
    ...(usage != null ? { usage } : {}),
    ...(toolCall != null ? { toolCall } : {}),
    ...(roomEvent != null ? { roomEvent } : {})
  }
}

const sanitizeStringArray = (value: unknown, context: PublicProjectionContext) => {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return undefined
  const copied = copyPublicJson(value, 0, context)
  return Array.isArray(copied) ? copied as string[] : undefined
}

const sanitizeSessionInfo = (value: unknown, context: PublicProjectionContext) => {
  if (!isRecord(value)) return undefined
  if (value.type === 'summary') {
    const type = copyRequiredString('summary', context)
    const summary = copyRequiredString(asString(value.summary), context)
    const leafUuid = copyRequiredString(asString(value.leafUuid), context)
    return type == null || summary == null || leafUuid == null
      ? undefined
      : { type: type as 'summary', summary, leafUuid }
  }
  if (value.type !== 'init') return undefined
  const type = copyRequiredString('init', context)
  const uuid = copyRequiredString(asString(value.uuid), context)
  const model = copyRequiredString(asString(value.model), context)
  const version = copyRequiredString(asString(value.version), context)
  const cwd = copyRequiredString(asString(value.cwd), context)
  const tools = sanitizeStringArray(value.tools, context)
  const slashCommands = sanitizeStringArray(value.slashCommands, context)
  const agents = sanitizeStringArray(value.agents, context)
  if (
    type == null || uuid == null || model == null || version == null || cwd == null ||
    tools == null || slashCommands == null || agents == null
  ) return undefined
  return {
    type: type as 'init',
    uuid,
    model,
    version,
    cwd,
    tools,
    slashCommands,
    agents,
    ...copyOptionalString(value, 'adapter', context),
    ...copyOptionalString(value, 'account', context),
    ...copyOptionalString(value, 'effort', context),
    ...(asBoolean(value.fastMode) != null ? { fastMode: asBoolean(value.fastMode) } : {}),
    ...copyOptionalString(value, 'title', context)
  }
}

const sanitizeWorkspaceChanges = (
  value: unknown,
  expectedSessionId: string | undefined,
  context: PublicProjectionContext
) => {
  if (!isRecord(value)) return undefined
  const id = copyRequiredString(asString(value.id), context)
  const sessionId = copyRequiredString(asString(value.sessionId), context)
  const cwd = copyRequiredString(asString(value.cwd), context)
  const repositoryRoot = copyRequiredString(asString(value.repositoryRoot), context)
  const outcome = value.outcome
  const summary = isRecord(value.summary) ? value.summary : undefined
  if (
    id == null || sessionId == null || cwd == null || repositoryRoot == null ||
    (expectedSessionId != null && sessionId !== expectedSessionId) ||
    !['completed', 'failed', 'terminated'].includes(String(outcome)) ||
    summary == null ||
    asNumber(summary.changedFiles) == null ||
    asNumber(summary.additions) == null ||
    asNumber(summary.deletions) == null ||
    !Array.isArray(value.files)
  ) return undefined
  const files = value.files.map((item) => {
    if (!isRecord(item) || asString(item.path) == null) return undefined
    const filePath = copyRequiredString(asString(item.path), context)
    if (filePath == null) return undefined
    const diff = isRecord(item.diff) &&
        typeof item.diff.patch === 'string' &&
        typeof item.diff.truncated === 'boolean'
      ? (() => {
          const patch = copyRequiredString(item.diff.patch, context)
          return patch == null ? undefined : { patch, truncated: item.diff.truncated }
        })()
      : undefined
    return {
      path: filePath,
      staged: item.staged === true,
      unstaged: item.unstaged === true,
      untracked: item.untracked === true,
      additions: asNumber(item.additions) ?? 0,
      deletions: asNumber(item.deletions) ?? 0,
      ...(diff != null ? { diff } : {})
    }
  })
  if (files.some(item => item == null)) return undefined
  return {
    id,
    sessionId,
    cwd,
    repositoryRoot,
    startedAt: asNumber(value.startedAt) ?? 0,
    completedAt: asNumber(value.completedAt) ?? 0,
    createdAt: asNumber(value.createdAt) ?? 0,
    outcome: outcome as 'completed' | 'failed' | 'terminated',
    summary: {
      changedFiles: asNumber(summary.changedFiles)!,
      additions: asNumber(summary.additions)!,
      deletions: asNumber(summary.deletions)!
    },
    files
  }
}

const sanitizeSessionRecord = (
  value: unknown,
  expectedSessionId: string | undefined,
  context: PublicProjectionContext
) => {
  if (!isRecord(value)) return undefined
  const id = copyRequiredString(asString(value.id), context)
  if (id == null || (expectedSessionId != null && id !== expectedSessionId)) return undefined
  if (value.isDeleted === true) return { id, isDeleted: true as const }
  const createdAt = asNumber(value.createdAt)
  if (createdAt == null) return undefined
  const strings = [
    'parentSessionId',
    'messageBranchGroupId',
    'messageBranchSourceSessionId',
    'messageBranchSourceMessageId',
    'title',
    'lastMessage',
    'lastUserMessage',
    'model',
    'adapter',
    'account',
    'permissionMode',
    'effort',
    'promptType',
    'promptName'
  ] as const
  const session: Record<string, unknown> = { id, createdAt }
  for (const key of strings) Object.assign(session, copyOptionalString(value, key, context))
  for (const key of ['messageBranchBaseMessageIndex', 'messageCount'] as const) {
    Object.assign(session, copyOptionalNumber(value, key, context))
  }
  for (const key of ['isStarred', 'isArchived', 'fastMode'] as const) {
    const field = asBoolean(value[key])
    if (field != null) session[key] = field
  }
  const tags = sanitizeStringArray(value.tags, context)
  if (tags != null) session.tags = tags
  if (
    typeof value.status === 'string' &&
    ['running', 'completed', 'failed', 'terminated', 'waiting_input'].includes(value.status)
  ) {
    const status = copyRequiredString(value.status, context)
    if (status == null) return undefined
    session.status = status
  }
  if (
    typeof value.messageBranchAction === 'string' &&
    ['fork', 'recall', 'edit'].includes(value.messageBranchAction)
  ) {
    const action = copyRequiredString(value.messageBranchAction, context)
    if (action == null) return undefined
    session.messageBranchAction = action
  }
  const panelState = sanitizePanelState(value.panelState, context)
  if (panelState != null) session.panelState = panelState
  return session
}

const sanitizeQueuedMessage = (
  value: unknown,
  expectedSessionId: string | undefined,
  context: PublicProjectionContext
) => {
  if (!isRecord(value)) return undefined
  const id = copyRequiredString(asString(value.id), context)
  const sessionId = copyRequiredString(asString(value.sessionId), context)
  if (
    id == null || sessionId == null ||
    (expectedSessionId != null && sessionId !== expectedSessionId) ||
    !['steer', 'next'].includes(String(value.mode)) ||
    !Array.isArray(value.content)
  ) return undefined
  const content = value.content.map(item => sanitizeContentItem(item, context))
  if (content.some(item => item == null)) return undefined
  const createdAt = asNumber(value.createdAt)
  const updatedAt = asNumber(value.updatedAt)
  const order = asNumber(value.order)
  if (createdAt == null || updatedAt == null || order == null) return undefined
  const mode = copyRequiredString(value.mode, context)
  if (mode == null) return undefined
  return {
    id,
    sessionId,
    mode: mode as 'steer' | 'next',
    content: content as ChatMessageContent[],
    createdAt,
    updatedAt,
    order
  }
}

export const sanitizePublicSessionRecord = (
  value: unknown,
  expectedSessionId: string | undefined,
  context: PublicProjectionContext
) => finalizeLocalProjection(sanitizeSessionRecord(value, expectedSessionId, context), context)

export const sanitizePublicPanelState = (value: unknown, context: PublicProjectionContext) =>
  finalizeLocalProjection(sanitizePanelState(value, context), context)

export const sanitizePublicQueuedSessionMessage = (
  value: unknown,
  expectedSessionId: string | undefined,
  context: PublicProjectionContext
) => finalizeLocalProjection(sanitizeQueuedMessage(value, expectedSessionId, context), context)

export const sanitizePublicQueuedSessionContent = (
  value: unknown,
  context: PublicProjectionContext
) => {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const content = value.map(item => sanitizeContentItem(item, context))
  return content.every(item => item != null)
    ? finalizeLocalProjection(content as ChatMessageContent[], context)
    : undefined
}

const sanitizePanelTab = (value: unknown, context: PublicProjectionContext) => {
  if (!isRecord(value)) return undefined
  const id = copyRequiredString(asString(value.id), context)
  const title = copyRequiredString(asString(value.title), context)
  if (id == null || title == null || typeof value.kind !== 'string') return undefined
  const common = { id, title }
  switch (value.kind) {
    case 'web': {
      const url = copyRequiredString(asString(value.url), context)
      if (url == null) return undefined
      const history = sanitizeStringArray(value.history, context)
      const viewport = isRecord(value.viewport)
        ? {
            ...copyOptionalNumber(value.viewport, 'devicePixelRatio', context),
            ...copyOptionalString(value.viewport, 'deviceType', context),
            ...copyOptionalNumber(value.viewport, 'height', context),
            ...copyOptionalString(value.viewport, 'presetId', context),
            ...copyOptionalNumber(value.viewport, 'width', context),
            ...(value.viewport.zoom === 'auto' || asNumber(value.viewport.zoom) != null
              ? { zoom: value.viewport.zoom }
              : {})
          }
        : undefined
      return {
        ...common,
        kind: 'web' as const,
        url,
        ...copyOptionalString(value, 'browserControlRequestId', context),
        ...copyOptionalString(value, 'devtoolsDockSide', context),
        ...copyOptionalString(value, 'faviconUrl', context),
        ...copyOptionalNumber(value, 'historyIndex', context),
        ...copyOptionalString(value, 'variant', context),
        ...(asBoolean(value.deviceToolbarOpen) != null
          ? { deviceToolbarOpen: asBoolean(value.deviceToolbarOpen) }
          : {}),
        ...(asBoolean(value.inspectOpen) != null
          ? { inspectOpen: asBoolean(value.inspectOpen) }
          : {}),
        ...(history != null ? { history } : {}),
        ...(viewport != null ? { viewport } : {})
      }
    }
    case 'terminal': {
      const terminalId = copyRequiredString(asString(value.terminalId), context)
      return terminalId == null
        ? undefined
        : {
            ...common,
            kind: 'terminal' as const,
            terminalId,
            ...copyOptionalString(value, 'shellKind', context),
            ...(() => {
              const runCommand = copyPublicJson(value.runCommand, 0, context)
              return runCommand === undefined ? {} : { runCommand }
            })()
          }
    }
    case 'file': {
      const filePath = copyRequiredString(asString(value.path), context)
      return filePath == null ? undefined : { ...common, kind: 'file' as const, path: filePath }
    }
    case 'session':
      return {
        ...common,
        kind: 'session' as const,
        ...copyOptionalString(value, 'focusRequestId', context),
        ...copyOptionalString(value, 'sessionId', context)
      }
    case 'mobile-debug':
    case 'page-debugger':
      return {
        ...common,
        kind: value.kind,
        ...(() => {
          const state = value.kind === 'mobile-debug'
            ? copyPublicJson(value.state, 0, context)
            : undefined
          return state === undefined ? {} : { state }
        })()
      }
    case 'workspace-drawer': {
      const view = copyRequiredString(asString(value.view), context)
      return view == null ? undefined : { ...common, kind: 'workspace-drawer' as const, view }
    }
    case 'plugin': {
      const pluginScope = copyRequiredString(asString(value.pluginScope), context)
      const tabId = copyRequiredString(asString(value.tabId), context)
      const viewId = copyRequiredString(asString(value.viewId), context)
      return pluginScope == null || tabId == null || viewId == null
        ? undefined
        : {
            ...common,
            kind: 'plugin' as const,
            pluginScope,
            tabId,
            viewId,
            ...copyOptionalString(value, 'icon', context),
            ...copyOptionalNumber(value, 'stateVersion', context),
            ...(() => {
              const state = copyPublicJson(value.state, 0, context)
              return state === undefined ? {} : { state }
            })()
          }
    }
    default:
      return undefined
  }
}

function sanitizePanelState(value: unknown, context: PublicProjectionContext) {
  if (!isRecord(value)) return undefined
  const sanitizeArea = (area: unknown) => {
    if (!isRecord(area) || !Array.isArray(area.tabs)) return undefined
    const tabs = area.tabs.map(tab => sanitizePanelTab(tab, context))
    if (tabs.some(tab => tab == null)) return undefined
    return {
      tabs,
      ...copyOptionalString(area, 'activeTabId', context),
      ...(() => {
        const layout = copyPublicJson(area.layout, 0, context)
        return layout === undefined ? {} : { layout }
      })()
    }
  }
  const bottom = sanitizeArea(value.bottom)
  const right = sanitizeArea(value.right)
  return bottom == null || right == null ? undefined : { bottom, right }
}

const sanitizePublicNonErrorTransportEvent = (
  event: WSEvent,
  expectedSessionId: string | undefined,
  expectedWorkspaceFolder: string | undefined,
  expectedAdapter: string | undefined,
  context: PublicProjectionContext
): WSEvent | undefined => {
  const value = event as unknown as Record<string, unknown>
  switch (event.type) {
    case 'message': {
      const message = sanitizePublicChatMessage(value.message, context)
      return message == null ? undefined : { type: 'message', message }
    }
    case 'adapter_event': {
      const data = sanitizePublicAdapterEventData(
        value.data,
        expectedSessionId,
        expectedWorkspaceFolder,
        expectedAdapter,
        context
      )
      return data == null ? undefined : { type: 'adapter_event', data }
    }
    case 'operation_started':
    case 'operation_completed':
    case 'operation_failed': {
      const sessionId = asString(value.sessionId)
      if (expectedSessionId != null && sessionId != null && sessionId !== expectedSessionId) {
        return undefined
      }
      if (
        expectedAdapter != null &&
        asString(value.adapter) != null &&
        asString(value.adapter) !== expectedAdapter
      ) return undefined
      const publicSessionId = sessionId == null
        ? undefined
        : copyRequiredString(sessionId, context)
      if (sessionId != null && publicSessionId == null) return undefined
      return {
        type: event.type,
        ...copyOptionalString(value, 'adapter', context),
        ...copyOptionalString(value, 'error', context),
        ...copyOptionalString(value, 'id', context),
        ...copyOptionalString(value, 'message', context),
        ...copyOptionalString(value, 'operationId', context),
        ...(publicSessionId != null ? { sessionId: publicSessionId } : {}),
        ...copyOptionalString(value, 'status', context),
        ...copyOptionalString(value, 'summary', context),
        ...copyOptionalString(value, 'title', context),
        ...(asNumber(value.ts) != null ? { ts: asNumber(value.ts) } : {})
      }
    }
    case 'session_info': {
      const info = sanitizeSessionInfo(value.info, context)
      return info == null ? undefined : { type: 'session_info', info }
    }
    case 'tool_result': {
      const toolCallId = copyRequiredString(asString(value.toolCallId), context)
      return toolCallId == null || typeof value.isError !== 'boolean' || !('output' in value)
        ? undefined
        : (() => {
            const output = copyPublicJson(value.output, 0, context)
            return output === undefined ? undefined : {
              type: 'tool_result' as const,
              toolCallId,
              output,
              isError: value.isError
            }
          })()
    }
    case 'adapter_result':
      return 'result' in value
        ? (() => {
            const result = copyPublicJson(value.result, 0, context)
            const usage = 'usage' in value ? copyPublicJson(value.usage, 0, context) : undefined
            return result === undefined ? undefined : {
            type: 'adapter_result',
            result,
            ...(usage !== undefined ? { usage } : {})
          }
          })()
        : undefined
    case 'session_updated': {
      const session = sanitizeSessionRecord(value.session, expectedSessionId, context)
      return session == null ? undefined : { type: 'session_updated', session }
    }
    case 'config_updated': {
      const workspaceFolder = copyRequiredString(asString(value.workspaceFolder), context)
      const updatedAt = asNumber(value.updatedAt)
      return workspaceFolder == null || updatedAt == null
        ? undefined
        : { type: 'config_updated', workspaceFolder, updatedAt }
    }
    case 'workspace_panel_state_updated': {
      const panelState = sanitizePanelState(value.panelState, context)
      const updatedAt = asNumber(value.updatedAt)
      return panelState == null || updatedAt == null
        ? undefined
        : { type: 'workspace_panel_state_updated', panelState: panelState as never, updatedAt }
    }
    case 'session_creation_progress': {
      const sessionId = copyRequiredString(asString(value.sessionId), context)
      const progress = isRecord(value.progress) ? value.progress : undefined
      if (
        sessionId == null ||
        (expectedSessionId != null && sessionId !== expectedSessionId) ||
        progress == null ||
        !['worktree', 'environment', 'workspace'].includes(String(progress.phase)) ||
        !['running', 'success', 'error', 'skipped'].includes(String(progress.status)) ||
        asString(progress.step) == null
      ) return undefined
      const step = copyRequiredString(asString(progress.step), context)
      const phase = copyRequiredString(asString(progress.phase), context)
      const status = copyRequiredString(asString(progress.status), context)
      if (step == null || phase == null || status == null) return undefined
      return {
        type: 'session_creation_progress',
        sessionId,
        progress: {
          phase: phase as 'worktree' | 'environment' | 'workspace',
          step: step as never,
          status: status as 'running' | 'success' | 'error' | 'skipped',
          ...Object.fromEntries([
            'message',
            'worktreePath',
            'environmentId',
            'scriptPath',
            'scriptFileName',
            'stream',
            'output'
          ].flatMap(key => {
            const field = asString(progress[key])
            const copied = field == null ? undefined : copyRequiredString(field, context)
            return copied == null ? [] : [[key, copied]]
          }))
        }
      }
    }
    case 'session_queue_updated': {
      const queue = isRecord(value.queue) ? value.queue : undefined
      if (queue == null || !Array.isArray(queue.steer) || !Array.isArray(queue.next)) return undefined
      const steer = queue.steer.map(item => sanitizeQueuedMessage(item, expectedSessionId, context))
      const next = queue.next.map(item => sanitizeQueuedMessage(item, expectedSessionId, context))
      return steer.some(item => item == null) || next.some(item => item == null)
        ? undefined
        : { type: 'session_queue_updated', queue: { steer, next } as never }
    }
    case 'workspace_changes': {
      const changes = sanitizeWorkspaceChanges(value.changes, expectedSessionId, context)
      return changes == null ? undefined : { type: 'workspace_changes', changes }
    }
    case 'interaction_response': {
      const id = copyRequiredString(asString(value.id), context)
      const data = typeof value.data === 'string' ||
          (Array.isArray(value.data) && value.data.every(item => typeof item === 'string'))
        ? copyPublicJson(value.data, 0, context)
        : undefined
      return id == null ||
          (typeof data !== 'string' && !Array.isArray(data))
        ? undefined
        : { type: 'interaction_response', id, data: data as string | string[] }
    }
    case 'interaction_request': {
      const id = copyRequiredString(asString(value.id), context)
      const payload = value.payload
      if (!isRecord(payload) || id == null) return undefined
      const sessionId = copyRequiredString(asString(payload.sessionId), context)
      const question = copyRequiredString(asString(payload.question), context)
      if (
        sessionId == null || question == null ||
        (expectedSessionId != null && sessionId !== expectedSessionId)
      ) return undefined
      const options = sanitizeOptions(payload.options, context)
      const permissionContext = sanitizePermissionContext(payload.permissionContext, context)
      const kind = payload.kind === 'question' || payload.kind === 'permission'
        ? copyRequiredString(payload.kind, context)
        : undefined
      return {
        type: 'interaction_request',
        id,
        payload: {
          sessionId,
          question,
          ...(options != null ? { options } : {}),
          ...(asBoolean(payload.multiselect) != null
            ? { multiselect: asBoolean(payload.multiselect) }
            : {}),
          ...(kind != null
            ? { kind: kind as 'question' | 'permission' }
            : {}),
          ...(permissionContext != null ? { permissionContext } : {})
        }
      }
    }
    default:
      return undefined
  }
}

export const sanitizePublicStoredSessionEvent = (
  value: unknown,
  expectedSessionId: string,
  expectedWorkspaceFolder: string | undefined,
  expectedAdapter: string | undefined,
  context: PublicProjectionContext
): WSEvent | undefined => {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  return finalizeLocalProjection(
    buildPublicRuntimeTransportEvent(
      value as WSEvent,
      expectedSessionId,
      expectedWorkspaceFolder,
      expectedAdapter,
      context
    ),
    context
  )
}

const buildPublicAdapterEventData = (
  value: unknown,
  expectedSessionId: string | undefined,
  expectedWorkspaceFolder: string | undefined,
  expectedAdapter: string | undefined,
  context: PublicProjectionContext
): Record<string, unknown> | undefined => {
  if (!isRecord(value)) return undefined
  if ('runtimeEvent' in value) {
    const runtimeEvent = normalizePublicRuntimeEvent(
      value.runtimeEvent,
      expectedSessionId,
      expectedWorkspaceFolder,
      expectedAdapter,
      context
    )
    return runtimeEvent == null ? undefined : { runtimeEvent }
  }
  if (value.source === 'adapter' && (
    value.type === 'context_compaction' || value.type === 'contextCompaction'
  )) {
    if (expectedAdapter != null && asString(value.adapter) != null && asString(value.adapter) !== expectedAdapter) {
      return undefined
    }
    return {
      source: 'adapter',
      type: value.type,
      ...copyOptionalString(value, 'adapter', context),
      ...copyOptionalString(value, 'id', context),
      ...(asNumber(value.createdAt) != null ? { createdAt: asNumber(value.createdAt) } : {}),
      ...(asNumber(value.tokenCount) != null ? { tokenCount: asNumber(value.tokenCount) } : {}),
      ...copyOptionalString(value, 'trigger', context)
    }
  }
  if (value.source === 'runtime_host_request_delivery') {
    const deliveryKey = copyRequiredString(asString(value.deliveryKey), context)
    if (deliveryKey == null) return undefined
    return {
      source: 'runtime_host_request_delivery',
      deliveryKey,
      ...Object.fromEntries([
        'runtimeEventId',
        'childSessionId',
        'runKey',
        'interactionId',
        'requestKind'
      ].flatMap(key => {
        const field = asString(value[key])
        const copied = field == null ? undefined : copyRequiredString(field, context)
        return copied == null ? [] : [[key, copied]]
      })),
      ...(asNumber(value.runtimeEventSeq) != null
        ? { runtimeEventSeq: asNumber(value.runtimeEventSeq) }
        : {}),
      ...(asNumber(value.createdAt) != null ? { createdAt: asNumber(value.createdAt) } : {})
    }
  }
  if (value.source === 'server' && value.type === 'channel_session_stop') {
    const message = value.message == null ? undefined : sanitizeChannelMessage(value.message, context)
    if (value.message != null && message == null) return undefined
    return {
      source: 'server',
      type: 'channel_session_stop',
      ...(message != null ? { message } : {})
    }
  }
  return undefined
}

export const sanitizePublicAdapterEventData = (
  value: unknown,
  expectedSessionId: string | undefined,
  expectedWorkspaceFolder: string | undefined,
  expectedAdapter: string | undefined,
  context: PublicProjectionContext
) => finalizeLocalProjection(
  buildPublicAdapterEventData(
    value,
    expectedSessionId,
    expectedWorkspaceFolder,
    expectedAdapter,
    context
  ),
  context
)

const buildPublicRuntimeTransportEvent = (
  event: WSEvent,
  expectedSessionId: string | undefined,
  expectedWorkspaceFolder: string | undefined,
  expectedAdapter: string | undefined,
  context: PublicProjectionContext
): WSEvent | undefined => {
  if (event.type !== 'error') {
    return sanitizePublicNonErrorTransportEvent(
      event,
      expectedSessionId,
      expectedWorkspaceFolder,
      expectedAdapter,
      context
    )
  }
  const message = typeof event.data?.message === 'string'
    ? event.data.message
    : typeof event.message === 'string'
    ? event.message
    : 'Session failed'
  const data = sanitizeRuntimePublicErrorData({
    code: event.data?.code ?? 'session_failed',
    details: event.data?.details,
    fatal: event.data?.fatal,
    message
  })
  const authoritativeData = data != null &&
      'details' in data &&
      (
        (expectedSessionId != null && data.details.sessionId !== expectedSessionId) ||
        (
          expectedWorkspaceFolder != null &&
          data.details.workspaceFolder !== expectedWorkspaceFolder
        ) ||
        (expectedAdapter != null && data.details.adapter !== expectedAdapter)
      )
    ? { code: 'session_failed', fatal: true, message }
    : data
  const publicMessage = copyRequiredString(message, context)
  const publicData = copyPublicJsonRecord(authoritativeData ?? {
    code: 'session_failed',
    fatal: event.data?.fatal,
    message
  }, context)
  if (publicMessage == null || publicData == null) return undefined
  return {
    type: 'error',
    data: publicData as Extract<WSEvent, { type: 'error' }>['data'],
    message: publicMessage
  }
}

export const sanitizePublicRuntimeTransportEvent = (
  event: WSEvent,
  expectedSessionId: string | undefined,
  expectedWorkspaceFolder: string | undefined,
  expectedAdapter: string | undefined,
  context: PublicProjectionContext
) => projectPublicResponse(
  buildPublicRuntimeTransportEvent(
    event,
    expectedSessionId,
    expectedWorkspaceFolder,
    expectedAdapter,
    context
  ),
  context
) as WSEvent | undefined
