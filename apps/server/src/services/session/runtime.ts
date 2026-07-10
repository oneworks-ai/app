import type {
  AskUserQuestionParams,
  EffortLevel,
  Session,
  SessionPanelState,
  SessionPermissionMode,
  WSEvent
} from '@oneworks/core'
import type { AdapterSession, SessionCreationProgressEvent, SessionPromptType } from '@oneworks/types'
import { WebSocket as WebSocketImpl } from 'ws'
import type { WebSocket } from 'ws'

import { getDb } from '#~/db/index.js'
import { publishClientEvent } from '#~/services/client-events.js'
import { safeJsonStringify } from '#~/utils/json.js'

export interface SessionInteractionState {
  id: string
  payload: AskUserQuestionParams
}

export interface SessionQueueRuntimeState {
  nextInterruptRequested: boolean
  nextInterruptPending: boolean
}

export interface SessionConnectionState {
  sockets: Set<WebSocket>
  messages: WSEvent[]
  currentInteraction?: SessionInteractionState
  queueRuntime: SessionQueueRuntimeState
}

export interface AdapterSessionConfig {
  runId: string
  model?: string
  adapter?: string
  account?: string
  permissionMode?: SessionPermissionMode
  effort?: EffortLevel
  fastMode?: boolean
  promptType?: SessionPromptType
  promptName?: string
  seededFromHistory?: boolean
}

export interface AdapterSessionRuntime extends SessionConnectionState {
  session: AdapterSession
  config?: AdapterSessionConfig
}

export interface PendingSessionInteraction {
  resolve: (data: string | string[]) => void
  reject: (reason: unknown) => void
  timer: NodeJS.Timeout
}

export const adapterSessionStore = new Map<string, AdapterSessionRuntime>()
export const externalSessionStore = new Map<string, SessionConnectionState>()
export const sessionSubscriberSockets = new Set<WebSocket>()
export const pendingSessionInteractionStore = new Map<string, PendingSessionInteraction>()

const sendEventToSockets = (sockets: Iterable<WebSocket>, event: WSEvent) => {
  const payload = safeJsonStringify(event)
  for (const socket of sockets) {
    if (socket.readyState === WebSocketImpl.OPEN) {
      socket.send(payload)
    }
  }
}

export function createSessionConnectionState(): SessionConnectionState {
  return {
    sockets: new Set<WebSocket>(),
    messages: [],
    queueRuntime: {
      nextInterruptRequested: false,
      nextInterruptPending: false
    }
  }
}

export function bindAdapterSessionRuntime(
  connectionState: SessionConnectionState,
  session: AdapterSession,
  config?: AdapterSessionConfig
): AdapterSessionRuntime {
  return Object.assign(connectionState, { session, config })
}

export function getAdapterSessionRuntime(sessionId: string) {
  return adapterSessionStore.get(sessionId)
}

export function setAdapterSessionRuntime(sessionId: string, runtime: AdapterSessionRuntime) {
  adapterSessionStore.set(sessionId, runtime)
  return runtime
}

export function deleteAdapterSessionRuntime(sessionId: string) {
  adapterSessionStore.delete(sessionId)
}

export function parkAdapterSessionRuntime(sessionId: string) {
  const runtime = adapterSessionStore.get(sessionId)
  if (runtime == null) {
    return undefined
  }

  const parked: SessionConnectionState = {
    sockets: runtime.sockets,
    messages: runtime.messages,
    currentInteraction: runtime.currentInteraction,
    queueRuntime: runtime.queueRuntime
  }
  externalSessionStore.set(sessionId, parked)
  adapterSessionStore.delete(sessionId)
  return parked
}

export function getExternalSessionRuntime(sessionId: string) {
  return externalSessionStore.get(sessionId)
}

export function takeExternalSessionRuntime(sessionId: string) {
  const runtime = externalSessionStore.get(sessionId)
  if (runtime == null) {
    return undefined
  }

  externalSessionStore.delete(sessionId)
  return runtime
}

export function ensureExternalSessionRuntime(sessionId: string) {
  const existing = externalSessionStore.get(sessionId)
  if (existing != null) {
    return existing
  }

  const created = createSessionConnectionState()
  externalSessionStore.set(sessionId, created)
  return created
}

export function deleteExternalSessionRuntime(sessionId: string) {
  externalSessionStore.delete(sessionId)
}

export function getSessionConnectionState(sessionId: string) {
  return adapterSessionStore.get(sessionId) ?? externalSessionStore.get(sessionId)
}

export function getSessionQueueRuntimeState(sessionId: string) {
  return getSessionConnectionState(sessionId)?.queueRuntime
}

export function emitRuntimeEvent(
  runtime: SessionConnectionState,
  event: WSEvent,
  options: { recordMessage?: boolean } = {}
) {
  if (options.recordMessage !== false) {
    runtime.messages.push(event)
  }

  sendEventToSockets(runtime.sockets, event)
}

export function broadcastSessionEvent(sessionId: string, event: WSEvent) {
  const adapterRuntime = adapterSessionStore.get(sessionId)
  if (adapterRuntime != null) {
    emitRuntimeEvent(adapterRuntime, event)
  }

  const externalRuntime = externalSessionStore.get(sessionId)
  if (externalRuntime != null) {
    emitRuntimeEvent(externalRuntime, event)
  }

  publishClientEvent('sessions', {
    type: event.type === 'message' ? 'session_message_appended' : 'session_event_appended',
    sessionId,
    event
  })
}

export function notifySessionUpdated(sessionId: string, session: Session | { id: string; isDeleted: boolean }) {
  const event: WSEvent = { type: 'session_updated', session }
  const runtime = getSessionConnectionState(sessionId)

  sendEventToSockets(runtime?.sockets ?? [], event)
  sendEventToSockets(sessionSubscriberSockets, event)
  publishClientEvent('sessions', {
    type: 'session_updated',
    sessionId,
    session
  })
}

export function notifyConfigUpdated(workspaceFolder: string) {
  const event = {
    type: 'config_updated',
    workspaceFolder,
    updatedAt: Date.now()
  } as const
  sendEventToSockets(sessionSubscriberSockets, event)
  publishClientEvent('config', event)
}

export function notifyWorkspacePanelStateUpdated(panelState: SessionPanelState, updatedAt: number) {
  const event = {
    type: 'workspace_panel_state_updated',
    panelState,
    updatedAt
  } as const
  sendEventToSockets(sessionSubscriberSockets, event)
  publishClientEvent('workspace', event)
}

export function notifySessionCreationProgress(sessionId: string, progress: SessionCreationProgressEvent) {
  const event: WSEvent = { type: 'session_creation_progress', sessionId, progress }
  const payload = safeJsonStringify(event)
  const runtime = getSessionConnectionState(sessionId)

  try {
    getDb().saveMessage(sessionId, event)
  } catch (error) {
    console.error('[sessions] Failed to persist session creation progress:', error)
  }

  for (const socket of runtime?.sockets ?? []) {
    if (socket.readyState === WebSocketImpl.OPEN) {
      socket.send(payload)
    }
  }

  for (const socket of sessionSubscriberSockets) {
    if (socket.readyState === WebSocketImpl.OPEN) {
      socket.send(payload)
    }
  }
}

export function addSessionSubscriberSocket(socket: WebSocket) {
  sessionSubscriberSockets.add(socket)
}

export function removeSessionSubscriberSocket(socket: WebSocket) {
  sessionSubscriberSockets.delete(socket)
}

export function attachSocketToSession(sessionId: string, socket: WebSocket, mode: 'adapter' | 'external') {
  if (mode === 'external') {
    const runtime = ensureExternalSessionRuntime(sessionId)
    runtime.sockets.add(socket)
    return runtime
  }

  const runtime = adapterSessionStore.get(sessionId)
  runtime?.sockets.add(socket)
  return runtime
}

export function detachSocketFromSession(sessionId: string, socket: WebSocket) {
  const adapterRuntime = adapterSessionStore.get(sessionId)
  if (adapterRuntime != null) {
    adapterRuntime.sockets.delete(socket)
    return adapterRuntime
  }

  const externalRuntime = externalSessionStore.get(sessionId)
  if (externalRuntime != null) {
    externalRuntime.sockets.delete(socket)
    if (externalRuntime.sockets.size === 0) {
      externalSessionStore.delete(sessionId)
    }
  }
  return externalRuntime
}

export function interruptAdapterSession(sessionId: string) {
  adapterSessionStore.get(sessionId)?.session.emit({ type: 'interrupt' })
}

export function getPendingSessionInteraction(interactionId: string) {
  return pendingSessionInteractionStore.get(interactionId)
}

export function setPendingSessionInteraction(interactionId: string, interaction: PendingSessionInteraction) {
  pendingSessionInteractionStore.set(interactionId, interaction)
}

export function deletePendingSessionInteraction(interactionId: string) {
  pendingSessionInteractionStore.delete(interactionId)
}
