import type { IncomingMessage } from 'node:http'

import type { WebSocket } from 'ws'

import type { ServerEnv } from '@oneworks/core'

export type WebSocketConnectionHandler = (
  ws: WebSocket,
  request: IncomingMessage,
  env: ServerEnv
) => Promise<void>

export type WebSocketConnectionHandlerLoader = () => Promise<WebSocketConnectionHandler>

const loadDefaultWebSocketConnectionHandler: WebSocketConnectionHandlerLoader = () =>
  import('./connection.js').then(module => module.handleWebSocketConnection)

export const createLazyWebSocketConnectionHandler = (
  load: WebSocketConnectionHandlerLoader = loadDefaultWebSocketConnectionHandler
): WebSocketConnectionHandler => {
  let handlerPromise: Promise<WebSocketConnectionHandler> | undefined

  const loadHandler = () => {
    if (handlerPromise != null) return handlerPromise

    const pending = load()
    handlerPromise = pending
    void pending.catch(() => {
      if (handlerPromise === pending) {
        handlerPromise = undefined
      }
    })
    return pending
  }

  return async (ws, request, env) => {
    const handler = await loadHandler()
    await handler(ws, request, env)
  }
}
