import type { EffortLevel, SessionPermissionMode } from '@oneworks/core'

import type { SqliteDatabase } from '../sqlite'

export interface ChannelSessionRow {
  channelType: string
  sessionType: string
  channelId: string
  threadId?: string
  channelKey: string
  senderId?: string
  replyReceiveId?: string
  replyReceiveIdType?: string
  sessionId: string
  createdAt: number
  updatedAt: number
}

export interface ChannelPreferenceRow {
  channelType: string
  sessionType: string
  channelId: string
  channelKey: string
  adapter?: string
  permissionMode?: SessionPermissionMode
  effort?: EffortLevel
  createdAt: number
  updatedAt: number
}

export function createChannelSessionsRepo(db: SqliteDatabase) {
  const get = (
    channelKey: string,
    channelType: string,
    sessionType: string,
    channelId: string,
    threadId?: string
  ): ChannelSessionRow | undefined => {
    const stmt = db.prepare(`
      SELECT channelType, sessionType, channelId, NULLIF(threadId, '') AS threadId,
             channelKey, senderId, replyReceiveId, replyReceiveIdType, sessionId, createdAt, updatedAt
      FROM channel_sessions_v3
      WHERE channelKey = ? AND channelType = ? AND sessionType = ? AND channelId = ? AND threadId = ?
    `)
    return stmt.get<ChannelSessionRow>(channelKey, channelType, sessionType, channelId, threadId ?? '')
  }

  const getBySessionId = (sessionId: string): ChannelSessionRow | undefined => {
    const stmt = db.prepare(`
      SELECT channelType, sessionType, channelId, NULLIF(threadId, '') AS threadId,
             channelKey, senderId, replyReceiveId, replyReceiveIdType, sessionId, createdAt, updatedAt
      FROM channel_session_deliveries
      WHERE sessionId = ?
      LIMIT 1
    `)
    return stmt.get<ChannelSessionRow>(sessionId) ?? db.prepare(`
      SELECT channelType, sessionType, channelId, NULLIF(threadId, '') AS threadId,
             channelKey, senderId, replyReceiveId, replyReceiveIdType, sessionId, createdAt, updatedAt
      FROM channel_sessions_v3
      WHERE sessionId = ?
      ORDER BY updatedAt DESC
      LIMIT 1
    `).get<ChannelSessionRow>(sessionId)
  }

  const upsert = db.transaction((row: Omit<ChannelSessionRow, 'createdAt' | 'updatedAt'>) => {
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO channel_sessions_v3 (
        channelType, sessionType, channelId, threadId, channelKey, senderId,
        replyReceiveId, replyReceiveIdType, sessionId, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channelKey, sessionType, channelId, threadId) DO UPDATE SET
        channelType = excluded.channelType,
        senderId = excluded.senderId,
        replyReceiveId = excluded.replyReceiveId,
        replyReceiveIdType = excluded.replyReceiveIdType,
        sessionId = excluded.sessionId,
        updatedAt = excluded.updatedAt
    `)
    stmt.run(
      row.channelType,
      row.sessionType,
      row.channelId,
      row.threadId ?? '',
      row.channelKey,
      row.senderId ?? null,
      row.replyReceiveId ?? null,
      row.replyReceiveIdType ?? null,
      row.sessionId,
      now,
      now
    )
    db.prepare(`
      INSERT INTO channel_session_deliveries (
        sessionId, channelType, sessionType, channelId, threadId, channelKey, senderId,
        replyReceiveId, replyReceiveIdType, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sessionId) DO NOTHING
    `).run(
      row.sessionId,
      row.channelType,
      row.sessionType,
      row.channelId,
      row.threadId ?? '',
      row.channelKey,
      row.senderId ?? null,
      row.replyReceiveId ?? null,
      row.replyReceiveIdType ?? null,
      now,
      now
    )
  })

  const removeBySessionId = (sessionId: string) => {
    const removedBindings = db.prepare(`
      DELETE FROM channel_sessions_v3
      WHERE sessionId = ?
    `).run(sessionId).changes
    const removedDeliveries = db.prepare(`
      DELETE FROM channel_session_deliveries
      WHERE sessionId = ?
    `).run(sessionId).changes
    return removedBindings + removedDeliveries
  }

  const remove = (
    channelKey: string,
    channelType: string,
    sessionType: string,
    channelId: string,
    threadId?: string
  ) => {
    const stmt = db.prepare(`
      DELETE FROM channel_sessions_v3
      WHERE channelKey = ? AND channelType = ? AND sessionType = ? AND channelId = ? AND threadId = ?
    `)
    return stmt.run(channelKey, channelType, sessionType, channelId, threadId ?? '').changes
  }

  const getPreference = (
    channelKey: string,
    channelType: string,
    sessionType: string,
    channelId: string
  ): ChannelPreferenceRow | undefined => {
    const stmt = db.prepare(`
      SELECT channelType, sessionType, channelId, channelKey, adapter, permissionMode, effort, createdAt, updatedAt
      FROM channel_preferences_v2
      WHERE channelKey = ? AND channelType = ? AND sessionType = ? AND channelId = ?
    `)
    return stmt.get<ChannelPreferenceRow>(channelKey, channelType, sessionType, channelId)
  }

  const upsertPreference = (row: Omit<ChannelPreferenceRow, 'createdAt' | 'updatedAt'>) => {
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO channel_preferences_v2 (
        channelType, sessionType, channelId, channelKey, adapter, permissionMode, effort, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channelKey, sessionType, channelId) DO UPDATE SET
        channelType = excluded.channelType,
        adapter = excluded.adapter,
        permissionMode = excluded.permissionMode,
        effort = excluded.effort,
        updatedAt = excluded.updatedAt
    `)
    stmt.run(
      row.channelType,
      row.sessionType,
      row.channelId,
      row.channelKey,
      row.adapter ?? null,
      row.permissionMode ?? null,
      row.effort ?? null,
      now,
      now
    )
  }

  return {
    get,
    getPreference,
    getBySessionId,
    remove,
    removeBySessionId,
    upsert,
    upsertPreference
  }
}
