import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { resolveAuthContext } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayRooms } from '../rooms/index.js'
import type { RelayRoomPermission } from '../rooms/types.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayServerArgs, RelayStore } from '../types.js'

const ROOM_OPERATION_ID_HEADER = 'x-oneworks-room-operation-id'
const ROOM_OPERATION_ID_PATTERN = /^\w[\w.:-]{0,127}$/u

const resolveOperationId = (req: IncomingMessage) => {
  const value = req.headers[ROOM_OPERATION_ID_HEADER]
  if (value == null) return req.method === 'GET' ? randomUUID() : undefined
  if (Array.isArray(value) || !ROOM_OPERATION_ID_PATTERN.test(value)) return undefined
  return value
}

const actionForPath = {
  approve: 'approve',
  'manage-share': 'manage_share',
  'open-run': 'open_run',
  send: 'send',
  'target-member': 'target_member',
  view: 'view'
} as const

export const handleRelayRoomsRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  repository: RelayStoreRepository,
  url: URL,
  rooms: RelayRooms
) => {
  if (!url.pathname.startsWith('/api/relay/rooms')) return false
  const auth = resolveAuthContext(req, args, store)
  if (auth?.user == null) {
    sendJson(res, 401, { error: 'Authentication required.' }, args.allowOrigin)
    return true
  }
  if (req.method === 'GET' && url.pathname === '/api/relay/rooms') {
    const visible = rooms.listVisible(store, auth.user.id).map(room => ({
      availability: rooms.isOwnerOnline(room.ownerDeviceId) ? 'online' : 'offline',
      createdAt: room.createdAt,
      ...(room.icon == null ? {} : { icon: room.icon }),
      shareId: room.shareId,
      status: room.status,
      title: room.title,
      updatedAt: room.updatedAt
    }))
    sendJson(res, 200, { rooms: visible }, args.allowOrigin)
    return true
  }
  const match = /^\/api\/relay\/rooms\/([^/]+)\/(approve|manage-share|open-run|send|target-member|view)$/
    .exec(url.pathname)
  const isView = match?.[2] === 'view'
  if (match == null || (isView ? req.method !== 'GET' : req.method !== 'POST')) {
    sendJson(res, 404, { error: 'Not found.' }, args.allowOrigin)
    return true
  }
  const shareId = decodeURIComponent(match[1]!)
  const body = isView ? undefined : await readRequestBody(req, { maxBytes: 32 * 1024 })
  const fresh = await repository.read()
  const room = (fresh.sharedRooms ?? []).find(item => item.shareId === shareId && item.status === 'active')
  if (room == null) {
    sendJson(res, 404, { error: 'Room unavailable.', code: 'room_unavailable' }, args.allowOrigin)
    return true
  }
  const visible = rooms.listVisible(fresh, auth.user.id).some(item => item.shareId === shareId)
  const action = actionForPath[match[2] as keyof typeof actionForPath]
  const requiredPermissions: RelayRoomPermission[] = action === 'target_member'
    ? ['send', 'target_member']
    : [action]
  const permitted = room.ownerUserId === auth.user.id || requiredPermissions.every(permission => (
    (fresh.sharedRooms ?? []).some(item => (
      item.shareId === shareId && rooms.listVisible(fresh, auth.user!.id).some(visibleRoom =>
        visibleRoom.shareId === shareId
      ) &&
      item.acls.some(grant =>
        grant.permissions.includes(permission) && (
          (grant.principalType === 'user' && grant.principalId === auth.user!.id) ||
          (grant.principalType === 'team' &&
            fresh.teamMembers.some(member => member.userId === auth.user!.id && member.teamId === grant.principalId))
        )
      )
    ))
  ))
  if (!visible || !permitted) {
    sendJson(res, 403, { error: 'Room permission denied.' }, args.allowOrigin)
    return true
  }
  const operationId = resolveOperationId(req)
  if (operationId == null) {
    sendJson(res, 400, { error: 'A valid Room operation identifier is required.' }, args.allowOrigin)
    return true
  }
  const teamIds = fresh.teamMembers.filter(member => member.userId === auth.user!.id).map(member => member.teamId)
  const result = await rooms.forward({ action, body, operationId, room, teamIds, userId: auth.user.id })
  const status = result.ok ? 200 : result.error === 'owner_offline' ? 503 : result.error === 'timeout' ? 504 : 503
  sendJson(res, status, result, args.allowOrigin)
  return true
}
