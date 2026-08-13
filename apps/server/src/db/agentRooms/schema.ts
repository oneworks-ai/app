/* eslint-disable max-lines -- Agent Room tables, indexes, and additive migrations must remain in execution order. */
import type { SchemaModule } from '../schema'

export const agentRoomsSchemaModule: SchemaModule = {
  name: 'agentRooms',
  apply({ ensureColumn, exec, getColumns }) {
    exec(`
      CREATE TABLE IF NOT EXISTS agent_rooms (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        avatar TEXT,
        description TEXT,
        hostSessionId TEXT,
        ownerAccountId TEXT,
        ownerNodeId TEXT,
        ownerSourceId TEXT,
        leaderEntity TEXT,
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
        sequence INTEGER NOT NULL DEFAULT 0,
        idempotencyKey TEXT,
        originJson TEXT,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY(roomId) REFERENCES agent_rooms(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_room_message_deliveries (
        id TEXT PRIMARY KEY,
        roomMessageId TEXT NOT NULL,
        targetJson TEXT NOT NULL,
        status TEXT NOT NULL,
        providerMessageId TEXT,
        navigationJson TEXT,
        error TEXT,
        sentAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(roomMessageId) REFERENCES agent_room_messages(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_room_channel_links (
        roomId TEXT NOT NULL,
        channelLinkName TEXT NOT NULL,
        channelType TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        channelId TEXT NOT NULL,
        accountLabel TEXT,
        conversationKind TEXT NOT NULL,
        entity TEXT NOT NULL,
        label TEXT NOT NULL,
        receiveId TEXT NOT NULL,
        receiveIdType TEXT NOT NULL,
        threadId TEXT,
        createdAt INTEGER NOT NULL,
        PRIMARY KEY (roomId, channelLinkName),
        FOREIGN KEY(roomId) REFERENCES agent_rooms(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_room_member_channels (
        roomId TEXT NOT NULL,
        memberKey TEXT NOT NULL,
        channelLinkName TEXT NOT NULL,
        channelType TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        channelId TEXT NOT NULL,
        accountLabel TEXT,
        conversationKind TEXT NOT NULL,
        entity TEXT NOT NULL,
        label TEXT NOT NULL,
        receiveId TEXT NOT NULL,
        receiveIdType TEXT NOT NULL,
        threadId TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        muted INTEGER NOT NULL DEFAULT 0,
        requireMention INTEGER NOT NULL DEFAULT 0,
        commandPrefix TEXT,
        lastSeenAt INTEGER,
        lastError TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (roomId, memberKey, channelLinkName),
        FOREIGN KEY(roomId) REFERENCES agent_rooms(id) ON DELETE CASCADE,
        FOREIGN KEY(roomId, memberKey) REFERENCES agent_room_members(roomId, memberKey) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_room_shares (
        id TEXT PRIMARY KEY,
        roomId TEXT NOT NULL,
        status TEXT NOT NULL,
        relayRef TEXT,
        publishedAt INTEGER,
        revokedAt INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        FOREIGN KEY(roomId) REFERENCES agent_rooms(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_room_share_grants (
        shareId TEXT NOT NULL,
        principalType TEXT NOT NULL,
        principalId TEXT NOT NULL,
        permissionsJson TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        PRIMARY KEY (shareId, principalType, principalId),
        FOREIGN KEY(shareId) REFERENCES agent_room_shares(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_room_events (
        id TEXT PRIMARY KEY,
        roomId TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        idempotencyKey TEXT,
        type TEXT NOT NULL,
        payloadJson TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY(roomId) REFERENCES agent_rooms(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_agent_rooms_hostSessionId ON agent_rooms(hostSessionId);
      CREATE INDEX IF NOT EXISTS idx_agent_room_messages_roomId ON agent_room_messages(roomId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_agent_room_messages_runKey ON agent_room_messages(roomId, runKey);
      CREATE INDEX IF NOT EXISTS idx_agent_room_deliveries_message ON agent_room_message_deliveries(roomMessageId);
      CREATE INDEX IF NOT EXISTS idx_agent_room_member_channels_room
        ON agent_room_member_channels(roomId, memberKey);
      CREATE INDEX IF NOT EXISTS idx_agent_room_member_channels_lookup
        ON agent_room_member_channels(channelType, channelId);
      CREATE INDEX IF NOT EXISTS idx_agent_room_shares_room ON agent_room_shares(roomId, status);
      CREATE INDEX IF NOT EXISTS idx_agent_room_runs_sessionId ON agent_room_runs(sessionId);
      CREATE INDEX IF NOT EXISTS idx_agent_room_runs_memberKey ON agent_room_runs(roomId, memberKey);
    `)

    if (getColumns('agent_rooms').length > 0) {
      ensureColumn('agent_rooms', 'archivedAt', 'INTEGER')
      ensureColumn('agent_rooms', 'avatar', 'TEXT')
      ensureColumn('agent_rooms', 'description', 'TEXT')
      ensureColumn('agent_rooms', 'favoritedAt', 'INTEGER')
      ensureColumn('agent_rooms', 'ownerAccountId', 'TEXT')
      ensureColumn('agent_rooms', 'ownerNodeId', 'TEXT')
      ensureColumn('agent_rooms', 'ownerSourceId', 'TEXT')
      ensureColumn('agent_rooms', 'leaderEntity', 'TEXT')
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
      ensureColumn('agent_room_messages', 'sequence', 'INTEGER NOT NULL DEFAULT 0')
      ensureColumn('agent_room_messages', 'idempotencyKey', 'TEXT')
      ensureColumn('agent_room_messages', 'originJson', 'TEXT')
    }

    if (getColumns('agent_room_channel_links').length > 0) {
      ensureColumn('agent_room_channel_links', 'accountLabel', 'TEXT')
      ensureColumn('agent_room_channel_links', 'channelType', 'TEXT NOT NULL DEFAULT ""')
      ensureColumn('agent_room_channel_links', 'channelKey', 'TEXT NOT NULL DEFAULT ""')
      ensureColumn('agent_room_channel_links', 'channelId', 'TEXT NOT NULL DEFAULT ""')
      ensureColumn('agent_room_channel_links', 'conversationKind', 'TEXT NOT NULL DEFAULT "unknown"')
      ensureColumn('agent_room_channel_links', 'entity', 'TEXT NOT NULL DEFAULT ""')
      ensureColumn('agent_room_channel_links', 'label', 'TEXT NOT NULL DEFAULT ""')
      ensureColumn('agent_room_channel_links', 'receiveId', 'TEXT NOT NULL DEFAULT ""')
      ensureColumn('agent_room_channel_links', 'receiveIdType', 'TEXT NOT NULL DEFAULT ""')
      ensureColumn('agent_room_channel_links', 'threadId', 'TEXT')
      ensureColumn('agent_room_channel_links', 'createdAt', 'INTEGER NOT NULL DEFAULT 0')
    }

    exec(`
      DROP INDEX IF EXISTS idx_agent_room_channel_links_lookup;
      INSERT OR IGNORE INTO agent_room_members (
        roomId, memberKey, kind, label, status,
        activeRunCount, pendingCount, createdAt, updatedAt
      )
      SELECT
        legacy.roomId, legacy.entity, 'entity',
        CASE WHEN legacy.entity = '' THEN legacy.label ELSE legacy.entity END,
        'idle', 0, 0, legacy.createdAt, legacy.createdAt
      FROM agent_room_channel_links legacy
      WHERE legacy.entity <> '';
      INSERT OR IGNORE INTO agent_room_member_channels (
        roomId, memberKey, channelLinkName, channelType, channelKey, channelId,
        accountLabel, conversationKind, entity, label, receiveId, receiveIdType,
        threadId, status, muted, requireMention, createdAt, updatedAt
      )
      SELECT
        legacy.roomId,
        legacy.entity,
        legacy.channelLinkName, legacy.channelType, legacy.channelKey, legacy.channelId,
        legacy.accountLabel, legacy.conversationKind, legacy.entity, legacy.label,
        legacy.receiveId, legacy.receiveIdType, legacy.threadId,
        'active', 0, 0, legacy.createdAt, legacy.createdAt
      FROM agent_room_channel_links legacy
      WHERE legacy.entity <> '';
      CREATE INDEX IF NOT EXISTS idx_agent_room_messages_sequence ON agent_room_messages(roomId, sequence);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_room_messages_idempotency
        ON agent_room_messages(roomId, idempotencyKey) WHERE idempotencyKey IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_room_events_idempotency
        ON agent_room_events(roomId, idempotencyKey) WHERE idempotencyKey IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_agent_room_events_sequence ON agent_room_events(roomId, sequence);
    `)
  }
}
