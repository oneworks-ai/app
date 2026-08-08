import type { SqliteDatabase } from '../sqlite'

export function createWebhookNoncesRepo(db: SqliteDatabase) {
  const reserve = db.transaction((input: {
    channelKey: string
    expiresAt: number
    nonce: string
    now?: number
    reservationExpiresAt: number
    reservationId: string
  }) => {
    const now = input.now ?? Date.now()
    db.prepare('DELETE FROM channel_webhook_nonces WHERE expiresAt <= ?').run(now)
    const reclaimed = db.prepare(`
      UPDATE channel_webhook_nonces
      SET status = 'processing', reservationId = ?, reservationExpiresAt = ?, expiresAt = ?
      WHERE channelKey = ? AND nonce = ? AND status = 'processing' AND reservationExpiresAt <= ?
    `).run(
      input.reservationId,
      input.reservationExpiresAt,
      input.expiresAt,
      input.channelKey,
      input.nonce,
      now
    )
    if (reclaimed.changes === 1) return true

    const inserted = db.prepare(`
      INSERT OR IGNORE INTO channel_webhook_nonces (
        channelKey, nonce, status, reservationId, reservationExpiresAt, expiresAt
      ) VALUES (?, ?, 'processing', ?, ?, ?)
    `).run(input.channelKey, input.nonce, input.reservationId, input.reservationExpiresAt, input.expiresAt)
    return inserted.changes === 1
  })

  const commit = (input: {
    channelKey: string
    expiresAt: number
    nonce: string
    reservationId: string
  }) => {
    const result = db.prepare(`
      UPDATE channel_webhook_nonces
      SET status = 'consumed', reservationId = NULL, reservationExpiresAt = NULL, expiresAt = ?
      WHERE channelKey = ? AND nonce = ? AND status = 'processing' AND reservationId = ?
    `).run(input.expiresAt, input.channelKey, input.nonce, input.reservationId)
    return result.changes === 1
  }

  const release = (input: {
    channelKey: string
    nonce: string
    reservationId: string
  }) => {
    const result = db.prepare(`
      DELETE FROM channel_webhook_nonces
      WHERE channelKey = ? AND nonce = ? AND status = 'processing' AND reservationId = ?
    `).run(input.channelKey, input.nonce, input.reservationId)
    return result.changes === 1
  }

  return { commit, release, reserve }
}
