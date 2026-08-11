/* eslint-disable max-lines -- backlog claim, retry, digest, and completion transitions share one repository. */
import { randomUUID } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import { mapBacklogRow } from './backlog-record'
import type { ChannelOffhourBacklogDbRow, OffhourBacklogFilter, OffhourBacklogInput } from './backlog-record'
import { stringifyJson } from './json'

export function createOffhourBacklogRepo(db: SqliteDatabase) {
  const getOffhourBacklogItem = (id: string) => {
    const stmt = db.prepare(`
      SELECT id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
             senderId, actorUserId, messageId, text, rawJson, createdAt, processedAt,
             status, attempts, leaseOwner, leaseExpiresAt, lastError, digestChildRunId
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
        senderId, actorUserId, messageId, text, rawJson, createdAt, processedAt,
        status, attempts, leaseOwner, leaseExpiresAt, lastError, digestChildRunId
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, NULL, NULL)
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
    const clauses: string[] = []
    const params: Array<string | number> = []
    const statuses = filter.statuses?.length ? filter.statuses : ['pending']
    clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`)
    params.push(...statuses)
    if (filter.channelLinkName != null) {
      clauses.push('channelLinkName = ?')
      params.push(filter.channelLinkName)
    }
    if (filter.channelType != null) {
      clauses.push('channelType = ?')
      params.push(filter.channelType)
    }
    if (filter.channelKey != null) {
      clauses.push('channelKey = ?')
      params.push(filter.channelKey)
    }
    if (filter.channelId != null) {
      clauses.push('channelId = ?')
      params.push(filter.channelId)
    }
    if (filter.entity != null) {
      clauses.push('entity = ?')
      params.push(filter.entity)
    }
    if (filter.sessionType != null) {
      clauses.push('sessionType = ?')
      params.push(filter.sessionType)
    }

    const limit = Number.isInteger(filter.limit) && filter.limit != null && filter.limit > 0
      ? filter.limit
      : 50
    const stmt = db.prepare(`
      SELECT id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
             senderId, actorUserId, messageId, text, rawJson, createdAt, processedAt,
             status, attempts, leaseOwner, leaseExpiresAt, lastError, digestChildRunId
      FROM channel_offhour_backlog
      WHERE ${clauses.join(' AND ')}
      ORDER BY createdAt ASC
      LIMIT ?
    `)
    return stmt.all<ChannelOffhourBacklogDbRow>(...params, limit).map(row => mapBacklogRow(row)!)
  }

  const claimOffhourBacklog = db.transaction((input: {
    filter?: OffhourBacklogFilter
    leaseMs: number
    leaseOwner: string
    now?: number
  }) => {
    const now = input.now ?? Date.now()
    const filter = input.filter ?? {}
    const clauses = ["(status = 'pending' OR (status = 'leased' AND leaseExpiresAt <= ?))"]
    const params: Array<string | number> = [now]
    if (filter.channelLinkName != null) {
      clauses.push('channelLinkName = ?')
      params.push(filter.channelLinkName)
    }
    if (filter.channelType != null) {
      clauses.push('channelType = ?')
      params.push(filter.channelType)
    }
    if (filter.channelKey != null) {
      clauses.push('channelKey = ?')
      params.push(filter.channelKey)
    }
    if (filter.channelId != null) {
      clauses.push('channelId = ?')
      params.push(filter.channelId)
    }
    if (filter.entity != null) {
      clauses.push('entity = ?')
      params.push(filter.entity)
    }
    if (filter.sessionType != null) {
      clauses.push('sessionType = ?')
      params.push(filter.sessionType)
    }
    const limit = Number.isInteger(filter.limit) && filter.limit != null && filter.limit > 0 ? filter.limit : 50
    const scope = db.prepare(`
      SELECT channelType, channelKey, channelId, sessionType, channelLinkName, entity
      FROM channel_offhour_backlog
      WHERE ${clauses.join(' AND ')}
      ORDER BY createdAt ASC LIMIT ?
    `).get<
      Pick<
        ChannelOffhourBacklogDbRow,
        'channelType' | 'channelKey' | 'channelId' | 'sessionType' | 'channelLinkName' | 'entity'
      >
    >(
      ...params,
      limit
    )
    if (scope == null) return []
    const candidates = db.prepare(`
      SELECT id FROM channel_offhour_backlog
      WHERE ${clauses.join(' AND ')}
        AND channelType = ? AND channelKey = ? AND channelId = ? AND sessionType = ?
        AND channelLinkName IS ? AND entity IS ?
      ORDER BY createdAt ASC LIMIT ?
    `).all<{ id: string }>(
      ...params,
      scope.channelType,
      scope.channelKey,
      scope.channelId,
      scope.sessionType,
      scope.channelLinkName,
      scope.entity,
      limit
    )
    const ids = candidates.map(row => row.id)
    const placeholders = ids.map(() => '?').join(', ')
    db.prepare(`
      UPDATE channel_offhour_backlog
      SET status = 'leased', attempts = attempts + 1, leaseOwner = ?, leaseExpiresAt = ?, lastError = NULL
      WHERE id IN (${placeholders}) AND (status = 'pending' OR (status = 'leased' AND leaseExpiresAt <= ?))
    `).run(input.leaseOwner, now + input.leaseMs, ...ids, now)
    return ids.map(getOffhourBacklogItem).filter((row): row is NonNullable<typeof row> =>
      row?.leaseOwner === input.leaseOwner
    )
  })

  const attachOffhourBacklogDigestChildRun = (
    input: { ids: string[]; leaseOwner: string; digestChildRunId: string }
  ) => {
    if (input.ids.length === 0) return 0
    const placeholders = input.ids.map(() => '?').join(', ')
    return db.prepare(`
      UPDATE channel_offhour_backlog SET digestChildRunId = ?
      WHERE id IN (${placeholders}) AND status = 'leased' AND leaseOwner = ?
        AND (digestChildRunId IS NULL OR digestChildRunId = ?)
    `).run(input.digestChildRunId, ...input.ids, input.leaseOwner, input.digestChildRunId).changes
  }

  const completeOffhourBacklogClaim = (input: { ids: string[]; leaseOwner: string; processedAt?: number }) => {
    if (input.ids.length === 0) return 0
    const placeholders = input.ids.map(() => '?').join(', ')
    return db.prepare(`
      UPDATE channel_offhour_backlog
      SET status = 'processed', processedAt = ?, leaseOwner = NULL, leaseExpiresAt = NULL, lastError = NULL
      WHERE id IN (${placeholders}) AND status = 'leased' AND leaseOwner = ?
    `).run(input.processedAt ?? Date.now(), ...input.ids, input.leaseOwner).changes
  }

  const retryOffhourBacklogClaim = (input: { ids: string[]; leaseOwner?: string; error?: string }) => {
    if (input.ids.length === 0) return 0
    const placeholders = input.ids.map(() => '?').join(', ')
    const ownerClause = input.leaseOwner == null ? '' : ' AND leaseOwner = ?'
    const params: Array<string | null> = [input.error ?? null, ...input.ids]
    if (input.leaseOwner != null) params.push(input.leaseOwner)
    return db.prepare(`
      UPDATE channel_offhour_backlog
      SET status = 'pending', leaseOwner = NULL, leaseExpiresAt = NULL, lastError = ?
      WHERE id IN (${placeholders}) AND status IN ('leased', 'failed')${ownerClause}
    `).run(...params).changes
  }

  const markOffhourBacklogProcessed = (ids: string[], processedAt = Date.now()) => {
    if (ids.length === 0) return 0
    const placeholders = ids.map(() => '?').join(', ')
    return db.prepare(`
      UPDATE channel_offhour_backlog
      SET status = 'processed', processedAt = ?, leaseOwner = NULL, leaseExpiresAt = NULL, lastError = NULL
      WHERE id IN (${placeholders})
    `).run(processedAt, ...ids).changes
  }

  return {
    appendOffhourBacklog,
    getOffhourBacklogItem,
    listPendingOffhourBacklog,
    claimOffhourBacklog,
    attachOffhourBacklogDigestChildRun,
    completeOffhourBacklogClaim,
    markOffhourBacklogProcessed,
    retryOffhourBacklogClaim
  }
}
