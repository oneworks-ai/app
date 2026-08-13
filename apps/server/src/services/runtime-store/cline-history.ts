/* eslint-disable max-lines -- strict SQLite and messages-artifact validation stays in one private Cline reader. */
import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite'

import type { RuntimeContentItem } from '@oneworks/runtime-protocol'

const require = createRequire(__filename)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

export const CLINE_HISTORY_DATABASE_MAX_BYTES = 50 * 1024 * 1024
export const CLINE_HISTORY_MESSAGES_MAX_BYTES = 50 * 1024 * 1024
export const CLINE_HISTORY_ARTIFACT_VERSION = 1
export const CLINE_HISTORY_CLI_VERSION = '3.0.54'

const REQUIRED_SESSION_COLUMNS = ['session_id', 'started_at', 'cwd', 'messages_path', 'updated_at'] as const
const OPTIONAL_SESSION_COLUMNS = [
  'workspace_root',
  'model',
  'parent_session_id',
  'parent_agent_id',
  'agent_id',
  'conversation_id',
  'is_subagent'
] as const

export interface ClineHistoryMessage {
  content: string | RuntimeContentItem[]
  id: string
  role: 'assistant' | 'system' | 'user'
  ts: number
}

export interface ClineHistorySession {
  createdAt: number
  cwd: string
  fileSizeBytes: number
  isSubagent: boolean
  messages?: ClineHistoryMessage[]
  model?: string
  nativeSessionId: string
  parentNativeSessionId?: string
  sourcePath: string
  sourceRoot: string
  title?: string
  updatedAt: number
  workspaceRoot: string
}

export interface ReadClineHistoryOptions {
  dataRoots: string[]
  maxDatabaseBytes?: number
  maxMessagesBytes?: number
  onDiagnostic?: (message: string) => void
  readMessages: boolean
  sourcePaths?: string[]
}

interface ClineSessionRow extends Record<string, unknown> {
  agent_id: unknown
  conversation_id: unknown
  cwd: unknown
  is_subagent: unknown
  messages_path: unknown
  model: unknown
  parent_agent_id: unknown
  parent_session_id: unknown
  session_id: unknown
  started_at: unknown
  updated_at: unknown
  workspace_root: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const asTimestamp = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  const text = asString(value)
  if (text == null) {
    return fallback
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : fallback
}

const isPathInside = (root: string, target: string) => {
  const relative = path.relative(root, target)
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

const assertNoSymlinkBelow = (root: string, target: string) => {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  if (!isPathInside(resolvedRoot, resolvedTarget)) {
    throw new Error('Cline history path escaped its data root')
  }

  let current = resolvedRoot
  if (lstatSync(current).isSymbolicLink()) {
    throw new Error('Cline history data root must not be a symbolic link')
  }
  const relative = path.relative(resolvedRoot, resolvedTarget)
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error('Cline history path must not contain symbolic links')
    }
  }
}

const assertContainedRegularFile = (root: string, candidate: string, maxBytes: number) => {
  const resolvedRoot = realpathSync.native(path.resolve(root))
  const lexicalCandidate = path.resolve(candidate)
  if (!isPathInside(path.resolve(root), lexicalCandidate)) {
    throw new Error('Cline history path escaped its data root')
  }
  assertNoSymlinkBelow(path.resolve(root), lexicalCandidate)
  const resolvedCandidate = realpathSync.native(lexicalCandidate)
  if (!isPathInside(resolvedRoot, resolvedCandidate)) {
    throw new Error('Cline history path escaped its data root')
  }
  const stats = statSync(resolvedCandidate)
  if (!stats.isFile()) {
    throw new Error('Cline history path is not a regular file')
  }
  if (stats.size > maxBytes) {
    throw new Error('Cline history file exceeds the safe size limit')
  }
  return { filePath: resolvedCandidate, stats }
}

const resolveDatabaseCandidates = (dataRoot: string) => {
  const resolved = path.resolve(dataRoot)
  try {
    if (statSync(resolved).isFile()) {
      return path.basename(resolved) === 'sessions.db' ? [resolved] : []
    }
  } catch {
    return []
  }
  return [
    path.join(resolved, 'db', 'sessions.db'),
    path.join(resolved, 'sessions.db')
  ]
}

const resolveDatabaseDataRoot = (configuredRoot: string, databasePath: string) => {
  const resolvedRoot = path.resolve(configuredRoot)
  try {
    if (statSync(resolvedRoot).isDirectory()) {
      return resolvedRoot
    }
  } catch {}
  return path.basename(path.dirname(databasePath)) === 'db'
    ? path.dirname(path.dirname(databasePath))
    : path.dirname(databasePath)
}

const rejectMutableSQLiteSidecars = (databasePath: string) => {
  for (const suffix of ['-journal', '-shm', '-wal']) {
    if (existsSync(`${databasePath}${suffix}`)) {
      throw new Error('Cline history database has a live SQLite sidecar')
    }
  }
}

const readTableColumns = (database: NodeDatabaseSync) =>
  new Set(
    (database.prepare("SELECT name FROM pragma_table_info('sessions')").all() as Array<{ name?: unknown }>)
      .map(row => asString(row.name))
      .filter((column): column is string => column != null)
  )

const buildSessionSelect = (columns: Set<string>) =>
  [
    ...REQUIRED_SESSION_COLUMNS,
    ...OPTIONAL_SESSION_COLUMNS
  ].map(column => columns.has(column) ? `"${column}"` : `NULL AS "${column}"`).join(', ')

const readSessionRows = (databasePath: string, dataRoot: string, maxDatabaseBytes: number) => {
  const databaseFile = assertContainedRegularFile(dataRoot, databasePath, maxDatabaseBytes)
  rejectMutableSQLiteSidecars(databaseFile.filePath)

  let database: NodeDatabaseSync | undefined
  try {
    database = new DatabaseSync(databaseFile.filePath, { readOnly: true })
    database.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 0;')
    const queryOnly = database.prepare('PRAGMA query_only').get() as { query_only?: unknown } | undefined
    if (queryOnly?.query_only !== 1) {
      throw new Error('Cline history database is not query-only')
    }
    const columns = readTableColumns(database)
    if (REQUIRED_SESSION_COLUMNS.some(column => !columns.has(column))) {
      throw new Error('Unsupported Cline history database schema')
    }
    return database.prepare(`
      SELECT ${buildSessionSelect(columns)}
      FROM sessions
      ORDER BY started_at DESC, session_id ASC
    `).all() as ClineSessionRow[]
  } finally {
    database?.close()
  }
}

const resolveMessagesPath = (dataRoot: string, rawPath: string) => {
  if (!path.isAbsolute(rawPath) && rawPath.split(/[\\/]/u).includes('..')) {
    throw new Error('Cline messages path contains traversal')
  }
  return path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(dataRoot, rawPath)
}

const containsImageSentinel = (value: unknown): boolean => {
  if (value === '[image]') {
    return true
  }
  if (Array.isArray(value)) {
    return value.some(containsImageSentinel)
  }
  if (!isRecord(value)) {
    return false
  }
  return value.rawOutput === '[image]' || value.raw_output === '[image]'
}

const normalizeText = (value: unknown) => {
  const text = asString(value)
  if (text == null) {
    return undefined
  }
  const wrapped = text.match(/^<user_input\b[^>]*>([\s\S]*)<\/user_input>$/u)
  return (wrapped?.[1] ?? text).trim()
}

const collectToolUseCounts = (messages: Array<Record<string, unknown>>) => {
  const counts = new Map<string, number>()
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue
    for (const item of message.content) {
      if (!isRecord(item) || item.type !== 'tool_use') continue
      const id = asString(item.id)
      const name = asString(item.name)
      if (id != null && name != null) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return counts
}

const normalizeContent = (
  value: unknown,
  toolUseCounts: Map<string, number>,
  priorToolUseIds: Set<string>,
  retainedToolResultIds: Set<string>
): string | RuntimeContentItem[] | undefined => {
  if (typeof value === 'string') {
    return normalizeText(value)
  }
  if (!Array.isArray(value)) {
    return undefined
  }

  const items: RuntimeContentItem[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    if (item.type === 'text') {
      const text = normalizeText(item.text)
      if (text != null) items.push({ type: 'text', text })
      continue
    }
    if (item.type === 'tool_use') {
      const id = asString(item.id)
      const name = asString(item.name)
      if (id == null || name == null) throw new Error('Malformed Cline native tool call')
      if (toolUseCounts.get(id) !== 1 || priorToolUseIds.has(id)) {
        throw new Error('Ambiguous duplicate Cline native tool call id')
      }
      priorToolUseIds.add(id)
      items.push({ type: 'tool_use', id, name, input: item.input ?? {} })
      continue
    }
    if (item.type === 'tool_result') {
      const toolUseId = asString(item.tool_use_id ?? item.toolUseId)
      if (
        toolUseId == null ||
        toolUseCounts.get(toolUseId) !== 1 ||
        !priorToolUseIds.has(toolUseId) ||
        retainedToolResultIds.has(toolUseId)
      ) {
        throw new Error('Unaligned Cline native tool result')
      }
      retainedToolResultIds.add(toolUseId)
      if (containsImageSentinel(item.content) || containsImageSentinel(item.rawOutput ?? item.raw_output)) {
        items.push({ type: 'text', text: '[unavailable native image output]' })
      } else {
        items.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: item.content ?? '[unavailable native tool output]',
          ...(typeof item.is_error === 'boolean' ? { is_error: item.is_error } : {})
        })
      }
      continue
    }
    items.push({ type: 'text', text: '[unavailable native message content]' })
  }

  if (items.length === 0) {
    return undefined
  }
  if (items.every(item => item.type === 'text')) {
    const text = items.map(item => item.text).join('\n').trim()
    return text === '' ? undefined : text
  }
  return items
}

const readMessagesArtifact = async (
  filePath: string,
  nativeSessionId: string,
  createdAt: number
): Promise<ClineHistoryMessage[]> => {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  if (!isRecord(parsed)) {
    throw new Error('Malformed Cline messages artifact')
  }
  const origin = isRecord(parsed.origin) ? parsed.origin : undefined
  if (
    parsed.version !== CLINE_HISTORY_ARTIFACT_VERSION ||
    origin?.source !== 'cli' ||
    origin.mode !== 'user' ||
    origin.version !== CLINE_HISTORY_CLI_VERSION ||
    parsed.agent !== 'lead' ||
    typeof parsed.system_prompt !== 'string' ||
    asString(parsed.updated_at) == null ||
    !Number.isFinite(Date.parse(String(parsed.updated_at))) ||
    !Array.isArray(parsed.messages) ||
    parsed.messages.length === 0
  ) {
    throw new Error('Unsupported Cline 3.0.54 messages artifact schema')
  }
  const artifactSessionId = asString(parsed.sessionId)
  if (artifactSessionId !== nativeSessionId) {
    throw new Error('Cline messages artifact session id mismatch')
  }
  if (asString(origin.sessionId) !== nativeSessionId) {
    throw new Error('Cline messages artifact origin session id mismatch')
  }
  if (
    parsed.messages.some(message => (
      !isRecord(message) ||
      asString(message.id) == null ||
      (message.role !== 'assistant' && message.role !== 'system' && message.role !== 'user') ||
      (typeof message.content !== 'string' && !Array.isArray(message.content)) ||
      (Array.isArray(message.content) && !message.content.every(isRecord)) ||
      (
        typeof message.ts === 'number'
          ? !Number.isFinite(message.ts) || message.ts <= 0
          : !Number.isFinite(Date.parse(asString(message.ts) ?? ''))
      )
    ))
  ) {
    throw new Error('Malformed Cline 3.0.54 message entry')
  }

  const seenMessageIds = new Set<string>()
  const retainedRawMessages: Array<Record<string, unknown>> = []
  for (const message of parsed.messages) {
    if (!isRecord(message)) continue
    const id = asString(message.id)
    if (id == null || seenMessageIds.has(id)) continue
    seenMessageIds.add(id)
    retainedRawMessages.push(message)
  }
  const toolUseCounts = collectToolUseCounts(retainedRawMessages)
  const priorToolUseIds = new Set<string>()
  const retainedToolResultIds = new Set<string>()
  const messages: ClineHistoryMessage[] = []
  for (let index = 0; index < retainedRawMessages.length; index += 1) {
    const message = retainedRawMessages[index]!
    const role = message.role
    if (role !== 'assistant' && role !== 'system' && role !== 'user') continue
    const id = asString(message.id)
    if (id == null) continue
    const content = normalizeContent(
      message.content,
      toolUseCounts,
      priorToolUseIds,
      retainedToolResultIds
    )
    if (content == null) continue
    messages.push({
      content,
      id,
      role,
      ts: asTimestamp(message.ts, createdAt + index)
    })
  }
  return messages
}

const readClineDatabase = async (
  configuredRoot: string,
  databasePath: string,
  options: ReadClineHistoryOptions,
  selectedSourcePaths: Set<string> | undefined
) => {
  const dataRoot = resolveDatabaseDataRoot(configuredRoot, databasePath)
  const sourceRoot = realpathSync.native(path.resolve(dataRoot))
  const rows = readSessionRows(
    databasePath,
    dataRoot,
    options.maxDatabaseBytes ?? CLINE_HISTORY_DATABASE_MAX_BYTES
  )
  const sessions: ClineHistorySession[] = []
  for (const row of rows) {
    try {
      const nativeSessionId = asString(row.session_id)
      const cwd = asString(row.cwd)
      const rawMessagesPath = asString(row.messages_path)
      if (nativeSessionId == null || cwd == null || rawMessagesPath == null) continue
      const messagesFile = assertContainedRegularFile(
        dataRoot,
        resolveMessagesPath(dataRoot, rawMessagesPath),
        options.maxMessagesBytes ?? CLINE_HISTORY_MESSAGES_MAX_BYTES
      )
      if (selectedSourcePaths != null && !selectedSourcePaths.has(messagesFile.filePath)) continue
      const createdAt = asTimestamp(row.started_at, messagesFile.stats.birthtimeMs || messagesFile.stats.mtimeMs)
      const messages = options.readMessages
        ? await readMessagesArtifact(messagesFile.filePath, nativeSessionId, createdAt)
        : undefined
      if (options.readMessages && messages?.length === 0) continue
      const firstUserContent = messages?.find(message => message.role === 'user')?.content
      const title = typeof firstUserContent === 'string'
        ? firstUserContent
        : asString(firstUserContent?.find(item => item.type === 'text')?.text)
      sessions.push({
        createdAt,
        cwd,
        fileSizeBytes: messagesFile.stats.size,
        isSubagent: row.is_subagent === 1 || asString(row.parent_session_id) != null,
        ...(messages == null ? {} : { messages }),
        ...(asString(row.model) == null ? {} : { model: asString(row.model) }),
        nativeSessionId,
        ...(asString(row.parent_session_id) == null
          ? {}
          : { parentNativeSessionId: asString(row.parent_session_id) }),
        sourcePath: messagesFile.filePath,
        sourceRoot,
        ...(title == null ? {} : { title }),
        updatedAt: asTimestamp(row.updated_at, messagesFile.stats.mtimeMs || createdAt),
        workspaceRoot: asString(row.workspace_root) ?? cwd
      })
    } catch (error) {
      // One malformed or unsafe artifact must not expose partial content from that session.
      options.onDiagnostic?.(error instanceof Error ? error.message : 'Cline history session was rejected')
    }
  }
  return sessions
}

export async function readClineHistory(options: ReadClineHistoryOptions): Promise<ClineHistorySession[]> {
  const selectedSourcePaths = options.sourcePaths == null
    ? undefined
    : new Set(options.sourcePaths.map((sourcePath) => {
      try {
        return realpathSync.native(path.resolve(sourcePath))
      } catch {
        return path.resolve(sourcePath)
      }
    }))
  const databaseCandidates = Array.from(
    new Set(
      options.dataRoots.flatMap(resolveDatabaseCandidates).filter(existsSync)
    )
  )
  const sessions: ClineHistorySession[] = []
  const seen = new Set<string>()
  for (const databasePath of databaseCandidates) {
    const configuredRoot = options.dataRoots.find(root => resolveDatabaseCandidates(root).includes(databasePath))
    if (configuredRoot == null) continue
    try {
      const candidates = await readClineDatabase(configuredRoot, databasePath, options, selectedSourcePaths)
      for (const candidate of candidates) {
        const key = `${candidate.sourceRoot}\0${candidate.nativeSessionId}\0${candidate.sourcePath}`
        if (seen.has(key)) continue
        seen.add(key)
        sessions.push(candidate)
      }
    } catch (error) {
      // Locked, corrupt, mutable, oversized, or schema-drifted databases fail closed.
      options.onDiagnostic?.(error instanceof Error ? error.message : 'Cline history database was rejected')
    }
  }
  const rootsByNativeId = new Map<string, Set<string>>()
  for (const session of sessions) {
    const roots = rootsByNativeId.get(session.nativeSessionId) ?? new Set<string>()
    roots.add(session.sourceRoot)
    rootsByNativeId.set(session.nativeSessionId, roots)
  }
  const ambiguousIds = new Set(
    [...rootsByNativeId].filter(([, roots]) => roots.size > 1).map(([nativeSessionId]) => nativeSessionId)
  )
  for (const nativeSessionId of ambiguousIds) {
    options.onDiagnostic?.(`Ambiguous Cline native session id across data roots: ${nativeSessionId}`)
  }
  return sessions.filter(session => !ambiguousIds.has(session.nativeSessionId))
}
