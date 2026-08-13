import { createHash } from 'node:crypto'

import type { ChannelInboundEvent } from '@oneworks/core/channel'
import { DefinitionLoader } from '@oneworks/definition-loader'

import { getDb } from '#~/db/index.js'
import { createAgentRoomService } from '#~/services/agent-room/index.js'
import { getWorkspaceFolder } from '#~/services/config/index.js'

import type { ChannelRuntimeState } from './types'

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const defaultReceiveIdType = (channelType: string) => {
  if (channelType === 'lark') return 'chat_id'
  if (channelType === 'wechat') return 'chatroom'
  return 'room'
}

const matchesConversation = (
  state: ChannelRuntimeState,
  link: NonNullable<ChannelRuntimeState['channelLinks']>[number],
  inbound: ChannelInboundEvent
) =>
  state.type === inbound.channelType &&
  link.address?.kind === inbound.sessionType &&
  link.address.id === inbound.channelId

const externalRoomId = (inbound: ChannelInboundEvent) =>
  `room_external_${
    createHash('sha256').update(`${inbound.channelType}:${inbound.channelId}`).digest('hex').slice(0, 24)
  }`

const externalRoomTitle = (inbound: ChannelInboundEvent, linkLabel: string | undefined) => {
  const platform = inbound.channelType === 'lark' ? '飞书群' : `${inbound.channelType} 群`
  return linkLabel == null ? `${platform} · ${inbound.channelId.slice(-6)}` : `${platform} · ${linkLabel}`
}

export const resolveAgentRoomConnectionsForInbound = async (input: {
  inbound: ChannelInboundEvent
  states: Iterable<ChannelRuntimeState>
}) => {
  const { inbound } = input
  const matchingLinks = [...input.states].flatMap(state =>
    (state.channelLinks ?? []).flatMap(link => matchesConversation(state, link, inbound) ? [{ link, state }] : [])
  )
  const db = getDb()
  const storedConnections = db.findAgentRoomChannelConnections({
    channelId: inbound.channelId,
    channelType: inbound.channelType
  })
  let connections = storedConnections.filter(connection => connection.status !== 'removed')
  if (storedConnections.length > 0 && connections.length === 0) return []
  if (matchingLinks.length === 0 && storedConnections.length === 0) return []

  const definitions = matchingLinks.length === 0
    ? []
    : await new DefinitionLoader(getWorkspaceFolder()).loadDefaultEntities()
  const entities = new Map(definitions.map(definition => {
    const entityId = definition.resolvedName ?? definition.attributes.name
    return [entityId, {
      avatar: trimNonEmpty(definition.attributes.avatar),
      description: trimNonEmpty(definition.attributes.description),
      label: trimNonEmpty(definition.attributes.name) ?? entityId
    }] as const
  }))

  if (connections.length === 0) {
    const roomId = externalRoomId(inbound)
    const service = createAgentRoomService()
    if (db.getAgentRoom(roomId) == null) {
      service.createRoom({ id: roomId, title: externalRoomTitle(inbound, matchingLinks[0]?.link.name) })
    }
    for (const { link } of matchingLinks) {
      const entity = entities.get(link.entity)
      service.upsertMember(roomId, {
        ...(entity?.avatar == null ? {} : { avatar: entity.avatar }),
        key: link.entity,
        kind: 'entity',
        label: entity?.label ?? link.entity,
        ...(entity?.description == null ? {} : { subtitle: entity.description })
      })
    }
  }

  const candidateRoomIds = connections.length === 0
    ? [externalRoomId(inbound)]
    : [...new Set(connections.map(connection => connection.roomId))]
  for (const roomId of candidateRoomIds) {
    const memberKeys = new Set(db.listAgentRoomMembers(roomId).map(member => member.key))
    for (const { link, state } of matchingLinks) {
      const memberKey = memberKeys.has(link.entity)
        ? link.entity
        : memberKeys.has(`entity:${link.entity}`)
        ? `entity:${link.entity}`
        : undefined
      if (memberKey == null) continue
      const existing = db.listAgentRoomChannelConnectionsForMember(roomId, memberKey)
        .find(connection => connection.channelLinkName === link.name)
      if (existing?.status === 'removed') continue
      const roomPolicy = link.ingress.room
      db.saveAgentRoomChannelConnection({
        ...(existing ?? {}),
        ...(trimNonEmpty(state.config?.title) == null ? {} : { accountLabel: trimNonEmpty(state.config?.title) }),
        channelId: inbound.channelId,
        channelKey: state.key,
        channelLinkName: link.name,
        channelType: state.type,
        ...(trimNonEmpty(roomPolicy?.commandPrefix) == null
          ? {}
          : { commandPrefix: trimNonEmpty(roomPolicy?.commandPrefix) }),
        conversationKind: 'group',
        entity: link.entity,
        label: link.name,
        lastSeenAt: Date.now(),
        memberKey,
        muted: existing?.muted ?? roomPolicy?.muted ?? false,
        receiveId: inbound.replyTo?.receiveId ?? inbound.channelId,
        receiveIdType: inbound.replyTo?.receiveIdType ?? defaultReceiveIdType(inbound.channelType),
        requireMention: existing?.requireMention ?? roomPolicy?.requireMention ?? false,
        roomId,
        status: state.status === 'connected' ? 'active' : 'unavailable',
        ...(inbound.threadId == null ? {} : { threadId: inbound.threadId })
      })
    }
  }
  connections = db.findAgentRoomChannelConnections({
    channelId: inbound.channelId,
    channelType: inbound.channelType
  }).filter(connection => connection.status !== 'removed')
  return connections
}
