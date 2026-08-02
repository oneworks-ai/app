/* eslint-disable max-lines -- one state machine owns all control, fallback, retry, and cleanup transitions. */
import { Buffer } from 'node:buffer'

import WebSocket from 'ws'

import { createHeartbeatBody, sendHeartbeat } from './heartbeat.js'
import type { RelayHeartbeatOptions } from './heartbeat.js'
import type { RelaySessionWorker } from './session-worker.js'

export const RELAY_CONTROL_HEARTBEAT_MS = 30_000
export const RELAY_CONTROL_SNAPSHOT_MS = 5 * 60_000
export const RELAY_CONTROL_FALLBACK_HEARTBEAT_MS = 45_000
export const RELAY_CONTROL_FALLBACK_LONG_POLL_MS = 60_000
export const RELAY_CONTROL_FALLBACK_POLL_RETRY_MIN_MS = 90_000
export const RELAY_CONTROL_RETRY_MIN_MS = 60_000
export const RELAY_CONTROL_RETRY_MAX_MS = 120_000

interface ControlSocket {
  close: (code?: number, reason?: string) => void
  on(event: 'close' | 'error' | 'open', listener: (...args: unknown[]) => void): ControlSocket
  on(event: 'message', listener: (data: unknown) => void): ControlSocket
  readyState: number
  send: (data: string) => void
  terminate?: () => void
}

export interface RelayDeviceTransport {
  apiBaseUrl: string
  controlWebSocketUrl: string
  version: 1
}

export interface RelayDeviceControlChannelOptions {
  heartbeat: RelayHeartbeatOptions
  logger?: { warn: (...args: unknown[]) => void }
  random?: () => number
  sessionWorker?: RelaySessionWorker
  transport?: RelayDeviceTransport
  webSocketFactory?: (url: string, headers: Record<string, string>) => ControlSocket
}

export interface RelayDeviceControlChannel {
  stop: () => void
}

const jitteredRetryMs = (baseMs: number, random: () => number) => {
  const multiplier = 0.8 + Math.max(0, Math.min(1, random())) * 0.4
  return Math.max(RELAY_CONTROL_RETRY_MIN_MS, Math.min(RELAY_CONTROL_RETRY_MAX_MS, Math.floor(baseMs * multiplier)))
}

const defaultWebSocketFactory = (url: string, headers: Record<string, string>): ControlSocket => (
  new WebSocket(url, { headers }) as unknown as ControlSocket
)

const unref = (timer: ReturnType<typeof setTimeout> | undefined) => {
  ;(timer as { unref?: () => void } | undefined)?.unref?.()
}

export const createRelayDeviceControlChannel = (
  options: RelayDeviceControlChannelOptions
): RelayDeviceControlChannel => {
  const random = options.random ?? Math.random
  const webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory
  let stopped = false
  let online = false
  let socket: ControlSocket | undefined
  let socketTimeout: ReturnType<typeof setTimeout> | undefined
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackHeartbeatTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackHeartbeatTimeout: ReturnType<typeof setTimeout> | undefined
  let fallbackHeartbeatAbort: AbortController | undefined
  let fallbackHeartbeatInFlight: Promise<void> | undefined
  let fallbackPollTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackPollAbort: AbortController | undefined
  let fallbackPollInFlight: Promise<void> | undefined
  let claimScheduled = false
  let claimInFlight: Promise<void> | undefined
  let claimAbort: AbortController | undefined
  let claimPending = false
  let snapshotAbort: AbortController | undefined
  let retryBaseMs = RELAY_CONTROL_RETRY_MIN_MS

  const clearTimer = (timer: ReturnType<typeof setTimeout> | undefined) => {
    if (timer != null) clearTimeout(timer)
  }

  const warn = (error: unknown, message: string) => {
    if (stopped) return
    options.logger?.warn({ err: error }, message)
  }

  const scheduleHeartbeat = () => {
    clearTimer(heartbeatTimer)
    if (stopped || !online) return
    heartbeatTimer = setTimeout(() => {
      if (!online || stopped || socket == null) return
      try {
        socket.send(JSON.stringify({ type: 'heartbeat', payload: createHeartbeatBody(options.heartbeat) }))
      } catch (error) {
        warn(error, '[relay] control heartbeat failed')
        socket.close(1011, 'heartbeat failed')
        return
      }
      scheduleHeartbeat()
    }, RELAY_CONTROL_HEARTBEAT_MS)
    unref(heartbeatTimer)
  }

  const scheduleSnapshot = () => {
    clearTimer(snapshotTimer)
    const sessionWorker = options.sessionWorker
    if (stopped || !online || sessionWorker == null) return
    snapshotTimer = setTimeout(() => {
      if (!online || stopped) return
      const controller = new AbortController()
      snapshotAbort = controller
      void sessionWorker.refreshSnapshot({ force: true, signal: controller.signal })
        .catch(error => warn(error, '[relay] control snapshot refresh failed'))
        .finally(() => {
          if (snapshotAbort === controller) snapshotAbort = undefined
          scheduleSnapshot()
        })
    }, RELAY_CONTROL_SNAPSHOT_MS)
    unref(snapshotTimer)
  }

  const claimJobs = () => {
    const sessionWorker = options.sessionWorker
    if (stopped || !online || sessionWorker == null) return
    if (claimScheduled) return
    if (claimInFlight != null) {
      claimPending = true
      return
    }
    claimScheduled = true
    queueMicrotask(() => {
      claimScheduled = false
      if (stopped || !online || claimInFlight != null) return
      claimAbort = new AbortController()
      claimInFlight = sessionWorker.runOnce({
        refreshSnapshot: false,
        signal: claimAbort.signal,
        waitMs: 0
      })
        .catch(error => warn(error, '[relay] control job claim failed'))
        .finally(() => {
          claimAbort = undefined
          claimInFlight = undefined
          if (claimPending) {
            claimPending = false
            claimJobs()
          }
        })
    })
  }

  const scheduleFallbackHeartbeat = (delayMs: number) => {
    clearTimer(fallbackHeartbeatTimer)
    if (stopped || online || fallbackHeartbeatInFlight != null) return
    fallbackHeartbeatTimer = setTimeout(runFallbackHeartbeat, delayMs)
    unref(fallbackHeartbeatTimer)
  }

  function runFallbackHeartbeat() {
    if (stopped || online || fallbackHeartbeatInFlight != null) return
    const startedAt = Date.now()
    const controller = new AbortController()
    fallbackHeartbeatAbort = controller
    fallbackHeartbeatTimeout = setTimeout(() => controller.abort(), 10_000)
    unref(fallbackHeartbeatTimeout)
    fallbackHeartbeatInFlight = sendHeartbeat({ ...options.heartbeat, signal: controller.signal })
      .then(() => undefined)
      .catch(error => {
        if (!controller.signal.aborted) warn(error, '[relay] control fallback heartbeat failed')
      })
      .finally(() => {
        clearTimer(fallbackHeartbeatTimeout)
        fallbackHeartbeatTimeout = undefined
        if (fallbackHeartbeatAbort === controller) fallbackHeartbeatAbort = undefined
        fallbackHeartbeatInFlight = undefined
        if (!stopped && !online) {
          scheduleFallbackHeartbeat(Math.max(0, RELAY_CONTROL_FALLBACK_HEARTBEAT_MS - (Date.now() - startedAt)))
        }
      })
  }

  const scheduleFallbackPoll = (delayMs: number) => {
    clearTimer(fallbackPollTimer)
    if (stopped || online || options.sessionWorker == null || fallbackPollInFlight != null) return
    fallbackPollTimer = setTimeout(runFallbackPoll, delayMs)
    unref(fallbackPollTimer)
  }

  function runFallbackPoll() {
    const sessionWorker = options.sessionWorker
    if (stopped || online || sessionWorker == null || fallbackPollInFlight != null) return
    const controller = new AbortController()
    fallbackPollAbort = controller
    fallbackPollInFlight = sessionWorker
      .runOnce({ signal: controller.signal, waitMs: RELAY_CONTROL_FALLBACK_LONG_POLL_MS })
      .catch(error => {
        if (!controller.signal.aborted) warn(error, '[relay] control fallback poll failed')
      })
      .finally(() => {
        if (fallbackPollAbort === controller) fallbackPollAbort = undefined
        fallbackPollInFlight = undefined
        if (!stopped && !online) {
          scheduleFallbackPoll(Math.max(
            RELAY_CONTROL_FALLBACK_POLL_RETRY_MIN_MS,
            jitteredRetryMs(retryBaseMs, random)
          ))
        }
      })
  }

  const scheduleReconnect = () => {
    if (stopped || online || options.transport == null || reconnectTimer != null) return
    const delayMs = jitteredRetryMs(retryBaseMs, random)
    retryBaseMs = Math.min(RELAY_CONTROL_RETRY_MAX_MS, retryBaseMs * 2)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      openSocket()
    }, delayMs)
    unref(reconnectTimer)
  }

  const becomeOffline = () => {
    if (stopped) return
    online = false
    clearTimer(socketTimeout)
    socketTimeout = undefined
    clearTimer(heartbeatTimer)
    clearTimer(snapshotTimer)
    claimAbort?.abort()
    claimAbort = undefined
    claimPending = false
    snapshotAbort?.abort()
    snapshotAbort = undefined
    heartbeatTimer = undefined
    snapshotTimer = undefined
    scheduleFallbackHeartbeat(0)
    scheduleFallbackPoll(0)
    scheduleReconnect()
  }

  const becomeOnline = (openedSocket: ControlSocket) => {
    if (stopped || socket !== openedSocket) return
    online = true
    retryBaseMs = RELAY_CONTROL_RETRY_MIN_MS
    clearTimer(socketTimeout)
    socketTimeout = undefined
    clearTimer(reconnectTimer)
    reconnectTimer = undefined
    clearTimer(fallbackHeartbeatTimer)
    clearTimer(fallbackHeartbeatTimeout)
    clearTimer(fallbackPollTimer)
    fallbackHeartbeatTimer = undefined
    fallbackHeartbeatTimeout = undefined
    fallbackPollTimer = undefined
    fallbackHeartbeatAbort?.abort()
    fallbackPollAbort?.abort()
    fallbackHeartbeatAbort = undefined
    fallbackPollAbort = undefined
    try {
      openedSocket.send(JSON.stringify({ type: 'heartbeat', payload: createHeartbeatBody(options.heartbeat) }))
    } catch (error) {
      warn(error, '[relay] initial control heartbeat failed')
      openedSocket.close(1011, 'heartbeat failed')
      return
    }
    if (options.sessionWorker != null) {
      const controller = new AbortController()
      snapshotAbort = controller
      void options.sessionWorker.refreshSnapshot({ force: true, signal: controller.signal })
        .catch(error => warn(error, '[relay] initial control snapshot failed'))
        .finally(() => {
          if (snapshotAbort === controller) snapshotAbort = undefined
        })
    }
    scheduleHeartbeat()
    scheduleSnapshot()
    claimJobs()
  }

  function openSocket() {
    if (stopped || online || options.transport == null) return
    const current = webSocketFactory(options.transport.controlWebSocketUrl, {
      authorization: `Bearer ${options.heartbeat.deviceToken}`,
      'x-oneworks-relay-device-id': options.heartbeat.deviceId
    })
    socket = current
    current.on('open', () => becomeOnline(current))
    current.on('message', data => {
      if (socket !== current) return
      let frame: unknown
      try {
        frame = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data))
      } catch {
        return
      }
      if (frame != null && typeof frame === 'object' && (frame as { type?: unknown }).type === 'jobs-available') {
        claimJobs()
      }
    })
    current.on('error', error => {
      if (socket !== current) return
      warn(error, '[relay] control socket failed')
    })
    current.on('close', () => {
      if (socket !== current) return
      socket = undefined
      becomeOffline()
    })
    socketTimeout = setTimeout(() => {
      if (socket !== current || online || stopped) return
      current.terminate?.()
      current.close(1013, 'connect timeout')
      if (socket === current) {
        socket = undefined
        becomeOffline()
      }
    }, 30_000)
    unref(socketTimeout)
  }

  if (options.transport == null) {
    scheduleFallbackHeartbeat(0)
    scheduleFallbackPoll(0)
  } else {
    openSocket()
  }

  return {
    stop: () => {
      if (stopped) return
      stopped = true
      online = false
      clearTimer(socketTimeout)
      clearTimer(heartbeatTimer)
      clearTimer(snapshotTimer)
      clearTimer(reconnectTimer)
      clearTimer(fallbackHeartbeatTimer)
      clearTimer(fallbackHeartbeatTimeout)
      clearTimer(fallbackPollTimer)
      fallbackHeartbeatAbort?.abort()
      fallbackPollAbort?.abort()
      claimAbort?.abort()
      snapshotAbort?.abort()
      socket?.close(1000, 'relay control stopped')
      socket = undefined
      options.sessionWorker?.stop()
    }
  }
}
