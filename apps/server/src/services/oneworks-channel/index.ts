/* eslint-disable max-lines -- the product facade keeps redacted rooms, trace, sharing, and scenarios aligned. */
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname } from 'node:path'

import type { OneWorksChannelConfig } from '@oneworks/channel-oneworks'
import { resolveDocumentDescription, resolveEntityIdentifier } from '@oneworks/definition-core'
import { DefinitionLoader } from '@oneworks/definition-loader'
import type { AgentRoom, AgentRoomShare, Entity, PluginRequestPrincipal } from '@oneworks/types'
import {
  AUTOMATIC_LEADER_DESCRIPTION,
  AUTOMATIC_LEADER_MEMBER_KEY,
  AUTOMATIC_LEADER_NAME,
  buildAutomaticLeaderSystemPrompt
} from './automatic-leader.js'
import type {
  OneWorksChannelScenario,
  OneWorksChannelScenarioPatch,
  OneWorksChannelSimulationInput,
  OneWorksChannelSimulationResult,
  OneWorksChannelSimulationTarget,
  OneWorksChannelTrace,
  OneWorksRoomEntity,
  OneWorksRoomPatchInput,
  OneWorksRoomShareInput,
  OneWorksRoomShareOwner,
  OneWorksRoomShareSummary,
  OneWorksRoomSummary,
  OneWorksSharedRoomSummary
} from './contract.js'
import {
  oneworksChannelScenarioInputSchema,
  oneworksChannelScenarioPatchSchema,
  oneworksChannelSimulationInputSchema,
  oneworksRoomPatchInputSchema,
  oneworksRoomShareInputSchema
} from './contract.js'
import type {
  OneWorksRoomChannelConnectionAttachInput,
  OneWorksRoomChannelConnectionCandidate,
  OneWorksRoomChannelConnectionPatchInput
} from './room-connections-contract.js'
import {
  oneworksRoomChannelConnectionAttachInputSchema,
  oneworksRoomChannelConnectionPatchInputSchema
} from './room-connections-contract.js'
import type { OneWorksRoomCreateInput } from './room-create-contract.js'
import { oneworksRoomCreateInputSchema } from './room-create-contract.js'

import { getChannelManager } from '#~/channels/index.js'
import type { ChannelRuntimeState } from '#~/channels/types.js'
import { handleChannelWebhook } from '#~/channels/webhook.js'
import { getDb } from '#~/db/index.js'
import type { ChannelScenarioRow } from '#~/db/index.js'
import { resolveAgentRoomChannelConnection } from '#~/services/agent-room/channel-link.js'
import { createAgentRoomService } from '#~/services/agent-room/index.js'
import { createAgentRoomOwner } from '#~/services/agent-room/owner.js'
import { listActiveAgentRoomRelayOwners, listSharedAgentRoomDirectory } from '#~/services/agent-room/relay.js'
import { publishClientEvent } from '#~/services/client-events.js'
import { getWorkspaceFolder } from '#~/services/config/index.js'
import { requirePluginRequestPermission } from '#~/services/plugins/types.js'
import { createSessionWithInitialMessage } from '#~/services/session/create.js'
import { resolveWorkspaceImageResource } from '#~/services/workspace/media.js'
import { buildOneWorksWebhookSignature } from '@oneworks/channel-oneworks/webhook-signature'

const MAX_TRACE_ITEMS = 100
const requireProductAccess = (principal: PluginRequestPrincipal) =>
  requirePluginRequestPermission(principal, 'workspace:manage')
const fingerprint = (namespace: string, value: string) =>
  createHash('sha256').update(`${namespace}:${value}`).digest('hex').slice(0, 16)

const resolveEntityName = (entity: { attributes: Entity; path: string }) =>
  entity.attributes.name?.trim() || resolveEntityIdentifier(entity.path) || 'Entity'

const toProductEntity = (entity: {
  attributes: Entity
  body?: string
  path: string
  resolvedName?: string
  resolvedSource?: string
}): OneWorksRoomEntity => {
  const name = resolveEntityName(entity)
  const avatar = entity.attributes.avatar?.trim()
  const entityId = entity.resolvedName?.trim() || resolveEntityIdentifier(entity.path, entity.attributes.name)
  return {
    ...(avatar == null ? {} : { avatar }),
    description: resolveDocumentDescription(entity.body ?? '', entity.attributes.description, name),
    entityId,
    name,
    relatedEntityIds: [],
    source: entity.resolvedSource === 'plugin' ? 'plugin' : 'project',
    teamRole: entity.attributes.team?.role === 'leader' ? 'leader' : 'member'
  }
}

const getEntityReferences = (definition: {
  attributes: Entity
  path: string
  resolvedName?: string
}) => [
  ...new Set([
    definition.resolvedName?.trim(),
    definition.attributes.name?.trim(),
    basename(dirname(definition.path))
  ].filter((value): value is string => value != null && value !== ''))
]

const resolveAvailableAvatar = async (value: string | undefined) => {
  const avatar = value?.trim()
  if (avatar == null || avatar === '') return undefined
  if (/^(?:blob:|data:|https?:\/\/)/u.test(avatar)) return avatar
  try {
    await resolveWorkspaceImageResource(avatar)
    return avatar
  } catch {
    return undefined
  }
}

const toAvailableProductEntity = async (definition: {
  attributes: Entity
  body?: string
  path: string
  resolvedName?: string
  resolvedSource?: string
}): Promise<OneWorksRoomEntity> => {
  const entity = toProductEntity(definition)
  const avatar = await resolveAvailableAvatar(entity.avatar)
  const { avatar: _avatar, ...fallback } = entity
  return avatar == null ? fallback : { ...fallback, avatar }
}

const resolveProductEntityCatalog = async (
  definitions: Array<{
    attributes: Entity
    body?: string
    path: string
    resolvedName?: string
    resolvedSource?: string
  }>
) => {
  const baseByReference = new Map<string, OneWorksRoomEntity>()
  const ambiguousReferences = new Set<string>()
  const baseEntities = await Promise.all(definitions.map(toAvailableProductEntity))
  for (const [index, definition] of definitions.entries()) {
    const entity = baseEntities[index]!
    for (const reference of getEntityReferences(definition)) {
      if (ambiguousReferences.has(reference)) continue
      const existing = baseByReference.get(reference)
      if (existing != null && existing.entityId !== entity.entityId) {
        baseByReference.delete(reference)
        ambiguousReferences.add(reference)
        continue
      }
      baseByReference.set(reference, entity)
    }
  }

  const entities = baseEntities.map((entity, index) => {
    const definition = definitions[index]!
    const relatedReferences = entity.teamRole === 'leader' && Array.isArray(definition.attributes.team?.relatedEntities)
      ? definition.attributes.team.relatedEntities
      : []
    const relatedEntityIds = [
      ...new Set(relatedReferences.flatMap(reference => {
        if (typeof reference !== 'string') return []
        const related = baseByReference.get(reference.trim())
        return related == null || related.entityId === entity.entityId || related.teamRole === 'leader'
          ? []
          : [related.entityId]
      }))
    ]
    return { ...entity, relatedEntityIds }
  })
  const entitiesById = new Map(entities.map(entity => [entity.entityId, entity]))
  const byReference = new Map(
    [...baseByReference].flatMap(([reference, entity]) => {
      const resolved = entitiesById.get(entity.entityId)
      return resolved == null ? [] : [[reference, resolved] as const]
    })
  )
  return { byReference, entities }
}

const indexProductEntitiesByReference = async (
  definitions: Parameters<typeof resolveProductEntityCatalog>[0]
) => (await resolveProductEntityCatalog(definitions)).byReference

const deriveRoomTitle = (message: string) => {
  const firstLine = message.split('\n')[0]?.trim() || 'Team chat'
  return firstLine.length > 36 ? `${firstLine.slice(0, 36)}...` : firstLine
}

const publishRoomUpdated = (roomId: string, hostSessionId?: string) => {
  publishClientEvent('agent-rooms', {
    type: 'agent_room_updated',
    roomId,
    ...(hostSessionId == null ? {} : { hostSessionId })
  })
}

interface ProductRuntimeRoom extends OneWorksChannelSimulationTarget {
  channelId: string
  channelKey: string
}

const getChannelStates = () => {
  const manager = getChannelManager()
  return manager == null ? [] : [...manager.states.values()]
}

const listProductRuntimeRooms = (): ProductRuntimeRoom[] =>
  getChannelStates().flatMap((state): ProductRuntimeRoom[] => {
    const links = state.channelLinks ?? []
    const capabilities: OneWorksChannelSimulationTarget['capabilities'] = state.type === 'oneworks'
      ? ['scenarios', 'simulation']
      : []
    const commandPrefix = state.config?.commandPrefix?.trim() || '/'
    if (links.length === 0) {
      const roomRef = fingerprint('oneworks-simulation-target', `${state.type}:${state.key}:default`)
      return [{
        binding: 'default' as const,
        capabilities,
        channelId: state.key,
        channelKey: state.key,
        channelType: state.type,
        commandPrefix,
        label: `${state.type} connection ${roomRef.slice(0, 6)}`,
        roomRef,
        status: state.status
      }]
    }
    return links.flatMap(link => {
      if (link.address == null) return []
      const roomRef = fingerprint(
        'oneworks-simulation-target',
        `${state.type}:${state.key}:${link.address.kind}:${link.address.id}`
      )
      return [{
        binding: link.address.kind,
        capabilities,
        channelId: link.address.id,
        channelKey: state.key,
        channelType: state.type,
        commandPrefix,
        entity: link.entity,
        label: link.name,
        linkName: link.name,
        roomRef,
        status: state.status
      }]
    })
  })

const listProductRoomConnectionCandidates = async (): Promise<OneWorksRoomChannelConnectionCandidate[]> => {
  const states = getChannelStates()
  const accountLabels = new Map(states.map(state => [state.key, state.config?.title]))
  const entities = await indexProductEntitiesByReference(
    await new DefinitionLoader(getWorkspaceFolder()).loadDefaultEntities()
  )
  return listProductRuntimeRooms().flatMap(room => {
    if (room.binding !== 'group' || room.channelType === 'oneworks' || room.entity == null || room.linkName == null) {
      return []
    }
    const entity = entities.get(room.entity)
    if (entity == null) return []
    const accountLabel = accountLabels.get(room.channelKey)
    return [{
      ...(accountLabel == null ? {} : { accountLabel }),
      channelLinkName: room.linkName,
      channelType: room.channelType,
      conversationLabel: room.label,
      entityId: room.entity,
      entityName: entity.name,
      status: room.status
    }]
  })
}

const toPublicRoom = (
  { channelId: _channelId, channelKey: _channelKey, ...room }: ProductRuntimeRoom
): OneWorksChannelSimulationTarget => room

const resolveRoom = (roomRef: string) => listProductRuntimeRooms().find(room => room.roomRef === roomRef)

const toScenario = (row: ChannelScenarioRow): OneWorksChannelScenario => ({
  actorRole: row.actorRole,
  createdAt: row.createdAt,
  name: row.name,
  roomRef: row.roomRef,
  scenarioRef: fingerprint('oneworks-scenario', row.id),
  sessionType: row.sessionType,
  text: row.text,
  updatedAt: row.updatedAt,
  userLabel: row.userLabel
})

const resolveScenario = (scenarioRef: string) =>
  getDb().listChannelScenarios().find(row => fingerprint('oneworks-scenario', row.id) === scenarioRef)

const listProductRooms = async (): Promise<OneWorksRoomSummary[]> =>
  await Promise.all(
    getDb().listAgentRooms('all').map(async room => {
      const detail = getDb().getAgentRoomDetail(room.id)
      const links = detail?.channelConnections ?? []
      const [roomAvatar, memberAvatars] = await Promise.all([
        resolveAvailableAvatar(room.avatar),
        Promise.all((detail?.members ?? []).map(async member =>
          [
            member.key,
            await resolveAvailableAvatar(member.avatar)
          ] as const
        ))
      ])
      const memberAvatarByKey = new Map(memberAvatars)
      const platforms = new Map<string, { accountKeys: Set<string>; labels: Set<string> }>()
      for (const link of links) {
        const platform = platforms.get(link.channelType) ?? { accountKeys: new Set(), labels: new Set() }
        platform.accountKeys.add(link.channelKey)
        if (link.accountLabel != null && link.accountLabel.trim() !== '') platform.labels.add(link.accountLabel)
        platforms.set(link.channelType, platform)
      }
      const activeOwner = listActiveAgentRoomRelayOwners().find(owner =>
        owner.accountId === room.owner.accountId &&
        (room.owner.nodeId == null || owner.nodeId === room.owner.nodeId) &&
        (room.owner.sourceId == null || owner.sourceId === room.owner.sourceId)
      )
      return {
        activeShareCount: (detail?.shares ?? []).filter(share => share.status === 'active').length,
        archived: room.archivedAt != null,
        ...(roomAvatar == null ? {} : { avatar: roomAvatar }),
        channelConnectionCount: links.length,
        ...(room.description == null ? {} : { description: room.description }),
        favorited: room.favoritedAt != null,
        ...(room.lastMessage == null ? {} : { lastMessage: room.lastMessage }),
        memberCount: detail?.members.length ?? 0,
        members: (detail?.members ?? []).map(member => ({
          ...(memberAvatarByKey.get(member.key) == null ? {} : { avatar: memberAvatarByKey.get(member.key) }),
          channelConnections: links.filter(link => link.memberKey === member.key).map(link => ({
            ...(link.accountLabel == null ? {} : { accountLabel: link.accountLabel }),
            channelLinkName: link.channelLinkName,
            channelType: link.channelType,
            ...(link.commandPrefix == null ? {} : { commandPrefix: link.commandPrefix }),
            conversationLabel: link.label,
            ...(link.lastError == null ? {} : { lastError: link.lastError }),
            muted: link.muted,
            requireMention: link.requireMention,
            status: link.status
          })),
          ...(member.subtitle == null ? {} : { description: member.subtitle }),
          entityId: member.key,
          isLeader: room.leaderEntity === member.key || `entity:${room.leaderEntity}` === member.key,
          name: member.label
        })),
        messageCount: detail?.messages.length ?? 0,
        ...(activeOwner == null
          ? {}
          : {
            ownerRef: fingerprint(
              'oneworks-room-owner',
              `${activeOwner.sourceId}:${activeOwner.accountId}:${activeOwner.nodeId}`
            )
          }),
        platforms: [...platforms.entries()].map(([channelType, platform]) => ({
          accountCount: platform.accountKeys.size,
          channelType,
          labels: [...platform.labels]
        })),
        roomId: room.id,
        status: room.status,
        title: room.title,
        updatedAt: room.updatedAt
      }
    })
  )

const toRoomShareSummary = (
  roomTitle: string,
  share: AgentRoomShare
): OneWorksRoomShareSummary => ({
  createdAt: share.createdAt,
  grantCount: share.grants.length,
  permissions: [...new Set(share.grants.flatMap(grant => grant.permissions))],
  roomId: share.roomId,
  roomTitle,
  shareRef: fingerprint('oneworks-room-share', share.id),
  status: share.status,
  updatedAt: share.updatedAt
})

const listProductShares = (): OneWorksRoomShareSummary[] => {
  const db = getDb()
  return db.listAgentRooms('all').flatMap(room =>
    db.listAgentRoomShares(room.id).map(share => toRoomShareSummary(room.title, share))
  )
}

const listProductShareOwners = (): OneWorksRoomShareOwner[] =>
  listActiveAgentRoomRelayOwners().map(owner => ({
    label: owner.label,
    ownerRef: fingerprint('oneworks-room-owner', `${owner.sourceId}:${owner.accountId}:${owner.nodeId}`)
  }))

const timestamp = (value: string) => {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const listProductSharedRooms = async (): Promise<OneWorksSharedRoomSummary[]> =>
  (
    await listSharedAgentRoomDirectory()
  ).map(entry => ({
    availability: entry.room.availability,
    createdAt: timestamp(entry.room.createdAt),
    ...(entry.room.icon == null ? {} : { icon: entry.room.icon }),
    shareRef: fingerprint('oneworks-shared-room', `${entry.sourceRef}:${entry.room.shareId}`),
    sourceLabel: entry.sourceLabel,
    status: entry.room.status,
    title: entry.room.title,
    updatedAt: timestamp(entry.room.updatedAt)
  }))

const resolveProductShareOwner = (room: AgentRoom | undefined, ownerRef?: string) => {
  const owners = listActiveAgentRoomRelayOwners()
  const selectedByRef = ownerRef == null
    ? undefined
    : owners.find(owner => (
      fingerprint('oneworks-room-owner', `${owner.sourceId}:${owner.accountId}:${owner.nodeId}`) === ownerRef
    ))
  if (ownerRef != null && selectedByRef == null) {
    throw new Error('The selected Relay owner is not online.')
  }
  const ownerAccountId = room?.owner?.accountId
  const ownerSourceId = room?.owner?.sourceId
  const candidates = ownerAccountId == null
    ? owners
    : owners.filter(owner => (
      owner.accountId === ownerAccountId && (ownerSourceId == null || owner.sourceId === ownerSourceId)
    ))
  const selected = selectedByRef ?? (candidates.length === 1 ? candidates[0] : undefined)
  if (selected == null) {
    throw new Error(
      candidates.length === 0
        ? 'Connect a Relay account before sharing this Room.'
        : 'Select the Relay account that owns this Room.'
    )
  }
  if (ownerAccountId != null && ownerAccountId !== selected.accountId) {
    throw new Error('A Room cannot be moved to a different Relay owner account.')
  }
  if (ownerSourceId != null && ownerSourceId !== selected.sourceId) {
    throw new Error('A Room cannot be moved to a different Relay service.')
  }
  return selected
}

const resolveProductShare = (roomId: string, shareRef: string) => {
  const db = getDb()
  const room = db.getAgentRoom(roomId)
  if (room == null) return undefined
  const share = db.listAgentRoomShares(roomId).find(candidate =>
    fingerprint('oneworks-room-share', candidate.id) === shareRef
  )
  return share == null ? undefined : { room, share }
}

const injectSimulation = async (
  input: OneWorksChannelSimulationInput
): Promise<OneWorksChannelSimulationResult> => {
  const room = resolveRoom(input.roomRef)
  if (room == null || !room.capabilities.includes('simulation') || room.channelType !== 'oneworks') {
    throw new Error('The selected channel does not support simulation.')
  }
  const state = getChannelStates().find(
    (candidate): candidate is ChannelRuntimeState & { config: OneWorksChannelConfig } =>
      candidate.key === room.channelKey && candidate.type === 'oneworks' && candidate.config != null
  )
  const secret = state?.config.webhookSecret?.trim()
  if (state?.status !== 'connected' || secret == null || secret === '') {
    throw new Error('Simulation requires a connected OneWorks channel with a webhook secret.')
  }
  const timestamp = String(Date.now())
  const nonce = randomUUID().replaceAll('-', '')
  const body = {
    channelId: room.channelId,
    messageId: `simulation-${randomUUID()}`,
    mentionedBot: input.sessionType === 'group' ? true : undefined,
    senderId: fingerprint(
      'oneworks-simulation-user',
      `${room.channelKey}:${room.channelId}:${input.actorRole}:${input.userLabel}`
    ),
    sessionType: input.sessionType,
    simulation: { actorRole: input.actorRole, userLabel: input.userLabel },
    text: input.text
  }
  const rawBody = JSON.stringify(body)
  const result = await handleChannelWebhook({
    body,
    channelKey: room.channelKey,
    channelType: 'oneworks',
    headers: {
      'content-type': 'application/json',
      'x-oneworks-channel-nonce': nonce,
      'x-oneworks-channel-signature': buildOneWorksWebhookSignature({ body: rawBody, nonce, secret, timestamp }),
      'x-oneworks-channel-timestamp': timestamp,
      'x-oneworks-product-simulation': '1'
    },
    method: 'POST',
    query: {},
    rawBody,
    // This request is constructed inside the product process, not received from the network.
    // The OneWorks provider still requires a valid signature before honoring this marker.
    remoteAddress: '127.0.0.1'
  })
  return {
    accepted: result.statusCode === 200,
    ...(result.statusCode === 200 ? { messageRef: fingerprint('oneworks-message', body.messageId) } : {}),
    status: result.statusCode ?? 500
  }
}

export const createOneWorksChannelFacade = () => ({
  listEntities: async (principal: PluginRequestPrincipal): Promise<OneWorksRoomEntity[]> => {
    requireProductAccess(principal)
    const loader = new DefinitionLoader(getWorkspaceFolder())
    return (await resolveProductEntityCatalog(await loader.loadDefaultEntities())).entities
  },
  createRoom: async (principal: PluginRequestPrincipal, input: unknown): Promise<OneWorksRoomSummary> => {
    requireProductAccess(principal)
    const parsed: OneWorksRoomCreateInput = oneworksRoomCreateInputSchema.parse(input)
    const loader = new DefinitionLoader(getWorkspaceFolder())
    const catalog = await resolveProductEntityCatalog(await loader.loadDefaultEntities())
    const available = new Map(catalog.entities.map(entity => [entity.entityId, entity]))
    const automaticLeader = parsed.leaderMode === 'automatic'
    const leaderEntityId = automaticLeader ? undefined : parsed.leaderEntityId ?? parsed.entityIds[0]!
    const leader = leaderEntityId == null ? undefined : available.get(leaderEntityId)
    if (!automaticLeader && leader == null) throw new Error('The selected leader entity no longer exists.')
    if (leader != null && leader.teamRole !== 'leader') {
      throw new Error('The selected entity is not registered as a Team Chat leader.')
    }
    const requestedMemberIds = automaticLeader
      ? parsed.entityIds
      : parsed.leaderEntityId == null
      ? parsed.entityIds.slice(1)
      : parsed.entityIds
    const selectedIds = automaticLeader
      ? requestedMemberIds
      : [leader!.entityId, ...leader!.relatedEntityIds, ...requestedMemberIds]
    const entities = [...new Set(selectedIds)].map(entityId => available.get(entityId))
    if (entities.some(entity => entity == null)) throw new Error('One or more selected entities no longer exist.')
    const selected = entities as OneWorksRoomEntity[]
    if (selected.slice(automaticLeader ? 0 : 1).some(entity => entity.teamRole === 'leader')) {
      throw new Error('Only one Team Chat leader can be selected.')
    }
    const leaderMember = automaticLeader
      ? {
        key: AUTOMATIC_LEADER_MEMBER_KEY,
        kind: 'host' as const,
        label: AUTOMATIC_LEADER_NAME,
        subtitle: AUTOMATIC_LEADER_DESCRIPTION
      }
      : {
        ...(leader!.avatar == null ? {} : { avatar: leader!.avatar }),
        key: leader!.entityId,
        kind: 'entity' as const,
        label: leader!.name,
        subtitle: leader!.description
      }
    const title = parsed.title ?? deriveRoomTitle(parsed.message)
    const roomId = `room_${randomUUID()}`
    const service = createAgentRoomService(undefined, undefined, {
      resolveChannelConnection: resolveAgentRoomChannelConnection
    })
    const selectedEntityIds = new Set(selected.map(entity => entity.entityId))
    const memberChannelLinks = getChannelStates().flatMap(state =>
      (state.channelLinks ?? []).filter(link => selectedEntityIds.has(link.entity) && link.address != null)
    )
    let roomCreated = false
    try {
      const session = await createSessionWithInitialMessage({
        beforeStart: async (hostSessionId) => {
          service.createRoom({
            hostSessionId,
            id: roomId,
            leaderEntity: leaderMember.key,
            title
          })
          roomCreated = true
          const members = automaticLeader
            ? [
              leaderMember,
              ...selected.map(entity => ({
                ...(entity.avatar == null ? {} : { avatar: entity.avatar }),
                key: entity.entityId,
                kind: 'entity' as const,
                label: entity.name,
                subtitle: entity.description
              }))
            ]
            : selected.map(entity => ({
              ...(entity.avatar == null ? {} : { avatar: entity.avatar }),
              key: entity.entityId,
              kind: 'entity' as const,
              label: entity.name,
              subtitle: entity.description
            }))
          for (const member of members) {
            service.applyEvent(roomId, {
              id: `runtime-member:${roomId}:${member.key}`,
              type: 'member_joined',
              member
            })
          }
          for (const link of memberChannelLinks) {
            await service.executeCommand(roomId, {
              connection: {
                channelLinkName: link.name,
                ...(link.ingress.room?.commandPrefix == null
                  ? {}
                  : { commandPrefix: link.ingress.room.commandPrefix }),
                memberKey: link.entity,
                muted: link.ingress.room?.muted ?? false,
                requireMention: link.ingress.room?.requireMention ?? false
              },
              idempotencyKey: `oneworks-room-connection:${roomId}:${link.name}`,
              type: 'attach_member_channel'
            })
          }
          await service.executeCommand(roomId, {
            idempotencyKey: `oneworks-room-initial:${roomId}`,
            type: 'ingest_channel_message',
            message: {
              content: parsed.message,
              origin: {
                channelId: roomId,
                channelKey: 'oneworks:local',
                channelType: 'oneworks',
                conversationKind: 'group',
                conversationLabel: title
              }
            }
          })
          service.applyEvent(roomId, {
            id: `runtime-meta:${hostSessionId}`,
            type: 'assignment_sent',
            member: leaderMember,
            run: {
              key: hostSessionId,
              sessionId: hostSessionId,
              title
            },
            summary: automaticLeader
              ? 'Auto Leader is coordinating the first group message.'
              : 'Started working on the first group message.'
          })
        },
        initialMessage: parsed.message,
        ...(automaticLeader
          ? { systemPrompt: buildAutomaticLeaderSystemPrompt(selected) }
          : { promptName: leader!.entityId, promptType: 'entity' as const }),
        room: {
          id: roomId,
          member: leaderMember,
          title
        },
        title
      })
      publishRoomUpdated(roomId, session.id)
      return (await listProductRooms()).find(room => room.roomId === roomId)!
    } catch (error) {
      if (roomCreated) service.deleteRoom(roomId)
      throw error
    }
  },
  listRooms: async (principal: PluginRequestPrincipal): Promise<OneWorksRoomSummary[]> => {
    requireProductAccess(principal)
    return await listProductRooms()
  },
  listRoomChannelConnectionCandidates: async (
    principal: PluginRequestPrincipal
  ): Promise<OneWorksRoomChannelConnectionCandidate[]> => {
    requireProductAccess(principal)
    return await listProductRoomConnectionCandidates()
  },
  attachRoomChannelConnection: async (
    principal: PluginRequestPrincipal,
    roomId: string,
    input: unknown
  ): Promise<OneWorksRoomSummary> => {
    requireProductAccess(principal)
    const parsed: OneWorksRoomChannelConnectionAttachInput = oneworksRoomChannelConnectionAttachInputSchema.parse(input)
    const room = getDb().getAgentRoom(roomId)
    if (room == null) throw new Error(`Agent room not found: ${roomId}`)
    const resolved = await resolveAgentRoomChannelConnection(parsed.channelLinkName)
    if (resolved.conversationKind !== 'group' || resolved.channelType === 'oneworks') {
      throw new Error(`Only external group ChannelLinks can be mapped to a Team Chat: ${parsed.channelLinkName}`)
    }
    const loader = new DefinitionLoader(getWorkspaceFolder())
    const entity = (await indexProductEntitiesByReference(await loader.loadDefaultEntities())).get(resolved.entity)
    if (entity == null) throw new Error(`Entity not found for ChannelLink: ${parsed.channelLinkName}`)
    const service = createAgentRoomService(undefined, undefined, {
      resolveChannelConnection: resolveAgentRoomChannelConnection
    })
    const existingMember = getDb().getAgentRoomMember(roomId, entity.entityId) ??
      getDb().getAgentRoomMember(roomId, `entity:${entity.entityId}`)
    const memberKey = existingMember?.key ?? entity.entityId
    if (existingMember == null) {
      service.upsertMember(roomId, {
        ...(entity.avatar == null ? {} : { avatar: entity.avatar }),
        key: memberKey,
        kind: 'entity',
        label: entity.name,
        subtitle: entity.description
      })
    }
    const runtimeLink = getChannelStates().flatMap(state => state.channelLinks ?? [])
      .find(link => link.name === parsed.channelLinkName)
    await service.executeCommand(roomId, {
      connection: {
        channelLinkName: parsed.channelLinkName,
        ...(runtimeLink?.ingress.room?.commandPrefix == null
          ? {}
          : { commandPrefix: runtimeLink.ingress.room.commandPrefix }),
        memberKey,
        muted: runtimeLink?.ingress.room?.muted ?? false,
        requireMention: runtimeLink?.ingress.room?.requireMention ?? false
      },
      idempotencyKey: `oneworks-room-connection:${randomUUID()}`,
      type: 'attach_member_channel'
    })
    publishRoomUpdated(roomId, room.hostSessionId)
    return (await listProductRooms()).find(candidate => candidate.roomId === roomId)!
  },
  updateRoom: async (
    principal: PluginRequestPrincipal,
    roomId: string,
    input: unknown
  ): Promise<OneWorksRoomSummary> => {
    requireProductAccess(principal)
    const patch: OneWorksRoomPatchInput = oneworksRoomPatchInputSchema.parse(input)
    const room = createAgentRoomService().updateRoomMetadata(roomId, patch)
    publishRoomUpdated(room.id, room.hostSessionId)
    return (await listProductRooms()).find(candidate => candidate.roomId === roomId)!
  },
  updateRoomChannelConnection: async (
    principal: PluginRequestPrincipal,
    roomId: string,
    memberKey: string,
    channelLinkName: string,
    input: unknown
  ): Promise<OneWorksRoomSummary> => {
    requireProductAccess(principal)
    const patch: OneWorksRoomChannelConnectionPatchInput = oneworksRoomChannelConnectionPatchInputSchema.parse(input)
    await createAgentRoomService(undefined, undefined, {
      resolveChannelConnection: resolveAgentRoomChannelConnection
    }).executeCommand(roomId, {
      connection: { channelLinkName, memberKey, ...patch },
      idempotencyKey: `oneworks-room-connection:${randomUUID()}`,
      type: 'update_member_channel'
    })
    publishRoomUpdated(roomId)
    return (await listProductRooms()).find(candidate => candidate.roomId === roomId)!
  },
  deleteRoom: async (principal: PluginRequestPrincipal, roomId: string): Promise<boolean> => {
    requireProductAccess(principal)
    const room = getDb().getAgentRoom(roomId)
    if (room == null) return false
    const removed = createAgentRoomService().deleteRoom(roomId)
    if (removed) publishRoomUpdated(roomId, room.hostSessionId)
    return removed
  },
  listSharedRooms: async (principal: PluginRequestPrincipal): Promise<OneWorksSharedRoomSummary[]> => {
    requireProductAccess(principal)
    return await listProductSharedRooms()
  },
  listShares: async (principal: PluginRequestPrincipal): Promise<OneWorksRoomShareSummary[]> => {
    requireProductAccess(principal)
    return listProductShares()
  },
  listShareOwners: async (principal: PluginRequestPrincipal): Promise<OneWorksRoomShareOwner[]> => {
    requireProductAccess(principal)
    return listProductShareOwners()
  },
  createRoomShare: async (
    principal: PluginRequestPrincipal,
    roomId: string,
    input: unknown
  ): Promise<OneWorksRoomShareSummary> => {
    requireProductAccess(principal)
    const db = getDb()
    const room = db.getAgentRoom(roomId)
    if (room == null) throw new Error('Room not found.')
    const shareInput: OneWorksRoomShareInput = oneworksRoomShareInputSchema.parse(input)
    const owner = resolveProductShareOwner(room, shareInput.ownerRef)
    const result = await createAgentRoomOwner({ db }).execute(roomId, {
      idempotencyKey: `oneworks-room-share:${randomUUID()}`,
      type: 'create_share',
      share: { grants: shareInput.grants }
    }, {
      bindOwner: {
        accountId: owner.accountId,
        nodeId: owner.nodeId,
        sourceId: owner.sourceId
      }
    })
    return toRoomShareSummary(room.title, result as AgentRoomShare)
  },
  revokeRoomShare: async (
    principal: PluginRequestPrincipal,
    roomId: string,
    shareRef: string
  ): Promise<boolean> => {
    requireProductAccess(principal)
    const resolved = resolveProductShare(roomId, shareRef)
    if (resolved == null) return false
    await createAgentRoomOwner({ db: getDb() }).execute(roomId, {
      idempotencyKey: `oneworks-room-share-revoke:${randomUUID()}`,
      type: 'revoke_share',
      shareId: resolved.share.id
    })
    return true
  },
  listSimulationTargets: async (principal: PluginRequestPrincipal): Promise<OneWorksChannelSimulationTarget[]> => {
    requireProductAccess(principal)
    return listProductRuntimeRooms().map(toPublicRoom)
  },
  getTrace: async (principal: PluginRequestPrincipal, input?: unknown): Promise<OneWorksChannelTrace[]> => {
    requireProductAccess(principal)
    const limit = typeof input === 'number' && Number.isInteger(input)
      ? Math.min(Math.max(input, 1), MAX_TRACE_ITEMS)
      : 40
    const db = getDb()
    const channelTypes = [...new Set(getChannelStates().map(state => state.type))]
    const channelLinkNames = new Set(listProductRuntimeRooms().flatMap(room => room.linkName ?? []))
    const ingress = db.listRecentChannelIngressRouterRuns(limit)
      .map(row => ({
        at: row.createdAt,
        decision: row.decision,
        kind: 'ingress' as const,
        reason: 'Routing decision recorded.',
        status: row.error == null ? 'recorded' : 'failed',
        traceRef: fingerprint('oneworks-ingress', row.id)
      }))
    const runs = db.listRecentChannelChildSessionRuns(limit)
      .map(row => ({
        at: row.completedAt ?? row.startedAt,
        kind: 'child-run' as const,
        reason: row.error == null ? 'Inbound channel run.' : 'Channel run failed.',
        status: row.status,
        traceRef: fingerprint('oneworks-child-run', row.id)
      }))
    const turns = channelTypes.flatMap(channelType => db.listRecentChannelConversationTurnsByType(channelType, limit))
      .map(row => ({
        at: row.createdAt,
        kind: 'turn' as const,
        reason: row.role === 'outbound' ? 'Outbound channel turn.' : 'Inbound channel turn.',
        status: row.role,
        traceRef: fingerprint('oneworks-turn', row.id)
      }))
    const persistedOutbound = channelTypes.flatMap(
      channelType => db.listRecentChannelOutboundDeliveries(channelType, limit)
    ).map(message => ({
      at: message.updatedAt ?? message.createdAt,
      kind: 'turn' as const,
      reason: 'Outbound native channel delivery.',
      status: 'outbound',
      traceRef: fingerprint('oneworks-outbound', message.id)
    }))
    const commands = db.listRecentChannelCommandRuns(limit)
      .map(row => ({
        at: row.completedAt ?? row.startedAt,
        kind: 'command' as const,
        reason: row.error == null ? 'Channel command completed.' : 'Channel command failed.',
        status: row.status,
        traceRef: fingerprint('oneworks-command', row.id)
      }))
    const policies = db.listRecentChannelPolicyEvents(limit)
      .filter(row => channelLinkNames.has(row.channelLinkName))
      .map(row => ({
        at: row.createdAt,
        kind: 'policy' as const,
        reason: 'Channel policy event recorded.',
        status: row.eventType,
        traceRef: fingerprint('oneworks-policy', row.id)
      }))
    const backlog = db.listPendingChannelOffhourBacklog({
      limit,
      statuses: ['pending', 'leased', 'processed', 'failed']
    }).map(row => ({
      at: row.processedAt ?? row.createdAt,
      kind: 'backlog' as const,
      reason: row.lastError == null ? 'Off-hours backlog state changed.' : 'Off-hours backlog needs attention.',
      status: row.status,
      traceRef: fingerprint('oneworks-backlog', row.id)
    }))
    return [...ingress, ...runs, ...turns, ...persistedOutbound, ...commands, ...policies, ...backlog]
      .sort((left, right) => right.at - left.at)
      .slice(0, limit)
  },
  injectSimulation: async (principal: PluginRequestPrincipal, input: unknown) => {
    requireProductAccess(principal)
    return await injectSimulation(oneworksChannelSimulationInputSchema.parse(input))
  },
  listScenarios: async (principal: PluginRequestPrincipal): Promise<OneWorksChannelScenario[]> => {
    requireProductAccess(principal)
    return getDb().listChannelScenarios().map(toScenario)
  },
  createScenario: async (
    principal: PluginRequestPrincipal,
    input: unknown
  ): Promise<OneWorksChannelScenario> => {
    requireProductAccess(principal)
    const parsed = oneworksChannelScenarioInputSchema.parse(input)
    const room = resolveRoom(parsed.roomRef)
    if (room == null || !room.capabilities.includes('scenarios')) {
      throw new Error('The selected channel does not support scenarios.')
    }
    return toScenario(getDb().createChannelScenario(parsed))
  },
  updateScenario: async (
    principal: PluginRequestPrincipal,
    scenarioRef: string,
    input: unknown
  ): Promise<OneWorksChannelScenario> => {
    requireProductAccess(principal)
    const current = resolveScenario(scenarioRef)
    if (current == null) throw new Error('Scenario not found.')
    const patch = oneworksChannelScenarioPatchSchema.parse(input) as OneWorksChannelScenarioPatch
    const room = patch.roomRef == null ? undefined : resolveRoom(patch.roomRef)
    if (patch.roomRef != null && (room == null || !room.capabilities.includes('scenarios'))) {
      throw new Error('The selected channel does not support scenarios.')
    }
    return toScenario(getDb().updateChannelScenario(current.id, patch)!)
  },
  deleteScenario: async (principal: PluginRequestPrincipal, scenarioRef: string) => {
    requireProductAccess(principal)
    const current = resolveScenario(scenarioRef)
    return current == null ? false : getDb().deleteChannelScenario(current.id)
  },
  runScenario: async (principal: PluginRequestPrincipal, scenarioRef: string) => {
    requireProductAccess(principal)
    const current = resolveScenario(scenarioRef)
    if (current == null) throw new Error('Scenario not found.')
    return await injectSimulation({
      actorRole: current.actorRole,
      roomRef: current.roomRef,
      sessionType: current.sessionType,
      text: current.text,
      userLabel: current.userLabel
    })
  }
})
