import type { Buffer } from 'node:buffer'
import type { IncomingMessage, Server } from 'node:http'
import type { Socket } from 'node:net'

import { WebSocketServer } from 'ws'
import type WebSocket from 'ws'
import type { RawData } from 'ws'

import type { RelayRooms } from '../rooms/index.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayTelemetry } from '../telemetry/metrics.js'
import type { RelayServerArgs } from '../types.js'
import {
  RELAY_CONTROL_MAX_FRAME_BYTES,
  applyRelayControlHeartbeatFrame,
  createRelayControlAttachment,
  parseRelayControlFrame
} from './control-heartbeat.js'
import type { RelayControlFrame } from './control-heartbeat.js'
import { denyUpgrade, isControlUpgrade, notifyNodeControlSocket } from './node-control-upgrade.js'

export { notifyNodeControlSocket }

interface NodeControlConnection {
  attachment: NonNullable<ReturnType<typeof createRelayControlAttachment>>
  closed: boolean
  inFlight: boolean
  isAlive: boolean
  pendingHeartbeat?: RelayControlFrame
  pendingRoomFrames: RelayControlFrame[]
}

export const attachRelayNodeControl = (input: {
  args: RelayServerArgs
  repository: RelayStoreRepository
  rooms?: RelayRooms
  server: Server
  telemetry: RelayTelemetry
}) => {
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
        const entry: NodeControlConnection = {
          attachment,
          closed: false,
          inFlight: false,
          isAlive: true,
          pendingRoomFrames: []
        }
        clients.set(client, entry)
        const clearRoomOwner = input.rooms?.bindOwner({
          deviceId: attachment.deviceId,
          send: frame => client.send(JSON.stringify(frame))
        })
        const closeClient = (code: number, reason: string) => {
          entry.closed = true
          entry.pendingHeartbeat = undefined
          entry.pendingRoomFrames.length = 0
          clearRoomOwner?.()
          client.close(code, reason)
        }
        const nextPendingFrame = () => {
          const roomFrame = entry.pendingRoomFrames.shift()
          if (roomFrame != null) return roomFrame
          const heartbeat = entry.pendingHeartbeat
          entry.pendingHeartbeat = undefined
          return heartbeat
        }
        const applyFrame = (frame: RelayControlFrame) => {
          if (entry.closed) return
          entry.inFlight = true
          const parsed = parseRelayControlFrame(frame)
          const isRoomFrame = parsed !== 'frame-too-large' &&
            (parsed?.type === 'room-descriptor' || parsed?.type === 'room-response')
          const applied = isRoomFrame
            ? input.rooms?.handleControlFrame({
              attachment: entry.attachment,
              frame,
              repository: input.repository
            }) ?? Promise.resolve('invalid-frame' as const)
            : applyRelayControlHeartbeatFrame({
              args: input.args,
              attachment: entry.attachment,
              frame,
              repository: input.repository,
              telemetry: input.telemetry
            })
          void applied.then(result => {
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
            const pendingFrame = nextPendingFrame()
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
            const parsed = parseRelayControlFrame(frame)
            if (parsed !== 'frame-too-large' && parsed?.type === 'heartbeat') {
              entry.pendingHeartbeat = frame
            } else if (entry.pendingRoomFrames.length < 256) {
              entry.pendingRoomFrames.push(frame)
            } else {
              closeClient(1013, 'control frame backlog exceeded')
            }
            return
          }
          applyFrame(frame)
        })
        // ws emits an error before it closes a socket whose frame exceeds maxPayload.
        // Consume it here so the server remains healthy while the peer receives the close code.
        client.on('error', () => {})
        client.on('close', () => {
          entry.closed = true
          entry.pendingHeartbeat = undefined
          entry.pendingRoomFrames.length = 0
          clearRoomOwner?.()
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
    onForwardingJobAvailable: (deviceId: string) => {
      for (const [socket, entry] of clients) {
        if (entry.attachment.deviceId === deviceId && socket.readyState === socket.OPEN) {
          notifyNodeControlSocket(socket)
        }
      }
    }
  }
}
