/* eslint-disable max-lines -- message persistence keeps dedupe keys, cursor windows, and copy helpers together. */
import { createHash } from 'node:crypto'

import { safeJsonStringify } from '#~/utils/json.js'

import type { SqliteDatabase } from '../sqlite'

export interface SessionMessageListOptions {
  afterId?: number
  beforeId?: number
  limit?: number
}

export interface SessionMessageWindowCursor {
  firstId?: number
  lastId?: number
}

export interface SessionMessageWindowResult {
  cursor: SessionMessageWindowCursor
  messages: unknown[]
}

interface SessionMessageRow {
  data: string
  eventKey: string | null
  id: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asString = (value: unknown) => typeof value === 'string' && value.trim() !== '' ? value : undefined

const hashValue = (value: unknown) => createHash('sha256').update(safeJsonStringify(value)).digest('hex')

const getMessageRuntimeCommandKey = (message: Record<string, unknown>) => {
  const agentRoom = isRecord(message.agentRoom) ? message.agentRoom : undefined
  const causedByCommandId = agentRoom == null ? undefined : asString(agentRoom.causedByCommandId)
  const commandId = agentRoom == null ? undefined : asString(agentRoom.commandId)
  const runtimeCommandId = causedByCommandId ?? commandId
  return runtimeCommandId == null ? undefined : `message:runtime-command:${runtimeCommandId}`
}

const getSessionMessageEventKey = (data: unknown): string | undefined => {
  if (!isRecord(data)) {
    return undefined
  }

  if (data.type === 'message' && isRecord(data.message)) {
    const runtimeCommandKey = getMessageRuntimeCommandKey(data.message)
    if (runtimeCommandKey != null) {
      return runtimeCommandKey
    }

    const messageId = asString(data.message.id)
    return messageId == null ? undefined : `message:${messageId}`
  }

  if (data.type === 'interaction_request') {
    const interactionId = asString(data.id)
    return interactionId == null ? undefined : `interaction_request:${interactionId}:${hashValue(data.payload)}`
  }

  if (data.type === 'interaction_response') {
    const interactionId = asString(data.id)
    return interactionId == null ? undefined : `interaction_response:${interactionId}:${hashValue(data.data)}`
  }

  if (data.type === 'error' && isRecord(data.data)) {
    const details = isRecord(data.data.details) ? data.data.details : undefined
    const runtimeEventId = details == null ? undefined : asString(details.runtimeEventId)
    const runtimeSessionId = details == null ? undefined : asString(details.runtimeSessionId)
    if (runtimeEventId != null) {
      return `error:runtime:${runtimeSessionId ?? ''}:${runtimeEventId}`
    }
  }

  if (data.type === 'adapter_event' && isRecord(data.data)) {
    const source = asString(data.data.source)
    const deliveryKey = asString(data.data.deliveryKey)
    if (source === 'runtime_host_request_delivery' && deliveryKey != null) {
      return `adapter_event:${source}:${deliveryKey}`
    }

    if (isRecord(data.data.runtimeEvent)) {
      const runtimeEventId = asString(data.data.runtimeEvent.id)
      const runtimeSessionId = asString(data.data.runtimeEvent.sessionId)
      if (runtimeEventId != null) {
        return `adapter_event:runtime:${runtimeSessionId ?? ''}:${runtimeEventId}`
      }
    }
  }

  if (data.type === 'workspace_changes' && isRecord(data.changes)) {
    const changeSetId = asString(data.changes.id)
    return changeSetId == null ? undefined : `workspace_changes:${changeSetId}`
  }

  return undefined
}

export function createMessagesRepo(db: SqliteDatabase) {
  const backfillEventKeys = () => {
    const rows = db.prepare('SELECT id, data FROM messages WHERE eventKey IS NULL')
      .all<{ id: number; data: string }>()
    if (rows.length === 0) {
      return
    }

    const update = db.prepare('UPDATE messages SET eventKey = ? WHERE id = ?')
    const backfill = db.transaction(() => {
      for (const row of rows) {
        const eventKey = getSessionMessageEventKey(JSON.parse(row.data) as unknown)
        if (eventKey != null) {
          update.run(eventKey, row.id)
        }
      }
    })
    backfill()
  }

  backfillEventKeys()

  const hasEventKey = (sessionId: string, eventKey: string) => (
    db.prepare('SELECT 1 FROM messages WHERE sessionId = ? AND eventKey = ? LIMIT 1')
      .get(sessionId, eventKey) != null
  )

  const save = (sessionId: string, data: unknown) => {
    const eventKey = getSessionMessageEventKey(data)
    if (eventKey != null && hasEventKey(sessionId, eventKey)) {
      return false
    }

    const stmt = db.prepare('INSERT INTO messages (sessionId, data, eventKey, createdAt) VALUES (?, ?, ?, ?)')
    stmt.run(sessionId, safeJsonStringify(data), eventKey ?? null, Date.now())
    return true
  }

  const mapRowsWithCursor = (rows: SessionMessageRow[]): SessionMessageWindowResult => {
    const seenEventKeys = new Set<string>()
    const messages: unknown[] = []
    for (const row of rows) {
      if (row.eventKey != null) {
        if (seenEventKeys.has(row.eventKey)) {
          continue
        }
        seenEventKeys.add(row.eventKey)
      }
      messages.push(JSON.parse(row.data) as unknown)
    }
    const firstRow = rows[0]
    const lastRow = rows[rows.length - 1]
    return {
      cursor: {
        ...(firstRow == null ? {} : { firstId: firstRow.id }),
        ...(lastRow == null ? {} : { lastId: lastRow.id })
      },
      messages
    }
  }

  const mapRows = (rows: SessionMessageRow[]): unknown[] => {
    return mapRowsWithCursor(rows).messages
  }

  const listWithCursor = (sessionId: string): SessionMessageWindowResult => {
    const stmt = db.prepare('SELECT id, data, eventKey FROM messages WHERE sessionId = ? ORDER BY id ASC')
    return mapRowsWithCursor(stmt.all<SessionMessageRow>(sessionId))
  }

  const list = (sessionId: string): unknown[] => {
    return listWithCursor(sessionId).messages
  }

  const listWindowWithCursor = (
    sessionId: string,
    options: SessionMessageListOptions
  ): SessionMessageWindowResult => {
    const limit = options.limit
    if (limit == null) {
      return listWithCursor(sessionId)
    }

    if (options.afterId != null) {
      return mapRowsWithCursor(
        db.prepare(`
          SELECT id, data, eventKey FROM messages
          WHERE sessionId = ? AND id > ?
          ORDER BY id ASC
          LIMIT ?
        `).all<SessionMessageRow>(sessionId, options.afterId, limit)
      )
    }

    const rows = options.beforeId == null
      ? db.prepare(`
        SELECT id, data, eventKey FROM messages
        WHERE sessionId = ?
        ORDER BY id DESC
        LIMIT ?
      `).all<SessionMessageRow>(sessionId, limit)
      : db.prepare(`
        SELECT id, data, eventKey FROM messages
        WHERE sessionId = ? AND id < ?
        ORDER BY id DESC
        LIMIT ?
      `).all<SessionMessageRow>(sessionId, options.beforeId, limit)

    return mapRowsWithCursor(rows.reverse())
  }

  const listWindow = (sessionId: string, options: SessionMessageListOptions): unknown[] => {
    return listWindowWithCursor(sessionId, options).messages
  }

  const findLatestSessionInfo = (sessionId: string): unknown | undefined => {
    const rows = db.prepare(
      'SELECT id, data, eventKey FROM messages WHERE sessionId = ? AND data LIKE ? ORDER BY id DESC LIMIT 50'
    ).all<SessionMessageRow>(sessionId, '%"type":"session_info"%')
    return mapRows(rows).find(event => isRecord(event) && event.type === 'session_info')
  }

  const copy = (fromSessionId: string, toSessionId: string) => {
    const messages = list(fromSessionId)
    for (const msg of messages) {
      save(toSessionId, msg)
    }
  }

  return { copy, findLatestSessionInfo, list, listWindow, listWindowWithCursor, save }
}

export type MessagesRepo = ReturnType<typeof createMessagesRepo>
