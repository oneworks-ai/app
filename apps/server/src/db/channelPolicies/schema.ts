import type { SchemaModule } from '../schema'

export const channelPoliciesSchemaModule: SchemaModule = {
  name: 'channel-policies',
  apply({ exec }) {
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
    `)
  }
}
