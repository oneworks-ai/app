import { randomUUID } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import { stringifyJson } from './json'
import { mapPolicyEventRow } from './policy-record'
import type { ChannelPolicyEventDbRow, ChannelPolicyEventRow, ChannelPolicyStateRow } from './policy-record'

export function createChannelPolicyStateRepo(db: SqliteDatabase) {
  const getChannelPolicyState = (policyKey: string) =>
    db.prepare(`
    SELECT policyKey, channelLinkName, scope, subjectKey, state, reason, hits, hitWindowStartedAt,
           mutedUntil, revision, updatedBy, updatedAt
    FROM channel_policy_states WHERE policyKey = ?
  `).get<ChannelPolicyStateRow>(policyKey)

  const listChannelPolicyEvents = (policyKey: string, limit = 50) =>
    db.prepare(`
    SELECT id, eventKey, policyKey, channelLinkName, eventType, actorUserId, actorAccountId, metadataJson, createdAt
    FROM channel_policy_events WHERE policyKey = ? ORDER BY createdAt DESC LIMIT ?
  `).all<ChannelPolicyEventDbRow>(policyKey, limit).map(row => mapPolicyEventRow(row)!)

  const getChannelPolicyEventByEventKey = (eventKey: string) => {
    const row = db.prepare(`
      SELECT id, eventKey, policyKey, channelLinkName, eventType, actorUserId, actorAccountId, metadataJson, createdAt
      FROM channel_policy_events WHERE eventKey = ?
    `).get<ChannelPolicyEventDbRow>(eventKey)
    return mapPolicyEventRow(row)
  }

  const appendChannelPolicyEvent = (input: {
    eventKey: string
    policyKey?: string
    channelLinkName: string
    eventType: string
    actorUserId?: string
    actorAccountId?: string
    metadata?: Record<string, unknown>
    createdAt?: number
  }): ChannelPolicyEventRow | undefined => {
    db.prepare(`
      INSERT INTO channel_policy_events (
        id, eventKey, policyKey, channelLinkName, eventType, actorUserId, actorAccountId, metadataJson, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(eventKey) DO NOTHING
    `).run(
      randomUUID(),
      input.eventKey,
      input.policyKey ?? null,
      input.channelLinkName,
      input.eventType,
      input.actorUserId ?? null,
      input.actorAccountId ?? null,
      stringifyJson(input.metadata),
      input.createdAt ?? Date.now()
    )
    const row = db.prepare(`
      SELECT id, eventKey, policyKey, channelLinkName, eventType, actorUserId, actorAccountId, metadataJson, createdAt
      FROM channel_policy_events WHERE eventKey = ?
    `).get<ChannelPolicyEventDbRow>(input.eventKey)
    return mapPolicyEventRow(row)
  }

  const compareAndSetChannelPolicyState = db.transaction((
    input: Omit<ChannelPolicyStateRow, 'revision'> & {
      expectedRevision?: number
    }
  ) => {
    const current = getChannelPolicyState(input.policyKey)
    if (current != null && input.expectedRevision != null && current.revision !== input.expectedRevision) {
      return undefined
    }
    if (current == null && input.expectedRevision != null) return undefined
    const revision = (current?.revision ?? 0) + 1
    db.prepare(`
      INSERT INTO channel_policy_states (
        policyKey, channelLinkName, scope, subjectKey, state, reason, hits, hitWindowStartedAt,
        mutedUntil, revision, updatedBy, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(policyKey) DO UPDATE SET
        channelLinkName = excluded.channelLinkName, scope = excluded.scope, subjectKey = excluded.subjectKey,
        state = excluded.state, reason = excluded.reason, hits = excluded.hits,
        hitWindowStartedAt = excluded.hitWindowStartedAt, mutedUntil = excluded.mutedUntil,
        revision = excluded.revision, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt
    `).run(
      input.policyKey,
      input.channelLinkName,
      input.scope,
      input.subjectKey,
      input.state,
      input.reason,
      input.hits,
      input.hitWindowStartedAt,
      input.mutedUntil,
      revision,
      input.updatedBy,
      input.updatedAt
    )
    return getChannelPolicyState(input.policyKey)
  })

  return {
    appendChannelPolicyEvent,
    compareAndSetChannelPolicyState,
    getChannelPolicyState,
    getChannelPolicyEventByEventKey,
    listChannelPolicyEvents
  }
}
