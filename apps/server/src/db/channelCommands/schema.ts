import type { SchemaModule } from '../schema'

export const channelCommandsSchemaModule: SchemaModule = {
  name: 'channel-commands',
  apply({ exec }) {
    exec(`
      CREATE TABLE IF NOT EXISTS channel_command_runs (
        id TEXT PRIMARY KEY,
        channelType TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        channelId TEXT NOT NULL,
        sessionType TEXT NOT NULL,
        channelLinkName TEXT,
        entity TEXT,
        actorUserId TEXT,
        actorAccountId TEXT,
        senderId TEXT,
        messageId TEXT,
        source TEXT NOT NULL,
        commandName TEXT NOT NULL,
        commandPathJson TEXT NOT NULL,
        rawArgsJson TEXT NOT NULL,
        permission TEXT NOT NULL,
        status TEXT NOT NULL,
        startedAt INTEGER NOT NULL,
        completedAt INTEGER,
        error TEXT,
        metadataJson TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_channel_command_runs_channel
        ON channel_command_runs(channelType, channelId, startedAt);

      CREATE INDEX IF NOT EXISTS idx_channel_command_runs_actor
        ON channel_command_runs(actorUserId, actorAccountId, startedAt);
    `)
  }
}
