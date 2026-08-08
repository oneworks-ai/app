import type { SqliteDatabase } from '../sqlite'
import { PENDING_INTENT_SELECT_FIELDS, mapPendingIntentRow } from './pending-intent-record'
import type { ChannelPendingIntentDbRow, PendingIntentFilter } from './pending-intent-record'

function appendFilter(clauses: string[], params: string[], filter: PendingIntentFilter) {
  if (filter.authorizationRequestId != null) {
    clauses.push('authorizationRequestId = ?')
    params.push(filter.authorizationRequestId)
  }
  if (filter.channelType != null) {
    clauses.push('channelType = ?')
    params.push(filter.channelType)
  }
  if (filter.channelKey != null) {
    clauses.push('channelKey = ?')
    params.push(filter.channelKey)
  }
  if (filter.conversationStateId != null) {
    clauses.push('conversationStateId = ?')
    params.push(filter.conversationStateId)
  }
  if (filter.ownerUserId != null) {
    clauses.push('ownerUserId = ?')
    params.push(filter.ownerUserId)
  }
  if (filter.ownerAccountId != null) {
    clauses.push('ownerAccountId = ?')
    params.push(filter.ownerAccountId)
  }
  if (filter.threadKey != null) {
    clauses.push('threadKey = ?')
    params.push(filter.threadKey)
  }
}

export function createPendingIntentReaders(db: SqliteDatabase) {
  const getPendingIntent = (id: string) => {
    const stmt = db.prepare(`
      SELECT ${PENDING_INTENT_SELECT_FIELDS}
      FROM channel_pending_intents
      WHERE id = ?
    `)
    return mapPendingIntentRow(stmt.get<ChannelPendingIntentDbRow>(id))
  }

  const listPendingIntents = (
    status: 'open' | 'resolved',
    filter: PendingIntentFilter,
    orderBy: string
  ) => {
    const clauses = [`status = '${status}'`]
    const params: string[] = []
    appendFilter(clauses, params, filter)
    const stmt = db.prepare(`
      SELECT ${PENDING_INTENT_SELECT_FIELDS}
      FROM channel_pending_intents
      WHERE ${clauses.join(' AND ')}
      ORDER BY ${orderBy}
    `)
    return stmt.all<ChannelPendingIntentDbRow>(...params).map(item => mapPendingIntentRow(item)!)
  }

  const listOpenPendingIntents = (filter: PendingIntentFilter = {}) => (
    listPendingIntents('open', filter, 'updatedAt ASC')
  )

  const listResolvedPendingIntents = (filter: PendingIntentFilter = {}) => (
    listPendingIntents('resolved', filter, 'resolvedAt ASC, updatedAt ASC')
  )

  return {
    getPendingIntent,
    listOpenPendingIntents,
    listResolvedPendingIntents
  }
}
