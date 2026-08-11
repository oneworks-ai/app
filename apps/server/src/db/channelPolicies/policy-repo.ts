import { randomUUID } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import { stringifyJson } from './json'
import { mapPolicyEventRow } from './policy-record'
import type { ChannelPolicyEventDbRow, ChannelPolicyStateRow } from './policy-record'

type NewState = Omit<ChannelPolicyStateRow, 'revision'>

export function createChannelPolicyStateRepo(db: SqliteDatabase) {
  const getChannelPolicyState = (policyKey: string) =>
    db.prepare(`
    SELECT policyKey, channelLinkName, scope, subjectKey, state, reason, hits, hitWindowStartedAt,
           mutedUntil, revision, updatedBy, updatedAt
    FROM channel_policy_states WHERE policyKey = ?
  `).get<ChannelPolicyStateRow>(policyKey)

  const getChannelPolicyEventByEventKey = (eventKey: string) =>
    mapPolicyEventRow(
      db.prepare(`
    SELECT id, eventKey, policyKey, channelLinkName, eventType, actorUserId, actorAccountId, metadataJson, createdAt
    FROM channel_policy_events WHERE eventKey = ?
  `).get<ChannelPolicyEventDbRow>(eventKey)
    )

  const listChannelPolicyEvents = (policyKey: string, limit = 50) =>
    db.prepare(`
    SELECT id, eventKey, policyKey, channelLinkName, eventType, actorUserId, actorAccountId, metadataJson, createdAt
    FROM channel_policy_events WHERE policyKey = ? ORDER BY createdAt DESC LIMIT ?
    `).all<ChannelPolicyEventDbRow>(policyKey, limit).map(row => mapPolicyEventRow(row)!)

  const listRecentChannelPolicyEvents = (limit = 50) => {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 50
    return db.prepare(`
      SELECT id, eventKey, policyKey, channelLinkName, eventType, actorUserId, actorAccountId, metadataJson, createdAt
      FROM channel_policy_events ORDER BY createdAt DESC LIMIT ?
    `).all<ChannelPolicyEventDbRow>(normalizedLimit).map(row => mapPolicyEventRow(row)!)
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
  }) => {
    db.prepare(`
      INSERT INTO channel_policy_events (id, eventKey, policyKey, channelLinkName, eventType, actorUserId, actorAccountId, metadataJson, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    return getChannelPolicyEventByEventKey(input.eventKey)
  }

  const writeState = (input: NewState, revision: number) => {
    db.prepare(`
      INSERT INTO channel_policy_states (policyKey, channelLinkName, scope, subjectKey, state, reason, hits, hitWindowStartedAt, mutedUntil, revision, updatedBy, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    return getChannelPolicyState(input.policyKey)!
  }

  const compareAndSetChannelPolicyState = db.transaction((input: NewState & { expectedRevision?: number }) => {
    const current = getChannelPolicyState(input.policyKey)
    if (input.expectedRevision != null && current?.revision !== input.expectedRevision) return undefined
    return writeState(input, (current?.revision ?? 0) + 1)
  })

  // The state transition and its inbound-message event share one immediate transaction.
  const applyChannelPolicyHit = db.transaction((input: {
    event: Parameters<typeof appendChannelPolicyEvent>[0]
    resolveState: (current: ChannelPolicyStateRow | undefined) => NewState
  }) => {
    if (getChannelPolicyEventByEventKey(input.event.eventKey) != null) {
      return { applied: false as const, state: getChannelPolicyState(input.event.policyKey ?? '') }
    }
    const current = getChannelPolicyState(input.event.policyKey ?? '')
    const state = writeState(input.resolveState(current), (current?.revision ?? 0) + 1)
    appendChannelPolicyEvent(input.event)
    return { applied: true as const, state }
  })

  return {
    appendChannelPolicyEvent,
    applyChannelPolicyHit,
    compareAndSetChannelPolicyState,
    getChannelPolicyEventByEventKey,
    getChannelPolicyState,
    listChannelPolicyEvents,
    listRecentChannelPolicyEvents
  }
}
