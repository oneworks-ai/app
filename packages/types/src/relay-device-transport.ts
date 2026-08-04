/**
 * Ephemeral Relay device-control capability advertised by service discovery.
 *
 * This contract intentionally does not identify a deployment platform. Entries
 * own capability selection because their runtime, credentials, and failure
 * semantics are platform-specific.
 */
export interface RelayWebSocketDeviceTransport {
  apiBaseUrl: string
  controlWebSocketUrl: string
  heartbeatIntervalMs?: number
  version: 1
}

export interface RelayLongPollDeviceTransport {
  apiBaseUrl: string
  idleRetryMs: number
  longPollMaxWaitMs: number
  mode: 'long-poll'
  version: 2
}

export type RelayDeviceTransport =
  | RelayWebSocketDeviceTransport
  | RelayLongPollDeviceTransport

const isLoopbackHost = (hostname: string) => (
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
)

const readText = (value: unknown) => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

const isBoundedInteger = (value: unknown, minimum: number, maximum: number): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
)

/**
 * Validates a device capability before a client uses it. It owns only protocol
 * safety and same-origin normalization; platform selection remains local.
 */
export const normalizeRelayDeviceTransport = (value: unknown): RelayDeviceTransport | undefined => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const apiBaseUrl = readText(record.apiBaseUrl)
  if (apiBaseUrl == null) return undefined

  try {
    const api = new URL(apiBaseUrl)
    if (!['http:', 'https:'].includes(api.protocol) || api.username !== '' || api.password !== '') return undefined
    if (api.protocol !== 'https:' && !isLoopbackHost(api.hostname)) return undefined
    if (api.pathname !== '/' || api.search !== '' || api.hash !== '') return undefined

    if (record.version === 2 && record.mode === 'long-poll') {
      const longPollMaxWaitMs = record.longPollMaxWaitMs
      const idleRetryMs = record.idleRetryMs
      if (!isBoundedInteger(longPollMaxWaitMs, 1_000, 55_000)) return undefined
      if (!isBoundedInteger(idleRetryMs, 60_000, 15 * 60_000)) return undefined
      return {
        apiBaseUrl: api.toString(),
        idleRetryMs,
        longPollMaxWaitMs,
        mode: 'long-poll',
        version: 2
      }
    }

    if (record.version !== 1) return undefined
    const controlWebSocketUrl = readText(record.controlWebSocketUrl)
    if (controlWebSocketUrl == null) return undefined
    const control = new URL(controlWebSocketUrl)
    if (!['ws:', 'wss:'].includes(control.protocol) || control.username !== '' || control.password !== '') {
      return undefined
    }
    if (control.protocol !== 'wss:' && !isLoopbackHost(control.hostname)) return undefined
    if (`${api.hostname}:${api.port}` !== `${control.hostname}:${control.port}`) return undefined
    if (control.pathname !== '/api/relay/devices/control' || control.search !== '' || control.hash !== '') {
      return undefined
    }
    const heartbeatIntervalMs = record.heartbeatIntervalMs
    if (heartbeatIntervalMs != null && !isBoundedInteger(heartbeatIntervalMs, 1_000, 15 * 60_000)) {
      return undefined
    }
    return {
      apiBaseUrl: api.toString(),
      controlWebSocketUrl: control.toString(),
      version: 1,
      ...(heartbeatIntervalMs == null ? {} : { heartbeatIntervalMs })
    }
  } catch {
    return undefined
  }
}
