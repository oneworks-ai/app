import type { SchemaModule } from '../schema'

export const usageSchemaModule: SchemaModule = {
  name: 'usage',
  apply({ exec }) {
    exec(`
      CREATE TABLE IF NOT EXISTS usage_observations (
        id TEXT PRIMARY KEY,
        observedAt INTEGER NOT NULL,
        sessionId TEXT,
        workspaceId TEXT,
        workspaceLabel TEXT,
        toolId TEXT NOT NULL,
        toolLabel TEXT,
        modelServiceId TEXT,
        modelServiceLabel TEXT,
        modelId TEXT,
        modelLabel TEXT,
        accountId TEXT,
        accountLabel TEXT,
        deviceId TEXT,
        deviceLabel TEXT,
        inputTokens INTEGER NOT NULL DEFAULT 0,
        outputTokens INTEGER NOT NULL DEFAULT 0,
        cacheReadTokens INTEGER NOT NULL DEFAULT 0,
        cacheCreationTokens INTEGER NOT NULL DEFAULT 0,
        reasoningTokens INTEGER NOT NULL DEFAULT 0,
        totalTokens INTEGER NOT NULL DEFAULT 0,
        costUsd REAL,
        aggregationMode TEXT NOT NULL DEFAULT 'delta',
        quality TEXT NOT NULL DEFAULT 'reported',
        origin TEXT NOT NULL DEFAULT 'local',
        authorityPluginId TEXT,
        authorityPluginScope TEXT,
        authorityPluginLabel TEXT,
        transportPluginId TEXT,
        transportPluginScope TEXT,
        transportPluginLabel TEXT
      );

      CREATE TABLE IF NOT EXISTS usage_ledger_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_usage_observations_time
        ON usage_observations(observedAt);
      CREATE INDEX IF NOT EXISTS idx_usage_observations_session
        ON usage_observations(sessionId, observedAt);
      CREATE INDEX IF NOT EXISTS idx_usage_observations_dimensions
        ON usage_observations(workspaceId, toolId, modelServiceId, modelId, accountId);
    `)
  }
}
