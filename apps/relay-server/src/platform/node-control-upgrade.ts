import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'

import type WebSocket from 'ws'

const NODE_CONTROL_UPGRADE_BASE_URL = 'http://relay-control.invalid'

export const isControlUpgrade = (req: IncomingMessage) => {
  const requestTarget = req.url ?? '/'
  // Upgrade request targets must stay origin-form. Never trust a client Host as the URL base.
  if (!requestTarget.startsWith('/')) return false
  try {
    const url = new URL(requestTarget, NODE_CONTROL_UPGRADE_BASE_URL)
    return url.pathname === '/api/relay/devices/control' && url.search === ''
  } catch {
    return false
  }
}

export const denyUpgrade = (socket: Socket) => {
  socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
  socket.destroy()
}

/** A failed fan-out is a stale control connection, never a failure of the committed job. */
export const notifyNodeControlSocket = (socket: Pick<WebSocket, 'send' | 'terminate'>) => {
  try {
    socket.send(JSON.stringify({ type: 'jobs-available' }))
  } catch {
    socket.terminate()
  }
}
