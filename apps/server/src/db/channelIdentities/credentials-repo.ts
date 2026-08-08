import type { SqliteDatabase } from '../sqlite'
import { mapCredentialRow } from './credential-record'
import type { ChannelUserCredentialDbRow, ChannelUserCredentialInput } from './credential-record'
import { stringifyJson } from './json'

export function createCredentialsRepo(db: SqliteDatabase) {
  const getCredential = (issuerKey: string, userId: string, credentialKey: string) => {
    const stmt = db.prepare(`
      SELECT issuerKey, userId, channelType, credentialKey, label, status, scopesJson, expiresAt, metadataJson,
             createdAt, updatedAt
      FROM channel_user_credentials_v2
      WHERE issuerKey = ? AND userId = ? AND credentialKey = ?
    `)
    return mapCredentialRow(stmt.get<ChannelUserCredentialDbRow>(issuerKey, userId, credentialKey))
  }

  const upsertCredential = (row: ChannelUserCredentialInput) => {
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO channel_user_credentials_v2 (
        issuerKey, userId, channelType, credentialKey, label, status, scopesJson, expiresAt, metadataJson, createdAt,
        updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issuerKey, userId, credentialKey) DO UPDATE SET
        channelType = excluded.channelType,
        label = excluded.label,
        status = excluded.status,
        scopesJson = excluded.scopesJson,
        expiresAt = excluded.expiresAt,
        metadataJson = excluded.metadataJson,
        updatedAt = excluded.updatedAt
    `)
    stmt.run(
      row.issuerKey,
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
    return getCredential(row.issuerKey, row.userId, row.credentialKey)
  }

  const listCredentialsForUser = (issuerKey: string, userId: string) => {
    const stmt = db.prepare(`
      SELECT issuerKey, userId, channelType, credentialKey, label, status, scopesJson, expiresAt, metadataJson,
             createdAt, updatedAt
      FROM channel_user_credentials_v2
      WHERE issuerKey = ? AND userId = ?
      ORDER BY credentialKey ASC
    `)
    return stmt.all<ChannelUserCredentialDbRow>(issuerKey, userId).map(row => mapCredentialRow(row)!)
  }

  return {
    getCredential,
    listCredentialsForUser,
    upsertCredential
  }
}
