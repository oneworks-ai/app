/* eslint-disable max-lines -- memory candidate, writeback, and expiry queries share one repository contract. */
import { randomUUID } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import { mapChannelMemoryRow } from './record'
import type { ChannelMemoryDbRow } from './record'

export type {
  ChannelMemoryMetadata,
  ChannelMemoryRow,
  ChannelMemorySensitivity,
  ChannelMemorySubjectType,
  ChannelMemoryVisibility
} from './record'

export interface ChannelMemoryCandidateFilter {
  accountId: string
  canonicalUserId?: string
  channelId: string
  channelKey: string
  channelType: string
  entity?: string
  issuer: string
  now: number
  orgId: string
  roomId?: string
  threadKey: string
}

export interface UpsertChannelMemoryInput {
  accountId?: string
  canonicalUserId?: string
  confidence: number
  content: string
  entity?: string
  expiresAt?: number
  id?: string
  importance: number
  issuer: string
  keywords: string[]
  metadata?: import('./record').ChannelMemoryMetadata
  orgId: string
  roomId?: string
  pinned: boolean
  sensitivity: import('./record').ChannelMemorySensitivity
  subjectId: string
  subjectType: import('./record').ChannelMemorySubjectType
  source: import('./record').ChannelMemorySource
  threadKey?: string
  visibility?: import('./record').ChannelMemoryVisibility
}

const MEMORY_FIELDS = `
  id, issuer, orgId, subjectType, subjectId, sourceJson, channelKey, channelId, entity,
  canonicalUserId, accountId, roomId, threadKey, sensitivity, visibilityJson,
  keywordsJson, content, importance, confidence, pinned, createdAt, updatedAt, expiresAt, metadataJson
`

export function createChannelMemoriesRepo(db: SqliteDatabase) {
  const get = (id: string) => {
    const stmt = db.prepare(`SELECT ${MEMORY_FIELDS} FROM channel_memories WHERE id = ?`)
    return mapChannelMemoryRow(stmt.get<ChannelMemoryDbRow>(id))
  }

  const listCandidates = (filter: ChannelMemoryCandidateFilter) => {
    const stmt = db.prepare(`
      SELECT ${MEMORY_FIELDS}
      FROM channel_memories
      WHERE orgId = ?
        AND (expiresAt IS NULL OR expiresAt > ?)
        AND (
          (subjectType = 'entity' AND entity = ?)
          OR (subjectType = 'canonical_user' AND canonicalUserId = ?)
          OR (subjectType = 'account' AND issuer = ? AND accountId = ?)
          OR (subjectType = 'channel' AND issuer = ? AND channelKey = ? AND channelId = ?)
          OR (subjectType = 'conversation' AND issuer = ? AND channelKey = ? AND channelId = ? AND threadKey = ?)
          OR (subjectType = 'room' AND roomId = ?)
        )
    `)
    return stmt.all<ChannelMemoryDbRow>(
      filter.orgId,
      filter.now,
      filter.entity ?? '',
      filter.canonicalUserId ?? '',
      filter.issuer,
      filter.accountId,
      filter.issuer,
      filter.channelKey,
      filter.channelId,
      filter.issuer,
      filter.channelKey,
      filter.channelId,
      filter.threadKey,
      filter.roomId ?? ''
    ).map(row => mapChannelMemoryRow(row)!)
  }

  const upsert = (input: UpsertChannelMemoryInput) => {
    const id = input.id ?? `channel_memory_${randomUUID()}`
    const now = Date.now()
    db.prepare(`
      INSERT INTO channel_memories (
        id, issuer, orgId, subjectType, subjectId, sourceJson, channelKey, channelId, entity,
        canonicalUserId, accountId, roomId, threadKey, sensitivity, visibilityJson, keywordsJson,
        content, importance, confidence, pinned, createdAt, updatedAt, expiresAt, metadataJson
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        issuer = excluded.issuer, orgId = excluded.orgId, subjectType = excluded.subjectType,
        subjectId = excluded.subjectId, sourceJson = excluded.sourceJson, channelKey = excluded.channelKey,
        channelId = excluded.channelId, entity = excluded.entity, canonicalUserId = excluded.canonicalUserId,
        accountId = excluded.accountId, roomId = excluded.roomId, threadKey = excluded.threadKey,
        sensitivity = excluded.sensitivity,
        content = excluded.content, importance = excluded.importance, confidence = excluded.confidence,
        pinned = excluded.pinned, keywordsJson = excluded.keywordsJson, visibilityJson = excluded.visibilityJson,
        expiresAt = excluded.expiresAt, metadataJson = excluded.metadataJson, updatedAt = excluded.updatedAt
    `).run(
      id,
      input.issuer,
      input.orgId,
      input.subjectType,
      input.subjectId,
      JSON.stringify(input.source),
      input.source.channelKey ?? null,
      input.source.channelId ?? null,
      input.entity ?? null,
      input.canonicalUserId ?? null,
      input.accountId ?? null,
      input.roomId ?? null,
      input.threadKey ?? null,
      input.sensitivity,
      JSON.stringify(input.visibility ?? null),
      JSON.stringify(input.keywords),
      input.content,
      input.importance,
      input.confidence,
      input.pinned ? 1 : 0,
      now,
      now,
      input.expiresAt ?? null,
      JSON.stringify(input.metadata ?? null)
    )
    return get(id)!
  }

  const saveSnapshot = (input: {
    accountId: string
    canonicalUserId?: string
    channelId: string
    channelKey: string
    channelType: string
    childRunId?: string
    entity?: string
    itemCount: number
    roomId?: string
    snapshot: Record<string, unknown>
    threadKey: string
    tokenCount: number
  }) => {
    const id = `channel_memory_snapshot_${randomUUID()}`
    db.prepare(`INSERT INTO channel_memory_snapshots (
      id, childRunId, channelType, channelKey, channelId, entity, canonicalUserId,
      accountId, roomId, threadKey, itemCount, tokenCount, snapshotJson, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        input.childRunId ?? null,
        input.channelType,
        input.channelKey,
        input.channelId,
        input.entity ?? null,
        input.canonicalUserId ?? null,
        input.accountId,
        input.roomId ?? null,
        input.threadKey,
        input.itemCount,
        input.tokenCount,
        JSON.stringify(input.snapshot),
        Date.now()
      )
    return id
  }

  const attachSnapshotToChildRun = (snapshotId: string, childRunId: string) => {
    db.prepare(`
      UPDATE channel_memory_snapshots
      SET childRunId = ?
      WHERE id = ? AND (childRunId IS NULL OR childRunId = ?)
    `).run(childRunId, snapshotId, childRunId)
    return db.prepare(`SELECT childRunId FROM channel_memory_snapshots WHERE id = ?`)
      .get<{ childRunId: string | null }>(snapshotId)?.childRunId === childRunId
  }

  const createPendingWriteback = (input: { childRunId: string; patchKey: string; patch: Record<string, unknown> }) => {
    const existing = db.prepare(`SELECT id FROM channel_memory_writebacks WHERE childRunId = ? AND patchKey = ?`)
      .get<{ id: string }>(input.childRunId, input.patchKey)
    if (existing != null) return existing.id
    const id = `channel_memory_writeback_${randomUUID()}`
    db.prepare(`INSERT INTO channel_memory_writebacks (id, childRunId, status, patchKey, patchJson, createdAt)
      VALUES (?, ?, 'pending', ?, ?, ?)`).run(
      id,
      input.childRunId,
      input.patchKey,
      JSON.stringify(input.patch),
      Date.now()
    )
    return id
  }

  const getWritebackByPatchKey = (childRunId: string, patchKey: string) =>
    db.prepare(`SELECT id, status FROM channel_memory_writebacks WHERE childRunId = ? AND patchKey = ?`)
      .get<{ id: string; status: string }>(childRunId, patchKey)

  const commitWriteback = (id: string) => {
    db.prepare(
      `UPDATE channel_memory_writebacks SET status = 'committed', committedAt = ? WHERE id = ? AND status = 'pending'`
    )
      .run(Date.now(), id)
  }

  const rejectWriteback = (id: string, error: string) => {
    db.prepare(
      `UPDATE channel_memory_writebacks SET status = 'rejected', error = ? WHERE id = ? AND status = 'pending'`
    )
      .run(error, id)
  }

  return {
    attachSnapshotToChildRun,
    commitWriteback,
    createPendingWriteback,
    get,
    getWritebackByPatchKey,
    listCandidates,
    rejectWriteback,
    saveSnapshot,
    upsert
  }
}
