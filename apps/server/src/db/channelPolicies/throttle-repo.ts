import type { SqliteDatabase } from '../sqlite'
import { stringifyJson } from './json'
import { mapThrottleRow } from './throttle-record'
import type { ChannelReplyThrottleDbRow, ReplyThrottleInput } from './throttle-record'

export function createReplyThrottlesRepo(db: SqliteDatabase) {
  const pruneReplyThrottles = (now = Date.now()) => {
    const stmt = db.prepare(`
      DELETE FROM channel_reply_throttles
      WHERE expiresAt IS NOT NULL AND expiresAt <= ?
    `)
    return stmt.run(now).changes
  }

  const getReplyThrottle = (throttleKey: string) => {
    const stmt = db.prepare(`
      SELECT throttleKey, policyType, channelType, channelId, channelLinkName, actorUserId,
             actorAccountId, lastSentAt, expiresAt, metadataJson
      FROM channel_reply_throttles
      WHERE throttleKey = ?
    `)
    return mapThrottleRow(stmt.get<ChannelReplyThrottleDbRow>(throttleKey))
  }

  const consumeReplyThrottle = db.transaction((row: ReplyThrottleInput) => {
    const now = row.now ?? Date.now()
    pruneReplyThrottles(now)
    const existing = getReplyThrottle(row.throttleKey)
    if (existing != null && row.windowMs > 0 && now - existing.lastSentAt < row.windowMs) {
      return false
    }

    const expiresAt = row.windowMs > 0 ? now + row.windowMs : null
    const stmt = db.prepare(`
      INSERT INTO channel_reply_throttles (
        throttleKey, policyType, channelType, channelId, channelLinkName, actorUserId,
        actorAccountId, lastSentAt, expiresAt, metadataJson
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(throttleKey) DO UPDATE SET
        policyType = excluded.policyType,
        channelType = excluded.channelType,
        channelId = excluded.channelId,
        channelLinkName = excluded.channelLinkName,
        actorUserId = excluded.actorUserId,
        actorAccountId = excluded.actorAccountId,
        lastSentAt = excluded.lastSentAt,
        expiresAt = excluded.expiresAt,
        metadataJson = excluded.metadataJson
    `)
    stmt.run(
      row.throttleKey,
      row.policyType,
      row.channelType,
      row.channelId,
      row.channelLinkName ?? null,
      row.actorUserId ?? null,
      row.actorAccountId ?? null,
      now,
      expiresAt,
      stringifyJson(row.metadata)
    )
    return true
  })

  return {
    consumeReplyThrottle,
    getReplyThrottle,
    pruneReplyThrottles
  }
}
