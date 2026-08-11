import type { SchemaModule } from '../schema'

export const channelOutboundDeliveriesSchemaModule: SchemaModule = {
  name: 'channel-outbound-deliveries',
  apply({ exec }) {
    exec(`
      CREATE TABLE IF NOT EXISTS channel_outbound_deliveries (
        id TEXT PRIMARY KEY,
        channelType TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        messageId TEXT NOT NULL,
        receiveId TEXT NOT NULL,
        receiveIdType TEXT NOT NULL,
        text TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_outbound_delivery_message
        ON channel_outbound_deliveries(channelType, channelKey, messageId);

      CREATE INDEX IF NOT EXISTS idx_channel_outbound_delivery_recent
        ON channel_outbound_deliveries(channelType, createdAt);

      CREATE TABLE IF NOT EXISTS channel_outbound_operations (
        operationId TEXT PRIMARY KEY,
        commandRunId TEXT,
        channelType TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        targetJson TEXT NOT NULL,
        payloadHash TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'failed')),
        providerMessageId TEXT,
        navigationJson TEXT,
        error TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_channel_outbound_operation_recent
        ON channel_outbound_operations(channelType, updatedAt);
    `)
  }
}
