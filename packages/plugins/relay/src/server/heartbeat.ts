import type { RelayCapabilities } from './types.js'
import { isRecord, toString } from './utils.js'

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000
export const DEFAULT_HEARTBEAT_MAX_ERROR_INTERVAL_MS = 120_000
export const DEFAULT_HEARTBEAT_ERROR_LOG_INTERVAL_MS = 30_000

export interface RelayHeartbeatOptions {
  capabilities: RelayCapabilities
  deviceId: string
  deviceName?: string
  deviceToken: string
  fetchImpl?: typeof fetch
  pluginScope: string
  remoteBaseUrl: string
  workspaceFolder: string
}

export interface RelayHeartbeatLoopOptions extends RelayHeartbeatOptions {
  errorLogIntervalMs?: number
  intervalMs?: number
  logger?: {
    warn: (...args: unknown[]) => void
  }
  maxErrorIntervalMs?: number
  serverId?: string
}

export interface RelayHeartbeatLoop {
  sendNow: () => Promise<Record<string, unknown> | undefined>
  stop: () => void
}

const createHeartbeatBody = (options: RelayHeartbeatOptions) => ({
  capabilities: options.capabilities,
  deviceId: options.deviceId,
  ...(options.deviceName == null ? {} : { deviceName: options.deviceName }),
  pluginScope: options.pluginScope,
  workspaceFolder: options.workspaceFolder
})

const readHeartbeatError = async (response: Response) => {
  const body = await response.json().catch(() => ({}))
  if (isRecord(body) && typeof body.error === 'string') return body.error
  return `Relay heartbeat failed with ${response.status}.`
}

export const sendHeartbeat = async (options: RelayHeartbeatOptions) => {
  const remoteBaseUrl = toString(options.remoteBaseUrl)
  const deviceToken = toString(options.deviceToken)
  if (remoteBaseUrl === '') throw new Error('remoteBaseUrl is required for relay heartbeat.')
  if (deviceToken === '') throw new Error('deviceToken is required for relay heartbeat.')

  const fetchImpl = options.fetchImpl ?? fetch
  const heartbeatUrl = new URL('/api/relay/devices/heartbeat', remoteBaseUrl)
  const response = await fetchImpl(heartbeatUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${deviceToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(createHeartbeatBody(options))
  })

  if (!response.ok) {
    throw new Error(await readHeartbeatError(response))
  }
  const body = await response.json().catch(() => ({}))
  return isRecord(body) ? body : {}
}

export const startHeartbeat = (options: RelayHeartbeatLoopOptions): RelayHeartbeatLoop => {
  let stopped = false
  let inFlight: Promise<unknown> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let nextIntervalMs = Math.max(1_000, Math.floor(options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS))
  let lastErrorKey: string | undefined
  let lastErrorLoggedAt = 0
  const intervalMs = nextIntervalMs
  const maxErrorIntervalMs = Math.max(
    intervalMs,
    Math.floor(options.maxErrorIntervalMs ?? DEFAULT_HEARTBEAT_MAX_ERROR_INTERVAL_MS)
  )
  const errorLogIntervalMs = Math.max(
    1_000,
    Math.floor(options.errorLogIntervalMs ?? DEFAULT_HEARTBEAT_ERROR_LOG_INTERVAL_MS)
  )

  const describeError = (error: unknown) => (
    error instanceof Error && error.message.trim() !== ''
      ? error.message.trim()
      : String(error)
  )

  const warnFailure = (error: unknown) => {
    const now = Date.now()
    const errorKey = describeError(error)
    const shouldLog = errorKey !== lastErrorKey || now - lastErrorLoggedAt >= errorLogIntervalMs
    if (!shouldLog) return
    lastErrorKey = errorKey
    lastErrorLoggedAt = now
    options.logger?.warn(
      { err: error, ...(options.serverId == null ? {} : { serverId: options.serverId }) },
      '[relay] heartbeat failed'
    )
  }

  const sendNow = async () => {
    if (stopped) return undefined
    return await sendHeartbeat(options)
  }

  const schedule = (delayMs = nextIntervalMs) => {
    if (stopped) return
    timer = setTimeout(sendScheduled, delayMs)
    ;(timer as { unref?: () => void }).unref?.()
  }

  const sendScheduled = () => {
    if (stopped) return
    if (inFlight != null) {
      schedule()
      return
    }
    inFlight = sendHeartbeat(options)
      .then(() => {
        lastErrorKey = undefined
        nextIntervalMs = intervalMs
      })
      .catch(error => {
        warnFailure(error)
        nextIntervalMs = Math.min(maxErrorIntervalMs, Math.max(nextIntervalMs, intervalMs) * 2)
      })
      .finally(() => {
        inFlight = undefined
        schedule()
      })
  }

  schedule(intervalMs)

  return {
    sendNow,
    stop: () => {
      stopped = true
      if (timer != null) clearTimeout(timer)
    }
  }
}
