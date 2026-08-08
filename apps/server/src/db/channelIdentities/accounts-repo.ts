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
  const getAccount = (channelType: string, accountId: string) => {
    const stmt = db.prepare(`
      SELECT channelType, accountId, accountKey, displayName, avatarUrl, metadataJson, createdAt, updatedAt
      FROM channel_accounts
      WHERE channelType = ? AND accountId = ?
    `)
    return mapAccountRow(stmt.get<ChannelAccountDbRow>(channelType, accountId))
  }

  const upsertAccount = (row: ChannelAccountInput) => {
    const now = Date.now()
    const accountKey = row.accountKey?.trim() || `${row.channelType}:${row.accountId}`
    const stmt = db.prepare(`
      INSERT INTO channel_accounts (
        channelType, accountId, accountKey, displayName, avatarUrl, metadataJson, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channelType, accountId) DO UPDATE SET
        accountKey = excluded.accountKey,
        displayName = excluded.displayName,
        avatarUrl = excluded.avatarUrl,
        metadataJson = excluded.metadataJson,
        updatedAt = excluded.updatedAt
    `)
    stmt.run(
      row.channelType,
      row.accountId,
      accountKey,
      row.displayName ?? null,
      row.avatarUrl ?? null,
      stringifyJson(row.metadata),
      now,
      now
    )
    return getAccount(row.channelType, row.accountId)
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

  const getIdentityLink = (channelType: string, accountId: string) => {
    const stmt = db.prepare(`
      SELECT channelType, accountId, userId, status, source, createdAt, updatedAt
      FROM channel_identity_links
      WHERE channelType = ? AND accountId = ?
    `)
    return stmt.get<ChannelIdentityLinkRow>(channelType, accountId)
  }

  const linkAccountToUser = (row: ChannelIdentityLinkInput) => {
    const now = Date.now()
    const stmt = db.prepare(`
      INSERT INTO channel_identity_links (
        channelType, accountId, userId, status, source, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channelType, accountId) DO UPDATE SET
        userId = excluded.userId,
        status = excluded.status,
        source = excluded.source,
        updatedAt = excluded.updatedAt
    `)
    stmt.run(
      row.channelType,
      row.accountId,
      row.userId,
      row.status ?? 'verified',
      row.source ?? null,
      now,
      now
    )
    return getIdentityLink(row.channelType, row.accountId)
  }

  const resolveUserByAccount = (channelType: string, accountId: string) => {
    const stmt = db.prepare(`
      SELECT users.id, users.displayName, users.createdAt, users.updatedAt
      FROM canonical_users users
      INNER JOIN channel_identity_links links ON links.userId = users.id
      WHERE links.channelType = ? AND links.accountId = ? AND links.status = 'verified'
      LIMIT 1
    `)
    return stmt.get<CanonicalUserRow>(channelType, accountId)
  }

  const listAccountsForUser = (userId: string) => {
    const stmt = db.prepare(`
      SELECT accounts.channelType, accounts.accountId, accounts.accountKey, accounts.displayName,
             accounts.avatarUrl, accounts.metadataJson, accounts.createdAt, accounts.updatedAt
      FROM channel_accounts accounts
      INNER JOIN channel_identity_links links
        ON links.channelType = accounts.channelType AND links.accountId = accounts.accountId
      WHERE links.userId = ?
      ORDER BY accounts.channelType ASC, accounts.accountId ASC
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
