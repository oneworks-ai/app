import type { SchemaModule } from '../schema'

export const channelSessionsSchemaModule: SchemaModule = {
  name: 'channel-sessions',
  apply({ db, exec, ensureColumn, getColumns }) {
    exec(`
      CREATE TABLE IF NOT EXISTS channel_sessions (
        channelType TEXT NOT NULL,
        sessionType TEXT NOT NULL,
        channelId TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        senderId TEXT,
        replyReceiveId TEXT,
        replyReceiveIdType TEXT,
        sessionId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (channelType, sessionType, channelId),
        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_channel_sessions_sessionId ON channel_sessions(sessionId);

      CREATE TABLE IF NOT EXISTS channel_sessions_v2 (
        channelType TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        sessionType TEXT NOT NULL,
        channelId TEXT NOT NULL,
        senderId TEXT,
        replyReceiveId TEXT,
        replyReceiveIdType TEXT,
        sessionId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (channelKey, sessionType, channelId),
        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_channel_sessions_v2_sessionId ON channel_sessions_v2(sessionId);

      CREATE TABLE IF NOT EXISTS channel_sessions_v3 (
        channelType TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        sessionType TEXT NOT NULL,
        channelId TEXT NOT NULL,
        threadId TEXT NOT NULL DEFAULT '',
        senderId TEXT,
        replyReceiveId TEXT,
        replyReceiveIdType TEXT,
        sessionId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (channelKey, sessionType, channelId, threadId),
        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_channel_sessions_v3_sessionId ON channel_sessions_v3(sessionId);

      CREATE TABLE IF NOT EXISTS channel_session_schema_migrations (
        id TEXT PRIMARY KEY,
        appliedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_session_deliveries (
        sessionId TEXT PRIMARY KEY,
        channelType TEXT NOT NULL,
        sessionType TEXT NOT NULL,
        channelId TEXT NOT NULL,
        threadId TEXT NOT NULL DEFAULT '',
        channelKey TEXT NOT NULL,
        senderId TEXT,
        replyReceiveId TEXT,
        replyReceiveIdType TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(sessionId) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS channel_preferences (
        channelType TEXT NOT NULL,
        sessionType TEXT NOT NULL,
        channelId TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        adapter TEXT,
        permissionMode TEXT,
        effort TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (channelType, sessionType, channelId)
      );

      CREATE TABLE IF NOT EXISTS channel_preferences_v2 (
        channelType TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        sessionType TEXT NOT NULL,
        channelId TEXT NOT NULL,
        adapter TEXT,
        permissionMode TEXT,
        effort TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (channelKey, sessionType, channelId)
      );
    `)

    if (getColumns('channel_sessions').length > 0) {
      ensureColumn('channel_sessions', 'senderId', 'TEXT')
      ensureColumn('channel_sessions', 'replyReceiveId', 'TEXT')
      ensureColumn('channel_sessions', 'replyReceiveIdType', 'TEXT')
    }

    if (getColumns('channel_preferences').length > 0) {
      ensureColumn('channel_preferences', 'adapter', 'TEXT')
      ensureColumn('channel_preferences', 'permissionMode', 'TEXT')
      ensureColumn('channel_preferences', 'effort', 'TEXT')
    }

    if (getColumns('channel_session_deliveries').length > 0) {
      ensureColumn('channel_session_deliveries', 'threadId', "TEXT NOT NULL DEFAULT ''")
    }

    db.transaction(() => {
      const migrationId = 'channel-sessions-v3'
      const applied = db.prepare(`
        SELECT 1
        FROM channel_session_schema_migrations
        WHERE id = ?
      `).get(migrationId)
      if (applied != null) return

      exec(`
        INSERT OR IGNORE INTO channel_sessions_v2 (
          channelType, channelKey, sessionType, channelId, senderId,
          replyReceiveId, replyReceiveIdType, sessionId, createdAt, updatedAt
        )
        SELECT channelType, channelKey, sessionType, channelId, senderId,
               replyReceiveId, replyReceiveIdType, sessionId, createdAt, updatedAt
        FROM channel_sessions;

        INSERT OR IGNORE INTO channel_sessions_v3 (
          channelType, channelKey, sessionType, channelId, threadId, senderId,
          replyReceiveId, replyReceiveIdType, sessionId, createdAt, updatedAt
        )
        SELECT channelType, channelKey, sessionType, channelId, '', senderId,
               replyReceiveId, replyReceiveIdType, sessionId, createdAt, updatedAt
        FROM channel_sessions_v2;

        INSERT OR IGNORE INTO channel_preferences_v2 (
          channelType, channelKey, sessionType, channelId, adapter,
          permissionMode, effort, createdAt, updatedAt
        )
        SELECT channelType, channelKey, sessionType, channelId, adapter,
               permissionMode, effort, createdAt, updatedAt
        FROM channel_preferences;
      `)
      db.prepare(`
        INSERT INTO channel_session_schema_migrations (id, appliedAt)
        VALUES (?, ?)
      `).run(migrationId, Date.now())
    })()
  }
}
