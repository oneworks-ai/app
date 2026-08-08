import { randomUUID } from 'node:crypto'

import type { SqliteDatabase } from '../sqlite'
import { mapAccountRow } from './account-record'
import type {
  CanonicalUserInput,
  CanonicalUserRow,
  ChannelAccountDbRow,
  ChannelAccountInput,
  ChannelIdentityLinkInput,
  ChannelIdentityLinkRow
} from './account-record'
import { stringifyJson } from './json'

export function createChannelAccountsRepo(db: SqliteDatabase) {
  const getAccount = (issuerKey: string, accountId: string) => {
    const stmt = db.prepare(`
      SELECT issuerKey, channelType, accountId, accountKey, displayName, avatarUrl, metadataJson, createdAt, updatedAt
      FROM channel_accounts_v2
      WHERE issuerKey = ? AND accountId = ?
    `)
    return mapAccountRow(stmt.get<ChannelAccountDbRow>(issuerKey, accountId))
  }

  const upsertAccount = (row: ChannelAccountInput) => {
    const now = Date.now()
    const accountKey = row.accountKey?.trim() || `${row.issuerKey}:${row.accountId}`
    const stmt = db.prepare(`
      INSERT INTO channel_accounts_v2 (
        issuerKey, channelType, accountId, accountKey, displayName, avatarUrl, metadataJson, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issuerKey, accountId) DO UPDATE SET
        channelType = excluded.channelType,
        accountKey = excluded.accountKey,
        displayName = excluded.displayName,
        avatarUrl = excluded.avatarUrl,
        metadataJson = excluded.metadataJson,
        updatedAt = excluded.updatedAt
    `)
    stmt.run(
      row.issuerKey,
      row.channelType,
      row.accountId,
      accountKey,
      row.displayName ?? null,
      row.avatarUrl ?? null,
      stringifyJson(row.metadata),
      now,
      now
    )
    return getAccount(row.issuerKey, row.accountId)
  }

  const getCanonicalUser = (id: string) => {
    const stmt = db.prepare(`
      SELECT id, displayName, createdAt, updatedAt
      FROM canonical_users
      WHERE id = ?
    `)
    return stmt.get<CanonicalUserRow>(id)
  }

  const ensureCanonicalUser = (row: CanonicalUserInput = {}) => {
    const now = Date.now()
    const id = row.id?.trim() || `user_${randomUUID()}`
    const stmt = db.prepare(`
      INSERT INTO canonical_users (id, displayName, createdAt, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        displayName = COALESCE(excluded.displayName, canonical_users.displayName),
        updatedAt = excluded.updatedAt
    `)
    stmt.run(id, row.displayName ?? null, now, now)
    return getCanonicalUser(id)
  }

  const getIdentityLink = (issuerKey: string, accountId: string) => {
    const stmt = db.prepare(`
      SELECT issuerKey, channelType, accountId, userId, status, source, createdAt, updatedAt
      FROM channel_identity_links_v2
      WHERE issuerKey = ? AND accountId = ?
    `)
    return stmt.get<ChannelIdentityLinkRow>(issuerKey, accountId)
  }

  const linkAccountToUser = (row: ChannelIdentityLinkInput) => {
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO channel_identity_links_v2 (
        issuerKey, channelType, accountId, userId, status, source, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issuerKey, accountId) DO UPDATE SET
        channelType = excluded.channelType,
        userId = excluded.userId,
        status = excluded.status,
        source = excluded.source,
        updatedAt = excluded.updatedAt
    `)
    stmt.run(
      row.issuerKey,
      row.channelType,
      row.accountId,
      row.userId,
      row.status ?? 'verified',
      row.source ?? null,
      now,
      now
    )
    return getIdentityLink(row.issuerKey, row.accountId)
  }

  const resolveUserByAccount = (issuerKey: string, accountId: string) => {
    const stmt = db.prepare(`
      SELECT users.id, users.displayName, users.createdAt, users.updatedAt
      FROM canonical_users users
      INNER JOIN channel_identity_links_v2 links ON links.userId = users.id
      WHERE links.issuerKey = ? AND links.accountId = ? AND links.status = 'verified'
      LIMIT 1
    `)
    return stmt.get<CanonicalUserRow>(issuerKey, accountId)
  }

  const listAccountsForUser = (userId: string) => {
    const stmt = db.prepare(`
      SELECT accounts.issuerKey, accounts.channelType, accounts.accountId, accounts.accountKey, accounts.displayName,
             accounts.avatarUrl, accounts.metadataJson, accounts.createdAt, accounts.updatedAt
      FROM channel_accounts_v2 accounts
      INNER JOIN channel_identity_links_v2 links
        ON links.issuerKey = accounts.issuerKey AND links.accountId = accounts.accountId
      WHERE links.userId = ?
      ORDER BY accounts.issuerKey ASC, accounts.accountId ASC
    `)
    return stmt.all<ChannelAccountDbRow>(userId).map(row => mapAccountRow(row)!)
  }

  return {
    ensureCanonicalUser,
    getAccount,
    getCanonicalUser,
    getIdentityLink,
    linkAccountToUser,
    listAccountsForUser,
    resolveUserByAccount,
    upsertAccount
  }
}
