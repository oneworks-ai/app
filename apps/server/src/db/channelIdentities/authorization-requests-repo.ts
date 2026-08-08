import { randomUUID } from 'node:crypto'

import { buildUpdateStatement } from '../repo.utils'
import type { SqliteDatabase } from '../sqlite'
import { mapAuthorizationRequestRow } from './authorization-request-record'
import type {
  AuthorizationRequestInput,
  AuthorizationRequestUpdates,
  ChannelAuthorizationRequestDbRow
} from './authorization-request-record'
import { stringifyJson } from './json'

const AUTHORIZATION_REQUEST_SELECT = `
  id, channelType, channelLinkName, requesterUserId, requesterAccountId,
  credentialSubjectUserId, credentialKey,
  capability, status, message, metadataJson, createdAt, updatedAt, expiresAt, resolvedAt
`

export function createAuthorizationRequestsRepo(db: SqliteDatabase) {
  const getAuthorizationRequest = (id: string) => {
    const stmt = db.prepare(`
      SELECT ${AUTHORIZATION_REQUEST_SELECT}
      FROM channel_authorization_requests
      WHERE id = ?
    `)
    return mapAuthorizationRequestRow(stmt.get<ChannelAuthorizationRequestDbRow>(id))
  }

  const createAuthorizationRequest = (row: AuthorizationRequestInput) => {
    const now = Date.now()
    const id = row.id?.trim() || `auth_${randomUUID()}`
    const stmt = db.prepare(`
      INSERT INTO channel_authorization_requests (
        id, channelType, channelLinkName, requesterUserId, requesterAccountId,
        credentialSubjectUserId, credentialKey,
        capability, status, message, metadataJson, createdAt, updatedAt, expiresAt, resolvedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      id,
      row.channelType,
      row.channelLinkName ?? null,
      row.requesterUserId ?? null,
      row.requesterAccountId ?? null,
      row.credentialSubjectUserId ?? null,
      row.credentialKey ?? null,
      row.capability,
      row.status ?? 'pending',
      row.message ?? null,
      stringifyJson(row.metadata),
      now,
      now,
      row.expiresAt ?? null,
      null
    )
    return getAuthorizationRequest(id)
  }

  const updateAuthorizationRequest = (id: string, updates: AuthorizationRequestUpdates) => {
    const statement = buildUpdateStatement(
      'channel_authorization_requests',
      'id',
      id,
      {
        ...updates,
        metadataJson: updates.metadata,
        updatedAt: Date.now()
      },
      [
        { key: 'status' },
        { key: 'message' },
        { key: 'metadataJson', toParam: value => stringifyJson(value) },
        { key: 'expiresAt' },
        { key: 'resolvedAt' },
        { key: 'updatedAt' }
      ] as const
    )
    if (statement == null) {
      return getAuthorizationRequest(id)
    }
    db.prepare(statement.sql).run(...statement.params)
    return getAuthorizationRequest(id)
  }

  const listPendingAuthorizationRequestsForUser = (userId: string, channelType?: string) => {
    const stmt = db.prepare(`
      SELECT ${AUTHORIZATION_REQUEST_SELECT}
      FROM channel_authorization_requests
      WHERE (requesterUserId = ? OR credentialSubjectUserId = ?) AND status = 'pending'${
      channelType == null ? '' : ' AND channelType = ?'
    }
      ORDER BY createdAt ASC
    `)
    return stmt.all<ChannelAuthorizationRequestDbRow>(
      ...(channelType == null ? [userId, userId] : [userId, userId, channelType])
    ).map(row => mapAuthorizationRequestRow(row)!)
  }

  const listPendingAuthorizationRequestsForAccount = (accountId: string, channelType?: string) => {
    const params = channelType == null ? [accountId] : [accountId, channelType]
    const stmt = db.prepare(`
      SELECT ${AUTHORIZATION_REQUEST_SELECT}
      FROM channel_authorization_requests
      WHERE requesterAccountId = ? AND status = 'pending'${channelType == null ? '' : ' AND channelType = ?'}
      ORDER BY createdAt ASC
    `)
    return stmt.all<ChannelAuthorizationRequestDbRow>(...params).map(row => mapAuthorizationRequestRow(row)!)
  }

  return {
    createAuthorizationRequest,
    getAuthorizationRequest,
    listPendingAuthorizationRequestsForAccount,
    listPendingAuthorizationRequestsForUser,
    updateAuthorizationRequest
  }
}
