/* eslint-disable max-lines -- Room owner publication and live ACL enforcement share one facade boundary. */
import type { RelayRoomDescriptor } from '@oneworks/types'

import { getDb } from '#~/db/index.js'
import type { PluginRoomRelayFacade } from '#~/services/plugins/types.js'

import { createAgentRoomService } from './index.js'
import { createAgentRoomRelayRegistryLease } from './relay-registry.js'
import {
  isRecord,
  parseGrants,
  parseMessageBody,
  requiredPermissions,
  resolveRelayRoomInteraction,
  resolveRelayRoomRun,
  sanitizeDetail,
  text
} from './relay-request.js'
import { subscribeAgentRoomShareChanged } from './share-events.js'

interface TunnelRegistration {
  connected: boolean
  ownerDeviceId: string
  ownerLabel?: string
  ownerSourceId: string
  ownerUserId: string
  publishDescriptor: (descriptor: RelayRoomDescriptor) => boolean
  unsubscribeConnection: () => void
}

export { listActiveAgentRoomRelayOwners, listSharedAgentRoomDirectory } from './relay-registry.js'

export interface AgentRoomRelayFacade extends PluginRoomRelayFacade {
  dispose: () => void
}

export const createAgentRoomRelayFacade = (): AgentRoomRelayFacade => {
  const db = getDb()
  const service = createAgentRoomService(db)
  const registrations = new Map<string, TunnelRegistration>()
  const registry = createAgentRoomRelayRegistryLease()

  const registrationsForRoom = (roomId: string) => {
    const room = db.getAgentRoom(roomId)
    if (room == null) return []
    const all = [...registrations.values()].filter(item => item.connected)
    if (room.owner.accountId == null || room.owner.nodeId == null || room.owner.sourceId == null) return []
    return all.filter(item => (
      item.ownerUserId === room.owner.accountId && item.ownerDeviceId === room.owner.nodeId &&
      item.ownerSourceId === room.owner.sourceId
    ))
  }

  const publishRoomToRegistration = (roomId: string, registration: TunnelRegistration) => {
    const room = db.getAgentRoom(roomId)
    if (room == null) return
    if (
      !registration.connected || room.owner.accountId !== registration.ownerUserId ||
      room.owner.nodeId !== registration.ownerDeviceId || room.owner.sourceId !== registration.ownerSourceId
    ) return
    for (const share of db.listAgentRoomShares(roomId)) {
      registration.publishDescriptor({
        acls: share.grants.map(grant => ({
          permissions: grant.permissions,
          principalId: grant.principalId,
          principalType: grant.principalType
        })),
        createdAt: new Date(share.createdAt).toISOString(),
        ownerDeviceId: registration.ownerDeviceId,
        ownerNodeId: room.owner.nodeId,
        ownerUserId: registration.ownerUserId,
        shareId: share.id,
        status: share.status,
        title: room.title,
        updatedAt: new Date(share.updatedAt).toISOString()
      })
    }
  }

  const publishRoom = (roomId: string) => {
    for (const registration of registrationsForRoom(roomId)) {
      publishRoomToRegistration(roomId, registration)
    }
  }

  const unsubscribe = subscribeAgentRoomShareChanged(publishRoom)

  return {
    dispose: () => {
      unsubscribe()
      for (const registration of registrations.values()) registration.unsubscribeConnection()
      registrations.clear()
      registry.dispose()
    },
    registerDirectoryClient: registry.registerDirectoryClient,
    registerTunnel: (tunnel, owner) => {
      const localKey = `${owner.ownerSourceId}:${owner.ownerUserId}:${owner.ownerDeviceId}`
      registrations.get(localKey)?.unsubscribeConnection()
      registry.setOwner(localKey)
      const registration: TunnelRegistration = {
        ...owner,
        connected: tunnel.isConnected(),
        publishDescriptor: tunnel.publishDescriptor,
        unsubscribeConnection: () => {}
      }
      const updateConnection = (connected: boolean) => {
        if (registrations.get(localKey) !== registration) return
        registration.connected = connected
        if (connected) {
          registry.setOwner(localKey, {
            accountId: registration.ownerUserId,
            label: registration.ownerLabel?.trim() || 'Relay account',
            nodeId: registration.ownerDeviceId,
            sourceId: registration.ownerSourceId
          })
          for (const room of db.listAgentRooms('all')) publishRoomToRegistration(room.id, registration)
        } else {
          registry.setOwner(localKey)
        }
      }
      registration.unsubscribeConnection = tunnel.subscribeConnection(updateConnection)
      registrations.set(localKey, registration)
      updateConnection(tunnel.isConnected())
    },
    handleRequest: async (request, ownerSourceId) => {
      const share = db.getAgentRoomShare(request.shareId)
      if (share == null || share.status !== 'active') throw new Error('Room share is unavailable.')
      const room = db.getAgentRoom(share.roomId)
      if (room == null) throw new Error('Room is unavailable.')
      if (room.owner.sourceId !== ownerSourceId) throw new Error('Room is unavailable.')
      const isOwner = room.owner.accountId === request.principal.id && room.owner.sourceId === ownerSourceId
      const detail = service.getOwnerSnapshot(share.roomId)
      if (detail == null) throw new Error('Room is unavailable.')
      const teamIds = new Set(request.principal.teamIds ?? [])
      const permissions = new Set(share.grants.flatMap(grant => (
        (grant.principalType === 'user' && grant.principalId === request.principal.id) ||
          (grant.principalType === 'team' && teamIds.has(grant.principalId))
          ? grant.permissions
          : []
      )))
      if (!isOwner && requiredPermissions(request.action).some(permission => !permissions.has(permission))) {
        throw new Error('Room permission denied.')
      }

      if (request.action === 'view') {
        return sanitizeDetail(detail)
      }
      if (request.action === 'open_run') {
        const run = isRecord(request.body) ? resolveRelayRoomRun(detail, request.body.runRef) : undefined
        if (run == null) throw new Error('Room run is unavailable.')
        return sanitizeDetail({ ...detail, messages: [], runs: [run] }).runs[0]
      }
      if (request.action === 'approve') {
        const interactionId = isRecord(request.body)
          ? resolveRelayRoomInteraction(detail, request.body.interactionRef)
          : undefined
        const data = isRecord(request.body) ? request.body.data : undefined
        if (interactionId == null || (typeof data !== 'string' && !Array.isArray(data))) {
          throw new Error('Invalid Room approval response.')
        }
        const handled = await service.respondInteraction(share.roomId, interactionId, data as string | string[])
        if (!handled) throw new Error('Room approval is no longer pending.')
        return { handled: true }
      }
      if (request.action === 'manage_share') {
        const operation = isRecord(request.body) ? text(request.body.operation) : undefined
        if (operation === 'revoke') {
          await service.executeCommand(share.roomId, {
            idempotencyKey: `relay:${request.shareId}:${request.principal.id}:${request.operationId}`,
            type: 'revoke_share',
            shareId: request.shareId
          })
          return { handled: true }
        }
        if (operation === 'create' && isRecord(request.body)) {
          await service.executeCommand(share.roomId, {
            idempotencyKey: `relay:${request.shareId}:${request.principal.id}:${request.operationId}`,
            type: 'create_share',
            share: { grants: parseGrants(request.body.grants) }
          })
          return { handled: true }
        }
        throw new Error('Invalid Room share operation.')
      }

      const message = parseMessageBody(request.body, detail)
      if (request.action === 'send' && message.target != null) {
        throw new Error('Targeted Room delivery requires target_member permission.')
      }
      if (request.action === 'target_member' && message.target == null) {
        throw new Error('Targeted Room delivery requires a target.')
      }
      await service.executeCommand(share.roomId, {
        idempotencyKey: `relay:${request.shareId}:${request.principal.id}:${request.operationId}`,
        type: 'append_message',
        message: {
          content: message.content,
          origin: {
            accountId: request.principal.id,
            channelId: request.shareId,
            channelKey: `relay:${request.shareId}`,
            channelType: 'oneworks',
            conversationKind: 'room',
            conversationLabel: room.title
          },
          ...(message.target == null ? {} : { target: message.target })
        }
      })
      return { handled: true }
    }
  }
}
