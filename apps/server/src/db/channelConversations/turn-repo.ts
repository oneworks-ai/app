import { randomUUID } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import { stringifyJson, uniqueStrings } from './json'
import type { ChannelConversationStateRow } from './state-record'
import { mapTurnRow } from './turn-record'
import type { ChannelConversationTurnDbRow, ChannelConversationTurnRole } from './turn-record'

const RECENT_TURN_LIMIT = 20
const TURN_SELECT_FIELDS = `
  id, conversationStateId, threadKey, channelType, channelKey, channelId,
  sessionType, channelLinkName, entity, childRunId, actorUserId, actorAccountId,
  senderId, messageId, role, text, summary, createdAt, metadataJson
`

interface ConversationStateReader {
  getState(id: string): ChannelConversationStateRow | undefined
}

export function createConversationTurnsRepo(db: SqliteDatabase, states: ConversationStateReader) {
  const getTurn = (id: string) => {
    const stmt = db.prepare(`
      SELECT ${TURN_SELECT_FIELDS}
      FROM channel_conversation_turns
      WHERE id = ?
    `)
    return mapTurnRow(stmt.get<ChannelConversationTurnDbRow>(id))
  }

  const appendTurn = (row: {
    id?: string | null
    conversationStateId: string
    threadKey: string
    channelType: string
    channelKey: string
    channelId: string
    sessionType: string
    channelLinkName?: string | null
    entity?: string | null
    childRunId?: string | null
    actorUserId?: string | null
    actorAccountId?: string | null
    senderId?: string | null
    messageId?: string | null
    role: ChannelConversationTurnRole
    text?: string | null
    summary?: string | null
    createdAt?: number
    metadata?: Record<string, unknown> | null
  }) => {
    const id = row.id?.trim() || `channel_turn_${randomUUID()}`
    const createdAt = row.createdAt ?? Date.now()
    db.prepare(`
      INSERT INTO channel_conversation_turns (
        id, conversationStateId, threadKey, channelType, channelKey, channelId,
        sessionType, channelLinkName, entity, childRunId, actorUserId, actorAccountId,
        senderId, messageId, role, text, summary, createdAt, metadataJson
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      row.conversationStateId,
      row.threadKey,
      row.channelType,
      row.channelKey,
      row.channelId,
      row.sessionType,
      row.channelLinkName ?? null,
      row.entity ?? null,
      row.childRunId ?? null,
      row.actorUserId ?? null,
      row.actorAccountId ?? null,
      row.senderId ?? null,
      row.messageId ?? null,
      row.role,
      row.text ?? null,
      row.summary ?? null,
      createdAt,
      stringifyJson(row.metadata)
    )

    const state = states.getState(row.conversationStateId)
    if (state != null) {
      const activeParticipants = uniqueStrings([
        ...state.activeParticipants,
        row.actorUserId,
        row.actorAccountId,
        row.senderId
      ])
      const recentTurnIds = uniqueStrings([...state.recentTurnIds, id]).slice(-RECENT_TURN_LIMIT)
      db.prepare(`
        UPDATE channel_conversation_states
        SET activeParticipantsJson = ?, recentTurnIdsJson = ?, lastChildRunId = COALESCE(?, lastChildRunId),
            lastMessageId = COALESCE(?, lastMessageId), updatedAt = ?
        WHERE id = ?
      `).run(
        JSON.stringify(activeParticipants),
        JSON.stringify(recentTurnIds),
        row.childRunId ?? null,
        row.messageId ?? null,
        createdAt,
        row.conversationStateId
      )
    }

    return getTurn(id)!
  }

  const listRecentTurns = (conversationStateId: string, limit = RECENT_TURN_LIMIT) => {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : RECENT_TURN_LIMIT
    const stmt = db.prepare(`
      SELECT ${TURN_SELECT_FIELDS}
      FROM channel_conversation_turns
      WHERE conversationStateId = ?
      ORDER BY createdAt DESC
      LIMIT ?
    `)
    return stmt.all<ChannelConversationTurnDbRow>(conversationStateId, normalizedLimit)
      .map(row => mapTurnRow(row)!)
      .reverse()
  }

  const listRecentTurnsByChannelType = (channelType: string, limit = RECENT_TURN_LIMIT) => {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : RECENT_TURN_LIMIT
    const stmt = db.prepare(`
      SELECT ${TURN_SELECT_FIELDS}
      FROM channel_conversation_turns
      WHERE channelType = ?
      ORDER BY createdAt DESC
      LIMIT ?
    `)
    return stmt.all<ChannelConversationTurnDbRow>(channelType, normalizedLimit)
      .map(row => mapTurnRow(row)!)
  }

  return {
    appendTurn,
    getTurn,
    listRecentTurns,
    listRecentTurnsByChannelType
  }
}
