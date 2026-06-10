/* eslint-disable max-lines */

import { v4 as uuidv4 } from 'uuid'

import type {
  AgentRoom,
  AgentRoomDetail,
  AgentRoomEvent,
  AgentRoomEventRequestKind,
  AgentRoomEventType,
  AgentRoomInteractionOption,
  AgentRoomMember,
  AgentRoomMemberKind,
  AgentRoomMemberStatus,
  AgentRoomMessage,
  AgentRoomMessageRole,
  AgentRoomRun,
  AgentRoomRunStatus,
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
  createdAt: number
}

export interface CreateAgentRoomParams {
  id?: string
  title: string
  hostSessionId?: string
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

export type AppendAgentRoomMessageParams = Omit<AgentRoomMessage, 'id' | 'createdAt'> & {
  id?: string
  createdAt?: number
}

export interface UpdateAgentRoomParams {
  hostSessionId?: string | null
  status?: AgentRoomStatus
  lastMessage?: string | null
  archivedAt?: number | null
  favoritedAt?: number | null
  updatedAt?: number
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
  { key: 'status' },
  { key: 'lastMessage', toParam: value => value ?? null },
  { key: 'archivedAt', toParam: value => value ?? null },
  { key: 'favoritedAt', toParam: value => value ?? null },
  { key: 'updatedAt' }
] as const satisfies ReadonlyArray<UpdateFieldDefinition<UpdateAgentRoomParams>>

const mapRoomRow = (row: AgentRoomRow): AgentRoom => ({
  id: row.id,
  title: row.title,
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

const mapMessageRow = (row: AgentRoomMessageRow): AgentRoomMessage => ({
  id: row.id,
  roomId: row.roomId,
  role: row.role as AgentRoomMessageRole,
  ...(row.memberKey != null ? { memberKey: row.memberKey } : {}),
  ...(row.runKey != null ? { runKey: row.runKey } : {}),
  content: row.content,
  ...(row.eventType != null ? { eventType: row.eventType as AgentRoomEventType } : {}),
  ...(row.payloadJson != null
    ? { payload: parseJson<AgentRoomEvent | AgentRoomUserMessagePayload | Record<string, unknown>>(row.payloadJson) }
    : {}),
  createdAt: row.createdAt
})

export function createAgentRoomsRepo(db: SqliteDatabase) {
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
      ...(params.hostSessionId != null ? { hostSessionId: params.hostSessionId } : {}),
      status: params.status ?? 'active',
      createdAt: now,
      updatedAt: now
    }
    db.prepare(`
      INSERT INTO agent_rooms (id, title, hostSessionId, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(room.id, room.title, room.hostSessionId ?? null, room.status, room.createdAt, room.updatedAt)
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
    return row == null ? undefined : mapMessageRow(row)
  }

  const appendMessage = (message: AppendAgentRoomMessageParams): AgentRoomMessage => {
    const id = message.id ?? uuidv4()
    const createdAt = message.createdAt ?? Date.now()
    db.prepare(`
      INSERT OR IGNORE INTO agent_room_messages (
        id, roomId, role, memberKey, runKey, content, eventType, payloadJson, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      message.roomId,
      message.role,
      message.memberKey ?? null,
      message.runKey ?? null,
      message.content,
      message.eventType ?? null,
      stringifyJson(message.payload),
      createdAt
    )

    const stored = getMessage(id)
    if (stored == null) {
      throw new Error(`Failed to append agent room message: ${id}`)
    }
    return stored
  }

  const listMessages = (roomId: string): AgentRoomMessage[] => {
    return db.prepare('SELECT * FROM agent_room_messages WHERE roomId = ? ORDER BY createdAt ASC, rowid ASC')
      .all<AgentRoomMessageRow>(roomId)
      .map(mapMessageRow)
  }

  const getDetail = (id: string): AgentRoomDetail | undefined => {
    const room = get(id)
    if (room == null) {
      return undefined
    }

    return {
      room,
      members: listMembers(id),
      runs: listRuns(id),
      messages: listMessages(id)
    }
  }

  const remove = (id: string) => {
    const result = db.prepare('DELETE FROM agent_rooms WHERE id = ?').run(id)
    return result.changes > 0
  }

  return {
    appendMessage,
    create,
    get,
    getByHostSessionId,
    getDetail,
    getMember,
    getMessage,
    getRun,
    list,
    listMembers,
    listMessages,
    listRuns,
    listRunsForMember,
    remove,
    saveMember,
    saveRun,
    update
  }
}
