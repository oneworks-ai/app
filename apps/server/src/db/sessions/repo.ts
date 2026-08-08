import { v4 as uuidv4 } from 'uuid'

import type { Session, SessionHistoryImport } from '@oneworks/core'
import { createEmptySessionPermissionState, normalizeSessionPermissionState } from '@oneworks/utils'
import type { SessionPermissionState } from '@oneworks/utils'

import { buildUpdateStatement } from '../repo.utils'
import type { SqliteDatabase } from '../sqlite'
import { normalizeSessionPanelState, parseSessionPanelState } from './panel-state'

export type SessionRuntimeKind = 'interactive' | 'external'

export interface SessionChannelActorSnapshot {
  actorAccountId?: string
  actorUserId?: string
  capturedAt?: number
  channelId?: string
  channelKey?: string
  channelLinkName?: string
  channelType?: string
  childRunId?: string
  conversationStateId?: string
  entity?: string
  messageId?: string
  replyReceiveId?: string
  replyReceiveIdType?: string
  senderId?: string
  sessionId?: string
  sessionType?: string
  threadId?: string
  threadKey?: string
}

export interface SessionRuntimeState {
  channelActorSnapshot?: SessionChannelActorSnapshot
  runtimeKind: SessionRuntimeKind
  historySeed?: string
  historySeedPending: boolean
  permissionState: SessionPermissionState
}

interface SessionRow {
  id: string
  parentSessionId: string | null
  messageBranchGroupId: string | null
  messageBranchSourceSessionId: string | null
  messageBranchSourceMessageId: string | null
  messageBranchBaseMessageIndex: number | null
  messageBranchAction: string | null
  title: string | null
  lastMessage: string | null
  lastUserMessage: string | null
  runtimeKind: string | null
  channelActorSnapshot: string | null
  historySeed: string | null
  historySeedPending: number | null
  permissionState: string | null
  createdAt: number
  messageCount: number
  isStarred: number
  isArchived: number
  tags?: string
  status: string | null
  model: string | null
  adapter: string | null
  account: string | null
  permissionMode: string | null
  effort: string | null
  fastMode: number | null
  promptType: string | null
  promptName: string | null
  panelState: string | null
  historyImport: string | null
}

type SessionUpdate = Partial<Omit<Session, 'id' | 'createdAt' | 'messageCount'>>
type SessionCreateOptions =
  & Partial<SessionRuntimeState>
  & Partial<
    Pick<
      Session,
      | 'messageBranchAction'
      | 'messageBranchBaseMessageIndex'
      | 'messageBranchGroupId'
      | 'messageBranchSourceMessageId'
      | 'messageBranchSourceSessionId'
      | 'historyImport'
    >
  >
type SessionRuntimeUpdate = Partial<{
  runtimeKind: SessionRuntimeKind
  channelActorSnapshot: SessionChannelActorSnapshot | null
  historySeed: string | null
  historySeedPending: boolean
  permissionState: SessionPermissionState
}>

const SESSION_SELECT = `
  SELECT s.*,
         (
           SELECT COUNT(DISTINCT COALESCE(eventKey, CAST(id AS TEXT)))
           FROM messages
           WHERE sessionId = s.id
             AND (
               json_extract(data, '$.type') = 'message'
               OR (
                 json_extract(data, '$.type') IS NULL
                 AND json_extract(data, '$.role') IN ('user', 'assistant', 'system')
               )
             )
         ) as messageCount,
         (SELECT GROUP_CONCAT(t.name) FROM tags t JOIN session_tags st ON t.id = st.tagId WHERE st.sessionId = s.id) as tags
  FROM sessions s
`

const sessionUpdateFields = [
  { key: 'title' },
  { key: 'lastMessage' },
  { key: 'lastUserMessage' },
  { key: 'isStarred', toParam: value => value ? 1 : 0 },
  { key: 'isArchived', toParam: value => value ? 1 : 0 },
  { key: 'status' },
  { key: 'model' },
  { key: 'adapter' },
  { key: 'account' },
  { key: 'permissionMode' },
  { key: 'effort' },
  { key: 'fastMode', toParam: value => value == null ? null : value ? 1 : 0 },
  { key: 'promptType' },
  { key: 'promptName' },
  { key: 'panelState', toParam: value => JSON.stringify(normalizeSessionPanelState(value)) },
  { key: 'historyImport', toParam: value => value == null ? null : JSON.stringify(value) },
  { key: 'messageBranchGroupId' },
  { key: 'messageBranchSourceSessionId' },
  { key: 'messageBranchSourceMessageId' },
  { key: 'messageBranchBaseMessageIndex' },
  { key: 'messageBranchAction' }
] as const satisfies ReadonlyArray<{
  key: keyof SessionUpdate
  toParam?: (value: any) => string | number | null
}>

const sessionRuntimeUpdateFields = [
  { key: 'runtimeKind' },
  {
    key: 'channelActorSnapshot',
    toParam: value => {
      const snapshot = normalizeChannelActorSnapshot(value)
      return snapshot == null ? null : JSON.stringify(snapshot)
    }
  },
  { key: 'historySeed', toParam: value => value ?? null },
  { key: 'historySeedPending', toParam: value => value ? 1 : 0 },
  { key: 'permissionState', toParam: value => JSON.stringify(normalizeSessionPermissionState(value)) }
] as const satisfies ReadonlyArray<{
  key: keyof SessionRuntimeUpdate
  toParam?: (value: any) => string | number | null
}>

const parsePermissionState = (value: string | null) => {
  if (value == null || value.trim() === '') {
    return createEmptySessionPermissionState()
  }

  try {
    return normalizeSessionPermissionState(JSON.parse(value))
  } catch {
    return createEmptySessionPermissionState()
  }
}

const parseHistoryImport = (value: string | null): SessionHistoryImport | undefined => {
  if (value == null || value.trim() === '') {
    return undefined
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (
      typeof parsed.adapter !== 'string' ||
      !Number.isFinite(parsed.importedAt) ||
      !Number.isFinite(parsed.sourceUpdatedAt)
    ) {
      return undefined
    }
    return {
      adapter: parsed.adapter,
      importedAt: parsed.importedAt as number,
      sourceUpdatedAt: parsed.sourceUpdatedAt as number
    }
  } catch {
    return undefined
  }
}

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value != null && !Array.isArray(value)
)

const normalizeChannelActorSnapshot = (value: unknown): SessionChannelActorSnapshot | undefined => {
  if (!isRecord(value)) return undefined
  const capturedAt = typeof value.capturedAt === 'number' && Number.isFinite(value.capturedAt)
    ? value.capturedAt
    : undefined
  const snapshot: SessionChannelActorSnapshot = {
    actorAccountId: trimNonEmpty(value.actorAccountId),
    actorUserId: trimNonEmpty(value.actorUserId),
    capturedAt,
    channelId: trimNonEmpty(value.channelId),
    channelKey: trimNonEmpty(value.channelKey),
    channelLinkName: trimNonEmpty(value.channelLinkName),
    channelType: trimNonEmpty(value.channelType),
    childRunId: trimNonEmpty(value.childRunId),
    conversationStateId: trimNonEmpty(value.conversationStateId),
    entity: trimNonEmpty(value.entity),
    messageId: trimNonEmpty(value.messageId),
    replyReceiveId: trimNonEmpty(value.replyReceiveId),
    replyReceiveIdType: trimNonEmpty(value.replyReceiveIdType),
    senderId: trimNonEmpty(value.senderId),
    sessionId: trimNonEmpty(value.sessionId),
    sessionType: trimNonEmpty(value.sessionType),
    threadKey: trimNonEmpty(value.threadKey)
  }

  return Object.values(snapshot).some(item => item != null) ? snapshot : undefined
}

const parseChannelActorSnapshot = (value: string | null) => {
  if (value == null || value.trim() === '') return undefined

  try {
    return normalizeChannelActorSnapshot(JSON.parse(value))
  } catch {
    return undefined
  }
}

function mapSessionRow(row: SessionRow): Session {
  const panelState = parseSessionPanelState(row.panelState)
  const historyImport = parseHistoryImport(row.historyImport)
  return {
    id: row.id,
    parentSessionId: row.parentSessionId ?? undefined,
    messageBranchGroupId: row.messageBranchGroupId ?? undefined,
    messageBranchSourceSessionId: row.messageBranchSourceSessionId ?? undefined,
    messageBranchSourceMessageId: row.messageBranchSourceMessageId ?? undefined,
    messageBranchBaseMessageIndex: row.messageBranchBaseMessageIndex ?? undefined,
    messageBranchAction: (row.messageBranchAction as Session['messageBranchAction']) ?? undefined,
    title: row.title ?? undefined,
    createdAt: row.createdAt,
    messageCount: row.messageCount,
    lastMessage: row.lastMessage ?? undefined,
    lastUserMessage: row.lastUserMessage ?? undefined,
    isStarred: row.isStarred === 1,
    isArchived: row.isArchived === 1,
    tags: (row.tags != null && row.tags !== '') ? row.tags.split(',') : [],
    status: (row.status as any) ?? undefined,
    model: row.model ?? undefined,
    adapter: row.adapter ?? undefined,
    account: row.account ?? undefined,
    permissionMode: (row.permissionMode as any) ?? undefined,
    effort: (row.effort as any) ?? undefined,
    fastMode: row.fastMode == null ? undefined : row.fastMode === 1,
    promptType: (row.promptType as any) ?? undefined,
    promptName: row.promptName ?? undefined,
    ...(panelState == null ? {} : { panelState }),
    ...(historyImport == null ? {} : { historyImport })
  }
}

function mapSessionRuntimeState(
  row: Pick<
    SessionRow,
    'runtimeKind' | 'channelActorSnapshot' | 'historySeed' | 'historySeedPending' | 'permissionState'
  >
): SessionRuntimeState {
  const channelActorSnapshot = parseChannelActorSnapshot(row.channelActorSnapshot)
  return {
    ...(channelActorSnapshot == null ? {} : { channelActorSnapshot }),
    runtimeKind: row.runtimeKind === 'external' ? 'external' : 'interactive',
    historySeed: row.historySeed ?? undefined,
    historySeedPending: row.historySeedPending === 1,
    permissionState: parsePermissionState(row.permissionState)
  }
}

export function createSessionsRepo(db: SqliteDatabase) {
  const list = (filter: 'active' | 'archived' | 'all' = 'active'): Session[] => {
    let whereClause = ''
    if (filter === 'active') {
      whereClause = 'WHERE isArchived = 0'
    } else if (filter === 'archived') {
      whereClause = 'WHERE isArchived = 1'
    }

    const stmt = db.prepare(`
      ${SESSION_SELECT}
      ${whereClause}
      ORDER BY isStarred DESC,
        CASE
          WHEN json_valid(historyImport) THEN COALESCE(json_extract(historyImport, '$.sourceUpdatedAt'), createdAt)
          ELSE createdAt
        END DESC
    `)
    const rows = stmt.all<SessionRow>()
    return rows.map(mapSessionRow)
  }

  const get = (id: string): Session | undefined => {
    const stmt = db.prepare(`
      ${SESSION_SELECT}
      WHERE s.id = ?
    `)
    const row = stmt.get<SessionRow>(id)
    if (row == null) return undefined
    return mapSessionRow(row)
  }

  const update = (id: string, updates: SessionUpdate) => {
    const statement = buildUpdateStatement('sessions', 'id', id, updates, sessionUpdateFields)
    if (!statement) return

    const stmt = db.prepare(statement.sql)
    stmt.run(...statement.params)
  }

  const updateRuntimeState = (id: string, updates: SessionRuntimeUpdate) => {
    const statement = buildUpdateStatement('sessions', 'id', id, updates, sessionRuntimeUpdateFields)
    if (!statement) return

    const stmt = db.prepare(statement.sql)
    stmt.run(...statement.params)
  }

  const consumePermissionOnce = db.transaction((id: string, keys: string[]) => {
    const row = db.prepare('SELECT permissionState FROM sessions WHERE id = ?')
      .get<Pick<SessionRow, 'permissionState'>>(id)
    if (row == null) return undefined
    const state = parsePermissionState(row.permissionState)
    const denyKey = keys.find(key => state.onceDeny.includes(key))
    const allowKey = denyKey == null ? keys.find(key => state.onceAllow.includes(key)) : undefined
    const key = denyKey ?? allowKey
    if (key == null) return undefined

    const decision = denyKey == null ? 'allow' as const : 'deny' as const
    const nextState = normalizeSessionPermissionState({
      ...state,
      onceAllow: decision === 'allow' ? state.onceAllow.filter(item => item !== key) : state.onceAllow,
      onceDeny: decision === 'deny' ? state.onceDeny.filter(item => item !== key) : state.onceDeny
    })
    db.prepare('UPDATE sessions SET permissionState = ? WHERE id = ?')
      .run(JSON.stringify(nextState), id)
    return { decision, key, state: nextState }
  })

  const transferPermissionState = db.transaction((parentId: string, childId: string) => {
    const select = db.prepare('SELECT permissionState FROM sessions WHERE id = ?')
    const parentRow = select.get<Pick<SessionRow, 'permissionState'>>(parentId)
    const childRow = select.get<Pick<SessionRow, 'permissionState'>>(childId)
    if (parentRow == null || childRow == null) return undefined

    const parentState = parsePermissionState(parentRow.permissionState)
    const childState = normalizeSessionPermissionState({
      ...parsePermissionState(childRow.permissionState),
      allow: parentState.allow,
      deny: parentState.deny,
      onceAllow: parentState.onceAllow,
      onceDeny: parentState.onceDeny
    })
    db.prepare('UPDATE sessions SET permissionState = ? WHERE id = ?')
      .run(JSON.stringify(childState), childId)
    db.prepare('UPDATE sessions SET permissionState = ? WHERE id = ?')
      .run(JSON.stringify({ ...parentState, onceAllow: [], onceDeny: [] }), parentId)
    return childState
  })

  const setStarred = (id: string, isStarred: boolean) => {
    update(id, { isStarred })
  }

  const setArchived = (id: string, isArchived: boolean) => {
    update(id, { isArchived })
  }

  const archiveTree = (id: string, isArchived: boolean): string[] => {
    const stmt = db.prepare('SELECT id FROM sessions WHERE parentSessionId = ?')
    const updateStmt = db.prepare('UPDATE sessions SET isArchived = ? WHERE id = ?')
    const updatedIds: string[] = []
    const stack = [id]

    while (stack.length > 0) {
      const currentId = stack.pop()
      if (!currentId) continue
      updateStmt.run(isArchived ? 1 : 0, currentId)
      updatedIds.push(currentId)
      const rows = stmt.all<{ id: string }>(currentId)
      for (const row of rows) {
        stack.push(row.id)
      }
    }

    return updatedIds
  }

  const create = (
    title?: string,
    id?: string,
    status?: string,
    parentSessionId?: string,
    options: SessionCreateOptions = {}
  ): Session => {
    const session: Session = {
      id: id ?? uuidv4(),
      parentSessionId: parentSessionId ?? undefined,
      messageBranchGroupId: options.messageBranchGroupId,
      messageBranchSourceSessionId: options.messageBranchSourceSessionId,
      messageBranchSourceMessageId: options.messageBranchSourceMessageId,
      messageBranchBaseMessageIndex: options.messageBranchBaseMessageIndex,
      messageBranchAction: options.messageBranchAction,
      title,
      createdAt: Date.now(),
      status: (status as any) ?? undefined,
      historyImport: options.historyImport
    }
    const runtimeKind = options.runtimeKind ?? (parentSessionId != null ? 'external' : 'interactive')
    const normalizedChannelActorSnapshot = normalizeChannelActorSnapshot(options.channelActorSnapshot)
    const channelActorSnapshot = normalizedChannelActorSnapshot == null
      ? null
      : JSON.stringify(normalizedChannelActorSnapshot)
    const historySeed = options.historySeed ?? null
    const historySeedPending = options.historySeedPending === true ? 1 : 0
    const permissionState = JSON.stringify(normalizeSessionPermissionState(options.permissionState))
    const stmt = db.prepare(`
      INSERT INTO sessions (
        id,
        parentSessionId,
        messageBranchGroupId,
        messageBranchSourceSessionId,
        messageBranchSourceMessageId,
        messageBranchBaseMessageIndex,
        messageBranchAction,
        title,
        runtimeKind,
        channelActorSnapshot,
        historySeed,
        historySeedPending,
        permissionState,
        historyImport,
        createdAt,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      session.id,
      session.parentSessionId ?? null,
      session.messageBranchGroupId ?? null,
      session.messageBranchSourceSessionId ?? null,
      session.messageBranchSourceMessageId ?? null,
      session.messageBranchBaseMessageIndex ?? null,
      session.messageBranchAction ?? null,
      session.title ?? null,
      runtimeKind,
      channelActorSnapshot,
      historySeed,
      historySeedPending,
      permissionState,
      session.historyImport == null ? null : JSON.stringify(session.historyImport),
      session.createdAt,
      session.status ?? null
    )
    return session
  }

  const setTitle = (id: string, title: string) => {
    update(id, { title })
  }

  const setLastMessages = (id: string, lastMessage?: string, lastUserMessage?: string) => {
    update(id, { lastMessage, lastUserMessage })
  }

  const remove = (id: string): boolean => {
    const stmt = db.prepare('DELETE FROM sessions WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }

  const getRuntimeState = (id: string): SessionRuntimeState | undefined => {
    const stmt = db.prepare(
      'SELECT runtimeKind, channelActorSnapshot, historySeed, historySeedPending, permissionState FROM sessions WHERE id = ?'
    )
    const row = stmt.get<
      Pick<
        SessionRow,
        'runtimeKind' | 'channelActorSnapshot' | 'historySeed' | 'historySeedPending' | 'permissionState'
      >
    >(id)
    if (row == null) return undefined
    return mapSessionRuntimeState(row)
  }

  return {
    archiveTree,
    consumePermissionOnce,
    create,
    get,
    getRuntimeState,
    list,
    remove,
    setArchived,
    setLastMessages,
    setStarred,
    setTitle,
    transferPermissionState,
    update,
    updateRuntimeState
  }
}

export type SessionsRepo = ReturnType<typeof createSessionsRepo>
