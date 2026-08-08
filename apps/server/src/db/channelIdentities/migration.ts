import type { SqliteDatabase } from '../sqlite'

export interface LegacyChannelIdentityMigrationInput {
  channelType: string
  issuerKey: string
}

export interface LegacyChannelIdentityMigrationResult {
  accounts: number
  credentials: number
  identityLinks: number
  linkCodes: number
}

export function createLegacyChannelIdentityMigration(db: SqliteDatabase) {
  return db.transaction((input: LegacyChannelIdentityMigrationInput): LegacyChannelIdentityMigrationResult => {
    const accounts = db.prepare(`
      INSERT OR IGNORE INTO channel_accounts_v2 (
        issuerKey, channelType, accountId, accountKey, displayName, avatarUrl, metadataJson, createdAt, updatedAt
      )
      SELECT ?, channelType, accountId, accountKey, displayName, avatarUrl, metadataJson, createdAt, updatedAt
      FROM channel_accounts
      WHERE channelType = ?
    `).run(input.issuerKey, input.channelType).changes

    const identityLinks = db.prepare(`
      INSERT OR IGNORE INTO channel_identity_links_v2 (
        issuerKey, channelType, accountId, userId, status, source, createdAt, updatedAt
      )
      SELECT ?, channelType, accountId, userId, status, source, createdAt, updatedAt
      FROM channel_identity_links
      WHERE channelType = ?
    `).run(input.issuerKey, input.channelType).changes

    const credentials = db.prepare(`
      INSERT OR IGNORE INTO channel_user_credentials_v2 (
        issuerKey, userId, channelType, credentialKey, label, status, scopesJson, expiresAt, metadataJson, createdAt,
        updatedAt
      )
      SELECT ?, userId, channelType, credentialKey, label, status, scopesJson, expiresAt, metadataJson, createdAt,
             updatedAt
      FROM channel_user_credentials
      WHERE channelType = ?
    `).run(input.issuerKey, input.channelType).changes

    const sourceLinkCodes = db.prepare(`
      UPDATE channel_identity_link_codes
      SET sourceIssuerKey = ?
      WHERE sourceChannelType = ? AND (sourceIssuerKey IS NULL OR sourceIssuerKey = sourceChannelType)
    `).run(input.issuerKey, input.channelType).changes
    const consumedLinkCodes = db.prepare(`
      UPDATE channel_identity_link_codes
      SET consumedIssuerKey = ?
      WHERE consumedChannelType = ? AND (consumedIssuerKey IS NULL OR consumedIssuerKey = consumedChannelType)
    `).run(input.issuerKey, input.channelType).changes

    return {
      accounts,
      credentials,
      identityLinks,
      linkCodes: sourceLinkCodes + consumedLinkCodes
    }
  })
}
