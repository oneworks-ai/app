import { randomUUID } from 'node:crypto'

import {
  DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  RuntimeSessionCommandEnvelopeSchema,
  assertProtocolCompatible,
  getCurrentProtocolVersion
} from '@oneworks/runtime-protocol'
import type { RuntimeSessionCommandEnvelope, RuntimeSessionResultEnvelope } from '@oneworks/runtime-protocol'

const runtimeSessionCommandTypes = [
  'session.start',
  'session.message',
  'session.resume',
  'session.stop',
  'session.submit',
  'session.status',
  'session.events'
] as const satisfies readonly RuntimeSessionCommandEnvelope['type'][]

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const defaultProtocolFields = (input: unknown) => {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return input
  const record = input as Record<string, unknown>
  const payload = isRecord(record.payload) ? record.payload : {}
  return {
    protocolVersion: getCurrentProtocolVersion(),
    supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
    commandId: `cmdreq_${randomUUID()}`,
    source: 'cli',
    ...payload,
    ...record
  }
}

const isRuntimeSessionCommandType = (value: unknown): value is RuntimeSessionCommandEnvelope['type'] =>
  typeof value === 'string' &&
  runtimeSessionCommandTypes.includes(value as RuntimeSessionCommandEnvelope['type'])

const readStringField = (input: unknown, field: string) => {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = (input as Record<string, unknown>)[field]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

export const fallbackProtocolCommand = (input: unknown): RuntimeSessionCommandEnvelope => {
  const type = readStringField(input, 'type')
  return {
    protocolVersion: getCurrentProtocolVersion(),
    supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
    commandId: readStringField(input, 'commandId') ?? `cmdreq_${randomUUID()}`,
    type: isRuntimeSessionCommandType(type) ? type : 'session.status',
    sessionId: readStringField(input, 'sessionId')
  }
}

export const parseRuntimeProtocolCommand = (input: unknown) => {
  const command = RuntimeSessionCommandEnvelopeSchema.parse(
    defaultProtocolFields(input)
  ) as RuntimeSessionCommandEnvelope
  assertProtocolCompatible(command.protocolVersion, DEFAULT_SUPPORTED_PROTOCOL_RANGE)
  if (command.supportedProtocolRange != null) {
    assertProtocolCompatible(getCurrentProtocolVersion(), command.supportedProtocolRange)
  }
  return command
}

const resultType = (type: RuntimeSessionCommandEnvelope['type']) =>
  `${type}.result` as RuntimeSessionResultEnvelope['type']

export const toSuccessResult = (
  command: RuntimeSessionCommandEnvelope,
  result: Record<string, unknown>
): RuntimeSessionResultEnvelope => ({
  protocolVersion: getCurrentProtocolVersion(),
  supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  commandId: command.commandId,
  type: resultType(command.type),
  ok: true,
  sessionId: typeof result.sessionId === 'string' ? result.sessionId : command.sessionId,
  status: typeof result.status === 'string' ? result.status : undefined,
  storePath: typeof result.storePath === 'string' ? result.storePath : undefined,
  result
})

export const toErrorResult = (
  command: RuntimeSessionCommandEnvelope,
  error: unknown
): RuntimeSessionResultEnvelope => ({
  protocolVersion: getCurrentProtocolVersion(),
  supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  commandId: command.commandId,
  type: resultType(command.type),
  ok: false,
  sessionId: command.sessionId,
  error: error instanceof Error ? error.message : String(error)
})

export const requiredString = (
  command: RuntimeSessionCommandEnvelope,
  field: keyof RuntimeSessionCommandEnvelope
) => {
  const value = command[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${String(field)} is required for ${command.type}.`)
  }
  return value.trim()
}
