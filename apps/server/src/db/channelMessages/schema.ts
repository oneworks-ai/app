import type { SchemaModule } from '../schema'

export const channelMessagesSchemaModule: SchemaModule = {
  name: 'channel-messages',
  apply({ exec }) {
    exec(`
      CREATE TABLE IF NOT EXISTS channel_seen_messages (
        messageKey TEXT NOT NULL PRIMARY KEY,
        seenAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_channel_seen_messages_seenAt ON channel_seen_messages(seenAt);
    `)
  }
}
