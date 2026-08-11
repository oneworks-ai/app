import type { SchemaModule } from '../schema'

export const channelChildRunsSchemaModule: SchemaModule = {
  name: 'channel-child-runs',
  apply({ ensureColumn, exec }) {
    exec(`
      CREATE TABLE IF NOT EXISTS channel_child_session_runs (
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
        sessionId TEXT,
        conversationStateId TEXT,
        threadKey TEXT,
        triggerType TEXT NOT NULL,
        dispatchMode TEXT NOT NULL,
        status TEXT NOT NULL,
        startedAt INTEGER NOT NULL,
        completedAt INTEGER,
        memorySnapshotId TEXT,
        continuitySnapshotJson TEXT,
        error TEXT,
        metadataJson TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_channel_child_session_runs_channel
        ON channel_child_session_runs(channelType, channelId, startedAt);

      CREATE INDEX IF NOT EXISTS idx_channel_child_session_runs_actor
        ON channel_child_session_runs(actorUserId, actorAccountId, startedAt);

      CREATE INDEX IF NOT EXISTS idx_channel_child_session_runs_session
        ON channel_child_session_runs(sessionId, startedAt);

      CREATE INDEX IF NOT EXISTS idx_channel_child_session_runs_conversation
        ON channel_child_session_runs(conversationStateId, startedAt);
    `)
    ensureColumn('channel_child_session_runs', 'memorySnapshotId', 'TEXT')
    ensureColumn('channel_child_session_runs', 'continuitySnapshotJson', 'TEXT')
  }
}
