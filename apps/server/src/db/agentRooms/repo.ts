/* eslint-disable max-lines */

import { v4 as uuidv4 } from 'uuid'

import type {
  AgentRoom,
  AgentRoomChannelLink,
  AgentRoomDetail,
  AgentRoomEvent,
  AgentRoomEventRequestKind,
  AgentRoomEventType,
  AgentRoomInteractionOption,
  AgentRoomMember,
  AgentRoomMemberKind,
  AgentRoomMemberStatus,
  AgentRoomMessage,
  AgentRoomMessageDelivery,
  AgentRoomMessageDeliveryStatus,
  AgentRoomMessageOrigin,
  AgentRoomMessageRole,
  AgentRoomRun,
  AgentRoomRunStatus,
  AgentRoomShare,
  AgentRoomShareGrant,
  AgentRoomSharePermission,
  AgentRoomStatus,
  AgentRoomUserMessagePayload
} from '@oneworks/core'

import { buildUpdateStatement } from '../repo.utils'
import type { UpdateFieldDefinition } from '../repo.utils'
import type { SqliteDatabase } from '../sqlite'

interface AgentRoomRow {
  id: string
  title: string
  hostSessionId: string | null
  ownerAccountId: string | null
  ownerNodeId: string | null
  ownerSourceId: string | null
  leaderEntity: string | null
  status: string
  lastMessage: string | null
  archivedAt: number | null
  favoritedAt: number | null
  createdAt: number
  updatedAt: number
}

interface AgentRoomMemberRow {
  roomId: string
  memberKey: string
  kind: string
  label: string
  avatar: string | null
  subtitle: string | null
  status: string
  latestSummary: string | null
  activeRunCount: number
  pendingCount: number
  createdAt: number
  updatedAt: number
}

interface AgentRoomRunRow {
  roomId: string
  runKey: string
  memberKey: string
  sessionId: string
  title: string
  status: string
  latestSummary: string | null
  interactionId: string | null
  requestKind: string | null
  options: string | null
  createdAt: number
  updatedAt: number
}

interface AgentRoomMessageRow {
  id: string
  roomId: string
  role: string
  memberKey: string | null
  runKey: string | null
  content: string
  eventType: string | null
  payloadJson: string | null
  sequence: number
  idempotencyKey: string | null
  originJson: string | null
  createdAt: number
}

interface AgentRoomMessageDeliveryRow {
  id: string
  roomMessageId: string
  targetJson: string
  status: string
  providerMessageId: string | null
  navigationJson: string | null
  error: string | null
  sentAt: number | null
  createdAt: number
  updatedAt: number
}

interface AgentRoomChannelLinkRow {
  accountLabel: string | null
  roomId: string
  channelLinkName: string
  channelType: string
  channelKey: string
  channelId: string
  conversationKind: string
  entity: string
  label: string
  receiveId: string
  receiveIdType: string
  threadId: string | null
  createdAt: number
}

interface AgentRoomShareRow {
  id: string
  roomId: string
  status: string
  relayRef: string | null
  publishedAt: number | null
  revokedAt: number | null
  createdAt: number
  updatedAt: number
}

interface AgentRoomShareGrantRow {
  shareId: string
  principalType: string
  principalId: string
  permissionsJson: string
  createdAt: number
}

export interface AgentRoomEventRow {
  createdAt: number
  id: string
  idempotencyKey: string | null
  payloadJson: string
  roomId: string
  sequence: number
  type: string
}

export interface AgentRoomStoredEvent extends Omit<AgentRoomEventRow, 'payloadJson'> {
  payload: unknown
}

export interface CreateAgentRoomParams {
  id?: string
  title: string
  hostSessionId?: string
  leaderEntity?: string
  owner?: AgentRoom['owner']
  status?: AgentRoomStatus
  createdAt?: number
}

export type SaveAgentRoomMemberParams = Omit<AgentRoomMember, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export type SaveAgentRoomRunParams = Omit<AgentRoomRun, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export type AppendAgentRoomMessageParams =
  & Omit<
    AgentRoomMessage,
    'createdAt' | 'deliveries' | 'id' | 'sequence'
  >
  & {
    id?: string
    createdAt?: number
    deliveries?: AgentRoomMessageDelivery[]
    sequence?: number
  }

export type SaveAgentRoomChannelLinkParams = Omit<AgentRoomChannelLink, 'createdAt'> & { createdAt?: number }

export interface CreateAgentRoomShareParams {
  grants: Array<Pick<AgentRoomShareGrant, 'permissions' | 'principalId' | 'principalType'>>
  id?: string
  roomId: string
}

export interface CreateAgentRoomShareWithOwnerParams extends CreateAgentRoomShareParams {
  event: {
    idempotencyKey: string
    type: string
  }
  owner: {
    accountId: string
    nodeId: string
    sourceId: string
  }
}

export interface UpdateAgentRoomParams {
  hostSessionId?: string | null
  ownerAccountId?: string | null
  ownerNodeId?: string | null
  ownerSourceId?: string | null
  status?: AgentRoomStatus
  lastMessage?: string | null
  archivedAt?: number | null
  favoritedAt?: number | null
  updatedAt?: number
}

export interface ClaimAgentRoomMessageResult {
  inserted: boolean
  message: AgentRoomMessage
}

export type AgentRoomListFilter = 'active' | 'archived' | 'all'

const parseJson = <T>(value: string | null | undefined): T | undefined => {
  if (value == null || value === '') {
    return undefined
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

const stringifyJson = (value: unknown) => value === undefined ? null : JSON.stringify(value)

const agentRoomUpdateFields = [
  { key: 'hostSessionId', toParam: value => value ?? null },
  { key: 'ownerAccountId', toParam: value => value ?? null },
  { key: 'ownerNodeId', toParam: value => value ?? null },
  { key: 'ownerSourceId', toParam: value => value ?? null },
  { key: 'status' },
  { key: 'lastMessage', toParam: value => value ?? null },
  { key: 'archivedAt', toParam: value => value ?? null },
  { key: 'favoritedAt', toParam: value => value ?? null },
  { key: 'updatedAt' }
] as const satisfies ReadonlyArray<UpdateFieldDefinition<UpdateAgentRoomParams>>

const mapRoomRow = (row: AgentRoomRow): AgentRoom => ({
  id: row.id,
  title: row.title,
  owner: {
    type: 'local',
    ...(row.ownerAccountId != null ? { accountId: row.ownerAccountId } : {}),
    ...(row.ownerNodeId != null ? { nodeId: row.ownerNodeId } : {}),
    ...(row.ownerSourceId != null ? { sourceId: row.ownerSourceId } : {})
  },
  ...(row.leaderEntity != null ? { leaderEntity: row.leaderEntity } : {}),
  ...(row.hostSessionId != null ? { hostSessionId: row.hostSessionId } : {}),
  status: row.status as AgentRoomStatus,
  ...(row.lastMessage != null ? { lastMessage: row.lastMessage } : {}),
  ...(row.archivedAt != null ? { archivedAt: row.archivedAt } : {}),
  ...(row.favoritedAt != null ? { favoritedAt: row.favoritedAt } : {}),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

const mapMemberRow = (row: AgentRoomMemberRow): AgentRoomMember => ({
  roomId: row.roomId,
  key: row.memberKey,
  kind: row.kind as AgentRoomMemberKind,
  label: row.label,
  ...(row.avatar != null ? { avatar: row.avatar } : {}),
  ...(row.subtitle != null ? { subtitle: row.subtitle } : {}),
  status: row.status as AgentRoomMemberStatus,
  ...(row.latestSummary != null ? { latestSummary: row.latestSummary } : {}),
  activeRunCount: row.activeRunCount,
  pendingCount: row.pendingCount,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

const mapRunRow = (row: AgentRoomRunRow): AgentRoomRun => ({
  roomId: row.roomId,
  key: row.runKey,
  memberKey: row.memberKey,
  sessionId: row.sessionId,
  title: row.title,
  status: row.status as AgentRoomRunStatus,
  ...(row.latestSummary != null ? { latestSummary: row.latestSummary } : {}),
  ...(row.interactionId != null ? { interactionId: row.interactionId } : {}),
  ...(row.requestKind != null ? { requestKind: row.requestKind as AgentRoomEventRequestKind } : {}),
  ...(row.options != null ? { options: parseJson<AgentRoomInteractionOption[]>(row.options) } : {}),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

const mapDeliveryRow = (row: AgentRoomMessageDeliveryRow): AgentRoomMessageDelivery => ({
  id: row.id,
  roomMessageId: row.roomMessageId,
  target: parseJson<AgentRoomMessageDelivery['target']>(row.targetJson)!,
  status: row.status as AgentRoomMessageDeliveryStatus,
  ...(row.providerMessageId != null ? { providerMessageId: row.providerMessageId } : {}),
  ...(row.navigationJson != null
    ? { navigation: parseJson<NonNullable<AgentRoomMessageDelivery['navigation']>>(row.navigationJson) }
    : {}),
  ...(row.error != null ? { error: row.error } : {}),
  ...(row.sentAt != null ? { sentAt: row.sentAt } : {})
})

const mapChannelLinkRow = (row: AgentRoomChannelLinkRow): AgentRoomChannelLink => ({
  channelId: row.channelId,
  channelKey: row.channelKey,
  channelLinkName: row.channelLinkName,
  channelType: row.channelType,
  conversationKind: row.conversationKind as AgentRoomChannelLink['conversationKind'],
  createdAt: row.createdAt,
  entity: row.entity,
  label: row.label,
  receiveId: row.receiveId,
  receiveIdType: row.receiveIdType,
  roomId: row.roomId,
  ...(row.accountLabel != null ? { accountLabel: row.accountLabel } : {}),
  ...(row.threadId != null ? { threadId: row.threadId } : {})
})

const mapShareGrantRow = (row: AgentRoomShareGrantRow): AgentRoomShareGrant => ({
  createdAt: row.createdAt,
  permissions: parseJson<AgentRoomSharePermission[]>(row.permissionsJson) ?? [],
  principalId: row.principalId,
  principalType: row.principalType as AgentRoomShareGrant['principalType'],
  shareId: row.shareId
})

const mapMessageRow = (
  row: AgentRoomMessageRow,
  deliveries: AgentRoomMessageDelivery[] = []
): AgentRoomMessage => ({
  id: row.id,
  roomId: row.roomId,
  role: row.role as AgentRoomMessageRole,
  ...(row.memberKey != null ? { memberKey: row.memberKey } : {}),
  ...(row.runKey != null ? { runKey: row.runKey } : {}),
  content: row.content,
  sequence: row.sequence,
  ...(row.idempotencyKey != null ? { idempotencyKey: row.idempotencyKey } : {}),
  ...(row.originJson != null ? { origin: parseJson<AgentRoomMessageOrigin>(row.originJson) } : {}),
  deliveries,
  ...(row.eventType != null ? { eventType: row.eventType as AgentRoomEventType } : {}),
  ...(row.payloadJson != null
    ? { payload: parseJson<AgentRoomEvent | AgentRoomUserMessagePayload | Record<string, unknown>>(row.payloadJson) }
    : {}),
  createdAt: row.createdAt
})

export function createAgentRoomsRepo(db: SqliteDatabase) {
  const mapEventRow = (row: AgentRoomEventRow): AgentRoomStoredEvent => ({
    createdAt: row.createdAt,
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    payload: parseJson(row.payloadJson),
    roomId: row.roomId,
    sequence: row.sequence,
    type: row.type
  })

  const getEventByIdempotencyKey = (roomId: string, idempotencyKey: string): AgentRoomStoredEvent | undefined => {
    const row = db.prepare(`
      SELECT * FROM agent_room_events WHERE roomId = ? AND idempotencyKey = ?
    `).get<AgentRoomEventRow>(roomId, idempotencyKey)
    return row == null ? undefined : mapEventRow(row)
  }

  const appendEvent = (input: {
    id?: string
    idempotencyKey?: string
    payload: unknown
    roomId: string
    type: string
  }): AgentRoomStoredEvent => {
    const insert = db.transaction((event: typeof input): string => {
      if (event.idempotencyKey != null) {
        const existing = db.prepare(`
          SELECT id FROM agent_room_events WHERE roomId = ? AND idempotencyKey = ?
        `).get<Pick<AgentRoomEventRow, 'id'>>(event.roomId, event.idempotencyKey)
        if (existing != null) return existing.id
      }

      const id = event.id ?? uuidv4()
      const createdAt = Date.now()
      const sequence = db.prepare(
        'SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM agent_room_events WHERE roomId = ?'
      ).get<{ value: number }>(event.roomId)?.value ?? 1
      db.prepare(`
        INSERT INTO agent_room_events (
          id, roomId, sequence, idempotencyKey, type, payloadJson, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        event.roomId,
        sequence,
        event.idempotencyKey ?? null,
        event.type,
        stringifyJson(event.payload),
        createdAt
      )
      return id
    })
    const id = insert(input)
    const stored = db.prepare('SELECT * FROM agent_room_events WHERE id = ?').get<AgentRoomEventRow>(id)
    if (stored == null) throw new Error(`Failed to append agent room event: ${id}`)
    return mapEventRow(stored)
  }
  const listDeliveries = (roomMessageId: string): AgentRoomMessageDelivery[] =>
    db.prepare(`
      SELECT * FROM agent_room_message_deliveries
      WHERE roomMessageId = ?
      ORDER BY createdAt ASC, id ASC
    `).all<AgentRoomMessageDeliveryRow>(roomMessageId).map(mapDeliveryRow)

  const listChannelLinks = (roomId: string): AgentRoomChannelLink[] =>
    db.prepare(`
      SELECT * FROM agent_room_channel_links
      WHERE roomId = ?
      ORDER BY createdAt ASC, channelLinkName ASC
    `).all<AgentRoomChannelLinkRow>(roomId).map(mapChannelLinkRow)

  const listShareGrants = (shareId: string): AgentRoomShareGrant[] =>
    db.prepare(`
      SELECT * FROM agent_room_share_grants
      WHERE shareId = ?
      ORDER BY createdAt ASC, principalType ASC, principalId ASC
    `).all<AgentRoomShareGrantRow>(shareId).map(mapShareGrantRow)

  const mapShareRow = (row: AgentRoomShareRow): AgentRoomShare => ({
    createdAt: row.createdAt,
    grants: listShareGrants(row.id),
    id: row.id,
    ...(row.publishedAt != null ? { publishedAt: row.publishedAt } : {}),
    ...(row.relayRef != null ? { relayRef: row.relayRef } : {}),
    ...(row.revokedAt != null ? { revokedAt: row.revokedAt } : {}),
    roomId: row.roomId,
    status: row.status as AgentRoomShare['status'],
    updatedAt: row.updatedAt
  })

  const listShares = (roomId: string): AgentRoomShare[] =>
    db.prepare(`
      SELECT * FROM agent_room_shares
      WHERE roomId = ?
      ORDER BY createdAt DESC, id ASC
    `).all<AgentRoomShareRow>(roomId).map(mapShareRow)

  const getShare = (shareId: string): AgentRoomShare | undefined => {
    const row = db.prepare('SELECT * FROM agent_room_shares WHERE id = ?').get<AgentRoomShareRow>(shareId)
    return row == null ? undefined : mapShareRow(row)
  }
  const list = (filter: AgentRoomListFilter = 'active'): AgentRoom[] => {
    const whereClause = filter === 'active'
      ? 'WHERE archivedAt IS NULL'
      : filter === 'archived'
      ? 'WHERE archivedAt IS NOT NULL'
      : ''
    const stmt = db.prepare(`
      SELECT * FROM agent_rooms
      ${whereClause}
      ORDER BY
        CASE WHEN favoritedAt IS NULL THEN 0 ELSE 1 END DESC,
        favoritedAt DESC,
        COALESCE(archivedAt, updatedAt) DESC,
        updatedAt DESC
    `)
    return stmt.all<AgentRoomRow>().map(mapRoomRow)
  }

  const get = (id: string): AgentRoom | undefined => {
    const row = db.prepare('SELECT * FROM agent_rooms WHERE id = ?').get<AgentRoomRow>(id)
    return row == null ? undefined : mapRoomRow(row)
  }

  const getByHostSessionId = (hostSessionId: string): AgentRoom | undefined => {
    const row = db.prepare('SELECT * FROM agent_rooms WHERE hostSessionId = ? ORDER BY updatedAt DESC LIMIT 1')
      .get<AgentRoomRow>(hostSessionId)
    return row == null ? undefined : mapRoomRow(row)
  }

  const create = (params: CreateAgentRoomParams): AgentRoom => {
    const now = params.createdAt ?? Date.now()
    const room: AgentRoom = {
      id: params.id ?? uuidv4(),
      title: params.title,
      owner: params.owner ?? { type: 'local' },
      ...(params.leaderEntity != null ? { leaderEntity: params.leaderEntity } : {}),
      ...(params.hostSessionId != null ? { hostSessionId: params.hostSessionId } : {}),
      status: params.status ?? 'active',
      createdAt: now,
      updatedAt: now
    }
    db.prepare(`
      INSERT INTO agent_rooms (
        id, title, hostSessionId, ownerAccountId, ownerNodeId, ownerSourceId,
        leaderEntity, status, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      room.id,
      room.title,
      room.hostSessionId ?? null,
      room.owner.accountId ?? null,
      room.owner.nodeId ?? null,
      room.owner.sourceId ?? null,
      room.leaderEntity ?? null,
      room.status,
      room.createdAt,
      room.updatedAt
    )
    return room
  }

  const update = (id: string, params: UpdateAgentRoomParams): AgentRoom | undefined => {
    const existing = get(id)
    if (existing == null) {
      return undefined
    }

    const statement = buildUpdateStatement('agent_rooms', 'id', id, {
      ...params,
      updatedAt: params.updatedAt ?? Date.now()
    }, agentRoomUpdateFields)
    if (statement != null) {
      db.prepare(statement.sql).run(...statement.params)
    }
    return get(id)
  }

  const getMember = (roomId: string, memberKey: string): AgentRoomMember | undefined => {
    const row = db.prepare('SELECT * FROM agent_room_members WHERE roomId = ? AND memberKey = ?')
      .get<AgentRoomMemberRow>(roomId, memberKey)
    return row == null ? undefined : mapMemberRow(row)
  }

  const listMembers = (roomId: string): AgentRoomMember[] => {
    return db.prepare('SELECT * FROM agent_room_members WHERE roomId = ? ORDER BY updatedAt DESC, memberKey ASC')
      .all<AgentRoomMemberRow>(roomId)
      .map(mapMemberRow)
  }

  const saveMember = (member: SaveAgentRoomMemberParams): AgentRoomMember => {
    const now = member.updatedAt ?? Date.now()
    const createdAt = member.createdAt ?? now
    db.prepare(`
      INSERT INTO agent_room_members (
        roomId, memberKey, kind, label, avatar, subtitle, status, latestSummary,
        activeRunCount, pendingCount, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(roomId, memberKey) DO UPDATE SET
        kind = excluded.kind,
        label = excluded.label,
        avatar = excluded.avatar,
        subtitle = excluded.subtitle,
        status = excluded.status,
        latestSummary = COALESCE(excluded.latestSummary, agent_room_members.latestSummary),
        activeRunCount = excluded.activeRunCount,
        pendingCount = excluded.pendingCount,
        updatedAt = excluded.updatedAt
    `).run(
      member.roomId,
      member.key,
      member.kind,
      member.label,
      member.avatar ?? null,
      member.subtitle ?? null,
      member.status,
      member.latestSummary ?? null,
      member.activeRunCount,
      member.pendingCount,
      createdAt,
      now
    )

    const stored = getMember(member.roomId, member.key)
    if (stored == null) {
      throw new Error(`Failed to save agent room member: ${member.key}`)
    }
    return stored
  }

  const getRun = (roomId: string, runKey: string): AgentRoomRun | undefined => {
    const row = db.prepare('SELECT * FROM agent_room_runs WHERE roomId = ? AND runKey = ?')
      .get<AgentRoomRunRow>(roomId, runKey)
    return row == null ? undefined : mapRunRow(row)
  }

  const listRuns = (roomId: string): AgentRoomRun[] => {
    return db.prepare('SELECT * FROM agent_room_runs WHERE roomId = ? ORDER BY updatedAt DESC, runKey ASC')
      .all<AgentRoomRunRow>(roomId)
      .map(mapRunRow)
  }

  const listRunsForMember = (roomId: string, memberKey: string): AgentRoomRun[] => {
    return db.prepare(
      'SELECT * FROM agent_room_runs WHERE roomId = ? AND memberKey = ? ORDER BY updatedAt DESC, runKey ASC'
    )
      .all<AgentRoomRunRow>(roomId, memberKey)
      .map(mapRunRow)
  }

  const saveRun = (run: SaveAgentRoomRunParams): AgentRoomRun => {
    const now = run.updatedAt ?? Date.now()
    const createdAt = run.createdAt ?? now
    db.prepare(`
      INSERT INTO agent_room_runs (
        roomId, runKey, memberKey, sessionId, title, status, latestSummary,
        interactionId, requestKind, options, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(roomId, runKey) DO UPDATE SET
        memberKey = excluded.memberKey,
        sessionId = excluded.sessionId,
        title = excluded.title,
        status = excluded.status,
        latestSummary = COALESCE(excluded.latestSummary, agent_room_runs.latestSummary),
        interactionId = excluded.interactionId,
        requestKind = excluded.requestKind,
        options = excluded.options,
        updatedAt = excluded.updatedAt
    `).run(
      run.roomId,
      run.key,
      run.memberKey,
      run.sessionId,
      run.title,
      run.status,
      run.latestSummary ?? null,
      run.interactionId ?? null,
      run.requestKind ?? null,
      stringifyJson(run.options),
      createdAt,
      now
    )

    const stored = getRun(run.roomId, run.key)
    if (stored == null) {
      throw new Error(`Failed to save agent room run: ${run.key}`)
    }
    return stored
  }

  const getMessage = (id: string): AgentRoomMessage | undefined => {
    const row = db.prepare('SELECT * FROM agent_room_messages WHERE id = ?').get<AgentRoomMessageRow>(id)
    return row == null ? undefined : mapMessageRow(row, listDeliveries(id))
  }

  const getMessageByIdempotencyKey = (roomId: string, idempotencyKey: string): AgentRoomMessage | undefined => {
    const row = db.prepare(`
      SELECT * FROM agent_room_messages WHERE roomId = ? AND idempotencyKey = ?
    `).get<AgentRoomMessageRow>(roomId, idempotencyKey)
    return row == null ? undefined : mapMessageRow(row, listDeliveries(row.id))
  }

  const saveDelivery = (delivery: AgentRoomMessageDelivery): AgentRoomMessageDelivery => {
    const now = Date.now()
    db.prepare(`
      INSERT INTO agent_room_message_deliveries (
        id, roomMessageId, targetJson, status, providerMessageId, navigationJson,
        error, sentAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        providerMessageId = excluded.providerMessageId,
        navigationJson = excluded.navigationJson,
        error = excluded.error,
        sentAt = excluded.sentAt,
        updatedAt = excluded.updatedAt
    `).run(
      delivery.id,
      delivery.roomMessageId,
      stringifyJson(delivery.target),
      delivery.status,
      delivery.providerMessageId ?? null,
      stringifyJson(delivery.navigation),
      delivery.error ?? null,
      delivery.sentAt ?? null,
      now,
      now
    )
    return mapDeliveryRow(
      db.prepare('SELECT * FROM agent_room_message_deliveries WHERE id = ?')
        .get<AgentRoomMessageDeliveryRow>(delivery.id)!
    )
  }

  const claimMessage = (message: AppendAgentRoomMessageParams): ClaimAgentRoomMessageResult => {
    const insert = db.transaction((input: AppendAgentRoomMessageParams): { id: string; inserted: boolean } => {
      if (input.idempotencyKey != null) {
        const existing = db.prepare(`
          SELECT id FROM agent_room_messages WHERE roomId = ? AND idempotencyKey = ?
        `).get<Pick<AgentRoomMessageRow, 'id'>>(input.roomId, input.idempotencyKey)
        if (existing != null) return { id: existing.id, inserted: false }
      }

      const id = input.id ?? uuidv4()
      const createdAt = input.createdAt ?? Date.now()
      const sequence = input.sequence ?? (
        db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS value FROM agent_room_messages WHERE roomId = ?')
          .get<{ value: number }>(input.roomId)?.value ?? 1
      )
      db.prepare(`
        INSERT INTO agent_room_messages (
          id, roomId, role, memberKey, runKey, content, eventType, payloadJson,
          sequence, idempotencyKey, originJson, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.roomId,
        input.role,
        input.memberKey ?? null,
        input.runKey ?? null,
        input.content,
        input.eventType ?? null,
        stringifyJson(input.payload),
        sequence,
        input.idempotencyKey ?? null,
        stringifyJson(input.origin),
        createdAt
      )

      for (const delivery of input.deliveries ?? []) {
        saveDelivery({ ...delivery, roomMessageId: id })
      }
      return { id, inserted: true }
    })
    const result = insert(message)
    const stored = getMessage(result.id)
    if (stored == null) {
      throw new Error(`Failed to append agent room message: ${result.id}`)
    }
    return { inserted: result.inserted, message: stored }
  }

  const appendMessage = (message: AppendAgentRoomMessageParams): AgentRoomMessage => claimMessage(message).message

  const updateMessagePayload = (
    id: string,
    payload: AgentRoomUserMessagePayload | Record<string, unknown>
  ): AgentRoomMessage | undefined => {
    db.prepare('UPDATE agent_room_messages SET payloadJson = ? WHERE id = ?').run(stringifyJson(payload), id)
    return getMessage(id)
  }

  const listMessages = (roomId: string): AgentRoomMessage[] => {
    return db.prepare('SELECT * FROM agent_room_messages WHERE roomId = ? ORDER BY sequence ASC, rowid ASC')
      .all<AgentRoomMessageRow>(roomId)
      .map(row => mapMessageRow(row, listDeliveries(row.id)))
  }

  const saveChannelLink = (link: SaveAgentRoomChannelLinkParams): AgentRoomChannelLink => {
    const createdAt = link.createdAt ?? Date.now()
    const existingOwner = findRoomChannelLink({
      channelId: link.channelId,
      channelKey: link.channelKey,
      channelType: link.channelType
    })
    if (
      existingOwner != null &&
      (existingOwner.roomId !== link.roomId || existingOwner.channelLinkName !== link.channelLinkName)
    ) {
      throw new Error(
        `Channel conversation is already attached to agent room ${existingOwner.roomId}: ` +
          `${link.channelType}/${link.channelKey}/${link.channelId}`
      )
    }
    db.prepare(`
      INSERT INTO agent_room_channel_links (
        roomId, channelLinkName, channelType, channelKey, channelId, accountLabel,
        conversationKind, entity, label, receiveId, receiveIdType, threadId, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(roomId, channelLinkName) DO UPDATE SET
        channelType = excluded.channelType,
        channelKey = excluded.channelKey,
        channelId = excluded.channelId,
        accountLabel = excluded.accountLabel,
        conversationKind = excluded.conversationKind,
        entity = excluded.entity,
        label = excluded.label,
        receiveId = excluded.receiveId,
        receiveIdType = excluded.receiveIdType,
        threadId = excluded.threadId
    `).run(
      link.roomId,
      link.channelLinkName,
      link.channelType,
      link.channelKey,
      link.channelId,
      link.accountLabel ?? null,
      link.conversationKind,
      link.entity,
      link.label,
      link.receiveId,
      link.receiveIdType,
      link.threadId ?? null,
      createdAt
    )
    return mapChannelLinkRow(
      db.prepare(`
      SELECT * FROM agent_room_channel_links WHERE roomId = ? AND channelLinkName = ?
    `).get<AgentRoomChannelLinkRow>(link.roomId, link.channelLinkName)!
    )
  }

  const findRoomChannelLink = (input: {
    channelId: string
    channelKey: string
    channelType: string
  }): AgentRoomChannelLink | undefined => {
    const row = db.prepare(`
      SELECT * FROM agent_room_channel_links
      WHERE channelType = ? AND channelKey = ? AND channelId = ?
      LIMIT 1
    `).get<AgentRoomChannelLinkRow>(input.channelType, input.channelKey, input.channelId)
    return row == null ? undefined : mapChannelLinkRow(row)
  }

  const createShare = (input: CreateAgentRoomShareParams): AgentRoomShare => {
    const id = input.id ?? uuidv4()
    const now = Date.now()
    db.transaction(() => {
      db.prepare(`
        INSERT INTO agent_room_shares (id, roomId, status, createdAt, updatedAt)
        VALUES (?, ?, 'active', ?, ?)
      `).run(id, input.roomId, now, now)
      const insertGrant = db.prepare(`
        INSERT INTO agent_room_share_grants (
          shareId, principalType, principalId, permissionsJson, createdAt
        ) VALUES (?, ?, ?, ?, ?)
      `)
      for (const grant of input.grants) {
        insertGrant.run(id, grant.principalType, grant.principalId, stringifyJson(grant.permissions), now)
      }
    })()
    return mapShareRow(db.prepare('SELECT * FROM agent_room_shares WHERE id = ?').get<AgentRoomShareRow>(id)!)
  }

  const createShareWithOwner = (input: CreateAgentRoomShareWithOwnerParams): AgentRoomShare => {
    return db.transaction(() => {
      const room = get(input.roomId)
      if (room == null) throw new Error(`Agent room not found: ${input.roomId}`)
      if (room.owner.accountId != null && room.owner.accountId !== input.owner.accountId) {
        throw new Error('A Room cannot be moved to a different Relay owner account.')
      }
      if (room.owner.sourceId != null && room.owner.sourceId !== input.owner.sourceId) {
        throw new Error('A Room cannot be moved to a different Relay service.')
      }
      const updated = update(input.roomId, {
        ownerAccountId: input.owner.accountId,
        ownerNodeId: input.owner.nodeId,
        ownerSourceId: input.owner.sourceId
      })
      if (updated == null) throw new Error(`Agent room not found: ${input.roomId}`)
      const share = createShare(input)
      appendEvent({
        idempotencyKey: input.event.idempotencyKey,
        payload: share,
        roomId: input.roomId,
        type: input.event.type
      })
      return share
    })()
  }

  const revokeShare = (roomId: string, shareId: string) => {
    const now = Date.now()
    return db.prepare(`
      UPDATE agent_room_shares
      SET status = 'revoked', revokedAt = ?, updatedAt = ?
      WHERE id = ? AND roomId = ? AND status = 'active'
    `).run(now, now, shareId, roomId).changes > 0
  }

  const getDetail = (id: string): AgentRoomDetail | undefined => {
    const room = get(id)
    if (room == null) {
      return undefined
    }

    return {
      room,
      channelLinks: listChannelLinks(id),
      members: listMembers(id),
      runs: listRuns(id),
      messages: listMessages(id),
      shares: listShares(id)
    }
  }

  const remove = (id: string) => {
    const result = db.prepare('DELETE FROM agent_rooms WHERE id = ?').run(id)
    return result.changes > 0
  }

  return {
    appendEvent,
    appendMessage,
    claimMessage,
    createShare,
    createShareWithOwner,
    create,
    get,
    getByHostSessionId,
    getDetail,
    getEventByIdempotencyKey,
    findRoomChannelLink,
    getMember,
    getMessage,
    getMessageByIdempotencyKey,
    getRun,
    getShare,
    list,
    listChannelLinks,
    listDeliveries,
    listMembers,
    listMessages,
    listRuns,
    listRunsForMember,
    listShares,
    remove,
    revokeShare,
    saveChannelLink,
    saveDelivery,
    saveMember,
    saveRun,
    updateMessagePayload,
    update
  }
}
