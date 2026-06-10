import type { SqliteDatabase } from '../sqlite'

export function createChannelMessagesRepo(db: SqliteDatabase) {
  const rememberSeen = (messageKey: string, seenAt = Date.now()) => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO channel_seen_messages (messageKey, seenAt)
      VALUES (?, ?)
    `)
    return stmt.run(messageKey, seenAt).changes > 0
  }

  const removeSeenBefore = (cutoff: number) => {
    const stmt = db.prepare(`
      DELETE FROM channel_seen_messages
      WHERE seenAt < ?
    `)
    return stmt.run(cutoff).changes
  }

  return {
    rememberSeen,
    removeSeenBefore
  }
}
