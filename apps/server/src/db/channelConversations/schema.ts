import type { SchemaModule } from '../schema'

export const channelConversationsSchemaModule: SchemaModule = {
  name: 'channel-conversations',
  apply({ ensureColumn, exec }) {
    exec(`
      CREATE TABLE IF NOT EXISTS channel_conversation_states (
        id TEXT PRIMARY KEY,
        channelType TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        channelId TEXT NOT NULL,
        sessionType TEXT NOT NULL,
        channelLinkName TEXT,
        entity TEXT,
        threadKey TEXT NOT NULL,
        topic TEXT,
        summary TEXT,
        activeParticipantsJson TEXT,
        recentTurnIdsJson TEXT,
        pendingIntentIdsJson TEXT,
        lastBotReplyJson TEXT,
        lastChildRunId TEXT,
        lastMessageId TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        expiresAt INTEGER,
        metadataJson TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_channel_conversation_states_updated
        ON channel_conversation_states(channelType, channelKey, channelId, updatedAt);

      CREATE TABLE IF NOT EXISTS channel_conversation_turns (
        id TEXT PRIMARY KEY,
        conversationStateId TEXT NOT NULL,
        threadKey TEXT NOT NULL,
        channelType TEXT NOT NULL,
        channelKey TEXT NOT NULL,
        channelId TEXT NOT NULL,
        sessionType TEXT NOT NULL,
        channelLinkName TEXT,
        entity TEXT,
        childRunId TEXT,
        actorUserId TEXT,
        actorAccountId TEXT,
        senderId TEXT,
        messageId TEXT,
        role TEXT NOT NULL,
        text TEXT,
        summary TEXT,
        createdAt INTEGER NOT NULL,
        metadataJson TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_channel_conversation_turns_state
        ON channel_conversation_turns(conversationStateId, createdAt);

      CREATE INDEX IF NOT EXISTS idx_channel_conversation_turns_child_run
        ON channel_conversation_turns(childRunId);

      CREATE TABLE IF NOT EXISTS channel_pending_intents (
        id TEXT PRIMARY KEY,
        conversationStateId TEXT,
        threadKey TEXT NOT NULL,
        channelType TEXT NOT NULL,
        channelKey TEXT,
        channelId TEXT,
        sessionType TEXT,
        channelLinkName TEXT,
        entity TEXT,
        ownerUserId TEXT,
        ownerAccountId TEXT,
        approverUserIdsJson TEXT,
        createdByChildRunId TEXT,
        authorizationRequestId TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        requiredAction TEXT,
        delivery TEXT,
        deliveryMessageId TEXT,
        payloadJson TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        expiresAt INTEGER,
        resolvedAt INTEGER,
        metadataJson TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_channel_pending_intents_owner
        ON channel_pending_intents(channelType, ownerUserId, ownerAccountId, status);

      CREATE INDEX IF NOT EXISTS idx_channel_pending_intents_conversation
        ON channel_pending_intents(conversationStateId, status, updatedAt);

      CREATE INDEX IF NOT EXISTS idx_channel_pending_intents_authorization
        ON channel_pending_intents(authorizationRequestId);
    `)

    exec(`
      DROP INDEX IF EXISTS idx_channel_conversation_states_thread;
      CREATE UNIQUE INDEX idx_channel_conversation_states_thread
        ON channel_conversation_states(channelType, channelKey, channelId, COALESCE(entity, ''), threadKey);
    `)

    ensureColumn('channel_conversation_states', 'pendingIntentIdsJson', 'TEXT')
    ensureColumn('channel_conversation_states', 'lastBotReplyJson', 'TEXT')
  }
}
