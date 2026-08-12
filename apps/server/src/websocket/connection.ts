import type { IncomingMessage } from 'node:http'
import { URL } from 'node:url'

import type { WebSocket } from 'ws'

import type { ServerEnv } from '@oneworks/core'

import {
  AUTH_COOKIE_NAME,
  getBearerTokenFromHeader,
  getCookieFromHeader,
  resolveWebAuthConfig,
  verifySessionToken
} from '#~/services/auth/index.js'
import { safeJsonStringify } from '#~/utils/json.js'

export const handleWebSocketConnection = async (
  ws: WebSocket,
  request: IncomingMessage,
  env: ServerEnv
) => {
  const url = new URL(request.url ?? '', `http://${request.headers.host ?? 'localhost'}`)
  const params = url.searchParams
  const authConfig = await resolveWebAuthConfig(env)
  if (authConfig.enabled) {
    const token = params.get('authToken') ??
      getBearerTokenFromHeader(request.headers.authorization) ??
      getCookieFromHeader(request.headers.cookie, AUTH_COOKIE_NAME)
    const authenticated = await verifySessionToken(env, token)
    if (!authenticated) {
      ws.close(1008, 'Login required')
      return
    }
  }

  const subscribeMode = params.get('subscribe')
  const channel = params.get('channel')

  if (channel === 'mobile-debug-video') {
    const { handleMobileDeviceVideoStreamSocket } = await import('#~/services/mobile-debug/index.js')
    await handleMobileDeviceVideoStreamSocket(ws, params.get('deviceId'))
    return
  }

  if (subscribeMode === 'sessions') {
    const { addSessionSubscriberSocket, removeSessionSubscriberSocket } = await import(
      '#~/services/session/runtime.js'
    )
    addSessionSubscriberSocket(ws)
    ws.on('close', () => {
      removeSessionSubscriberSocket(ws)
    })
    return
  }

  if (channel === 'terminal') {
    const sessionId = params.get('sessionId')
    const [{ v4: uuidv4 }, { WORKSPACE_TERMINAL_SESSION_ID }, { getDb }, terminal] = await Promise.all([
      import('uuid'),
      import('@oneworks/types'),
      import('#~/db/index.js'),
      import('./terminal.js')
    ])
    const resolvedSessionId = sessionId ?? uuidv4()
    const isWorkspaceTerminal = resolvedSessionId === WORKSPACE_TERMINAL_SESSION_ID
    const session = isWorkspaceTerminal ? undefined : getDb().getSession(resolvedSessionId)
    if (!isWorkspaceTerminal && session == null) {
      terminal.sendTerminalFatalError(ws, 'Session not found.', 1008)
      return
    }

    await terminal.handleTerminalSocketConnection(ws, resolvedSessionId, params)
    return
  }

  if (channel === 'plugin') {
    const scope = params.get('scope') ?? ''
    if (scope === '') {
      ws.close(1008, 'Plugin scope required')
      return
    }

    const { getPluginManager } = await import('#~/services/plugins/index.js')
    const pluginManager = getPluginManager()
    await pluginManager.load()
    const subscribeScope = scope === '*' ? undefined : scope
    if (subscribeScope != null) {
      const record = pluginManager.getRecord(subscribeScope)
      if (record == null) {
        ws.close(1008, 'Plugin scope not registered')
        return
      }
    }

    ws.send(safeJsonStringify({
      type: 'plugin.ready',
      scope
    }))
    const unsubscribe = pluginManager.subscribeWatchEvents(ws, subscribeScope)
    ws.on('close', () => {
      unsubscribe()
    })
    return
  }

  const { handleSessionWebSocketConnection } = await import('./session-connection.js')
  await handleSessionWebSocketConnection(ws, params)
}
