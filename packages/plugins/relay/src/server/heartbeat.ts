import type { RelayCapabilities } from './types.js'
import { isRecord, toString } from './utils.js'

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000

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
  intervalMs?: number
  logger?: {
    warn: (...args: unknown[]) => void
  }
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
  const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS

  const sendNow = async () => {
    if (stopped) return undefined
    return await sendHeartbeat(options)
  }

  const sendScheduled = () => {
    if (stopped || inFlight != null) return
    inFlight = sendHeartbeat(options)
      .catch(error => {
        options.logger?.warn({ err: error }, '[relay] heartbeat failed')
      })
      .finally(() => {
        inFlight = undefined
      })
  }

  const timer = setInterval(sendScheduled, intervalMs)
  const nodeTimer = timer as { unref?: () => void }
  nodeTimer.unref?.()

  return {
    sendNow,
    stop: () => {
      stopped = true
      clearInterval(timer)
    }
  }
}
