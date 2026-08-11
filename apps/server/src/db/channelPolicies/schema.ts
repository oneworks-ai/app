import type { SchemaModule } from '../schema'

export const channelPoliciesSchemaModule: SchemaModule = {
  name: 'channel-policies',
  apply({ ensureColumn, exec }) {
    exec(`
      CREATE TABLE IF NOT EXISTS channel_reply_throttles (
        throttleKey TEXT NOT NULL PRIMARY KEY,
        policyType TEXT NOT NULL,
        channelType TEXT NOT NULL,
        channelId TEXT NOT NULL,
        channelLinkName TEXT,
        actorUserId TEXT,
        actorAccountId TEXT,
        lastSentAt INTEGER NOT NULL,
        expiresAt INTEGER,
        metadataJson TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_channel_reply_throttles_expiresAt
        ON channel_reply_throttles(expiresAt);

      CREATE TABLE IF NOT EXISTS channel_offhour_backlog (
        id TEXT PRIMARY KEY,
        channelType TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        channelId TEXT NOT NULL,
        sessionType TEXT NOT NULL,
        channelLinkName TEXT,
        entity TEXT,
        senderId TEXT,
        actorUserId TEXT,
        messageId TEXT,
        text TEXT,
        rawJson TEXT,
        createdAt INTEGER NOT NULL,
        processedAt INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_channel_offhour_backlog_pending
        ON channel_offhour_backlog(channelLinkName, processedAt, createdAt);

      CREATE INDEX IF NOT EXISTS idx_channel_offhour_backlog_channel
        ON channel_offhour_backlog(channelType, channelId, processedAt, createdAt);

      CREATE TABLE IF NOT EXISTS channel_policy_states (
        policyKey TEXT NOT NULL PRIMARY KEY,
        channelLinkName TEXT NOT NULL,
        scope TEXT NOT NULL,
        subjectKey TEXT NOT NULL,
        state TEXT NOT NULL,
        reason TEXT,
        hits INTEGER NOT NULL DEFAULT 0,
        hitWindowStartedAt INTEGER,
        mutedUntil INTEGER,
        revision INTEGER NOT NULL DEFAULT 1,
        updatedBy TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_channel_policy_states_subject
        ON channel_policy_states(channelLinkName, scope, subjectKey);

      CREATE TABLE IF NOT EXISTS channel_policy_events (
        id TEXT NOT NULL PRIMARY KEY,
        eventKey TEXT NOT NULL UNIQUE,
        policyKey TEXT,
        channelLinkName TEXT NOT NULL,
        eventType TEXT NOT NULL,
        actorUserId TEXT,
        actorAccountId TEXT,
        metadataJson TEXT,
        createdAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_channel_policy_events_policy
        ON channel_policy_events(policyKey, createdAt);

      CREATE TABLE IF NOT EXISTS channel_webhook_nonces (
        channelKey TEXT NOT NULL,
        nonce TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'consumed',
        reservationId TEXT,
        reservationExpiresAt INTEGER,
        expiresAt INTEGER NOT NULL,
        PRIMARY KEY (channelKey, nonce)
      );

      CREATE INDEX IF NOT EXISTS idx_channel_webhook_nonces_expiry
        ON channel_webhook_nonces(expiresAt);
    `)
    ensureColumn('channel_webhook_nonces', 'status', "TEXT NOT NULL DEFAULT 'consumed'")
    ensureColumn('channel_webhook_nonces', 'reservationId', 'TEXT')
    ensureColumn('channel_webhook_nonces', 'reservationExpiresAt', 'INTEGER')
  }
}
