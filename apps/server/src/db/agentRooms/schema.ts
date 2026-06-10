import type { SchemaModule } from '../schema'

export const agentRoomsSchemaModule: SchemaModule = {
  name: 'agentRooms',
  apply({ ensureColumn, exec, getColumns }) {
    exec(`
      CREATE TABLE IF NOT EXISTS agent_rooms (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        hostSessionId TEXT,
        status TEXT NOT NULL,
        lastMessage TEXT,
        archivedAt INTEGER,
        favoritedAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_room_members (
        roomId TEXT NOT NULL,
        memberKey TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        avatar TEXT,
        subtitle TEXT,
        status TEXT NOT NULL,
        latestSummary TEXT,
        activeRunCount INTEGER NOT NULL DEFAULT 0,
        pendingCount INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (roomId, memberKey),
        FOREIGN KEY(roomId) REFERENCES agent_rooms(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_room_runs (
        roomId TEXT NOT NULL,
        runKey TEXT NOT NULL,
        memberKey TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        latestSummary TEXT,
        interactionId TEXT,
        requestKind TEXT,
        options TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (roomId, runKey),
        FOREIGN KEY(roomId) REFERENCES agent_rooms(id) ON DELETE CASCADE,
        FOREIGN KEY(roomId, memberKey) REFERENCES agent_room_members(roomId, memberKey) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_room_messages (
        id TEXT PRIMARY KEY,
        roomId TEXT NOT NULL,
        role TEXT NOT NULL,
        memberKey TEXT,
        runKey TEXT,
        content TEXT NOT NULL,
        eventType TEXT,
        payloadJson TEXT,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY(roomId) REFERENCES agent_rooms(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agent_rooms_hostSessionId ON agent_rooms(hostSessionId);
      CREATE INDEX IF NOT EXISTS idx_agent_room_messages_roomId ON agent_room_messages(roomId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_agent_room_messages_runKey ON agent_room_messages(roomId, runKey);
      CREATE INDEX IF NOT EXISTS idx_agent_room_runs_sessionId ON agent_room_runs(sessionId);
      CREATE INDEX IF NOT EXISTS idx_agent_room_runs_memberKey ON agent_room_runs(roomId, memberKey);
    `)

    if (getColumns('agent_rooms').length > 0) {
      ensureColumn('agent_rooms', 'archivedAt', 'INTEGER')
      ensureColumn('agent_rooms', 'favoritedAt', 'INTEGER')
    }

    if (getColumns('agent_room_members').length > 0) {
      ensureColumn('agent_room_members', 'avatar', 'TEXT')
      ensureColumn('agent_room_members', 'subtitle', 'TEXT')
      ensureColumn('agent_room_members', 'status', 'TEXT NOT NULL DEFAULT "idle"')
      ensureColumn('agent_room_members', 'latestSummary', 'TEXT')
      ensureColumn('agent_room_members', 'activeRunCount', 'INTEGER NOT NULL DEFAULT 0')
      ensureColumn('agent_room_members', 'pendingCount', 'INTEGER NOT NULL DEFAULT 0')
    }

    if (getColumns('agent_room_messages').length > 0) {
      ensureColumn('agent_room_messages', 'memberKey', 'TEXT')
      ensureColumn('agent_room_messages', 'runKey', 'TEXT')
      ensureColumn('agent_room_messages', 'eventType', 'TEXT')
      ensureColumn('agent_room_messages', 'payloadJson', 'TEXT')
    }
  }
}
