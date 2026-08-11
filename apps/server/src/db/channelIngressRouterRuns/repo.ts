import { randomUUID } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import type { ChannelIngressRouterRunDbRow } from './record'

export type { ChannelIngressRouterDecision, ChannelIngressRouterRunRow } from './record'

const FIELDS = `
  id, channelType, channelKey, channelId, sessionType, channelLinkName, entity,
  actorUserId, actorAccountId, senderId, messageId, syntheticActorRole,
  syntheticUserLabel, decision, reason, confidence, mode, model, adapter,
  visibility, candidateCount, filteredCount, contextCount, childRunId, error,
  latencyMs, createdAt
`

export function createChannelIngressRouterRunsRepo(db: SqliteDatabase) {
  const get = (id: string) =>
    db.prepare(`SELECT ${FIELDS} FROM channel_ingress_router_runs WHERE id = ?`)
      .get<ChannelIngressRouterRunDbRow>(id)

  const create = (
    input: Omit<ChannelIngressRouterRunDbRow, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
  ) => {
    const id = input.id?.trim() || `channel_ingress_${randomUUID()}`
    db.prepare(`
      INSERT INTO channel_ingress_router_runs (${FIELDS})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.channelType,
      input.channelKey,
      input.channelId,
      input.sessionType,
      input.channelLinkName,
      input.entity,
      input.actorUserId,
      input.actorAccountId,
      input.senderId,
      input.messageId,
      input.syntheticActorRole,
      input.syntheticUserLabel,
      input.decision,
      input.reason,
      input.confidence,
      input.mode,
      input.model,
      input.adapter,
      input.visibility,
      input.candidateCount,
      input.filteredCount,
      input.contextCount,
      input.childRunId,
      input.error,
      input.latencyMs,
      input.createdAt ?? Date.now()
    )
    return get(id)!
  }

  const attachChildRun = (id: string, childRunId: string) => {
    db.prepare(`
      UPDATE channel_ingress_router_runs
      SET childRunId = ?
      WHERE id = ? AND (childRunId IS NULL OR childRunId = ?)
    `).run(childRunId, id, childRunId)
    return get(id)
  }

  const listRecent = (limit = 50) =>
    db.prepare(`
    SELECT ${FIELDS} FROM channel_ingress_router_runs ORDER BY createdAt DESC LIMIT ?
  `).all<ChannelIngressRouterRunDbRow>(Math.max(1, Math.trunc(limit)))

  return { attachChildRun, create, get, listRecent }
}
