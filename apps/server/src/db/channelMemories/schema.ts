import type { SchemaModule } from '../schema'

export const channelMemoriesSchemaModule: SchemaModule = {
  name: 'channel-memories',
  apply({ ensureColumn, exec }) {
    exec(`
      CREATE TABLE IF NOT EXISTS channel_memories (
        id TEXT PRIMARY KEY, issuer TEXT NOT NULL, orgId TEXT NOT NULL DEFAULT '', subjectType TEXT NOT NULL, subjectId TEXT NOT NULL,
        sourceJson TEXT NOT NULL DEFAULT '{}',
        channelType TEXT, channelKey TEXT, channelId TEXT, entity TEXT, canonicalUserId TEXT,
        accountId TEXT, roomId TEXT, threadKey TEXT, sessionType TEXT, sensitivity TEXT NOT NULL, visibilityJson TEXT,
        keywordsJson TEXT, content TEXT NOT NULL, importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5, pinned INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, expiresAt INTEGER, metadataJson TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_channel_memories_scope
        ON channel_memories(channelType, channelKey, channelId, entity, canonicalUserId, accountId, expiresAt);
      CREATE TABLE IF NOT EXISTS channel_memory_snapshots (
        id TEXT PRIMARY KEY, childRunId TEXT, channelType TEXT NOT NULL, channelKey TEXT NOT NULL,
        channelId TEXT NOT NULL, entity TEXT, canonicalUserId TEXT, accountId TEXT, roomId TEXT,
        threadKey TEXT, itemCount INTEGER NOT NULL, tokenCount INTEGER NOT NULL,
        snapshotJson TEXT NOT NULL, createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_channel_memory_snapshots_run ON channel_memory_snapshots(childRunId);
      CREATE TABLE IF NOT EXISTS channel_memory_writebacks (
        id TEXT PRIMARY KEY, childRunId TEXT NOT NULL, memoryId TEXT, status TEXT NOT NULL, patchKey TEXT NOT NULL,
        patchJson TEXT NOT NULL, createdAt INTEGER NOT NULL, committedAt INTEGER, error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_channel_memory_writebacks_run ON channel_memory_writebacks(childRunId, status);
    `)
    // Additive migrations keep existing runtime databases readable.
    ensureColumn('channel_memories', 'threadKey', 'TEXT')
    ensureColumn('channel_memories', 'orgId', "TEXT NOT NULL DEFAULT ''")
    ensureColumn('channel_memories', 'sourceJson', "TEXT NOT NULL DEFAULT '{}'")
    ensureColumn('channel_memories', 'roomId', 'TEXT')
    ensureColumn('channel_memory_snapshots', 'roomId', 'TEXT')
    ensureColumn('channel_memory_writebacks', 'patchKey', "TEXT NOT NULL DEFAULT ''")
    exec(`
      CREATE INDEX IF NOT EXISTS idx_channel_memories_room ON channel_memories(roomId, expiresAt);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_memory_writebacks_idempotency
        ON channel_memory_writebacks(childRunId, patchKey);
    `)
  }
}
