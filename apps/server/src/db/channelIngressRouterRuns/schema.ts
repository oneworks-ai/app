import type { SchemaModule } from '../schema'

export const channelIngressRouterRunsSchemaModule: SchemaModule = {
  name: 'channel-ingress-router-runs',
  apply({ ensureColumn, exec }) {
    exec(`
      CREATE TABLE IF NOT EXISTS channel_ingress_router_runs (
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
        syntheticActorRole TEXT,
        syntheticUserLabel TEXT,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        confidence REAL NOT NULL,
        mode TEXT,
        model TEXT,
        adapter TEXT,
        visibility TEXT,
        candidateCount INTEGER NOT NULL DEFAULT 0,
        filteredCount INTEGER NOT NULL DEFAULT 0,
        contextCount INTEGER NOT NULL DEFAULT 0,
        childRunId TEXT,
        error TEXT,
        latencyMs INTEGER,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_channel_ingress_router_runs_message
        ON channel_ingress_router_runs(channelType, channelId, messageId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_channel_ingress_router_runs_child
        ON channel_ingress_router_runs(childRunId, createdAt);
    `)
    ensureColumn('channel_ingress_router_runs', 'syntheticActorRole', 'TEXT')
    ensureColumn('channel_ingress_router_runs', 'syntheticUserLabel', 'TEXT')
  }
}
