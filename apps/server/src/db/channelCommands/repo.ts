import { randomUUID } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import { mapRunRow, stringifyJson } from './record'
import type {
  ChannelCommandRunDbRow,
  ChannelCommandRunPermission,
  ChannelCommandRunSource,
  ChannelCommandRunStatus
} from './record'

export type {
  ChannelCommandRunPermission,
  ChannelCommandRunRow,
  ChannelCommandRunSource,
  ChannelCommandRunStatus
} from './record'

export function createChannelCommandsRepo(db: SqliteDatabase) {
  const get = (id: string) => {
    const stmt = db.prepare(`
      SELECT id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
             actorUserId, actorAccountId, senderId, messageId, source, commandName,
             commandPathJson, rawArgsJson, permission, status, startedAt, completedAt,
             error, metadataJson
      FROM channel_command_runs
      WHERE id = ?
    `)
    return mapRunRow(stmt.get<ChannelCommandRunDbRow>(id))
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
    source: ChannelCommandRunSource
    commandName: string
    commandPath: string[]
    rawArgs: string[]
    permission: ChannelCommandRunPermission
    status?: ChannelCommandRunStatus
    startedAt?: number
    metadata?: Record<string, unknown> | null
  }) => {
    const id = row.id?.trim() || `channel_command_${randomUUID()}`
    const startedAt = row.startedAt ?? Date.now()
    const stmt = db.prepare(`
      INSERT INTO channel_command_runs (
        id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
        actorUserId, actorAccountId, senderId, messageId, source, commandName,
        commandPathJson, rawArgsJson, permission, status, startedAt, completedAt, error, metadataJson
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
      row.source,
      row.commandName,
      JSON.stringify(row.commandPath),
      JSON.stringify(row.rawArgs),
      row.permission,
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
    status: Exclude<ChannelCommandRunStatus, 'started'>
  }) => {
    const completedAt = updates.completedAt ?? Date.now()
    const stmt = db.prepare(`
      UPDATE channel_command_runs
      SET status = ?, completedAt = ?, error = ?
      WHERE id = ?
    `)
    stmt.run(updates.status, completedAt, updates.error ?? null, id)
    return get(id)
  }

  const listRecent = (limit = 50) => {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 50
    const stmt = db.prepare(`
      SELECT id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
             actorUserId, actorAccountId, senderId, messageId, source, commandName,
             commandPathJson, rawArgsJson, permission, status, startedAt, completedAt,
             error, metadataJson
      FROM channel_command_runs
      ORDER BY startedAt DESC
      LIMIT ?
    `)
    return stmt.all<ChannelCommandRunDbRow>(normalizedLimit).map(row => mapRunRow(row)!)
  }

  return {
    create,
    finish,
    get,
    listRecent
  }
}
