import { randomUUID } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import { mapBacklogRow } from './backlog-record'
import type { ChannelOffhourBacklogDbRow, OffhourBacklogFilter, OffhourBacklogInput } from './backlog-record'
import { stringifyJson } from './json'

export function createOffhourBacklogRepo(db: SqliteDatabase) {
  const getOffhourBacklogItem = (id: string) => {
    const stmt = db.prepare(`
      SELECT id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
             senderId, actorUserId, messageId, text, rawJson, createdAt, processedAt
      FROM channel_offhour_backlog
      WHERE id = ?
    `)
    return mapBacklogRow(stmt.get<ChannelOffhourBacklogDbRow>(id))
  }

  const appendOffhourBacklog = (row: OffhourBacklogInput) => {
    const id = row.id?.trim() || `offhour_${randomUUID()}`
    const createdAt = row.createdAt ?? Date.now()
    const stmt = db.prepare(`
      INSERT INTO channel_offhour_backlog (
        id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
        senderId, actorUserId, messageId, text, rawJson, createdAt, processedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      id,
      row.channelType,
      row.channelKey,
      row.channelId,
      row.sessionType,
      row.channelLinkName ?? null,
      row.entity ?? null,
      row.senderId ?? null,
      row.actorUserId ?? null,
      row.messageId ?? null,
      row.text ?? null,
      stringifyJson(row.raw),
      createdAt,
      null
    )
    return getOffhourBacklogItem(id)
  }

  const listPendingOffhourBacklog = (filter: OffhourBacklogFilter = {}) => {
    const clauses = ['processedAt IS NULL']
    const params: Array<string | number> = []
    if (filter.channelLinkName != null) {
      clauses.push('channelLinkName = ?')
      params.push(filter.channelLinkName)
    }
    if (filter.channelType != null) {
      clauses.push('channelType = ?')
      params.push(filter.channelType)
    }
    if (filter.channelId != null) {
      clauses.push('channelId = ?')
      params.push(filter.channelId)
    }

    const limit = Number.isInteger(filter.limit) && filter.limit != null && filter.limit > 0
      ? filter.limit
      : 50
    const stmt = db.prepare(`
      SELECT id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
             senderId, actorUserId, messageId, text, rawJson, createdAt, processedAt
      FROM channel_offhour_backlog
      WHERE ${clauses.join(' AND ')}
      ORDER BY createdAt ASC
      LIMIT ?
    `)
    return stmt.all<ChannelOffhourBacklogDbRow>(...params, limit).map(row => mapBacklogRow(row)!)
  }

  const markOffhourBacklogProcessed = (ids: string[], processedAt = Date.now()) => {
    if (ids.length === 0) return 0
    const placeholders = ids.map(() => '?').join(', ')
    const stmt = db.prepare(`
      UPDATE channel_offhour_backlog
      SET processedAt = ?
      WHERE id IN (${placeholders})
    `)
    return stmt.run(processedAt, ...ids).changes
  }

  return {
    appendOffhourBacklog,
    getOffhourBacklogItem,
    listPendingOffhourBacklog,
    markOffhourBacklogProcessed
  }
}
