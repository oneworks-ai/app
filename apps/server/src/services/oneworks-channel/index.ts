/* eslint-disable max-lines -- the product facade keeps redacted rooms, trace, sharing, and scenarios aligned. */
import { createHash, randomUUID } from 'node:crypto'

import type { OneWorksChannelConfig } from '@oneworks/channel-oneworks'
import type { AgentRoom, AgentRoomShare, PluginRequestPrincipal } from '@oneworks/types'
import type {
  OneWorksChannelScenario,
  OneWorksChannelScenarioPatch,
  OneWorksChannelSimulationInput,
  OneWorksChannelSimulationResult,
  OneWorksChannelSimulationTarget,
  OneWorksChannelTrace,
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
  oneworksRoomShareInputSchema
} from './contract.js'

import { getChannelManager } from '#~/channels/index.js'
import type { ChannelRuntimeState } from '#~/channels/types.js'
import { handleChannelWebhook } from '#~/channels/webhook.js'
import { getDb } from '#~/db/index.js'
import type { ChannelScenarioRow } from '#~/db/index.js'
import { createAgentRoomOwner } from '#~/services/agent-room/owner.js'
import { listActiveAgentRoomRelayOwners, listSharedAgentRoomDirectory } from '#~/services/agent-room/relay.js'
import { requirePluginRequestPermission } from '#~/services/plugins/types.js'
import { buildOneWorksWebhookSignature } from '@oneworks/channel-oneworks/webhook-signature'

const MAX_TRACE_ITEMS = 100
const requireProductAccess = (principal: PluginRequestPrincipal) =>
  requirePluginRequestPermission(principal, 'workspace:manage')
const fingerprint = (namespace: string, value: string) =>
  createHash('sha256').update(`${namespace}:${value}`).digest('hex').slice(0, 16)

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

const listProductRooms = (): OneWorksRoomSummary[] =>
  getDb().listAgentRooms('all').map(room => {
    const detail = getDb().getAgentRoomDetail(room.id)
    const links = detail?.channelLinks ?? []
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
      channelLinkCount: links.length,
      ...(room.lastMessage == null ? {} : { lastMessage: room.lastMessage }),
      memberCount: detail?.members.length ?? 0,
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
  listRooms: async (principal: PluginRequestPrincipal): Promise<OneWorksRoomSummary[]> => {
    requireProductAccess(principal)
    return listProductRooms()
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
