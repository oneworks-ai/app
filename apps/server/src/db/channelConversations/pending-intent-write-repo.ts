import { randomUUID } from 'node:crypto'

import { buildUpdateStatement } from '../repo.utils'
import type { SqliteDatabase } from '../sqlite'
import { stringifyJson, uniqueStrings } from './json'
import type { createPendingIntentReaders } from './pending-intent-read-repo'
import type { PendingIntentInput, PendingIntentUpdates } from './pending-intent-record'
import type { ChannelConversationStateRow } from './state-record'

const PENDING_INTENT_LIMIT = 50

interface ConversationStateReader {
  getState(id: string): ChannelConversationStateRow | undefined
}

export function createPendingIntentWriters(
  db: SqliteDatabase,
  states: ConversationStateReader,
  readers: ReturnType<typeof createPendingIntentReaders>
) {
  const syncStatePendingIntentIds = (conversationStateId: string | null | undefined, intentId: string) => {
    if (conversationStateId == null || conversationStateId.trim() === '') return
    const state = states.getState(conversationStateId)
    if (state == null) return
    const pendingIntentIds = uniqueStrings([...state.pendingIntentIds, intentId]).slice(-PENDING_INTENT_LIMIT)
    db.prepare(`
      UPDATE channel_conversation_states
      SET pendingIntentIdsJson = ?, updatedAt = ?
      WHERE id = ?
    `).run(JSON.stringify(pendingIntentIds), Date.now(), conversationStateId)
  }

  const upsertPendingIntent = (row: PendingIntentInput) => {
    const id = row.id?.trim() || `channel_pending_intent_${randomUUID()}`
    const now = Date.now()
    db.prepare(`
      INSERT INTO channel_pending_intents (
        id, conversationStateId, threadKey, channelType, channelKey, channelId,
        sessionType, channelLinkName, entity, ownerUserId, ownerAccountId,
        approverUserIdsJson, createdByChildRunId, authorizationRequestId, kind, status,
        requiredAction, delivery, deliveryMessageId, payloadJson, createdAt, updatedAt,
        expiresAt, resolvedAt, metadataJson
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        conversationStateId = COALESCE(excluded.conversationStateId, channel_pending_intents.conversationStateId),
        threadKey = excluded.threadKey,
        channelType = excluded.channelType,
        channelKey = excluded.channelKey,
        channelId = excluded.channelId,
        sessionType = excluded.sessionType,
        channelLinkName = excluded.channelLinkName,
        entity = excluded.entity,
        ownerUserId = excluded.ownerUserId,
        ownerAccountId = excluded.ownerAccountId,
        approverUserIdsJson = excluded.approverUserIdsJson,
        createdByChildRunId = COALESCE(excluded.createdByChildRunId, channel_pending_intents.createdByChildRunId),
        authorizationRequestId = COALESCE(excluded.authorizationRequestId, channel_pending_intents.authorizationRequestId),
        kind = excluded.kind,
        status = excluded.status,
        requiredAction = excluded.requiredAction,
        delivery = excluded.delivery,
        deliveryMessageId = excluded.deliveryMessageId,
        payloadJson = excluded.payloadJson,
        updatedAt = excluded.updatedAt,
        expiresAt = excluded.expiresAt,
        resolvedAt = excluded.resolvedAt,
        metadataJson = excluded.metadataJson
    `).run(
      id,
      row.conversationStateId ?? null,
      row.threadKey,
      row.channelType,
      row.channelKey ?? null,
      row.channelId ?? null,
      row.sessionType ?? null,
      row.channelLinkName ?? null,
      row.entity ?? null,
      row.ownerUserId ?? null,
      row.ownerAccountId ?? null,
      stringifyJson(row.approverUserIds ?? []),
      row.createdByChildRunId ?? null,
      row.authorizationRequestId ?? null,
      row.kind,
      row.status ?? 'open',
      row.requiredAction ?? null,
      row.delivery ?? null,
      row.deliveryMessageId ?? null,
      stringifyJson(row.payload),
      now,
      now,
      row.expiresAt ?? null,
      row.resolvedAt ?? null,
      stringifyJson(row.metadata)
    )
    syncStatePendingIntentIds(row.conversationStateId, id)
    return readers.getPendingIntent(id)!
  }

  const updatePendingIntent = (id: string, updates: PendingIntentUpdates) => {
    const statement = buildUpdateStatement(
      'channel_pending_intents',
      'id',
      id,
      {
        ...updates,
        metadataJson: updates.metadata,
        payloadJson: updates.payload,
        updatedAt: Date.now()
      },
      [
        { key: 'status' },
        { key: 'delivery' },
        { key: 'deliveryMessageId' },
        { key: 'payloadJson', toParam: value => stringifyJson(value) },
        { key: 'expiresAt' },
        { key: 'resolvedAt' },
        { key: 'metadataJson', toParam: value => stringifyJson(value) },
        { key: 'updatedAt' }
      ] as const
    )
    if (statement == null) return readers.getPendingIntent(id)
    db.prepare(statement.sql).run(...statement.params)
    return readers.getPendingIntent(id)
  }

  const claimPendingIntentResume = db.transaction((input: {
    id: string
    metadata: Record<string, unknown>
    now?: number
  }) => {
    const result = db.prepare(`
      UPDATE channel_pending_intents
      SET metadataJson = ?, updatedAt = ?
      WHERE id = ?
        AND status = 'resolved'
        AND (
          json_extract(metadataJson, '$.resume.status') = 'ready'
          OR (
            json_extract(metadataJson, '$.resume.status') = 'dispatching'
            AND json_extract(metadataJson, '$.resume.leaseExpiresAt') <= ?
          )
        )
    `).run(stringifyJson(input.metadata), input.now ?? Date.now(), input.id, input.now ?? Date.now())
    return result.changes === 1 ? readers.getPendingIntent(input.id) : undefined
  })

  const finishPendingIntentResumeClaim = db.transaction((input: {
    claimId: string
    id: string
    metadata: Record<string, unknown>
    now?: number
  }) => {
    const result = db.prepare(`
      UPDATE channel_pending_intents
      SET metadataJson = ?, updatedAt = ?
      WHERE id = ?
        AND status = 'resolved'
        AND json_extract(metadataJson, '$.resume.status') = 'dispatching'
        AND json_extract(metadataJson, '$.resume.claimId') = ?
    `).run(stringifyJson(input.metadata), input.now ?? Date.now(), input.id, input.claimId)
    return result.changes === 1 ? readers.getPendingIntent(input.id) : undefined
  })

  return {
    claimPendingIntentResume,
    finishPendingIntentResumeClaim,
    updatePendingIntent,
    upsertPendingIntent
  }
}
