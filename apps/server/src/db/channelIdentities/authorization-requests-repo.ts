import { randomUUID } from 'node:crypto'

import { buildUpdateStatement } from '../repo.utils'
import type { SqliteDatabase } from '../sqlite'
import { mapAuthorizationRequestRow, validateAllowedApprovers } from './authorization-request-record'
import type {
  AuthorizationRequestInput,
  AuthorizationRequestUpdates,
  ChannelAuthorizationRequestDbRow
} from './authorization-request-record'
import { stringifyJson } from './json'

const AUTHORIZATION_REQUEST_SELECT = `
  id, channelType, issuerKey, channelKey, channelId, channelLinkName, requesterUserId, requesterAccountId,
  credentialSubjectUserId, credentialKey, allowedApproversJson,
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
    const allowedApprovers = validateAllowedApprovers(row.allowedApprovers)
    const now = Date.now()
    const id = row.id?.trim() || `auth_${randomUUID()}`
    const stmt = db.prepare(`
      INSERT INTO channel_authorization_requests (
        id, channelType, issuerKey, channelKey, channelId, channelLinkName, requesterUserId, requesterAccountId,
        credentialSubjectUserId, credentialKey, allowedApproversJson,
        capability, status, message, metadataJson, createdAt, updatedAt, expiresAt, resolvedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      id,
      row.channelType,
      row.issuerKey ?? row.channelKey ?? null,
      row.channelKey ?? row.issuerKey ?? null,
      row.channelId ?? null,
      row.channelLinkName ?? null,
      row.requesterUserId ?? null,
      row.requesterAccountId ?? null,
      row.credentialSubjectUserId ?? null,
      row.credentialKey ?? null,
      stringifyJson(allowedApprovers),
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
        allowedApproversJson: updates.allowedApprovers,
        updatedAt: Date.now()
      },
      [
        { key: 'status' },
        { key: 'message' },
        { key: 'metadataJson', toParam: value => stringifyJson(value) },
        { key: 'expiresAt' },
        { key: 'resolvedAt' },
        { key: 'allowedApproversJson', toParam: value => stringifyJson(value) },
        { key: 'updatedAt' }
      ] as const
    )
    if (statement == null) {
      return getAuthorizationRequest(id)
    }
    db.prepare(statement.sql).run(...statement.params)
    return getAuthorizationRequest(id)
  }

  const resolveAuthorizationRequest = db.transaction((input: {
    id: string
    message?: string | null
    now?: number
    resolvedAt: number
    status: 'denied' | 'granted'
  }) => {
    const now = input.now ?? Date.now()
    const result = db.prepare(`
      UPDATE channel_authorization_requests
      SET status = ?, message = COALESCE(?, message), resolvedAt = ?, updatedAt = ?
      WHERE id = ?
        AND status = 'pending'
        AND (expiresAt IS NULL OR expiresAt > ?)
    `).run(input.status, input.message ?? null, input.resolvedAt, now, input.id, now)
    return result.changes === 1 ? getAuthorizationRequest(input.id) : undefined
  })

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

  const listPendingAuthorizationRequests = (channelType?: string, limit = 50) => {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 50
    const stmt = db.prepare(`
      SELECT ${AUTHORIZATION_REQUEST_SELECT}
      FROM channel_authorization_requests
      WHERE status = 'pending'${channelType == null ? '' : ' AND channelType = ?'}
      ORDER BY createdAt ASC
      LIMIT ?
    `)
    const params = channelType == null ? [normalizedLimit] : [channelType, normalizedLimit]
    return stmt.all<ChannelAuthorizationRequestDbRow>(...params).map(row => mapAuthorizationRequestRow(row)!)
  }

  return {
    createAuthorizationRequest,
    getAuthorizationRequest,
    listPendingAuthorizationRequests,
    listPendingAuthorizationRequestsForAccount,
    listPendingAuthorizationRequestsForUser,
    resolveAuthorizationRequest,
    updateAuthorizationRequest
  }
}
