import type { WSEvent } from '@oneworks/core'
import {
  CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE,
  CodexProjectConfigInvalidDetailsSchema,
  ProjectedCodexProjectConfigInvalidDetailsSchema
} from '@oneworks/runtime-protocol'

import type { RuntimeEvent } from './types.js'

const getNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const getParsedErrorMessage = (value: string) => {
  const trimmed = value.trim()
  const candidates = Array.from(
    new Set([
      trimmed,
      trimmed.split(/\r?\n/, 1)[0] ?? ''
    ].filter(candidate => candidate !== ''))
  )

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>
        const error = record.error
        if (error != null && typeof error === 'object' && !Array.isArray(error)) {
          const message = getNonEmptyString((error as Record<string, unknown>).message)
          if (message != null) return message
        }

        const message = getNonEmptyString(record.message)
        if (message != null) return message

        const errorText = getNonEmptyString(error)
        if (errorText != null) return errorText
      }
    } catch {
      // Runtime adapters may append diagnostic suffixes after JSON payloads.
    }
  }

  return undefined
}

const getRuntimeFailureMessage = (event: RuntimeEvent) => {
  const raw = getNonEmptyString(event.error) ??
    getNonEmptyString(event.message) ??
    getNonEmptyString(event.summary) ??
    getNonEmptyString(event.publicSummary)
  if (raw == null) return 'Session failed'

  return getParsedErrorMessage(raw) ?? raw
}

export const buildRuntimeFailureErrorEvent = (event: RuntimeEvent): Extract<WSEvent, { type: 'error' }> => {
  const message = getRuntimeFailureMessage(event)
  const knownDetails = event.code === CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE
    ? CodexProjectConfigInvalidDetailsSchema.safeParse(event.details)
    : undefined
  const projectedDetails = knownDetails?.success === true
    ? ProjectedCodexProjectConfigInvalidDetailsSchema.safeParse({
      ...knownDetails.data,
      runtimeEventId: event.id,
      runtimeEventSeq: event.seq
    })
    : undefined
  if (projectedDetails?.success === true) {
    return {
      type: 'error',
      message,
      data: {
        code: CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE,
        details: projectedDetails.data,
        fatal: true,
        message
      }
    }
  }

  const malformedKnownError = event.code === CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE
  const safeCode = malformedKnownError
    ? 'session_failed'
    : getNonEmptyString(event.code) ?? 'session_failed'

  return {
    type: 'error',
    message,
    data: {
      code: safeCode,
      fatal: event.fatal ?? true,
      message
    }
  }
}
