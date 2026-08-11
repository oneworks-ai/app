import type { SchemaModule } from '../schema'

export const channelScenariosSchemaModule: SchemaModule = {
  name: 'channel-scenarios',
  apply({ ensureColumn, exec }) {
    exec(`
      CREATE TABLE IF NOT EXISTS channel_scenarios (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        roomRef TEXT NOT NULL,
        actorRole TEXT NOT NULL DEFAULT 'participant',
        userLabel TEXT NOT NULL DEFAULT 'operator',
        sessionType TEXT NOT NULL,
        text TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_channel_scenarios_updated
        ON channel_scenarios(updatedAt DESC);
    `)
    ensureColumn('channel_scenarios', 'actorRole', "TEXT NOT NULL DEFAULT 'participant'")
    ensureColumn('channel_scenarios', 'userLabel', "TEXT NOT NULL DEFAULT 'operator'")
  }
}
