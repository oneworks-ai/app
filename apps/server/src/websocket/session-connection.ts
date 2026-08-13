import type { Buffer } from 'node:buffer'
import type { URLSearchParams } from 'node:url'

import { v4 as uuidv4 } from 'uuid'
import type { WebSocket } from 'ws'

import { getDb } from '#~/db/index.js'
import { interruptSession, killSession, processUserMessage, startAdapterSession } from '#~/services/session/index.js'
import { handleInteractionResponse } from '#~/services/session/interaction.js'
import {
  attachSocketToSession,
  detachSocketFromSession,
  getAdapterSessionRuntime
} from '#~/services/session/runtime.js'
import { safeJsonStringify } from '#~/utils/json.js'
import { getSessionLogger } from '#~/utils/logger.js'

const WEBSOCKET_OPEN = 1

const sendSocketError = (ws: WebSocket, error: unknown) => {
  if (ws.readyState !== WEBSOCKET_OPEN) return
  const message = error instanceof Error ? error.message : String(error)
  ws.send(safeJsonStringify({
    type: 'error',
    data: { message, fatal: true },
    message
  }))
}

export const handleSessionWebSocketConnection = async (
  ws: WebSocket,
  params: URLSearchParams
) => {
  const sessionId = params.get('sessionId') ?? uuidv4()
  const model = params.get('model') ?? undefined
  const effort = params.get('effort') ?? undefined
  const fastModeValue = params.get('fastMode')
  const fastMode = fastModeValue === 'true' ? true : fastModeValue === 'false' ? false : undefined
  const systemPrompt = params.get('systemPrompt') ?? undefined
  const appendSystemPrompt = params.get('appendSystemPrompt') !== 'false'
  const permissionMode = params.get('permissionMode') ?? undefined
  const promptTypeRaw = params.get('type') ?? undefined
  const promptType = promptTypeRaw === 'spec' || promptTypeRaw === 'entity' || promptTypeRaw === 'workspace'
    ? promptTypeRaw
    : undefined
  const promptName = params.get('name') ?? undefined
  const adapter = params.get('adapter') ?? undefined
  const account = params.get('account') ?? undefined

  const serverLogger = getSessionLogger(sessionId, 'server')
  serverLogger.info({ sessionId }, '[server] Connection established')

  try {
    const db = getDb()
    const sessionData = db.getSession(sessionId)
    const sessionRuntimeState = db.getSessionRuntimeState(sessionId)
    const isExternalSession = sessionRuntimeState?.runtimeKind === 'external'
    const cachedRuntime = getAdapterSessionRuntime(sessionId)
    const shouldAutoStartAdapter = sessionData == null ||
      sessionData.status === 'running' ||
      sessionData.status === 'waiting_input'

    if (isExternalSession) {
      attachSocketToSession(sessionId, ws, 'external')
    } else if (cachedRuntime != null) {
      attachSocketToSession(sessionId, ws, 'adapter')
    } else if (shouldAutoStartAdapter) {
      const cached = await startAdapterSession(sessionId, {
        model,
        effort: effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | undefined,
        fastMode,
        systemPrompt,
        appendSystemPrompt,
        permissionMode: permissionMode as
          | 'default'
          | 'acceptEdits'
          | 'plan'
          | 'dontAsk'
          | 'bypassPermissions'
          | undefined,
        promptType,
        promptName,
        adapter,
        account
      })
      attachSocketToSession(sessionId, ws, 'adapter')
      if (cached == null) {
        throw new Error(`Failed to initialize session runtime for ${sessionId}`)
      }
    } else {
      attachSocketToSession(sessionId, ws, 'external')
    }
  } catch (err) {
    sendSocketError(ws, err)
    return
  }

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(String(raw)) as any

      if (msg.type === 'interaction_response') {
        const { id, data } = msg
        void handleInteractionResponse(sessionId, id, data)
          .catch(error =>
            serverLogger.warn(
              { sessionId, interactionId: id, error },
              '[websocket] Failed to handle interaction response'
            )
          )
        return
      }

      serverLogger.info({ event: 'user_input', data: msg }, 'Received user message')
      if (msg.type === 'user_message') {
        const content = msg.content ?? msg.text
        void processUserMessage(sessionId, content)
      } else if (msg.type === 'interrupt') {
        serverLogger.info({ sessionId }, '[server] Received interrupt request')
        const sessionRuntimeState = getDb().getSessionRuntimeState(sessionId)
        if (sessionRuntimeState?.runtimeKind !== 'external') {
          interruptSession(sessionId)
        }
      } else if (msg.type === 'terminate_session') {
        serverLogger.info({ sessionId }, '[server] Received terminate_session request')
        killSession(sessionId)
      }
    } catch (err) {
      sendSocketError(ws, err)
    }
  })

  ws.on('close', () => {
    const runtime = detachSocketFromSession(sessionId, ws)
    const cached = runtime != null && 'session' in runtime ? runtime : undefined
    if (cached != null) {
      if (cached.sockets.size === 0) {
        serverLogger.info({ sessionId }, '[server] All sockets closed, but keeping adapter process alive')
      } else {
        serverLogger.info(
          { sessionId, activeSockets: cached.sockets.size },
          '[server] Socket closed, but session still has active sockets'
        )
      }
    }
  })
}
