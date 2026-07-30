import type { ChatMessage, ChatMessageContent, Session, WSEvent } from '@oneworks/core'

import { getDb } from '#~/db/index.js'
import {
  createPublicProjectionContext,
  sanitizePublicRuntimeTransportEvent
} from '#~/services/runtime-store/public-runtime-event.js'

export interface SessionEventCallbacks {
  broadcast?: (event: WSEvent) => void
  onSessionUpdated?: (session: Session) => void
}

export const sanitizePublicSessionEvent = (
  event: WSEvent,
  expectedSessionId: string | undefined,
  expectedWorkspaceFolder: string | undefined,
  expectedAdapter: string | undefined
) => sanitizePublicRuntimeTransportEvent(
  event,
  expectedSessionId,
  expectedWorkspaceFolder,
  expectedAdapter,
  createPublicProjectionContext()
)

export function extractTextFromMessage(message: ChatMessage): string | undefined {
  if (typeof message.content === 'string') {
    return message.content
  }
  if (Array.isArray(message.content)) {
    const textContent = message.content.find((c: ChatMessageContent) => c.type === 'text')
    if (textContent != null && 'text' in textContent) {
      return textContent.text
    }
    const fileContent = message.content.find((c): c is Extract<ChatMessageContent, { type: 'file' }> =>
      c.type === 'file'
    )
    if (fileContent != null) {
      return `Context file: ${fileContent.path}`
    }
  }
  return undefined
}

export function applySessionEvent(
  sessionId: string,
  event: WSEvent,
  callbacks: SessionEventCallbacks = {}
) {
  const db = getDb()
  // Do not let a caller choose the authority used to expose a runtime event.
  // This also re-projects legacy/database events before they can leave history.
  const authoritativeSession = db.getSession(sessionId)
  if (authoritativeSession == null) return
  const publicEvent = sanitizePublicSessionEvent(
    event,
    sessionId,
    db.getSessionWorkspace(sessionId)?.workspaceFolder,
    authoritativeSession.adapter
  )
  if (publicEvent == null) return
  if (publicEvent.type !== 'session_updated') {
    const didSave = db.saveMessage(sessionId, publicEvent)
    if (didSave === false) {
      return
    }
  }

  const updates: Partial<Omit<Session, 'id' | 'createdAt' | 'messageCount'>> = {}
  if (publicEvent.type === 'message') {
    const text = extractTextFromMessage(publicEvent.message)
    if (text != null && text !== '') {
      updates.lastMessage = text
      if (publicEvent.message.role === 'user') {
        updates.lastUserMessage = text
      }
    }
    updates.status = 'running'
  } else if (publicEvent.type === 'interaction_request') {
    updates.status = 'waiting_input'
  } else if (publicEvent.type === 'interaction_response') {
    updates.status = 'running'
  } else if (publicEvent.type === 'error') {
    if (publicEvent.data.fatal !== false) {
      updates.status = 'failed'
    }
  }

  if (Object.keys(updates).length > 0) {
    db.updateSession(sessionId, updates)
    const updated = db.getSession(sessionId)
    if (updated != null && callbacks.onSessionUpdated) {
      callbacks.onSessionUpdated(updated)
    }
  }

  if (callbacks.broadcast) {
    callbacks.broadcast(publicEvent)
  }
}
