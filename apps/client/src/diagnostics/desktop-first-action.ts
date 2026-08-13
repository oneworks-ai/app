import type { ChatMessage, SessionStatus } from '@oneworks/core'
import type { DesktopFirstActionMilestone } from '@oneworks/types'

import { isChatMessageDisplayable } from '#~/components/chat/messages/message-renderability'

export type DesktopFirstActionObservationSource = 'client-events' | 'session-live'

export interface DesktopFirstActionReporter {
  accepted: (sessionId: string, actionId: string) => void
  messageObserved: (
    sessionId: string,
    message: ChatMessage | null | undefined,
    source?: DesktopFirstActionObservationSource
  ) => void
  restore: (
    sessionId: string,
    messages: ChatMessage[],
    status: SessionStatus | undefined
  ) => void
  resetSource: (source: DesktopFirstActionObservationSource, sessionId?: string) => void
  statusObserved: (
    sessionId: string,
    status: SessionStatus,
    source?: DesktopFirstActionObservationSource
  ) => void
  submitted: (sessionId: string, actionId: string) => boolean
  succeeded: (sessionId: string, source?: DesktopFirstActionObservationSource) => void
  terminated: (sessionId: string, actionId: string) => void
}

interface SubmittedSessionState {
  actionId: string
  sources: Map<DesktopFirstActionObservationSource, {
    actionObserved: boolean
    closed: boolean
  }>
}

const isNonEmptySessionId = (sessionId: string) => sessionId.trim() !== ''
const isNonEmptyActionId = (actionId: string) => actionId.trim() !== ''

export const createDesktopFirstActionId = () => {
  const randomId = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  return `client-action-${randomId}`
}

export const isDisplayableAssistantResponse = (message: ChatMessage | null | undefined) => {
  return message?.role === 'assistant' && isChatMessageDisplayable(message)
}

export const createDesktopFirstActionReporter = (
  emit: (milestone: DesktopFirstActionMilestone) => void
): DesktopFirstActionReporter => {
  const emittedMilestones = new Set<DesktopFirstActionMilestone>()
  const sessions = new Map<string, SubmittedSessionState>()
  let firstSessionId: string | undefined
  let superseded = false
  let terminalOutcome: 'failed' | 'success' | 'terminated' | undefined

  const emitOnce = (milestone: DesktopFirstActionMilestone) => {
    if (emittedMilestones.has(milestone)) return
    emittedMilestones.add(milestone)
    emit(milestone)
  }

  const stateFor = (sessionId: string) => {
    if (sessionId !== firstSessionId) return
    return sessions.get(sessionId)
  }

  const sourceStateFor = (
    sessionId: string,
    source: DesktopFirstActionObservationSource
  ) => {
    const state = stateFor(sessionId)
    if (state == null) return
    let sourceState = state.sources.get(source)
    if (sourceState == null) {
      sourceState = { actionObserved: false, closed: false }
      state.sources.set(source, sourceState)
    }
    return { sourceState, state }
  }

  const messageObserved = (
    sessionId: string,
    message: ChatMessage | null | undefined,
    source: DesktopFirstActionObservationSource = 'session-live'
  ) => {
    const resolved = sourceStateFor(sessionId, source)
    if (resolved == null || message == null) return
    const { sourceState, state } = resolved

    if (message.role === 'user') {
      if (message.id === state.actionId) {
        sourceState.actionObserved = true
      } else if (sourceState.actionObserved) {
        sourceState.closed = true
        superseded = true
      }
      return
    }
    if (
      superseded || terminalOutcome != null || sourceState.closed || !sourceState.actionObserved ||
      !isDisplayableAssistantResponse(message)
    ) return

    emitOnce('first.response.received')
  }

  const statusObserved = (
    sessionId: string,
    status: SessionStatus,
    source: DesktopFirstActionObservationSource = 'session-live'
  ) => {
    const resolved = sourceStateFor(sessionId, source)
    if (
      superseded || terminalOutcome != null || resolved?.sourceState.actionObserved !== true ||
      resolved.sourceState.closed
    ) return
    if (status === 'completed') {
      terminalOutcome = 'success'
      emitOnce('first.success')
    } else if (status === 'failed') {
      terminalOutcome = 'failed'
      emitOnce('first.failed')
    } else if (status === 'terminated') {
      terminalOutcome = 'terminated'
      emitOnce('first.terminated')
    }
  }

  return {
    accepted: (sessionId, actionId) => {
      const state = stateFor(sessionId)
      if (state == null || state.actionId !== actionId) return
      emitOnce('submit.accepted')
    },
    messageObserved,
    restore: (sessionId, messages, status) => {
      const state = stateFor(sessionId)
      if (state == null) return
      const actionIndex = messages.findIndex(message => message.role === 'user' && message.id === state.actionId)
      if (actionIndex < 0) return
      const laterMessages = messages.slice(actionIndex + 1)
      const nextUserIndex = laterMessages.findIndex(message => message.role === 'user')
      const firstTurnMessages = nextUserIndex < 0 ? laterMessages : laterMessages.slice(0, nextUserIndex)
      if (firstTurnMessages.some(isDisplayableAssistantResponse)) {
        emitOnce('first.response.received')
      }
      if (nextUserIndex >= 0) {
        superseded = true
        return
      }
      if (superseded || terminalOutcome != null) return
      if (status === 'completed') {
        terminalOutcome = 'success'
        emitOnce('first.success')
      } else if (status === 'failed') {
        terminalOutcome = 'failed'
        emitOnce('first.failed')
      } else if (status === 'terminated') {
        terminalOutcome = 'terminated'
        emitOnce('first.terminated')
      }
    },
    resetSource: (source, sessionId) => {
      if (sessionId != null && sessionId !== firstSessionId) return
      const state = firstSessionId == null ? undefined : sessions.get(firstSessionId)
      state?.sources.delete(source)
    },
    statusObserved,
    submitted: (sessionId, actionId) => {
      if (!isNonEmptySessionId(sessionId) || !isNonEmptyActionId(actionId)) return false
      firstSessionId ??= sessionId
      if (sessionId !== firstSessionId) return false
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, {
          actionId,
          sources: new Map()
        })
      }
      if (sessions.get(sessionId)?.actionId !== actionId) return false
      emitOnce('first.submit')
      return true
    },
    succeeded: (sessionId, source) => statusObserved(sessionId, 'completed', source),
    terminated: (sessionId, actionId) => {
      const state = stateFor(sessionId)
      if (state == null || state.actionId !== actionId || terminalOutcome != null) return
      terminalOutcome = 'terminated'
      emitOnce('first.terminated')
    }
  }
}
