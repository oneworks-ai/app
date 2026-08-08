import { createHash } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import { stringifyJson } from './json'
import { mapStateRow } from './state-record'
import type { ChannelConversationStateDbRow } from './state-record'

const STATE_SELECT_FIELDS = `
  id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
  threadKey, topic, summary, activeParticipantsJson, recentTurnIdsJson, pendingIntentIdsJson,
  lastChildRunId, lastMessageId, createdAt, updatedAt, expiresAt, metadataJson
`

function makeStateId(input: {
  channelType: string
  channelId: string
  entity?: string | null
  threadKey: string
}) {
  const hash = createHash('sha256')
    .update(JSON.stringify({
      channelId: input.channelId,
      channelType: input.channelType,
      entity: input.entity ?? null,
      threadKey: input.threadKey
    }))
    .digest('hex')
    .slice(0, 24)
  return `channel-conversation:${hash}`
}

export function createConversationStatesRepo(db: SqliteDatabase) {
  const getState = (id: string) => {
    const stmt = db.prepare(`
      SELECT ${STATE_SELECT_FIELDS}
      FROM channel_conversation_states
      WHERE id = ?
    `)
    return mapStateRow(stmt.get<ChannelConversationStateDbRow>(id))
  }

  const getStateByThread = (input: {
    channelType: string
    channelId: string
    entity?: string | null
    threadKey: string
  }) => {
    const stmt = db.prepare(`
      SELECT ${STATE_SELECT_FIELDS}
      FROM channel_conversation_states
      WHERE channelType = ? AND channelId = ? AND entity IS ? AND threadKey = ?
      LIMIT 1
    `)
    return mapStateRow(stmt.get<ChannelConversationStateDbRow>(
      input.channelType,
      input.channelId,
      input.entity ?? null,
      input.threadKey
    ))
  }

  const ensureState = (row: {
    id?: string | null
    channelType: string
    channelKey: string
    channelId: string
    sessionType: string
    channelLinkName?: string | null
    entity?: string | null
    threadKey: string
    metadata?: Record<string, unknown> | null
    now?: number
  }) => {
    const existing = getStateByThread(row)
    const now = row.now ?? Date.now()
    if (existing != null) {
      db.prepare(`
        UPDATE channel_conversation_states
        SET channelKey = ?, sessionType = ?, channelLinkName = ?, updatedAt = ?, metadataJson = COALESCE(?, metadataJson)
        WHERE id = ?
      `).run(
        row.channelKey,
        row.sessionType,
        row.channelLinkName ?? null,
        now,
        stringifyJson(row.metadata),
        existing.id
      )
      return getState(existing.id)!
    }

    const id = row.id?.trim() || makeStateId(row)
    db.prepare(`
      INSERT INTO channel_conversation_states (
        id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
        threadKey, topic, summary, activeParticipantsJson, recentTurnIdsJson, pendingIntentIdsJson,
        lastChildRunId, lastMessageId, createdAt, updatedAt, expiresAt, metadataJson
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      row.channelType,
      row.channelKey,
      row.channelId,
      row.sessionType,
      row.channelLinkName ?? null,
      row.entity ?? null,
      row.threadKey,
      null,
      null,
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      null,
      null,
      now,
      now,
      null,
      stringifyJson(row.metadata)
    )
    return getState(id)!
  }

  return {
    ensureState,
    getState,
    getStateByThread
  }
}
