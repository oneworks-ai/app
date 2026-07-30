import type { AskUserQuestionParams, Session, WSEvent } from '@oneworks/core'
import {
  CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE,
  ProjectedRuntimeKnownErrorDataSchema
} from '@oneworks/runtime-protocol'

import { stripAnsi } from '#~/utils/strip-ansi'

export interface InteractionRequestState {
  id: string
  payload: AskUserQuestionParams
}

export interface ChatErrorState {
  action?: 'retry-session-creation'
  kind: 'connection' | 'session'
  message: string
  code?: string
  details?: unknown
  recoverable?: boolean
  reason?: 'error' | 'closed'
}

export interface FatalSessionErrorState {
  message: string
  code?: string
  details?: unknown
}

const normalizeErrorMessage = (value: string) => stripAnsi(value).trim()

export const getFatalSessionError = (event: WSEvent): FatalSessionErrorState | null => {
  if (event?.type !== 'error') {
    return null
  }

  if (event.data != null && typeof event.data === 'object' && 'fatal' in event.data && event.data.fatal === false) {
    return null
  }

  const rawCode = event.data != null && typeof event.data === 'object' &&
      'code' in event.data &&
      typeof event.data.code === 'string' &&
      event.data.code.trim() !== ''
    ? event.data.code
    : undefined
  const knownError = rawCode === CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE
    ? ProjectedRuntimeKnownErrorDataSchema.safeParse(event.data)
    : undefined
  const code = rawCode === CODEX_PROJECT_CONFIG_INVALID_ERROR_CODE && knownError?.success !== true
    ? 'session_failed'
    : rawCode
  const details = knownError?.success === true
    ? knownError.data.details
    : undefined

  if (event.data != null && typeof event.data === 'object' && 'message' in event.data) {
    const message = event.data.message
    if (typeof message === 'string') {
      const normalizedMessage = normalizeErrorMessage(message)
      if (normalizedMessage !== '') {
        return {
          message: normalizedMessage,
          code,
          details
        }
      }
    }
  }

  if (typeof event.message === 'string') {
    const normalizedMessage = normalizeErrorMessage(event.message)
    if (normalizedMessage !== '') {
      return {
        message: normalizedMessage,
        code,
        details
      }
    }
  }

  return null
}

export const applyInteractionStateEvent = (
  currentInteraction: InteractionRequestState | null,
  data: WSEvent
) => {
  if (data.type === 'interaction_request') {
    return currentInteraction ?? { id: data.id, payload: data.payload }
  }

  if (data.type === 'interaction_response') {
    return currentInteraction?.id === data.id || currentInteraction == null
      ? null
      : currentInteraction
  }

  if (data.type === 'session_updated') {
    const session = data.session as Session | { id: string; isDeleted: boolean }
    if ('isDeleted' in session) {
      return null
    }
    if (session.status !== 'waiting_input') {
      return null
    }
  }

  if (data.type === 'error' && data.data != null && typeof data.data === 'object' && 'fatal' in data.data) {
    return (data.data as { fatal?: boolean }).fatal !== false ? null : currentInteraction
  }

  return currentInteraction
}

const dataHasFatalError = (event: Extract<WSEvent, { type: 'error' }>) => (
  event.data != null &&
  typeof event.data === 'object' &&
  'fatal' in event.data &&
  (event.data as { fatal?: boolean }).fatal !== false
)

export const restoreInteractionStateFromHistory = (
  events: WSEvent[],
  fallbackInteraction: InteractionRequestState | null,
  sessionStatus?: Session['status']
) => {
  const pendingInteractions = new Map<string, InteractionRequestState>()

  for (const event of events) {
    if (event.type === 'interaction_request') {
      pendingInteractions.set(event.id, { id: event.id, payload: event.payload })
    } else if (event.type === 'interaction_response') {
      pendingInteractions.delete(event.id)
    } else if (event.type === 'session_updated') {
      const session = event.session as Session | { id: string; isDeleted: boolean }
      if ('isDeleted' in session || session.status !== 'waiting_input') {
        pendingInteractions.clear()
      }
    } else if (
      event.type === 'error' &&
      dataHasFatalError(event)
    ) {
      pendingInteractions.clear()
    }
  }

  const currentInteraction = pendingInteractions.values().next().value ?? null
  if (currentInteraction != null) {
    return sessionStatus == null || sessionStatus === 'waiting_input' || sessionStatus === 'running'
      ? currentInteraction
      : null
  }

  return sessionStatus === 'waiting_input' ? fallbackInteraction : null
}

export const findLatestFatalError = (events: WSEvent[]): FatalSessionErrorState | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const resolved = getFatalSessionError(events[index]!)
    if (resolved != null) {
      return resolved
    }
  }

  return null
}
