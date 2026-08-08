import type { SqliteDatabase } from '../sqlite'
import { mapCredentialRow } from './credential-record'
import type { ChannelUserCredentialDbRow, ChannelUserCredentialInput } from './credential-record'
import { stringifyJson } from './json'

export function createCredentialsRepo(db: SqliteDatabase) {
  const getCredential = (userId: string, channelType: string, credentialKey: string) => {
    const stmt = db.prepare(`
      SELECT userId, channelType, credentialKey, label, status, scopesJson, expiresAt, metadataJson, createdAt, updatedAt
      FROM channel_user_credentials
      WHERE userId = ? AND channelType = ? AND credentialKey = ?
    `)
    return mapCredentialRow(stmt.get<ChannelUserCredentialDbRow>(userId, channelType, credentialKey))
  }

  const upsertCredential = (row: ChannelUserCredentialInput) => {
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO channel_user_credentials (
        userId, channelType, credentialKey, label, status, scopesJson, expiresAt, metadataJson, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId, channelType, credentialKey) DO UPDATE SET
        label = excluded.label,
        status = excluded.status,
        scopesJson = excluded.scopesJson,
        expiresAt = excluded.expiresAt,
        metadataJson = excluded.metadataJson,
        updatedAt = excluded.updatedAt
    `)
    stmt.run(
      row.userId,
      row.channelType,
      row.credentialKey,
      row.label ?? null,
      row.status ?? 'needs_auth',
      stringifyJson(row.scopes),
      row.expiresAt ?? null,
      stringifyJson(row.metadata),
      now,
      now
    )
    return getCredential(row.userId, row.channelType, row.credentialKey)
  }

  const listCredentialsForUser = (userId: string, channelType?: string) => {
    const params = channelType == null ? [userId] : [userId, channelType]
    const stmt = db.prepare(`
      SELECT userId, channelType, credentialKey, label, status, scopesJson, expiresAt, metadataJson, createdAt, updatedAt
      FROM channel_user_credentials
      WHERE userId = ?${channelType == null ? '' : ' AND channelType = ?'}
      ORDER BY channelType ASC, credentialKey ASC
    `)
    return stmt.all<ChannelUserCredentialDbRow>(...params).map(row => mapCredentialRow(row)!)
  }

  return {
    getCredential,
    listCredentialsForUser,
    upsertCredential
  }
}
