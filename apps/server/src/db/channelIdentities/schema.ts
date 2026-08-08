import type { SchemaModule } from '../schema'

export const channelIdentitiesSchemaModule: SchemaModule = {
  name: 'channel-identities',
  apply({ ensureColumn, exec }) {
    exec(`
      CREATE TABLE IF NOT EXISTS channel_accounts (
        channelType TEXT NOT NULL,
        accountId TEXT NOT NULL,
        accountKey TEXT NOT NULL,
        displayName TEXT,
        avatarUrl TEXT,
        metadataJson TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (channelType, accountId)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_accounts_accountKey
        ON channel_accounts(channelType, accountKey);

      CREATE TABLE IF NOT EXISTS canonical_users (
        id TEXT PRIMARY KEY,
        displayName TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_identity_links (
        channelType TEXT NOT NULL,
        accountId TEXT NOT NULL,
        userId TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (channelType, accountId)
      );

      CREATE INDEX IF NOT EXISTS idx_channel_identity_links_userId
        ON channel_identity_links(userId);

      CREATE TABLE IF NOT EXISTS channel_identity_link_codes (
        code TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        sourceChannelType TEXT NOT NULL,
        sourceAccountId TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        expiresAt INTEGER NOT NULL,
        consumedAt INTEGER,
        consumedChannelType TEXT,
        consumedAccountId TEXT,
        metadataJson TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_channel_identity_link_codes_user_status
        ON channel_identity_link_codes(userId, status);

      CREATE INDEX IF NOT EXISTS idx_channel_identity_link_codes_expiry
        ON channel_identity_link_codes(status, expiresAt);

      CREATE TABLE IF NOT EXISTS channel_user_credentials (
        userId TEXT NOT NULL,
        channelType TEXT NOT NULL,
        credentialKey TEXT NOT NULL,
        label TEXT,
        status TEXT NOT NULL,
        scopesJson TEXT,
        expiresAt INTEGER,
        metadataJson TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        PRIMARY KEY (userId, channelType, credentialKey)
      );

      CREATE INDEX IF NOT EXISTS idx_channel_user_credentials_channelType
        ON channel_user_credentials(channelType);

      CREATE TABLE IF NOT EXISTS channel_authorization_requests (
        id TEXT PRIMARY KEY,
        channelType TEXT NOT NULL,
        channelLinkName TEXT,
        requesterUserId TEXT,
        requesterAccountId TEXT,
        credentialSubjectUserId TEXT,
        credentialKey TEXT,
        capability TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        metadataJson TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        expiresAt INTEGER,
        resolvedAt INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_channel_authorization_requests_requester
        ON channel_authorization_requests(channelType, requesterUserId, requesterAccountId, status);

      CREATE INDEX IF NOT EXISTS idx_channel_authorization_requests_credentialSubject
        ON channel_authorization_requests(channelType, credentialSubjectUserId, status);
    `)
    ensureColumn('channel_authorization_requests', 'credentialSubjectUserId', 'TEXT')
  }
}
