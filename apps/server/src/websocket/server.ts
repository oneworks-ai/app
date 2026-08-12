import type { Buffer } from 'node:buffer'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { URL } from 'node:url'

import { v4 as uuidv4 } from 'uuid'
import { WebSocketServer } from 'ws'

import type { ServerEnv } from '@oneworks/core'

import {
  AUTH_COOKIE_NAME,
  getBearerTokenFromHeader,
  getCookieFromHeader,
  resolveWebAuthConfig,
  verifySessionToken
} from '#~/services/auth/index.js'
import {
  CODEX_MODEL_SHARING_WS_PATH,
  handleCodexModelSharingSocket,
  isLoopbackSocketAddress
} from '#~/services/codex-model-sharing/index.js'
import {
  isHttpUpgradeSocketHandled,
  markHttpUpgradeSocketHandled,
  scheduleUnhandledHttpUpgradeSocketClose
} from '#~/utils/http-upgrade.js'
import { logger } from '#~/utils/logger.js'
import { createLazyWebSocketConnectionHandler } from './lazy-connection'

const WEBSOCKET_OPEN = 1

export const shouldAllowTokenlessCodexModelSharing = (params: {
  remoteAddress?: string
  headers: IncomingMessage['headers']
}) => (
  isLoopbackSocketAddress(params.remoteAddress) &&
  !Object.prototype.hasOwnProperty.call(params.headers, 'origin')
)

export const isCodexModelSharingUpgradePath = (pathname: string | undefined, env: ServerEnv) => (
  pathname === CODEX_MODEL_SHARING_WS_PATH && env.__ONEWORKS_PROJECT_SERVER_ROLE__ === 'manager'
)

const parseRequestPathname = (request: IncomingMessage) => {
  try {
    return new URL(request.url ?? '', `http://${request.headers.host ?? 'localhost'}`).pathname
  } catch {
    return undefined
  }
}

export function setupWebSocket(server: Server, env: ServerEnv) {
  const wss = new WebSocketServer({ noServer: true })
  const codexModelSharingWss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024 * 1024
  })
  const handleConnection = createLazyWebSocketConnectionHandler()

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (isHttpUpgradeSocketHandled(socket)) return

    const pathname = parseRequestPathname(request)
    const isCodexModelSharingPath = isCodexModelSharingUpgradePath(pathname, env)
    if (pathname !== env.__ONEWORKS_PROJECT_SERVER_WS_PATH__ && !isCodexModelSharingPath) {
      scheduleUnhandledHttpUpgradeSocketClose(socket)
      return
    }

    markHttpUpgradeSocketHandled(socket)
    const target = isCodexModelSharingPath ? codexModelSharingWss : wss
    target.handleUpgrade(request, socket, head, (ws) => {
      target.emit('connection', ws, request)
    })
  })

  server.once('close', () => {
    wss.close()
    codexModelSharingWss.close()
  })

  codexModelSharingWss.on('connection', async (ws, req) => {
    try {
      if (env.__ONEWORKS_PROJECT_SERVER_ROLE__ !== 'manager') {
        ws.close(1008, 'Codex model sharing is unavailable')
        return
      }
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`)
      if (
        !shouldAllowTokenlessCodexModelSharing({
          remoteAddress: req.socket?.remoteAddress,
          headers: req.headers
        })
      ) {
        const authConfig = await resolveWebAuthConfig(env)
        const token = url.searchParams.get('authToken') ??
          getBearerTokenFromHeader(req.headers.authorization) ??
          getCookieFromHeader(req.headers.cookie, AUTH_COOKIE_NAME)
        if (!authConfig.enabled || !await verifySessionToken(env, token)) {
          ws.close(1008, 'Login required')
          return
        }
      }

      await handleCodexModelSharingSocket({
        ws,
        env,
        sessionId: uuidv4(),
        account: url.searchParams.get('account')
      })
    } catch {
      if (ws.readyState === WEBSOCKET_OPEN) {
        ws.close(1008, 'Login required')
      }
    }
  })

  wss.on('connection', async (ws, request) => {
    try {
      await handleConnection(ws, request, env)
    } catch (error) {
      logger.error({ error }, '[websocket] Failed to load connection handler')
      if (ws.readyState === WEBSOCKET_OPEN) {
        ws.close(1011, 'WebSocket service unavailable')
      }
    }
  })

  return wss
}
