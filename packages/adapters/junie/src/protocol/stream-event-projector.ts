/* eslint-disable max-lines -- The pinned wire projector keeps terminal-state transitions auditable together. */
import { projectJunieStep } from './stream-step'
import type { JunieJsonStreamParserOptions, JunieJsonStreamParserResult } from './types'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const asText = (value: unknown) => (
  typeof value === 'string' && value !== '' ? value : undefined
)

const asTimestamp = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : Date.now()
)

const normalizeType = (value: string) => value.replace(/[^a-z0-9]+/giu, '').toLowerCase()

const TERMINAL_PREFIXES = ['agent', 'run', 'session', 'task']
const TERMINAL_SUFFIXES = ['completed', 'finished', 'terminated', 'stopped', 'ended']

const isTerminalShapedUnknown = (eventType: string) => (
  eventType.includes('terminal') || TERMINAL_PREFIXES.some(prefix => (
    TERMINAL_SUFFIXES.some(suffix => eventType.includes(`${prefix}${suffix}`))
  ))
)

const isFailureShapedUnknown = (eventType: string) => (
  ['failure', 'fatal', 'error'].some(marker => eventType.includes(marker))
)

const uniqueText = (...values: Array<string | undefined>) => (
  Array.from(new Set(values.filter((value): value is string => value != null))).join('\n')
)

const RESULT_USAGE_NUMBER_FIELDS = [
  'cost',
  'inputTokens',
  'cacheInputTokens',
  'cacheCreateTokens',
  'outputTokens'
] as const

const validateResultUsage = (value: unknown, index: number) => {
  if (!isRecord(value)) return `errorCode[${index}] must be an object`
  if (typeof value.model !== 'string') return `errorCode[${index}].model must be a string`
  if (!Number.isInteger(value.calls) || (value.calls as number) < 0) {
    return `errorCode[${index}].calls must be a non-negative integer`
  }
  for (const field of RESULT_USAGE_NUMBER_FIELDS) {
    const fieldValue = value[field]
    if (fieldValue != null && (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue) || fieldValue < 0)) {
      return `errorCode[${index}].${field} must be null or a non-negative finite number`
    }
  }
  return undefined
}

const validateTerminalResult = (value: Record<string, unknown>) => {
  if (!Object.prototype.hasOwnProperty.call(value, 'result') || typeof value.result !== 'string') {
    return 'result must be present and must be a string'
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'errorCode') || !Array.isArray(value.errorCode)) {
    return 'errorCode must be present and must be the pinned LlmUsageOutput array'
  }
  for (const [index, usage] of value.errorCode.entries()) {
    const issue = validateResultUsage(usage, index)
    if (issue != null) return issue
  }
  return undefined
}

export const createJunieCliStreamEventProjector = (options: JunieJsonStreamParserOptions) => {
  let eventCount = 0
  let didFatalError = false
  let didResult = false
  let didStop = false
  let sessionId: string | undefined

  const emitStop = (line: number) => {
    if (didStop) {
      options.onDiagnostic({
        code: 'duplicate_terminal',
        line,
        message: 'Junie emitted more than one terminal event; the duplicate was ignored.'
      })
      return
    }
    didStop = true
    options.onEvent({ type: 'stop' })
  }

  const emitFatal = (message: string, code: string, details: unknown, line: number) => {
    if (didFatalError) return
    didFatalError = true
    options.onEvent({ type: 'error', data: { message, code, details, fatal: true } })
    emitStop(line)
  }

  const emitAssistantText = (id: string, content: string, createdAt: number) => {
    if (content === '') return
    options.onEvent({
      type: 'message',
      data: {
        id,
        role: 'assistant',
        content,
        createdAt,
        ...(options.model == null ? {} : { model: options.model })
      }
    })
  }

  const handle = (value: unknown, line: number) => {
    if (!isRecord(value)) {
      emitFatal('Junie json-stream emitted a non-object event.', 'junie_protocol_invalid_event', value, line)
      return
    }
    eventCount += 1
    const rawType = asString(value.type)
    if (rawType == null) {
      emitFatal('Junie json-stream event is missing a type discriminator.', 'junie_protocol_missing_type', value, line)
      return
    }
    const eventType = normalizeType(rawType)
    const createdAt = asTimestamp(value.timestamp)
    if (didStop) {
      if (eventType === 'result') {
        const resultIssue = validateTerminalResult(value)
        if (resultIssue != null) {
          emitFatal(
            `Junie emitted an incompatible terminal result: ${resultIssue}.`,
            'junie_protocol_invalid_result',
            { issue: resultIssue },
            line
          )
          return
        }
        emitStop(line)
        return
      }
      if (eventType === 'error') {
        emitFatal(
          uniqueText(asText(value.message), asText(value.details), asText(value.output)) ||
            'Junie reported an error after its result event.',
          'junie_cli_error',
          value,
          line
        )
        return
      }
      if (isFailureShapedUnknown(eventType) || isTerminalShapedUnknown(eventType)) {
        emitFatal(
          `Unsupported terminal Junie event "${rawType}" after result; update One Works or pin a compatible Junie CLI.`,
          'junie_protocol_unknown_terminal',
          value,
          line
        )
        return
      }
      options.onDiagnostic({
        code: 'post_terminal_event',
        eventType: rawType,
        line,
        message: `Ignored Junie event "${rawType}" after the terminal event.`
      })
      return
    }

    if (!['session', 'step', 'system', 'error', 'result'].includes(eventType)) {
      if (isFailureShapedUnknown(eventType) || isTerminalShapedUnknown(eventType)) {
        emitFatal(
          `Unsupported terminal Junie event "${rawType}"; update One Works or pin a compatible Junie CLI.`,
          'junie_protocol_unknown_terminal',
          value,
          line
        )
        return
      }
      options.onDiagnostic({
        code: 'unknown_event',
        eventType: rawType,
        line,
        message: `Ignored unknown non-terminal Junie event "${rawType}".`
      })
      return
    }
    if (eventType === 'session') {
      const nextSessionId = asString(value.sessionId)
      if (nextSessionId == null) {
        emitFatal(
          'Junie session event did not include its required native sessionId.',
          'junie_protocol_session_id_missing',
          value,
          line
        )
        return
      }
      if (options.expectedSessionId != null && nextSessionId !== options.expectedSessionId) {
        emitFatal(
          `Junie resumed a different native session than requested: expected "${options.expectedSessionId}", received "${nextSessionId}".`,
          'junie_protocol_session_id_mismatch',
          { expectedSessionId: options.expectedSessionId, receivedSessionId: nextSessionId },
          line
        )
        return
      }
      if (sessionId != null && nextSessionId !== sessionId) {
        emitFatal(
          `Junie changed native session id within one turn: expected "${sessionId}", received "${nextSessionId}".`,
          'junie_protocol_session_id_changed',
          { expectedSessionId: sessionId, receivedSessionId: nextSessionId },
          line
        )
        return
      }
      if (sessionId == null) {
        sessionId = nextSessionId
        options.onSessionId(nextSessionId)
      }
      return
    }
    if (eventType === 'step') {
      projectJunieStep({ createdAt, event: value, eventCount, emitAssistantText, options })
      return
    }
    if (eventType === 'system') {
      emitAssistantText(
        `junie-system-${createdAt}-${eventCount}`,
        uniqueText(asText(value.message), asText(value.details), asText(value.output)),
        createdAt
      )
      return
    }
    if (eventType === 'error') {
      emitFatal(
        uniqueText(asText(value.message), asText(value.details), asText(value.output)) || 'Junie reported an error.',
        'junie_cli_error',
        value,
        line
      )
      return
    }
    const resultIssue = validateTerminalResult(value)
    if (resultIssue != null) {
      emitFatal(
        `Junie emitted an incompatible terminal result: ${resultIssue}.`,
        'junie_protocol_invalid_result',
        { issue: resultIssue },
        line
      )
      return
    }
    didResult = true
    emitAssistantText(`junie-result-${createdAt}-${eventCount}`, asText(value.result) ?? '', createdAt)
    emitStop(line)
  }

  const failInvalidJson = (input: { error: unknown; line: number; raw: string }) => {
    emitFatal(
      `Invalid Junie json-stream JSON on line ${input.line}: ${
        input.error instanceof Error ? input.error.message : String(input.error)
      }`,
      'junie_protocol_invalid_json',
      { line: input.raw },
      input.line
    )
  }

  const result = (): JunieJsonStreamParserResult => ({
    didFatalError,
    didResult,
    didStop,
    eventCount,
    ...(sessionId == null ? {} : { sessionId })
  })
  return { failInvalidJson, handle, result }
}
