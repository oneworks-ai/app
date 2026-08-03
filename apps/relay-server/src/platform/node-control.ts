import type { Buffer } from 'node:buffer'
import type { IncomingMessage, Server } from 'node:http'
import type { Socket } from 'node:net'

import { WebSocketServer } from 'ws'
import type WebSocket from 'ws'
import type { RawData } from 'ws'

import type { ForwardingJobAvailableObserver } from '../session-forwarding/job-handlers.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayTelemetry } from '../telemetry/metrics.js'
import type { RelayServerArgs } from '../types.js'
import {
  RELAY_CONTROL_MAX_FRAME_BYTES,
  applyRelayControlHeartbeatFrame,
  createRelayControlAttachment
} from './control-heartbeat.js'
import type { RelayControlFrame } from './control-heartbeat.js'

interface NodeControlConnection {
  attachment: NonNullable<ReturnType<typeof createRelayControlAttachment>>
  closed: boolean
  inFlight: boolean
  isAlive: boolean
  pendingFrame?: RelayControlFrame
}

export interface RelayNodeControl {
  close: () => void
  onForwardingJobAvailable: ForwardingJobAvailableObserver
}

const NODE_CONTROL_UPGRADE_BASE_URL = 'http://relay-control.invalid'

const isControlUpgrade = (req: IncomingMessage) => {
  const requestTarget = req.url ?? '/'
  // Upgrade request targets must stay origin-form. Never use a client-provided Host as a URL base:
  // this handler is an EventEmitter listener, so a parsing exception would otherwise escape sync.
  if (!requestTarget.startsWith('/')) return false
  try {
    const url = new URL(requestTarget, NODE_CONTROL_UPGRADE_BASE_URL)
    return url.pathname === '/api/relay/devices/control' && url.search === ''
  } catch {
    return false
  }
}

const denyUpgrade = (socket: Socket) => {
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

export const attachRelayNodeControl = (input: {
  args: RelayServerArgs
  repository: RelayStoreRepository
  server: Server
  telemetry: RelayTelemetry
}): RelayNodeControl => {
  const webSockets = new WebSocketServer({ maxPayload: RELAY_CONTROL_MAX_FRAME_BYTES, noServer: true })
  const clients = new Map<WebSocket, NodeControlConnection>()
  const onUpgrade = (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!isControlUpgrade(req)) {
      socket.destroy()
      return
    }
    const deviceToken = (req.headers.authorization ?? '').replace(/^Bearer\s+/iu, '')
    const deviceId = typeof req.headers['x-oneworks-relay-device-id'] === 'string'
      ? req.headers['x-oneworks-relay-device-id'].trim()
      : ''
    void input.repository.read().then(store => {
      const attachment = createRelayControlAttachment(store, {
        ...(req.socket.remoteAddress == null ? {} : { connectionIp: req.socket.remoteAddress }),
        deviceId,
        deviceToken
      })
      if (attachment == null) {
        denyUpgrade(socket)
        return
      }
      webSockets.handleUpgrade(req, socket, head, client => {
        const entry: NodeControlConnection = { attachment, closed: false, inFlight: false, isAlive: true }
        clients.set(client, entry)
        const closeClient = (code: number, reason: string) => {
          entry.closed = true
          entry.pendingFrame = undefined
          client.close(code, reason)
        }
        const applyFrame = (frame: RelayControlFrame) => {
          if (entry.closed) return
          entry.inFlight = true
          void applyRelayControlHeartbeatFrame({
            args: input.args,
            attachment: entry.attachment,
            frame,
            repository: input.repository,
            telemetry: input.telemetry
          }).then(result => {
            if (result === 'frame-too-large') {
              closeClient(1009, 'frame too large')
              return
            }
            if (result === 'invalid-frame') {
              closeClient(1003, 'invalid frame')
              return
            }
            if (result === 'revoked') {
              closeClient(1008, 'device token revoked')
              return
            }
            const pendingFrame = entry.pendingFrame
            entry.pendingFrame = undefined
            if (pendingFrame != null && !entry.closed && clients.has(client)) {
              applyFrame(pendingFrame)
              return
            }
            entry.inFlight = false
          }).catch(() => closeClient(1011, 'heartbeat failed'))
        }
        client.on('pong', () => {
          if (!entry.closed) entry.isAlive = true
        })
        client.on('message', data => {
          if (entry.closed) return
          const frame = data as RawData as RelayControlFrame
          if (entry.inFlight) {
            entry.pendingFrame = frame
            return
          }
          applyFrame(frame)
        })
        // ws emits an error before it closes a socket whose frame exceeds maxPayload.
        // Consume it here so the server remains healthy while the peer receives the close code.
        client.on('error', () => {})
        client.on('close', () => {
          entry.closed = true
          entry.pendingFrame = undefined
          clients.delete(client)
        })
      })
    }).catch(() => socket.destroy())
  }
  input.server.on('upgrade', onUpgrade)
  const liveness = setInterval(() => {
    for (const [client, entry] of clients) {
      if (!entry.isAlive) {
        client.terminate()
        continue
      }
      entry.isAlive = false
      if (client.readyState === client.OPEN) client.ping()
    }
  }, 30_000)
  liveness.unref()
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    clearInterval(liveness)
    input.server.off('upgrade', onUpgrade)
    for (const socket of clients.keys()) socket.terminate()
    clients.clear()
    webSockets.close()
  }
  // Node waits for upgraded sockets before firing its `close` event. Dispose them at
  // close initiation so a normal Relay shutdown cannot hang behind a live control client.
  const closeServer = input.server.close.bind(input.server)
  input.server.close = ((...args: Parameters<Server['close']>) => {
    close()
    return closeServer(...args)
  }) as Server['close']
  return {
    close,
    onForwardingJobAvailable: deviceId => {
      for (const [socket, entry] of clients) {
        if (entry.attachment.deviceId === deviceId && socket.readyState === socket.OPEN) {
          notifyNodeControlSocket(socket)
        }
      }
    }
  }
}
