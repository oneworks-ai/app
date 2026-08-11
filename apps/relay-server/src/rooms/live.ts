import { randomUUID } from 'node:crypto'

import type { RelayRoomAction, RelayRoomLiveRequest, RelayRoomLiveResponse, RelaySharedRoom } from './types.js'

const REQUEST_TIMEOUT_MS = 15_000

interface PendingRequest {
  deviceId: string
  operationId: string
  resolve: (value: RelayRoomLiveResponse) => void
  shareId: string
  timer: ReturnType<typeof setTimeout>
}

export interface RelayRoomLiveGateway {
  clearOwner: (deviceId: string, send: (frame: unknown) => void) => void
  forward: (input: {
    action: RelayRoomAction
    body?: unknown
    operationId: string
    room: RelaySharedRoom
    teamIds: string[]
    userId: string
  }) => Promise<RelayRoomLiveResponse>
  hasOwner: (deviceId: string) => boolean
  receiveResponse: (input: { deviceId: string; frame: unknown }) => boolean
  setOwner: (input: { deviceId: string; send: (frame: unknown) => void }) => void
}

const isResponse = (value: unknown): value is RelayRoomLiveResponse => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.type === 'room-response' && typeof record.requestId === 'string' &&
    typeof record.shareId === 'string' &&
    typeof record.ok === 'boolean'
}

export const createRelayRoomLiveGateway = (): RelayRoomLiveGateway => {
  const owners = new Map<string, (frame: unknown) => void>()
  const pending = new Map<string, PendingRequest>()
  const clearPending = (requestId: string, value: RelayRoomLiveResponse) => {
    const request = pending.get(requestId)
    if (request == null) return
    clearTimeout(request.timer)
    pending.delete(requestId)
    request.resolve(value)
  }
  return {
    clearOwner: (deviceId, send) => {
      if (owners.get(deviceId) !== send) return
      owners.delete(deviceId)
      for (const [requestId, request] of pending) {
        if (request.deviceId !== deviceId) continue
        clearTimeout(request.timer)
        pending.delete(requestId)
        request.resolve({
          error: 'owner_offline',
          ok: false,
          operationId: request.operationId,
          requestId,
          shareId: request.shareId
        })
      }
    },
    forward: async ({ action, body, operationId, room, teamIds, userId }) => {
      const send = owners.get(room.ownerDeviceId)
      const requestId = randomUUID()
      if (send == null) {
        return { error: 'owner_offline', ok: false, operationId, requestId, shareId: room.shareId }
      }
      return await new Promise<RelayRoomLiveResponse>(resolve => {
        const timer = setTimeout(() =>
          clearPending(requestId, {
            error: 'timeout',
            ok: false,
            operationId,
            requestId,
            shareId: room.shareId
          }), REQUEST_TIMEOUT_MS)
        ;(timer as { unref?: () => void }).unref?.()
        pending.set(requestId, { deviceId: room.ownerDeviceId, operationId, resolve, shareId: room.shareId, timer })
        try {
          send(
            {
              action,
              ...(body === undefined ? {} : { body }),
              operationId,
              principal: { id: userId, teamIds, type: 'user' },
              requestId,
              shareId: room.shareId,
              type: 'room-request'
            } satisfies RelayRoomLiveRequest & { type: 'room-request' }
          )
        } catch {
          clearPending(requestId, {
            error: 'owner_offline',
            ok: false,
            operationId,
            requestId,
            shareId: room.shareId
          })
        }
      })
    },
    hasOwner: deviceId => owners.has(deviceId),
    receiveResponse: ({ deviceId, frame }) => {
      if (!isResponse(frame)) return false
      const pendingRequest = pending.get(frame.requestId)
      if (pendingRequest == null) return true
      if (pendingRequest.deviceId !== deviceId || pendingRequest.shareId !== frame.shareId) return false
      const response = frame as RelayRoomLiveResponse & { type: 'room-response' }
      clearTimeout(pendingRequest.timer)
      pending.delete(response.requestId)
      pendingRequest.resolve({
        ...(response.body === undefined ? {} : { body: response.body }),
        ...(response.error === 'room_unavailable' ? { error: response.error } : {}),
        ok: response.ok,
        operationId: pendingRequest.operationId,
        requestId: response.requestId,
        shareId: response.shareId
      })
      return true
    },
    setOwner: ({ deviceId, send }) => {
      owners.set(deviceId, send)
    }
  }
}
