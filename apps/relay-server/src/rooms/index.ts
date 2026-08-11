import { deviceTokenHashMatches, hashDeviceToken } from '../devices/private-metadata.js'
import { parseRelayControlFrame, validateRelayControlAttachment } from '../platform/control-heartbeat.js'
import type { RelayControlAttachment, RelayControlFrame } from '../platform/control-heartbeat.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import { now } from '../utils.js'
import { createRelayRoomLiveGateway } from './live.js'
import { normalizeRelaySharedRoom } from './store.js'
import type { RelayRoomAction, RelaySharedRoom } from './types.js'

export interface RelayRooms {
  bindOwner: (input: { deviceId: string; send: (frame: unknown) => void }) => () => void
  forward: (input: {
    action: RelayRoomAction
    body?: unknown
    operationId: string
    room: RelaySharedRoom
    teamIds: string[]
    userId: string
  }) => Promise<{ body?: unknown; error?: 'owner_offline' | 'room_unavailable' | 'timeout'; ok: boolean }>
  handleControlFrame: (input: {
    attachment: RelayControlAttachment
    frame: RelayControlFrame
    repository: RelayStoreRepository
  }) => Promise<'applied' | 'frame-too-large' | 'invalid-frame' | 'revoked' | 'unhandled'>
  isOwnerOnline: (deviceId: string) => boolean
  listVisible: (
    store: { sharedRooms?: RelaySharedRoom[]; teamMembers: Array<{ teamId: string; userId: string }> },
    userId: string
  ) => RelaySharedRoom[]
}

const hasPermission = (room: RelaySharedRoom, userId: string, permission: string, teamIds: Set<string>) => (
  room.acls.some(grant =>
    grant.permissions.includes(permission as never) && (
      (grant.principalType === 'user' && grant.principalId === userId) ||
      (grant.principalType === 'team' && teamIds.has(grant.principalId))
    )
  )
)

const canUse = (room: RelaySharedRoom, userId: string, permission: string, teamIds: Set<string>) => (
  room.ownerUserId === userId || hasPermission(room, userId, permission, teamIds)
)

const roomFromDescriptorFrame = (
  frame: Record<string, unknown>,
  attachment: RelayControlAttachment,
  userId: string
) => {
  if (frame.type !== 'room-descriptor') return undefined
  const room = normalizeRelaySharedRoom(frame.descriptor)
  if (
    room == null || room.acls.length === 0 || room.ownerDeviceId !== attachment.deviceId ||
    room.ownerNodeId !== attachment.deviceId || room.ownerUserId !== userId
  ) return undefined
  return room
}

const attachmentOwner = (
  store: { devices: Array<{ deviceToken?: string; deviceTokenHash?: string; id: string; userId?: string }> },
  attachment: RelayControlAttachment
) => {
  const device = store.devices.find(candidate =>
    candidate.id === attachment.deviceId && (
      deviceTokenHashMatches(candidate.deviceTokenHash, attachment.deviceTokenHash) || (
        candidate.deviceToken != null &&
        deviceTokenHashMatches(hashDeviceToken(candidate.deviceToken), attachment.deviceTokenHash)
      )
    )
  )
  return device?.userId
}

export const createRelayRooms = (): RelayRooms => {
  const live = createRelayRoomLiveGateway()
  return {
    bindOwner: ({ deviceId, send }) => {
      live.setOwner({ deviceId, send })
      return () => live.clearOwner(deviceId, send)
    },
    forward: async ({ action, body, operationId, room, teamIds, userId }) => {
      // The request body enters this function only to be immediately tunneled; do not add logging or persistence here.
      return await live.forward({ action, body, operationId, room, teamIds, userId })
    },
    handleControlFrame: async ({ attachment, frame: rawFrame, repository }) => {
      const frame = parseRelayControlFrame(rawFrame)
      if (frame === 'frame-too-large') return frame
      if (frame == null) return 'invalid-frame'
      if (frame.type !== 'room-descriptor' && frame.type !== 'room-response') return 'unhandled'
      if (!await validateRelayControlAttachment({ attachment, repository })) return 'revoked'
      let result: 'applied' | 'invalid-frame' | 'revoked' = 'revoked'
      await (repository.withStore != null
        ? repository.withStore(async (store, scopedRepository) => {
          const ownerUserId = attachmentOwner(store, attachment)
          if (ownerUserId == null) return
          if (frame.type === 'room-descriptor') {
            const room = roomFromDescriptorFrame(frame, attachment, ownerUserId)
            if (room == null) {
              result = 'invalid-frame'
              return
            }
            const current = store.sharedRooms ?? []
            const existing = current.find(item => item.shareId === room.shareId)
            if (
              existing != null &&
              (existing.ownerDeviceId !== attachment.deviceId || existing.ownerUserId !== ownerUserId)
            ) {
              result = 'revoked'
              return
            }
            const timestamp = now()
            const next = {
              ...room,
              createdAt: existing?.createdAt ?? room.createdAt ?? timestamp,
              updatedAt: timestamp
            }
            store.sharedRooms = [...current.filter(item => item.shareId !== room.shareId), next]
            await scopedRepository.write(store)
            result = 'applied'
            return
          }
          result = live.receiveResponse({ deviceId: attachment.deviceId, frame }) ? 'applied' : 'invalid-frame'
        })
        : Promise.resolve())
      return result
    },
    isOwnerOnline: deviceId => live.hasOwner(deviceId),
    listVisible: (store, userId) => {
      const teamIds = new Set(store.teamMembers.filter(member => member.userId === userId).map(member => member.teamId))
      return (store.sharedRooms ?? []).filter(room => room.status === 'active' && canUse(room, userId, 'view', teamIds))
    }
  }
}
