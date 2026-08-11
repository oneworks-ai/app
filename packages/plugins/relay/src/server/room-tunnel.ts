import type { RelayRoomLiveRequest } from '@oneworks/types'

/**
 * Live Room traffic has no fallback transport.  The caller owns ACL re-checks
 * and Room mutation; this object only speaks the authenticated control socket.
 */
export type RelayRoomTunnelRequest = RelayRoomLiveRequest

export interface RelayRoomTunnel {
  clearTransport: (send: (frame: string) => void) => void
  handleFrame: (frame: unknown) => boolean
  isConnected: () => boolean
  publishDescriptor: (descriptor: unknown) => boolean
  setRequestHandler: (handler: ((request: RelayRoomTunnelRequest) => Promise<unknown>) | undefined) => void
  setTransport: (send: (frame: string) => void) => void
  subscribeConnection: (listener: (connected: boolean) => void) => () => void
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asRequest = (value: unknown): RelayRoomTunnelRequest | undefined => {
  if (!isRecord(value) || value.type !== 'room-request') return undefined
  const action = value.action
  const principal = isRecord(value.principal) ? value.principal : undefined
  if (
    (action !== 'approve' && action !== 'manage_share' && action !== 'open_run' && action !== 'send' &&
      action !== 'target_member' && action !== 'view') ||
    typeof value.operationId !== 'string' || typeof value.requestId !== 'string' || typeof value.shareId !== 'string' ||
    principal?.type !== 'user' || typeof principal.id !== 'string'
  ) return undefined
  return {
    action,
    ...(value.body === undefined ? {} : { body: value.body }),
    principal: {
      id: principal.id,
      ...(Array.isArray(principal.teamIds)
        ? { teamIds: principal.teamIds.filter((teamId): teamId is string => typeof teamId === 'string') }
        : {}),
      type: 'user'
    },
    operationId: value.operationId,
    requestId: value.requestId,
    shareId: value.shareId
  }
}

export const createRelayRoomTunnel = (): RelayRoomTunnel => {
  let send: ((frame: string) => void) | undefined
  let handler: ((request: RelayRoomTunnelRequest) => Promise<unknown>) | undefined
  const connectionListeners = new Set<(connected: boolean) => void>()
  const notifyConnection = (connected: boolean) => {
    for (const listener of connectionListeners) listener(connected)
  }
  const respond = (
    request: RelayRoomTunnelRequest,
    result: { body?: unknown; error?: 'room_unavailable'; ok: boolean }
  ) => {
    if (send == null) return
    send(JSON.stringify({
      ...(result.body === undefined ? {} : { body: result.body }),
      ...(result.error == null ? {} : { error: result.error }),
      ok: result.ok,
      requestId: request.requestId,
      shareId: request.shareId,
      type: 'room-response'
    }))
  }
  return {
    clearTransport: candidate => {
      if (send !== candidate) return
      send = undefined
      notifyConnection(false)
    },
    handleFrame: frame => {
      const request = asRequest(frame)
      if (request == null) return false
      void (handler == null
        ? Promise.resolve({ error: 'room_unavailable' as const, ok: false })
        : handler(request).then(body => ({ body, ok: true })).catch(() => ({
          error: 'room_unavailable' as const,
          ok: false
        }))).then(result => respond(request, result))
      return true
    },
    isConnected: () => send != null,
    publishDescriptor: descriptor => {
      if (send == null) return false
      send(JSON.stringify({ descriptor, type: 'room-descriptor' }))
      return true
    },
    setRequestHandler: next => {
      handler = next
    },
    setTransport: next => {
      const wasConnected = send != null
      send = next
      if (!wasConnected) notifyConnection(true)
    },
    subscribeConnection: listener => {
      connectionListeners.add(listener)
      return () => connectionListeners.delete(listener)
    }
  }
}
