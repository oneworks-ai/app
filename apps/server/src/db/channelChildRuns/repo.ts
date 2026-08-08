import { randomUUID } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import { mapRunRow, stringifyJson } from './record'
import type {
  ChannelChildSessionRunDbRow,
  ChannelChildSessionRunDispatchMode,
  ChannelChildSessionRunStatus,
  ChannelChildSessionRunTriggerType
} from './record'

export type {
  ChannelChildSessionRunDispatchMode,
  ChannelChildSessionRunRow,
  ChannelChildSessionRunStatus,
  ChannelChildSessionRunTriggerType
} from './record'

export function createChannelChildRunsRepo(db: SqliteDatabase) {
  const selectFields = `
    id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
    actorUserId, actorAccountId, senderId, messageId, sessionId, conversationStateId,
    threadKey, triggerType, dispatchMode, status, startedAt, completedAt, error, metadataJson
  `

  const get = (id: string) => {
    const stmt = db.prepare(`
      SELECT ${selectFields}
      FROM channel_child_session_runs
      WHERE id = ?
    `)
    return mapRunRow(stmt.get<ChannelChildSessionRunDbRow>(id))
  }

  const create = (row: {
    id?: string | null
    channelType: string
    channelKey: string
    channelId: string
    sessionType: string
    channelLinkName?: string | null
    entity?: string | null
    actorUserId?: string | null
    actorAccountId?: string | null
    senderId?: string | null
    messageId?: string | null
    sessionId?: string | null
    conversationStateId?: string | null
    threadKey?: string | null
    triggerType: ChannelChildSessionRunTriggerType
    dispatchMode: ChannelChildSessionRunDispatchMode
    status?: ChannelChildSessionRunStatus
    startedAt?: number
    metadata?: Record<string, unknown> | null
  }) => {
    const id = row.id?.trim() || `channel_child_${randomUUID()}`
    const startedAt = row.startedAt ?? Date.now()
    const stmt = db.prepare(`
      INSERT INTO channel_child_session_runs (
        id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
        actorUserId, actorAccountId, senderId, messageId, sessionId, conversationStateId, threadKey, triggerType,
        dispatchMode, status, startedAt, completedAt, error, metadataJson
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      id,
      row.channelType,
      row.channelKey,
      row.channelId,
      row.sessionType,
      row.channelLinkName ?? null,
      row.entity ?? null,
      row.actorUserId ?? null,
      row.actorAccountId ?? null,
      row.senderId ?? null,
      row.messageId ?? null,
      row.sessionId ?? null,
      row.conversationStateId ?? null,
      row.threadKey ?? null,
      row.triggerType,
      row.dispatchMode,
      row.status ?? 'started',
      startedAt,
      null,
      null,
      stringifyJson(row.metadata)
    )
    return get(id)
  }

  const finish = (id: string, updates: {
    completedAt?: number
    error?: string | null
    sessionId?: string | null
    status: Exclude<ChannelChildSessionRunStatus, 'started'>
  }) => {
    const completedAt = updates.completedAt ?? Date.now()
    const stmt = db.prepare(`
      UPDATE channel_child_session_runs
      SET status = ?, sessionId = COALESCE(?, sessionId), completedAt = ?, error = ?
      WHERE id = ?
    `)
    stmt.run(updates.status, updates.sessionId ?? null, completedAt, updates.error ?? null, id)
    return get(id)
  }

  const listRecent = (limit = 50) => {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 50
    const stmt = db.prepare(`
      SELECT ${selectFields}
      FROM channel_child_session_runs
      ORDER BY startedAt DESC
      LIMIT ?
    `)
    return stmt.all<ChannelChildSessionRunDbRow>(normalizedLimit).map(row => mapRunRow(row)!)
  }

  return {
    create,
    finish,
    get,
    listRecent
  }
}
