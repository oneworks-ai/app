import { createHash } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import { stringifyJson } from './json'
import { mapStateRow } from './state-record'
import type { ChannelConversationStateDbRow } from './state-record'

const STATE_SELECT_FIELDS = `
  id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
  threadKey, topic, summary, activeParticipantsJson, recentTurnIdsJson, pendingIntentIdsJson, lastBotReplyJson,
  lastChildRunId, lastMessageId, createdAt, updatedAt, expiresAt, metadataJson
`

function makeStateId(input: {
  channelType: string
  channelKey: string
  channelId: string
  entity?: string | null
  threadKey: string
}) {
  const hash = createHash('sha256')
    .update(JSON.stringify({
      channelId: input.channelId,
      channelKey: input.channelKey,
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
    channelKey: string
    channelId: string
    entity?: string | null
    threadKey: string
  }) => {
    const stmt = db.prepare(`
      SELECT ${STATE_SELECT_FIELDS}
      FROM channel_conversation_states
      WHERE channelType = ? AND channelKey = ? AND channelId = ? AND entity IS ? AND threadKey = ?
      LIMIT 1
    `)
    return mapStateRow(stmt.get<ChannelConversationStateDbRow>(
      input.channelType,
      input.channelKey,
      input.channelId,
      input.entity ?? null,
      input.threadKey
    ))
  }

  const getStateByLastBotReply = (
    input: { channelType: string; channelKey: string; channelId: string; entity?: string | null; messageId: string }
  ) => {
    const stmt = db.prepare(
      `SELECT ${STATE_SELECT_FIELDS} FROM channel_conversation_states WHERE channelType = ? AND channelKey = ? AND channelId = ? AND entity IS ? AND json_extract(lastBotReplyJson, '$.messageId') = ? LIMIT 1`
    )
    return mapStateRow(
      stmt.get<ChannelConversationStateDbRow>(
        input.channelType,
        input.channelKey,
        input.channelId,
        input.entity ?? null,
        input.messageId
      )
    )
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
    const now = row.now ?? Date.now()
    const id = row.id?.trim() || makeStateId(row)
    db.prepare(`
      INSERT INTO channel_conversation_states (
        id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
        threadKey, topic, summary, activeParticipantsJson, recentTurnIdsJson, pendingIntentIdsJson, lastBotReplyJson,
        lastChildRunId, lastMessageId, createdAt, updatedAt, expiresAt, metadataJson
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO UPDATE SET
        sessionType = excluded.sessionType,
        channelLinkName = excluded.channelLinkName,
        updatedAt = excluded.updatedAt,
        metadataJson = COALESCE(excluded.metadataJson, channel_conversation_states.metadataJson)
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
      null,
      now,
      now,
      null,
      stringifyJson(row.metadata)
    )
    return getStateByThread(row)!
  }

  return {
    ensureState,
    getState,
    getStateByLastBotReply,
    getStateByThread
  }
}
