/* eslint-disable max-lines -- native history import needs parser compatibility in one place. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite'

import type { RuntimeContentItem } from '@oneworks/runtime-protocol'
import {
  DEFAULT_RUNTIME_PROTOCOL_VERSION,
  DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  FileRuntimeStore,
  appendJsonlLine
} from '@oneworks/runtime-store'
import type { RuntimeEvent, RuntimeEventDraft, RuntimeMeta, RuntimeState } from '@oneworks/runtime-store'
import type { Config } from '@oneworks/types'
import { resolveProjectHomePath, resolveProjectWorkspaceFolder } from '@oneworks/utils/ai-path'
import {
  resolveProjectPrimaryWorkspaceFolder,
  resolveProjectSharedWorkspaceFolder
} from '@oneworks/utils/project-cache-path'

import { getDb } from '#~/db/index.js'
import { logger } from '#~/utils/logger.js'

import { discoverRuntimeSessionStores } from './discovery.js'
import { getRuntimeStoreWatcher, replayRuntimeStore, watchRuntimeStoreRoot } from './watcher.js'
import { createWorkspaceRuntimeEnv, resolveWorkspaceRuntimeStoreRoot } from './workspace-env.js'

const require = createRequire(__filename)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

export type NativeHistoryAdapter = 'codex' | 'claude-code'
export type NativeHistoryCandidateScope = 'all' | 'unarchived' | 'archived'
export type NativeHistoryProjectScope = 'current-project' | 'all-projects'
export type NativeHistoryThreadScope = 'all' | 'user' | 'subagent'
export type NativeHistoryTimeSort = 'activity' | 'createdAt' | 'updatedAt'

export interface NativeHistoryTimeRange {
  from?: number
  to?: number
}

export interface NativeHistoryTimeFilter {
  createdAt?: NativeHistoryTimeRange
  updatedAt?: NativeHistoryTimeRange
}

export interface NativeHistoryImportOptions {
  adapters?: NativeHistoryAdapter[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
  maxFileSizeBytes?: number
  maxFileSizeBytesByAdapter?: Partial<Record<NativeHistoryAdapter, number | null>>
  candidateScope?: NativeHistoryCandidateScope
  threadScope?: NativeHistoryThreadScope
  previewCursor?: string
  previewLimit?: number
  projectScope?: NativeHistoryProjectScope
  sourceDirs?: Partial<Record<NativeHistoryAdapter, string[]>>
  sourcePaths?: string[]
  timeFilter?: NativeHistoryTimeFilter
  timeSort?: NativeHistoryTimeSort
}

export interface NativeHistoryImportSessionResult {
  adapter: NativeHistoryAdapter
  createdAt: number
  importedEvents: number
  sessionId: string
  sourcePath: string
  title: string
  updatedAt: number
}

export interface NativeHistoryImportResult {
  importedEvents: number
  importedSessions: number
  matchedFiles: number
  scannedFiles: number
  sessions: NativeHistoryImportSessionResult[]
}

export interface NativeHistoryImportPreviewCandidate {
  adapter: NativeHistoryAdapter
  createdAt: number
  cwd: string
  fileSizeBytes: number
  importedSessionId?: string
  isArchived: boolean
  isImported: boolean
  isLarge: boolean
  isPinned: boolean
  nativeSessionId: string
  sourcePath: string
  threadSource?: string
  title: string
  updatedAt: number
}

export interface NativeHistoryImportAdapterPreview {
  adapter: NativeHistoryAdapter
  candidates: NativeHistoryImportPreviewCandidate[]
  hasMore: boolean
  isComplete: boolean
  largeFiles: number
  largestFileBytes: number
  matchedFiles: number
  nextCursor?: string
  scannedFiles: number
  totalBytes: number
}

export interface NativeHistoryImportPreviewResult {
  adapters: NativeHistoryImportAdapterPreview[]
  hasMore: boolean
  isComplete: boolean
  largeFileThresholdBytes: number
  largeFiles: number
  largestFileBytes: number
  matchedFiles: number
  nextCursor?: string
  scannedFiles: number
  totalBytes: number
}

interface JsonlRecord {
  line: number
  value: unknown
}

interface NativeHistoryMessage {
  content: string | RuntimeContentItem[]
  id: string
  role: 'assistant' | 'system' | 'user'
  ts: number
}

interface NativeHistoryConversation {
  adapter: NativeHistoryAdapter
  createdAt: number
  cwd: string
  messages: NativeHistoryMessage[]
  model?: string
  nativeSessionId: string
  sourcePath: string
  title?: string
  titleIsAuthoritative?: boolean
  updatedAt: number
}

interface GitProjectIdentity {
  commonGitDir?: string
  remoteUrl?: string
}

interface ProjectMatchContext {
  gitIdentities: GitProjectIdentity[]
  roots: string[]
}

interface CodexThreadMetadata {
  createdAt?: number
  cwd?: string
  gitOriginUrl?: string
  isArchived?: boolean
  isListed?: boolean
  isPinned?: boolean
  nativeSessionId: string
  sourcePath?: string
  spawnStatus?: string
  threadSource?: string
  title?: string
  updatedAt?: number
}

interface CodexThreadMetadataIndex {
  byNativeSessionId: Map<string, CodexThreadMetadata>
  bySourcePath: Map<string, CodexThreadMetadata>
  pinnedThreadIds: Set<string>
}

interface CodexSpawnEdge {
  parentThreadId: string
  status: string
}

interface NativeHistorySourceFile {
  codexThreadMetadata?: CodexThreadMetadata
  createdAt: number
  filePath: string
  isArchived: boolean
  isPinned: boolean
  stat: Stats
  updatedAt: number
}

interface NativeHistoryPreviewCursor {
  offsets: Partial<Record<NativeHistoryAdapter, number>>
}

const HISTORY_IMPORT_SOURCE = 'native-history-import'
const HISTORY_IMPORT_MARKER_SEGMENTS = ['caches', 'native-history-import'] as const
const LARGE_NATIVE_HISTORY_FILE_BYTES = 25 * 1024 * 1024
export const DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
const MAX_NATIVE_HISTORY_PREVIEW_LIMIT = 100
const MAX_HISTORY_WALK_DEPTH = 8
const IMPORT_SESSION_PREFIX = 'imported_'
const TITLE_MAX_LENGTH = 80
let defaultNativeHistoryImportInFlight: Promise<NativeHistoryImportResult> | undefined
let defaultFirstOpenImportInFlight: Promise<NativeHistoryImportResult> | undefined
let pendingFirstOpenPromptResult: NativeHistoryImportResult | undefined
const nativeHistoryImportRuntimeRoots = Symbol('nativeHistoryImportRuntimeRoots')

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const asStringArray = (value: unknown) => (
  Array.isArray(value)
    ? value.map(asString).filter((item): item is string => item != null)
    : []
)

const unique = <T>(values: T[]) => Array.from(new Set(values))

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

const stableHash = (value: string) => createHash('sha1').update(value).digest('hex')

const stableId = (prefix: string, ...parts: string[]) => `${prefix}_${stableHash(parts.join('\0')).slice(0, 20)}`

const parseJson = (value: string) => {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

const normalizeRealPath = (value: string) => {
  const resolved = path.resolve(value)
  try {
    return realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

const findExistingPath = (value: string) => {
  let current = path.resolve(value)
  while (!existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
  return current
}

const isDirectory = (value: string) => {
  try {
    return statSync(value).isDirectory()
  } catch {
    return false
  }
}

const findGitMetadataDir = (startPath: string): string | undefined => {
  const existingPath = findExistingPath(startPath)
  if (existingPath == null) {
    return undefined
  }

  let current = isDirectory(existingPath) ? existingPath : path.dirname(existingPath)
  while (true) {
    const dotGitPath = path.join(current, '.git')
    if (isDirectory(dotGitPath)) {
      return dotGitPath
    }
    if (existsSync(dotGitPath)) {
      try {
        const content = readFileSync(dotGitPath, 'utf8').trim()
        const prefix = 'gitdir:'
        if (content.toLowerCase().startsWith(prefix)) {
          const gitDir = content.slice(prefix.length).trim()
          if (gitDir !== '') {
            return path.resolve(current, gitDir)
          }
        }
      } catch {}
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}

const resolveGitCommonDir = (gitDir: string) => {
  try {
    const commonDir = readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()
    if (commonDir !== '') {
      return normalizeRealPath(path.resolve(gitDir, commonDir))
    }
  } catch {}
  return normalizeRealPath(gitDir)
}

const normalizeRemoteUrl = (value: string) => {
  let next = value.trim()
  if (next === '') {
    return undefined
  }
  next = next.replace(/^git@([^:]+):(.+)$/u, 'https://$1/$2')
  next = next.replace(/\.git$/u, '')
  next = next.replace(/\/+$/u, '')
  return next.toLowerCase()
}

const readOriginRemoteUrl = (commonGitDir: string) => {
  try {
    const config = readFileSync(path.join(commonGitDir, 'config'), 'utf8')
    for (const line of config.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('url')) {
        continue
      }
      const separatorIndex = trimmed.indexOf('=')
      if (separatorIndex < 0) {
        continue
      }
      return normalizeRemoteUrl(trimmed.slice(separatorIndex + 1))
    }
    return undefined
  } catch {
    return undefined
  }
}

const createEmptyCodexThreadMetadataIndex = (
  pinnedThreadIds = new Set<string>()
): CodexThreadMetadataIndex => ({
  byNativeSessionId: new Map(),
  bySourcePath: new Map(),
  pinnedThreadIds
})

const applyCodexSessionIndexThreadNames = (
  index: CodexThreadMetadataIndex,
  threadNames: Map<string, string>
) => {
  for (const [nativeSessionId, title] of threadNames) {
    const existing = index.byNativeSessionId.get(nativeSessionId)
    if (existing != null) {
      existing.isListed = true
      existing.title = title
      continue
    }
    index.byNativeSessionId.set(nativeSessionId, {
      isListed: true,
      isPinned: index.pinnedThreadIds.has(nativeSessionId),
      nativeSessionId,
      title
    })
  }
  return index
}

const resolveCodexStateDatabasePaths = (homeDir: string) =>
  unique([
    path.join(homeDir, '.codex', 'state_5.sqlite'),
    path.join(homeDir, '.codex', 'sqlite', 'state_5.sqlite')
  ])

const resolveCodexSessionIndexPaths = (homeDir: string) =>
  unique([
    path.join(homeDir, '.codex', 'session_index.jsonl')
  ])

const resolveCodexGlobalStatePaths = (homeDir: string) =>
  unique([
    path.join(homeDir, '.codex', '.codex-global-state.json')
  ])

const readCodexSessionIndexThreadNames = (homeDir: string) => {
  const threadNames = new Map<string, string>()
  const indexPath = resolveCodexSessionIndexPaths(homeDir).find(filePath => existsSync(filePath))
  if (indexPath == null) {
    return threadNames
  }

  try {
    for (const line of readFileSync(indexPath, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') {
        continue
      }
      const record = parseJson(trimmed)
      if (!isRecord(record)) {
        continue
      }
      const nativeSessionId = asString(record.id)
      const threadName = asString(record.thread_name) ?? asString(record.threadName)
      if (nativeSessionId != null && threadName != null) {
        threadNames.set(nativeSessionId, threadName)
      }
    }
  } catch (error) {
    logger.warn({ error, indexPath }, '[runtime-store] Failed to read Codex session index')
  }
  return threadNames
}

const readCodexPinnedThreadIds = (homeDir: string) => {
  const statePath = resolveCodexGlobalStatePaths(homeDir).find(filePath => existsSync(filePath))
  if (statePath == null) {
    return new Set<string>()
  }

  try {
    const state = parseJson(readFileSync(statePath, 'utf8'))
    if (!isRecord(state)) {
      return new Set<string>()
    }
    const persistedState = isRecord(state['electron-persisted-atom-state'])
      ? state['electron-persisted-atom-state']
      : undefined
    return new Set(unique([
      ...asStringArray(state['pinned-thread-ids']),
      ...asStringArray(state.pinnedThreadIds),
      ...asStringArray(persistedState?.['pinned-thread-ids']),
      ...asStringArray(persistedState?.pinnedThreadIds)
    ]))
  } catch (error) {
    logger.warn({ error, statePath }, '[runtime-store] Failed to read Codex pinned thread ids')
    return new Set<string>()
  }
}

const readCodexThreadTimestamp = (primaryMs: unknown, fallbackSeconds: unknown) => {
  const value = typeof primaryMs === 'number' && Number.isFinite(primaryMs) && primaryMs > 0
    ? primaryMs
    : typeof fallbackSeconds === 'number' && Number.isFinite(fallbackSeconds) && fallbackSeconds > 0
    ? fallbackSeconds
    : undefined
  if (value == null) {
    return undefined
  }
  return value < 10_000_000_000 ? value * 1000 : value
}

const readCodexThreadMetadataColumns = (database: NodeDatabaseSync) =>
  new Set(
    (database.prepare('PRAGMA table_info(threads)').all() as Array<Record<string, unknown>>)
      .map(row => asString(row.name))
      .filter((value): value is string => value != null)
  )

const readCodexTableNames = (database: NodeDatabaseSync) =>
  new Set(
    (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<Record<string, unknown>>)
      .map(row => asString(row.name))
      .filter((value): value is string => value != null)
  )

const readCodexSpawnEdges = (database: NodeDatabaseSync, tableNames: Set<string>) => {
  const edges = new Map<string, CodexSpawnEdge>()
  if (!tableNames.has('thread_spawn_edges')) {
    return edges
  }

  const rows = database.prepare(`
    SELECT parent_thread_id, child_thread_id, status
    FROM thread_spawn_edges
  `).all() as Array<Record<string, unknown>>
  for (const row of rows) {
    const parentThreadId = asString(row.parent_thread_id)
    const childThreadId = asString(row.child_thread_id)
    const status = asString(row.status)
    if (parentThreadId != null && childThreadId != null && status != null) {
      edges.set(childThreadId, {
        parentThreadId,
        status
      })
    }
  }
  return edges
}

const buildCodexThreadMetadataSelect = (columns: Set<string>) => {
  const selectColumn = (name: string) => columns.has(name) ? name : `NULL AS ${name}`
  return [
    selectColumn('id'),
    selectColumn('rollout_path'),
    selectColumn('cwd'),
    selectColumn('title'),
    selectColumn('archived'),
    selectColumn('git_origin_url'),
    selectColumn('created_at'),
    selectColumn('updated_at'),
    selectColumn('created_at_ms'),
    selectColumn('updated_at_ms'),
    selectColumn('thread_source')
  ].join(', ')
}

const readCodexSubagentNotificationTexts = (record: Record<string, unknown>) => {
  const payload = isRecord(record.payload) ? record.payload : undefined
  const content = Array.isArray(payload?.content) ? payload.content : []
  return content.flatMap((item) => {
    if (!isRecord(item) || typeof item.text !== 'string') {
      return []
    }
    return [item.text]
  })
}

const CODEX_SUBAGENT_NOTIFICATION_OPEN_TAG = '<subagent_notification>'
const CODEX_SUBAGENT_NOTIFICATION_CLOSE_TAG = '</subagent_notification>'

const readCodexSubagentNotificationPayloads = (text: string) => {
  const payloads: string[] = []
  let offset = 0
  while (offset < text.length) {
    const openIndex = text.indexOf(CODEX_SUBAGENT_NOTIFICATION_OPEN_TAG, offset)
    if (openIndex < 0) {
      break
    }
    const payloadStartIndex = openIndex + CODEX_SUBAGENT_NOTIFICATION_OPEN_TAG.length
    const closeIndex = text.indexOf(CODEX_SUBAGENT_NOTIFICATION_CLOSE_TAG, payloadStartIndex)
    if (closeIndex < 0) {
      break
    }
    const payload = text.slice(payloadStartIndex, closeIndex).trim()
    if (payload !== '') {
      payloads.push(payload)
    }
    offset = closeIndex + CODEX_SUBAGENT_NOTIFICATION_CLOSE_TAG.length
  }
  return payloads
}

const readCodexSubagentNotificationCompletedChildId = (
  notification: Record<string, unknown>,
  childThreadIds: Set<string>
) => {
  const agentPath = asString(notification.agent_path) ?? asString(notification.agentPath)
  const status = notification.status
  const isCompleted = asString(status) === 'completed' ||
    (isRecord(status) && hasOwn(status, 'completed') && status.completed != null)
  if (agentPath == null || !isCompleted) {
    return undefined
  }

  const candidateIds = unique([
    agentPath,
    path.basename(agentPath),
    path.basename(agentPath, '.jsonl')
  ])
  return candidateIds.find(candidateId => childThreadIds.has(candidateId))
}

const readCodexCompletedSubagentNotificationIdsFromRollout = async (
  filePath: string,
  childThreadIds: Set<string>
) => {
  const completedChildThreadIds = new Set<string>()
  const lines = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(filePath, { encoding: 'utf8' })
  })

  try {
    for await (const line of lines) {
      if (!line.includes('<subagent_notification>')) {
        continue
      }

      let record: unknown
      try {
        record = JSON.parse(line) as unknown
      } catch {
        continue
      }
      if (!isRecord(record)) {
        continue
      }

      for (const text of readCodexSubagentNotificationTexts(record)) {
        for (const payload of readCodexSubagentNotificationPayloads(text)) {
          const notification = parseJson(payload)
          if (!isRecord(notification)) {
            continue
          }
          const completedChildThreadId = readCodexSubagentNotificationCompletedChildId(notification, childThreadIds)
          if (completedChildThreadId != null) {
            completedChildThreadIds.add(completedChildThreadId)
            if (completedChildThreadIds.size >= childThreadIds.size) {
              lines.close()
              return completedChildThreadIds
            }
          }
        }
      }
    }
  } finally {
    lines.close()
  }

  return completedChildThreadIds
}

const readCodexCompletedSubagentNotificationIds = async (
  spawnEdges: Map<string, CodexSpawnEdge>,
  threadRolloutPaths: Map<string, string>
) => {
  const childThreadIdsByParent = new Map<string, Set<string>>()
  for (const [childThreadId, edge] of spawnEdges) {
    if (edge.status === 'closed') {
      continue
    }
    const childThreadIds = childThreadIdsByParent.get(edge.parentThreadId) ?? new Set<string>()
    childThreadIds.add(childThreadId)
    childThreadIdsByParent.set(edge.parentThreadId, childThreadIds)
  }

  const completedChildThreadIds = new Set<string>()
  for (const [parentThreadId, childThreadIds] of childThreadIdsByParent) {
    const rolloutPath = threadRolloutPaths.get(parentThreadId)
    if (rolloutPath == null || !existsSync(rolloutPath)) {
      continue
    }
    try {
      const completedIds = await readCodexCompletedSubagentNotificationIdsFromRollout(rolloutPath, childThreadIds)
      for (const completedId of completedIds) {
        completedChildThreadIds.add(completedId)
      }
    } catch (error) {
      logger.warn({ error, rolloutPath }, '[runtime-store] Failed to read Codex subagent notifications')
    }
  }

  return completedChildThreadIds
}

const readCodexThreadMetadataIndex = async (homeDir: string): Promise<CodexThreadMetadataIndex> => {
  const pinnedThreadIds = readCodexPinnedThreadIds(homeDir)
  const sessionIndexThreadNames = readCodexSessionIndexThreadNames(homeDir)
  const databasePath = resolveCodexStateDatabasePaths(homeDir).find(filePath => existsSync(filePath))
  if (databasePath == null) {
    return applyCodexSessionIndexThreadNames(
      createEmptyCodexThreadMetadataIndex(pinnedThreadIds),
      sessionIndexThreadNames
    )
  }

  let database: NodeDatabaseSync | undefined
  try {
    database = new DatabaseSync(databasePath, { readOnly: true })
    const columns = readCodexThreadMetadataColumns(database)
    if (!columns.has('id') || !columns.has('rollout_path')) {
      return applyCodexSessionIndexThreadNames(
        createEmptyCodexThreadMetadataIndex(pinnedThreadIds),
        sessionIndexThreadNames
      )
    }
    const spawnEdges = readCodexSpawnEdges(database, readCodexTableNames(database))

    const index = createEmptyCodexThreadMetadataIndex(pinnedThreadIds)
    const rows = database.prepare(`
      SELECT ${buildCodexThreadMetadataSelect(columns)}
      FROM threads
    `).all() as Array<Record<string, unknown>>
    const threadRolloutPaths = new Map<string, string>()
    for (const row of rows) {
      const nativeSessionId = asString(row.id)
      const sourcePath = asString(row.rollout_path)
      if (nativeSessionId != null && sourcePath != null) {
        threadRolloutPaths.set(nativeSessionId, sourcePath)
      }
    }
    const completedSubagentThreadIds = await readCodexCompletedSubagentNotificationIds(spawnEdges, threadRolloutPaths)

    for (const row of rows) {
      const nativeSessionId = asString(row.id)
      if (nativeSessionId == null) {
        continue
      }
      const sourcePath = asString(row.rollout_path)
      const gitOriginUrl = asString(row.git_origin_url)
      const spawnStatus = spawnEdges.get(nativeSessionId)?.status
      const threadSource = asString(row.thread_source)
      const isArchived = typeof row.archived === 'number' ? row.archived !== 0 : undefined
      const isCompletedSubagent = completedSubagentThreadIds.has(nativeSessionId)
      const metadata: CodexThreadMetadata = {
        createdAt: readCodexThreadTimestamp(row.created_at_ms, row.created_at),
        cwd: asString(row.cwd),
        gitOriginUrl: gitOriginUrl == null ? undefined : normalizeRemoteUrl(gitOriginUrl),
        isArchived: isArchived === true || spawnStatus === 'closed' || isCompletedSubagent ? true : isArchived,
        isListed: sessionIndexThreadNames.has(nativeSessionId),
        isPinned: pinnedThreadIds.has(nativeSessionId),
        nativeSessionId,
        sourcePath,
        spawnStatus,
        threadSource,
        title: sessionIndexThreadNames.get(nativeSessionId) ?? asString(row.title),
        updatedAt: readCodexThreadTimestamp(row.updated_at_ms, row.updated_at)
      }

      index.byNativeSessionId.set(nativeSessionId, metadata)
      if (sourcePath != null) {
        index.bySourcePath.set(normalizeRealPath(sourcePath), metadata)
      }
    }

    return applyCodexSessionIndexThreadNames(index, sessionIndexThreadNames)
  } catch (error) {
    logger.warn({ databasePath, error }, '[runtime-store] Failed to read Codex thread metadata')
    return applyCodexSessionIndexThreadNames(
      createEmptyCodexThreadMetadataIndex(pinnedThreadIds),
      sessionIndexThreadNames
    )
  } finally {
    if (database?.isOpen === true) {
      database.close()
    }
  }
}

const getCodexThreadMetadata = (
  index: CodexThreadMetadataIndex | undefined,
  filePath: string,
  nativeSessionId?: string
) =>
  index?.bySourcePath.get(normalizeRealPath(filePath)) ??
    (nativeSessionId == null ? undefined : index?.byNativeSessionId.get(nativeSessionId))

const getVisibleCodexThreadSource = (metadata: CodexThreadMetadata | undefined) => (
  metadata?.isListed === true ? undefined : metadata?.threadSource
)

const resolveGitProjectIdentity = (startPath: string): GitProjectIdentity | undefined => {
  const gitDir = findGitMetadataDir(startPath)
  if (gitDir == null) {
    return undefined
  }

  const commonGitDir = resolveGitCommonDir(gitDir)
  return {
    commonGitDir,
    remoteUrl: readOriginRemoteUrl(commonGitDir)
  }
}

const isPathInside = (parentPath: string, targetPath: string) => {
  const relativePath = path.relative(normalizeRealPath(parentPath), normalizeRealPath(targetPath))
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

const isArchivedNativeHistoryFile = (
  adapter: NativeHistoryAdapter,
  homeDir: string,
  filePath: string
) => adapter === 'codex' && isPathInside(path.join(homeDir, '.codex', 'archived_sessions'), filePath)

const getEventTime = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const getFirstText = (content: string | RuntimeContentItem[]) => {
  if (typeof content === 'string') {
    return content.trim()
  }
  for (const item of content) {
    if (item.type === 'text' && typeof item.text === 'string' && item.text.trim() !== '') {
      return item.text.trim()
    }
  }
  return undefined
}

const buildTitle = (conversation: NativeHistoryConversation) => {
  const title = (conversation.titleIsAuthoritative === true ? conversation.title?.trim() : undefined) ??
    conversation.messages.find(message => message.role === 'user' && getFirstText(message.content) != null)?.content ??
    conversation.title?.trim()
  const text = typeof title === 'string' ? title : title == null ? undefined : getFirstText(title)
  const normalized = text?.replace(/\s+/g, ' ').trim()
  if (normalized == null || normalized === '') {
    return `${conversation.adapter} history`
  }
  return normalized.length > TITLE_MAX_LENGTH ? `${normalized.slice(0, TITLE_MAX_LENGTH - 1)}...` : normalized
}

const readJsonlRecords = async (
  filePath: string,
  adapter: NativeHistoryAdapter
): Promise<JsonlRecord[]> => {
  const records: JsonlRecord[] = []
  const lines = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(filePath, { encoding: 'utf8' })
  })
  let index = 0

  for await (const line of lines) {
    index += 1
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    if (adapter === 'codex' && trimmed.includes('function_call_output')) {
      continue
    }
    try {
      records.push({ line: index, value: JSON.parse(trimmed) as unknown })
    } catch {
      continue
    }
  }

  return records
}

const walkJsonlFiles = async (root: string, maxDepth = MAX_HISTORY_WALK_DEPTH) => {
  const files: string[] = []
  const visit = async (dir: string, depth: number) => {
    if (depth > maxDepth) {
      return
    }
    let entries: Dirent<string>[]
    try {
      entries = await readdir(dir, { encoding: 'utf8', withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      throw error
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath, depth + 1)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(entryPath)
      }
    }
  }

  await visit(root, 0)
  return files
}

const resolveSourceDirs = (
  adapter: NativeHistoryAdapter,
  homeDir: string,
  sourceDirs?: Partial<Record<NativeHistoryAdapter, string[]>>
) => {
  const explicit = sourceDirs?.[adapter]
  if (explicit != null) {
    return explicit.map(dir => path.resolve(dir))
  }

  if (adapter === 'codex') {
    return [
      path.join(homeDir, '.codex', 'archived_sessions'),
      path.join(homeDir, '.codex', 'sessions')
    ]
  }

  return [
    path.join(homeDir, '.claude', 'projects')
  ]
}

const resolveProjectMatchContext = (cwd: string, env: NodeJS.ProcessEnv): ProjectMatchContext => {
  const workspaceFolder = resolveProjectWorkspaceFolder(cwd, env)
  const runtimeEnv = createWorkspaceRuntimeEnv(workspaceFolder, env)
  const primaryWorkspaceFolder = resolveProjectPrimaryWorkspaceFolder(workspaceFolder, runtimeEnv)
  const roots = unique(
    [
      cwd,
      workspaceFolder,
      primaryWorkspaceFolder,
      runtimeEnv.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
    ].filter((value): value is string => value != null && value.trim() !== '')
      .map(normalizeRealPath)
  )

  return {
    roots,
    gitIdentities: roots
      .map(resolveGitProjectIdentity)
      .filter((value): value is GitProjectIdentity => value != null)
  }
}

const gitIdentitiesMatch = (left: GitProjectIdentity, right: GitProjectIdentity) => {
  if (left.commonGitDir != null && right.commonGitDir != null && left.commonGitDir === right.commonGitDir) {
    return true
  }
  if (left.remoteUrl != null && right.remoteUrl != null && left.remoteUrl === right.remoteUrl) {
    return true
  }
  return false
}

const gitOriginMatchesProject = (
  gitOriginUrl: string | undefined,
  projectContext: ProjectMatchContext
) => {
  const normalizedGitOriginUrl = gitOriginUrl == null ? undefined : normalizeRemoteUrl(gitOriginUrl)
  return normalizedGitOriginUrl != null &&
    projectContext.gitIdentities.some(identity => identity.remoteUrl === normalizedGitOriginUrl)
}

const isProjectConversation = (
  conversationCwd: string | undefined,
  projectContext: ProjectMatchContext,
  gitOriginUrl?: string
) => {
  if (conversationCwd != null) {
    const normalizedCwd = normalizeRealPath(conversationCwd)
    if (projectContext.roots.some(root => isPathInside(root, normalizedCwd))) {
      return true
    }

    const conversationGitIdentity = resolveGitProjectIdentity(normalizedCwd)
    if (
      conversationGitIdentity != null &&
      projectContext.gitIdentities.some(identity => gitIdentitiesMatch(identity, conversationGitIdentity))
    ) {
      return true
    }
  }

  if (gitOriginMatchesProject(gitOriginUrl, projectContext)) {
    return true
  }

  return false
}

const resolveNativeHistoryProjectScope = (
  options: NativeHistoryImportOptions
): NativeHistoryProjectScope => options.projectScope ?? 'current-project'

const isConversationInProjectScope = (
  conversationCwd: string | undefined,
  projectContext: ProjectMatchContext,
  projectScope: NativeHistoryProjectScope,
  gitOriginUrl?: string
) => {
  if (projectScope === 'all-projects') {
    return conversationCwd != null
  }
  return isProjectConversation(conversationCwd, projectContext, gitOriginUrl)
}

const resolveConversationWorkspaceCwd = (
  conversationCwd: string,
  fallbackCwd: string,
  env: NodeJS.ProcessEnv,
  projectScope: NativeHistoryProjectScope
) => {
  if (projectScope !== 'all-projects') {
    return fallbackCwd
  }
  const conversationEnv = createWorkspaceRuntimeEnv(conversationCwd, env)
  return resolveProjectSharedWorkspaceFolder(conversationCwd, conversationEnv)
}

const resolveNativeHistoryImportTarget = (
  conversationCwd: string,
  fallbackCwd: string,
  env: NodeJS.ProcessEnv,
  projectScope: NativeHistoryProjectScope
) => {
  const workspaceCwd = resolveConversationWorkspaceCwd(conversationCwd, fallbackCwd, env, projectScope)
  const runtimeEnv = createWorkspaceRuntimeEnv(workspaceCwd, env)
  return {
    runtimeRoot: resolveWorkspaceRuntimeStoreRoot(workspaceCwd, runtimeEnv),
    workspaceCwd
  }
}

const readContentText = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value.trim() === '' ? undefined : value
  }
  if (!Array.isArray(value)) {
    return undefined
  }
  const text = value
    .flatMap((item) => {
      if (!isRecord(item)) {
        return []
      }
      const part = asString(item.text) ?? asString(item.content)
      return part == null ? [] : [part]
    })
    .join('\n')
    .trim()
  return text === '' ? undefined : text
}

const readCodexMessageText = (payload: Record<string, unknown>) => readContentText(payload.content)

const buildPreviewTitle = (adapter: NativeHistoryAdapter, title: string | undefined) => {
  const normalized = title?.replace(/\s+/g, ' ').trim()
  if (normalized == null || normalized === '') {
    return `${adapter} history`
  }
  return normalized.length > TITLE_MAX_LENGTH ? `${normalized.slice(0, TITLE_MAX_LENGTH - 1)}...` : normalized
}

const readConversationPreview = async (
  adapter: NativeHistoryAdapter,
  filePath: string,
  isArchived: boolean,
  codexThreadMetadata?: CodexThreadMetadata,
  fileStat?: Stats,
  codexThreadMetadataIndex?: CodexThreadMetadataIndex
): Promise<NativeHistoryImportPreviewCandidate | undefined> => {
  const stat = fileStat ?? statSync(filePath)

  if (adapter === 'codex' && codexThreadMetadata?.cwd != null) {
    const createdAt = codexThreadMetadata.createdAt ?? stat.birthtimeMs ?? stat.mtimeMs
    return {
      adapter,
      createdAt,
      cwd: codexThreadMetadata.cwd,
      fileSizeBytes: stat.size,
      isArchived: codexThreadMetadata.isArchived ?? isArchived,
      isImported: false,
      isLarge: stat.size >= LARGE_NATIVE_HISTORY_FILE_BYTES,
      isPinned: codexThreadMetadata.isPinned === true,
      nativeSessionId: codexThreadMetadata.nativeSessionId,
      sourcePath: filePath,
      ...(getVisibleCodexThreadSource(codexThreadMetadata) == null
        ? {}
        : { threadSource: getVisibleCodexThreadSource(codexThreadMetadata) }),
      title: buildPreviewTitle(adapter, codexThreadMetadata.title),
      updatedAt: codexThreadMetadata.updatedAt ?? createdAt
    }
  }

  const lines = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(filePath, { encoding: 'utf8' })
  })
  let createdAt = codexThreadMetadata?.createdAt ?? 0
  let cwd: string | undefined = codexThreadMetadata?.cwd
  let nativeSessionId: string | undefined = codexThreadMetadata?.nativeSessionId
  let parsedRecords = 0
  let title: string | undefined = codexThreadMetadata?.title
  let updatedAt = codexThreadMetadata?.updatedAt ?? 0

  try {
    for await (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === '') {
        continue
      }
      if (adapter === 'codex' && trimmed.includes('function_call_output')) {
        continue
      }

      let value: unknown
      try {
        value = JSON.parse(trimmed) as unknown
      } catch {
        continue
      }
      if (!isRecord(value)) {
        continue
      }
      parsedRecords += 1

      const timestamp = getEventTime(value.timestamp, stat.mtimeMs)
      updatedAt = Math.max(updatedAt, timestamp)

      if (adapter === 'codex') {
        const payload = isRecord(value.payload) ? value.payload : undefined
        if (value.type === 'session_meta') {
          cwd ??= asString(payload?.cwd)
          nativeSessionId ??= asString(payload?.id)
          createdAt = getEventTime(payload?.timestamp, timestamp)
          title ??= asString(payload?.thread_name)
        } else if (value.type === 'event_msg' && payload?.type === 'user_message') {
          title ??= asString(payload.message)
        }
      } else {
        cwd ??= asString(value.cwd)
        nativeSessionId ??= asString(value.sessionId) ?? asString(value.session_id)
        if (createdAt === 0) {
          createdAt = timestamp
        }
        if (value.type === 'summary') {
          title ??= asString(value.summary)
        } else if (value.type === 'user') {
          const message = isRecord(value.message) ? value.message : undefined
          title ??= readContentText(message?.content ?? value.content)
        }
      }

      if (cwd != null && (nativeSessionId != null || adapter === 'codex') && (title != null || parsedRecords >= 16)) {
        lines.close()
        break
      }
    }
  } finally {
    lines.close()
  }

  const effectiveCodexThreadMetadata = adapter === 'codex'
    ? getCodexThreadMetadata(codexThreadMetadataIndex, filePath, nativeSessionId) ?? codexThreadMetadata
    : codexThreadMetadata
  const resolvedNativeSessionId = effectiveCodexThreadMetadata?.nativeSessionId ?? nativeSessionId ??
    path.basename(filePath, '.jsonl')
  const resolvedCwd = effectiveCodexThreadMetadata?.cwd ?? cwd
  if (resolvedCwd == null) {
    return undefined
  }

  return {
    adapter,
    createdAt: effectiveCodexThreadMetadata?.createdAt ?? (createdAt || stat.birthtimeMs || stat.mtimeMs),
    cwd: resolvedCwd,
    fileSizeBytes: stat.size,
    isArchived: effectiveCodexThreadMetadata?.isArchived ?? isArchived,
    isImported: false,
    isLarge: stat.size >= LARGE_NATIVE_HISTORY_FILE_BYTES,
    isPinned: effectiveCodexThreadMetadata?.isPinned === true ||
      codexThreadMetadataIndex?.pinnedThreadIds.has(resolvedNativeSessionId) === true,
    nativeSessionId: resolvedNativeSessionId,
    sourcePath: filePath,
    ...(getVisibleCodexThreadSource(effectiveCodexThreadMetadata) == null
      ? {}
      : { threadSource: getVisibleCodexThreadSource(effectiveCodexThreadMetadata) }),
    title: buildPreviewTitle(adapter, effectiveCodexThreadMetadata?.title ?? title),
    updatedAt: effectiveCodexThreadMetadata?.updatedAt ?? (updatedAt || createdAt || stat.mtimeMs)
  }
}

const buildNativeMessageId = (
  adapter: NativeHistoryAdapter,
  sourcePath: string,
  line: number,
  role: string,
  preferredId?: string
) => preferredId ?? stableId(`native-${adapter}`, sourcePath, String(line), role)

const toRuntimeContentItems = (items: unknown): RuntimeContentItem[] | undefined => {
  if (!Array.isArray(items)) {
    return undefined
  }

  const content: RuntimeContentItem[] = []
  for (const item of items) {
    if (!isRecord(item)) {
      continue
    }
    const type = asString(item.type)
    if ((type === 'text' || type === 'input_text' || type === 'output_text') && asString(item.text) != null) {
      content.push({ type: 'text', text: asString(item.text)! })
    } else if (type === 'tool_use' && asString(item.id) != null && asString(item.name) != null) {
      content.push({
        type: 'tool_use',
        id: asString(item.id)!,
        name: asString(item.name)!,
        input: item.input ?? {}
      })
    } else if (type === 'tool_result' && asString(item.tool_use_id ?? item.toolUseId) != null) {
      content.push({
        type: 'tool_result',
        tool_use_id: asString(item.tool_use_id ?? item.toolUseId)!,
        content: item.content ?? '',
        ...(typeof item.is_error === 'boolean' ? { is_error: item.is_error } : {})
      })
    }
  }

  return content.length === 0 ? undefined : content
}

const parseCodexConversation = (
  sourcePath: string,
  records: JsonlRecord[],
  projectContext: ProjectMatchContext,
  projectScope: NativeHistoryProjectScope,
  codexThreadMetadata?: CodexThreadMetadata
): NativeHistoryConversation | undefined => {
  let sessionMeta: Record<string, unknown> | undefined
  const messages: NativeHistoryMessage[] = []
  let updatedAt = 0

  for (const record of records) {
    if (!isRecord(record.value)) {
      continue
    }
    const event = record.value
    const payload = isRecord(event.payload) ? event.payload : undefined
    if (payload == null) {
      continue
    }
    const timestamp = getEventTime(event.timestamp, Date.now())
    updatedAt = Math.max(updatedAt, timestamp)

    if (event.type === 'session_meta') {
      sessionMeta = payload
      continue
    }

    if (event.type === 'event_msg' && payload.type === 'user_message') {
      const message = asString(payload.message)
      if (message == null) {
        continue
      }
      messages.push({
        id: buildNativeMessageId('codex', sourcePath, record.line, 'user'),
        role: 'user',
        content: message,
        ts: timestamp
      })
      continue
    }

    if (event.type !== 'response_item') {
      continue
    }

    const payloadType = asString(payload.type)
    if (payloadType === 'message' && payload.role === 'assistant') {
      const text = readCodexMessageText(payload)
      if (text == null) {
        continue
      }
      messages.push({
        id: buildNativeMessageId('codex', sourcePath, record.line, 'assistant', asString(payload.id)),
        role: 'assistant',
        content: text,
        ts: timestamp
      })
    } else if (payloadType === 'function_call' && asString(payload.call_id) != null && asString(payload.name) != null) {
      messages.push({
        id: buildNativeMessageId('codex', sourcePath, record.line, 'tool-use', asString(payload.call_id)),
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: asString(payload.call_id)!,
          name: asString(payload.name)!,
          input: typeof payload.arguments === 'string' ? parseJson(payload.arguments) : payload.arguments ?? {}
        }],
        ts: timestamp
      })
    } else if (payloadType === 'function_call_output' && asString(payload.call_id) != null) {
      messages.push({
        id: buildNativeMessageId(
          'codex',
          sourcePath,
          record.line,
          'tool-result',
          `${asString(payload.call_id)}:result`
        ),
        role: 'assistant',
        content: [{
          type: 'tool_result',
          tool_use_id: asString(payload.call_id)!,
          content: typeof payload.output === 'string' ? parseJson(payload.output) : payload.output ?? ''
        }],
        ts: timestamp
      })
    }
  }

  const cwd = codexThreadMetadata?.cwd ?? asString(sessionMeta?.cwd)
  if (
    !isConversationInProjectScope(cwd, projectContext, projectScope, codexThreadMetadata?.gitOriginUrl) ||
    messages.length === 0
  ) {
    return undefined
  }

  const nativeSessionId = codexThreadMetadata?.nativeSessionId ?? asString(sessionMeta?.id) ?? path.basename(
    sourcePath,
    '.jsonl'
  )
  const createdAt = codexThreadMetadata?.createdAt ??
    getEventTime(sessionMeta?.timestamp, messages[0]?.ts ?? Date.now())
  return {
    adapter: 'codex',
    createdAt,
    cwd: cwd!,
    messages,
    model: asString(sessionMeta?.model) ?? asString(sessionMeta?.model_provider),
    nativeSessionId,
    sourcePath,
    title: codexThreadMetadata?.title ?? asString(sessionMeta?.thread_name),
    titleIsAuthoritative: codexThreadMetadata?.title != null,
    updatedAt: (codexThreadMetadata?.updatedAt ?? updatedAt) || createdAt
  }
}

const normalizeClaudeContent = (value: unknown): string | RuntimeContentItem[] | undefined => {
  const contentItems = toRuntimeContentItems(value)
  if (contentItems != null) {
    const textOnly = contentItems.every(item => item.type === 'text')
    if (textOnly) {
      const text = contentItems
        .map(item => typeof item.text === 'string' ? item.text : '')
        .join('\n')
        .trim()
      return text === '' ? undefined : text
    }
    return contentItems
  }
  return readContentText(value)
}

const readClaudeMessage = (record: Record<string, unknown>) => {
  const message = isRecord(record.message) ? record.message : undefined
  const role = asString(message?.role) ?? asString(record.type)
  const content = normalizeClaudeContent(message?.content ?? record.content)
  return role != null && content != null ? { role, content } : undefined
}

const parseClaudeConversation = (
  sourcePath: string,
  records: JsonlRecord[],
  projectContext: ProjectMatchContext,
  projectScope: NativeHistoryProjectScope
): NativeHistoryConversation | undefined => {
  const messages: NativeHistoryMessage[] = []
  let cwd: string | undefined
  let nativeSessionId: string | undefined
  let summary: string | undefined
  let createdAt = 0
  let updatedAt = 0

  for (const record of records) {
    if (!isRecord(record.value)) {
      continue
    }
    const value = record.value
    const timestamp = getEventTime(value.timestamp, Date.now())
    if (createdAt === 0) {
      createdAt = timestamp
    }
    updatedAt = Math.max(updatedAt, timestamp)
    cwd ??= asString(value.cwd)
    nativeSessionId ??= asString(value.sessionId) ?? asString(value.session_id)

    if (value.type === 'summary') {
      summary ??= asString(value.summary)
      continue
    }
    if (value.isSidechain === true || (value.type !== 'user' && value.type !== 'assistant')) {
      continue
    }

    const message = readClaudeMessage(value)
    if (message == null || (message.role !== 'user' && message.role !== 'assistant')) {
      continue
    }

    messages.push({
      id: buildNativeMessageId('claude-code', sourcePath, record.line, message.role, asString(value.uuid)),
      role: message.role,
      content: message.content,
      ts: timestamp
    })
  }

  if (!isConversationInProjectScope(cwd, projectContext, projectScope) || messages.length === 0) {
    return undefined
  }

  return {
    adapter: 'claude-code',
    createdAt: createdAt || messages[0]!.ts,
    cwd: cwd!,
    messages,
    nativeSessionId: nativeSessionId ?? path.basename(sourcePath, '.jsonl'),
    sourcePath,
    title: summary,
    updatedAt: updatedAt || createdAt || messages.at(-1)!.ts
  }
}

const toRuntimeSessionId = (
  conversation: Pick<NativeHistoryConversation, 'adapter' | 'nativeSessionId' | 'sourcePath'>
) => (
  `${IMPORT_SESSION_PREFIX}${conversation.adapter.replace(/[^a-z0-9]+/gi, '_')}_${
    stableHash(
      `${conversation.nativeSessionId}\0${conversation.sourcePath}`
    ).slice(0, 16)
  }`
)

const findImportedNativeHistorySessionId = (
  runtimeRoot: string,
  conversation: Pick<NativeHistoryConversation, 'adapter' | 'nativeSessionId' | 'sourcePath'>
) => {
  const sessionId = toRuntimeSessionId(conversation)
  return existsSync(path.join(runtimeRoot, 'sessions', sessionId, 'meta.json')) ? sessionId : undefined
}

const toRuntimeEvents = (conversation: NativeHistoryConversation): RuntimeEventDraft[] =>
  conversation.messages.map(message => ({
    id: message.id,
    sessionId: toRuntimeSessionId(conversation),
    type: 'message',
    role: message.role,
    content: message.content,
    ts: message.ts,
    visibility: 'private',
    adapter: conversation.adapter,
    ...(conversation.model != null ? { model: conversation.model } : {}),
    source: HISTORY_IMPORT_SOURCE,
    nativeSource: {
      adapter: conversation.adapter,
      sessionId: conversation.nativeSessionId,
      path: conversation.sourcePath
    }
  }))

const importConversation = async (
  conversation: NativeHistoryConversation,
  params: {
    runtimeRoot: string
    workspaceCwd: string
  }
): Promise<NativeHistoryImportSessionResult> => {
  const store = new FileRuntimeStore(params.runtimeRoot)
  const sessionId = toRuntimeSessionId(conversation)
  const title = buildTitle(conversation)
  const session = await store.createSession(
    {
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId,
      title,
      cwd: conversation.cwd,
      adapter: conversation.adapter,
      ...(conversation.model != null ? { model: conversation.model } : {}),
      createdAt: conversation.createdAt,
      historyImport: {
        adapter: conversation.adapter,
        nativeSessionId: conversation.nativeSessionId,
        sourcePath: conversation.sourcePath,
        workspaceCwd: params.workspaceCwd
      }
    } satisfies RuntimeMeta
  )

  const existingEvents = await session.replayEvents()
  const existingEventIds = new Set(existingEvents.map(event => event.id))
  const events = toRuntimeEvents(conversation)
  let lastSeq = existingEvents.at(-1)?.seq ?? 0
  let importedEvents = 0
  for (const event of events) {
    if (existingEventIds.has(event.id!)) {
      continue
    }
    lastSeq += 1
    const nextEvent = {
      ...event,
      protocolVersion: event.protocolVersion ?? DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: event.supportedProtocolRange ?? DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      id: event.id ?? `evt_${lastSeq}`,
      seq: event.seq ?? lastSeq,
      ts: event.ts ?? Date.now()
    } satisfies RuntimeEvent
    await appendJsonlLine(path.join(session.sessionPath, 'events.jsonl'), nextEvent)
    existingEventIds.add(nextEvent.id)
    importedEvents += 1
  }
  const state: RuntimeState = {
    protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
    supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
    sessionId,
    status: 'completed',
    title,
    lastSeq,
    ...(conversation.messages.at(-1) != null
      ? { lastMessage: getFirstText(conversation.messages.at(-1)!.content) }
      : {}),
    updatedAt: conversation.updatedAt
  }

  await Promise.all([
    session.writeState(state),
    session.writeHeartbeat({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId,
      runtimeId: HISTORY_IMPORT_SOURCE,
      status: 'completed',
      updatedAt: conversation.updatedAt
    }),
    store.updateIndex(sessionId, {
      storePath: path.relative(params.runtimeRoot, session.sessionPath),
      cwd: conversation.cwd,
      status: 'completed',
      updatedAt: conversation.updatedAt
    })
  ])

  return {
    adapter: conversation.adapter,
    createdAt: conversation.createdAt,
    importedEvents,
    sessionId,
    sourcePath: conversation.sourcePath,
    title,
    updatedAt: conversation.updatedAt
  }
}

const parseConversation = (
  adapter: NativeHistoryAdapter,
  filePath: string,
  records: JsonlRecord[],
  projectContext: ProjectMatchContext,
  projectScope: NativeHistoryProjectScope,
  codexThreadMetadata?: CodexThreadMetadata
) =>
  adapter === 'codex'
    ? parseCodexConversation(filePath, records, projectContext, projectScope, codexThreadMetadata)
    : parseClaudeConversation(filePath, records, projectContext, projectScope)

const readCodexNativeSessionIdFromRecords = (records: JsonlRecord[]) => {
  for (const record of records) {
    if (!isRecord(record.value)) {
      continue
    }
    const payload = isRecord(record.value.payload) ? record.value.payload : undefined
    const nativeSessionId = record.value.type === 'session_meta' ? asString(payload?.id) : undefined
    if (nativeSessionId != null) {
      return nativeSessionId
    }
  }
  return undefined
}

const readConversationCwdFromRecords = (
  adapter: NativeHistoryAdapter,
  records: JsonlRecord[]
) => {
  for (const record of records) {
    if (!isRecord(record.value)) {
      continue
    }
    if (adapter === 'codex') {
      const payload = isRecord(record.value.payload) ? record.value.payload : undefined
      const cwd = record.value.type === 'session_meta' ? asString(payload?.cwd) : undefined
      if (cwd != null) {
        return cwd
      }
    } else {
      const cwd = asString(record.value.cwd)
      if (cwd != null) {
        return cwd
      }
    }
  }
  return undefined
}

const getCodexThreadMetadataFromRecords = (
  index: CodexThreadMetadataIndex | undefined,
  filePath: string,
  records: JsonlRecord[],
  fallback?: CodexThreadMetadata
) => getCodexThreadMetadata(index, filePath, readCodexNativeSessionIdFromRecords(records)) ?? fallback

const hasCustomImportOptions = (options: NativeHistoryImportOptions) => (
  options.adapters != null ||
  options.cwd != null ||
  options.env != null ||
  options.homeDir != null ||
  options.maxFileSizeBytes != null ||
  options.maxFileSizeBytesByAdapter != null ||
  options.projectScope != null ||
  options.sourceDirs != null ||
  options.sourcePaths != null ||
  options.threadScope != null ||
  options.timeFilter != null ||
  options.timeSort != null
)

const createEmptyImportResult = (): NativeHistoryImportResult => ({
  importedEvents: 0,
  importedSessions: 0,
  matchedFiles: 0,
  scannedFiles: 0,
  sessions: []
})

const getImportFileSizeLimit = (
  options: NativeHistoryImportOptions,
  adapter: NativeHistoryAdapter
) => {
  if (options.maxFileSizeBytesByAdapter != null && hasOwn(options.maxFileSizeBytesByAdapter, adapter)) {
    return options.maxFileSizeBytesByAdapter[adapter] ?? undefined
  }
  return options.maxFileSizeBytes
}

const createSourcePathFilter = (sourcePaths: string[] | undefined) => {
  if (sourcePaths == null) {
    return undefined
  }
  return new Set(sourcePaths.map(sourcePath => normalizeRealPath(sourcePath)))
}

const matchesSourcePathFilter = (sourcePathFilter: Set<string> | undefined, filePath: string) => (
  sourcePathFilter == null || sourcePathFilter.has(normalizeRealPath(filePath))
)

const matchesNativeHistoryCandidateScope = (
  candidate: Pick<NativeHistoryImportPreviewCandidate, 'isArchived'>,
  candidateScope: NativeHistoryCandidateScope | undefined
) => (
  candidateScope == null ||
  candidateScope === 'all' ||
  (candidateScope === 'archived' ? candidate.isArchived : !candidate.isArchived)
)

const isNativeHistorySubagentThread = (value: { isListed?: boolean; threadSource?: string } | undefined) => (
  value?.threadSource === 'subagent' && value.isListed !== true
)

const matchesNativeHistoryThreadScope = (
  value: { isListed?: boolean; threadSource?: string } | undefined,
  threadScope: NativeHistoryThreadScope | undefined
) => (
  threadScope == null ||
  threadScope === 'all' ||
  (
    threadScope === 'subagent'
      ? isNativeHistorySubagentThread(value)
      : !isNativeHistorySubagentThread(value)
  )
)

const normalizeNativeHistoryPreviewLimit = (value: number | undefined) => {
  if (value == null) {
    return undefined
  }
  if (!Number.isFinite(value)) {
    return undefined
  }
  return Math.min(MAX_NATIVE_HISTORY_PREVIEW_LIMIT, Math.max(1, Math.floor(value)))
}

const parseNativeHistoryPreviewCursor = (cursor: string | undefined): NativeHistoryPreviewCursor => {
  if (cursor == null || cursor.trim() === '') {
    return { offsets: {} }
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (!isRecord(decoded) || !isRecord(decoded.offsets)) {
      return { offsets: {} }
    }
    const offsets: Partial<Record<NativeHistoryAdapter, number>> = {}
    for (const adapter of ['codex', 'claude-code'] satisfies NativeHistoryAdapter[]) {
      const offset = decoded.offsets[adapter]
      if (typeof offset === 'number' && Number.isInteger(offset) && offset > 0) {
        offsets[adapter] = offset
      }
    }
    return { offsets }
  } catch {
    return { offsets: {} }
  }
}

const createNativeHistoryPreviewCursor = (
  offsets: Partial<Record<NativeHistoryAdapter, number>>
) => Buffer.from(JSON.stringify({ offsets }), 'utf8').toString('base64url')

const normalizeTimestamp = (value: number | undefined) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
)

const getCandidateActivityTime = (value: Pick<NativeHistoryImportPreviewCandidate, 'createdAt' | 'updatedAt'>) => (
  normalizeTimestamp(value.updatedAt) ?? normalizeTimestamp(value.createdAt) ?? 0
)

const getImportSessionActivityTime = (value: Pick<NativeHistoryImportSessionResult, 'createdAt' | 'updatedAt'>) => (
  normalizeTimestamp(value.updatedAt) ?? normalizeTimestamp(value.createdAt) ?? 0
)

const comparePinnedFirst = (
  left: { isPinned?: boolean },
  right: { isPinned?: boolean }
) => Number(right.isPinned === true) - Number(left.isPinned === true)

const matchesNativeHistoryTimeRange = (
  value: number,
  range: NativeHistoryTimeRange | undefined
) => {
  if (range == null) {
    return true
  }
  if (range.from != null && value < range.from) {
    return false
  }
  if (range.to != null && value > range.to) {
    return false
  }
  return true
}

const matchesNativeHistoryTimeFilter = (
  candidate: Pick<NativeHistoryImportPreviewCandidate, 'createdAt' | 'updatedAt'>,
  timeFilter: NativeHistoryTimeFilter | undefined
) => (
  timeFilter == null ||
  (
    matchesNativeHistoryTimeRange(candidate.createdAt, timeFilter.createdAt) &&
    matchesNativeHistoryTimeRange(candidate.updatedAt, timeFilter.updatedAt)
  )
)

const compareNativeHistoryCandidates = (
  timeSort: NativeHistoryTimeSort | undefined
) =>
(
  left: NativeHistoryImportPreviewCandidate,
  right: NativeHistoryImportPreviewCandidate
) => {
  const leftTime = timeSort === 'createdAt'
    ? left.createdAt
    : timeSort === 'updatedAt'
    ? left.updatedAt
    : getCandidateActivityTime(left)
  const rightTime = timeSort === 'createdAt'
    ? right.createdAt
    : timeSort === 'updatedAt'
    ? right.updatedAt
    : getCandidateActivityTime(right)
  return comparePinnedFirst(left, right) ||
    rightTime - leftTime ||
    right.createdAt - left.createdAt ||
    right.sourcePath.localeCompare(left.sourcePath)
}

const compareNativeHistorySourceFiles = (
  timeSort: NativeHistoryTimeSort | undefined
) =>
(
  left: NativeHistorySourceFile,
  right: NativeHistorySourceFile
) => {
  const leftTime = timeSort === 'createdAt'
    ? left.createdAt
    : timeSort === 'updatedAt'
    ? left.updatedAt
    : normalizeTimestamp(left.updatedAt) ?? normalizeTimestamp(left.createdAt) ?? 0
  const rightTime = timeSort === 'createdAt'
    ? right.createdAt
    : timeSort === 'updatedAt'
    ? right.updatedAt
    : normalizeTimestamp(right.updatedAt) ?? normalizeTimestamp(right.createdAt) ?? 0
  return comparePinnedFirst(left, right) ||
    rightTime - leftTime ||
    right.createdAt - left.createdAt ||
    right.filePath.localeCompare(left.filePath)
}

const compareNativeHistoryImportSessions = (
  timeSort: NativeHistoryTimeSort | undefined
) =>
(
  left: NativeHistoryImportSessionResult,
  right: NativeHistoryImportSessionResult
) => {
  const leftTime = timeSort === 'createdAt'
    ? left.createdAt
    : timeSort === 'updatedAt'
    ? left.updatedAt
    : getImportSessionActivityTime(left)
  const rightTime = timeSort === 'createdAt'
    ? right.createdAt
    : timeSort === 'updatedAt'
    ? right.updatedAt
    : getImportSessionActivityTime(right)
  return rightTime - leftTime || right.createdAt - left.createdAt || right.sourcePath.localeCompare(left.sourcePath)
}

const isWithinImportFileSizeLimit = (
  filePath: string,
  limitBytes: number | undefined
) => limitBytes == null || statSync(filePath).size <= limitBytes

const createAdapterPreview = (adapter: NativeHistoryAdapter): NativeHistoryImportAdapterPreview => ({
  adapter,
  candidates: [],
  hasMore: false,
  isComplete: true,
  largeFiles: 0,
  largestFileBytes: 0,
  matchedFiles: 0,
  scannedFiles: 0,
  totalBytes: 0
})

const createNativeHistorySourceFile = (
  adapter: NativeHistoryAdapter,
  homeDir: string,
  filePath: string,
  codexThreadMetadataIndex: CodexThreadMetadataIndex | undefined
): NativeHistorySourceFile => {
  const stat = statSync(filePath)
  const codexThreadMetadata = adapter === 'codex'
    ? getCodexThreadMetadata(codexThreadMetadataIndex, filePath)
    : undefined
  return {
    codexThreadMetadata,
    createdAt: codexThreadMetadata?.createdAt ?? stat.birthtimeMs ?? stat.mtimeMs,
    filePath,
    isArchived: isArchivedNativeHistoryFile(adapter, homeDir, filePath),
    isPinned: codexThreadMetadata?.isPinned === true,
    stat,
    updatedAt: codexThreadMetadata?.updatedAt ?? stat.mtimeMs
  }
}

export async function previewNativeProjectHistory(
  options: NativeHistoryImportOptions = {}
): Promise<NativeHistoryImportPreviewResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const env = options.env ?? process.env
  const runtimeEnv = createWorkspaceRuntimeEnv(cwd, env)
  const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(cwd, runtimeEnv)
  const homeDir = path.resolve(options.homeDir ?? env.__ONEWORKS_PROJECT_REAL_HOME__ ?? env.HOME ?? homedir())
  const adapters = options.adapters ?? ['codex', 'claude-code']
  const projectContext = resolveProjectMatchContext(cwd, runtimeEnv)
  const projectScope = resolveNativeHistoryProjectScope(options)
  const adapterPreviews: NativeHistoryImportAdapterPreview[] = []
  const sourcePathFilter = createSourcePathFilter(options.sourcePaths)
  const previewLimit = normalizeNativeHistoryPreviewLimit(options.previewLimit)
  const previewCursor = parseNativeHistoryPreviewCursor(options.previewCursor)
  const nextCursorOffsets: Partial<Record<NativeHistoryAdapter, number>> = {}

  for (const adapter of adapters) {
    const preview = createAdapterPreview(adapter)
    const sourceDirs = resolveSourceDirs(adapter, homeDir, options.sourceDirs)
    const codexThreadMetadataIndex = adapter === 'codex'
      ? await readCodexThreadMetadataIndex(homeDir)
      : undefined
    const sourceFiles: NativeHistorySourceFile[] = []

    for (const sourceDir of sourceDirs) {
      if (!existsSync(sourceDir)) {
        continue
      }
      const files = await walkJsonlFiles(sourceDir)
      preview.scannedFiles += files.length

      for (const filePath of files) {
        if (!matchesSourcePathFilter(sourcePathFilter, filePath)) {
          continue
        }
        try {
          sourceFiles.push(createNativeHistorySourceFile(adapter, homeDir, filePath, codexThreadMetadataIndex))
        } catch (error) {
          logger.warn({
            adapter,
            error,
            filePath
          }, '[runtime-store] Failed to inspect native history file')
        }
      }
    }

    sourceFiles.sort(compareNativeHistorySourceFiles(options.timeSort))

    const startOffset = previewCursor.offsets[adapter] ?? 0
    for (let index = startOffset; index < sourceFiles.length; index += 1) {
      const sourceFile = sourceFiles[index]!
      try {
        const codexThreadMetadata = sourceFile.codexThreadMetadata
        const candidate = await readConversationPreview(
          adapter,
          sourceFile.filePath,
          sourceFile.isArchived,
          codexThreadMetadata,
          sourceFile.stat,
          codexThreadMetadataIndex
        )
        if (
          candidate == null ||
          !isConversationInProjectScope(
            candidate.cwd,
            projectContext,
            projectScope,
            codexThreadMetadata?.gitOriginUrl
          ) ||
          !matchesNativeHistoryThreadScope(candidate, options.threadScope) ||
          !matchesNativeHistoryTimeFilter(candidate, options.timeFilter) ||
          !matchesNativeHistoryCandidateScope(candidate, options.candidateScope)
        ) {
          continue
        }

        const importTarget = projectScope === 'all-projects'
          ? resolveNativeHistoryImportTarget(candidate.cwd, cwd, env, projectScope)
          : { runtimeRoot, workspaceCwd: cwd }
        const importedSessionId = findImportedNativeHistorySessionId(importTarget.runtimeRoot, candidate)
        if (importedSessionId != null) {
          continue
        }

        preview.candidates.push(candidate)
        preview.matchedFiles += 1
        preview.totalBytes += candidate.fileSizeBytes
        preview.largestFileBytes = Math.max(preview.largestFileBytes, candidate.fileSizeBytes)
        if (candidate.isLarge) {
          preview.largeFiles += 1
        }

        if (previewLimit != null && preview.candidates.length >= previewLimit) {
          const nextOffset = index + 1
          if (nextOffset < sourceFiles.length) {
            preview.hasMore = true
            preview.isComplete = false
            preview.nextCursor = createNativeHistoryPreviewCursor({
              ...previewCursor.offsets,
              ...nextCursorOffsets,
              [adapter]: nextOffset
            })
            nextCursorOffsets[adapter] = nextOffset
          }
          break
        }
      } catch (error) {
        logger.warn({
          adapter,
          error,
          filePath: sourceFile.filePath
        }, '[runtime-store] Failed to preview native history file')
      }
    }

    preview.candidates.sort(compareNativeHistoryCandidates(options.timeSort))
    adapterPreviews.push(preview)
  }

  const nextCursor = Object.keys(nextCursorOffsets).length === 0
    ? undefined
    : createNativeHistoryPreviewCursor({
      ...previewCursor.offsets,
      ...nextCursorOffsets
    })

  return {
    adapters: adapterPreviews,
    hasMore: adapterPreviews.some(preview => preview.hasMore),
    isComplete: adapterPreviews.every(preview => preview.isComplete),
    largeFileThresholdBytes: LARGE_NATIVE_HISTORY_FILE_BYTES,
    largeFiles: adapterPreviews.reduce((sum, preview) => sum + preview.largeFiles, 0),
    largestFileBytes: Math.max(0, ...adapterPreviews.map(preview => preview.largestFileBytes)),
    matchedFiles: adapterPreviews.reduce((sum, preview) => sum + preview.matchedFiles, 0),
    ...(nextCursor == null ? {} : { nextCursor }),
    scannedFiles: adapterPreviews.reduce((sum, preview) => sum + preview.scannedFiles, 0),
    totalBytes: adapterPreviews.reduce((sum, preview) => sum + preview.totalBytes, 0)
  }
}

const resolveNativeHistoryImportRuntimeRoot = (options: NativeHistoryImportOptions = {}) => {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const env = options.env ?? process.env
  const runtimeEnv = createWorkspaceRuntimeEnv(cwd, env)
  return resolveWorkspaceRuntimeStoreRoot(cwd, runtimeEnv)
}

const setNativeHistoryImportRuntimeRoots = (
  result: NativeHistoryImportResult,
  runtimeRoots: string[]
) => {
  Object.defineProperty(result, nativeHistoryImportRuntimeRoots, {
    configurable: true,
    enumerable: false,
    value: runtimeRoots
  })
}

const getNativeHistoryImportRuntimeRoots = (
  result: NativeHistoryImportResult,
  options: NativeHistoryImportOptions
) => {
  const roots = (result as NativeHistoryImportResult & {
    [nativeHistoryImportRuntimeRoots]?: string[]
  })[nativeHistoryImportRuntimeRoots]
  return roots == null || roots.length === 0
    ? [resolveNativeHistoryImportRuntimeRoot(options)]
    : roots
}

const resolveNativeHistoryImportMarkerDir = (options: NativeHistoryImportOptions = {}) => {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const env = options.env ?? process.env
  const workspaceFolder = resolveProjectWorkspaceFolder(cwd, env)
  const runtimeEnv = createWorkspaceRuntimeEnv(workspaceFolder, env)
  return resolveProjectHomePath(workspaceFolder, runtimeEnv, ...HISTORY_IMPORT_MARKER_SEGMENTS)
}

const claimNativeHistoryFirstOpenImport = async (markerDir: string) => {
  await mkdir(path.dirname(markerDir), { recursive: true })
  try {
    await mkdir(markerDir)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }
    throw error
  }
}

const writeNativeHistoryFirstOpenMarker = async (
  markerDir: string,
  result: NativeHistoryImportResult
) => {
  await writeFile(
    path.join(markerDir, 'state.json'),
    `${
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          importedEvents: result.importedEvents,
          importedSessions: result.importedSessions,
          matchedFiles: result.matchedFiles,
          scannedFiles: result.scannedFiles,
          version: 1
        },
        null,
        2
      )
    }\n`,
    'utf8'
  )
}

const replayNativeHistoryRuntimeRoot = async (runtimeRoot: string) => {
  const watcher = getRuntimeStoreWatcher()
  if (watcher != null) {
    await watcher.scanAndReplay()
    return
  }

  const db = getDb()
  const stores = await discoverRuntimeSessionStores([runtimeRoot])
  for (const store of stores) {
    await replayRuntimeStore(store, {
      db,
      broadcast: true,
      agentRoomProjectionEnabled: false
    })
  }
}

const nativeHistoryAutoImportAdapters: NativeHistoryAdapter[] = ['codex', 'claude-code']

const normalizeFileSizeLimit = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
)

const resolveNativeHistoryAutoImportOptions = (config: Config): NativeHistoryImportOptions | undefined => {
  const nativeHistoryImport = config.nativeHistoryImport
  if (nativeHistoryImport == null) {
    return undefined
  }

  const adapters = nativeHistoryAutoImportAdapters.filter((adapter) => {
    const adapterConfig = nativeHistoryImport.adapters?.[adapter]
    return (adapterConfig?.autoImport ?? nativeHistoryImport.autoImport) === true
  })
  if (adapters.length === 0) {
    return undefined
  }

  const maxFileSizeBytes = hasOwn(nativeHistoryImport, 'maxFileSizeBytes')
    ? normalizeFileSizeLimit(nativeHistoryImport.maxFileSizeBytes)
    : DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
  const maxFileSizeBytesByAdapter = Object.fromEntries(
    nativeHistoryAutoImportAdapters.flatMap((adapter) => {
      const adapterConfig = nativeHistoryImport.adapters?.[adapter]
      if (adapterConfig == null || !hasOwn(adapterConfig, 'maxFileSizeBytes')) {
        return []
      }
      const value = normalizeFileSizeLimit(adapterConfig.maxFileSizeBytes)
      return [[adapter, value ?? null]]
    })
  ) as Partial<Record<NativeHistoryAdapter, number | null>>

  return {
    adapters,
    threadScope: 'user',
    ...(maxFileSizeBytes == null ? {} : { maxFileSizeBytes }),
    ...(Object.keys(maxFileSizeBytesByAdapter).length === 0 ? {} : { maxFileSizeBytesByAdapter })
  }
}

export async function autoImportNativeProjectHistoryAndReplay(config: Config): Promise<NativeHistoryImportResult> {
  const options = resolveNativeHistoryAutoImportOptions(config)
  if (options == null) {
    return createEmptyImportResult()
  }
  return importNativeProjectHistoryAndReplay(options)
}

async function importNativeProjectHistoryInternal(
  options: NativeHistoryImportOptions = {}
): Promise<NativeHistoryImportResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const env = options.env ?? process.env
  const runtimeEnv = createWorkspaceRuntimeEnv(cwd, env)
  const runtimeRoot = resolveWorkspaceRuntimeStoreRoot(cwd, runtimeEnv)
  const homeDir = path.resolve(options.homeDir ?? env.__ONEWORKS_PROJECT_REAL_HOME__ ?? env.HOME ?? homedir())
  const adapters = options.adapters ?? ['codex', 'claude-code']
  const projectContext = resolveProjectMatchContext(cwd, runtimeEnv)
  const projectScope = resolveNativeHistoryProjectScope(options)
  const sourcePathFilter = createSourcePathFilter(options.sourcePaths)
  const changedRuntimeRoots = new Set<string>()
  const result: NativeHistoryImportResult = {
    importedEvents: 0,
    importedSessions: 0,
    matchedFiles: 0,
    scannedFiles: 0,
    sessions: []
  }

  await mkdir(runtimeRoot, { recursive: true })

  for (const adapter of adapters) {
    const sourceDirs = resolveSourceDirs(adapter, homeDir, options.sourceDirs)
    const codexThreadMetadataIndex = adapter === 'codex'
      ? await readCodexThreadMetadataIndex(homeDir)
      : undefined
    for (const sourceDir of sourceDirs) {
      if (!existsSync(sourceDir)) {
        continue
      }
      const files = await walkJsonlFiles(sourceDir)
      result.scannedFiles += files.length
      for (const filePath of files) {
        try {
          if (!matchesSourcePathFilter(sourcePathFilter, filePath)) {
            continue
          }
          if (!isWithinImportFileSizeLimit(filePath, getImportFileSizeLimit(options, adapter))) {
            continue
          }
          const pathCodexThreadMetadata = getCodexThreadMetadata(codexThreadMetadataIndex, filePath)
          const records = await readJsonlRecords(filePath, adapter)
          const codexThreadMetadata = adapter === 'codex'
            ? getCodexThreadMetadataFromRecords(codexThreadMetadataIndex, filePath, records, pathCodexThreadMetadata)
            : pathCodexThreadMetadata
          if (!matchesNativeHistoryThreadScope(codexThreadMetadata, options.threadScope)) {
            continue
          }
          const conversationCwd = codexThreadMetadata?.cwd ?? readConversationCwdFromRecords(adapter, records)
          if (
            !isConversationInProjectScope(
              conversationCwd,
              projectContext,
              projectScope,
              codexThreadMetadata?.gitOriginUrl
            )
          ) {
            continue
          }
          const conversation = parseConversation(
            adapter,
            filePath,
            records,
            projectContext,
            projectScope,
            codexThreadMetadata
          )
          if (conversation == null || !matchesNativeHistoryTimeFilter(conversation, options.timeFilter)) {
            continue
          }
          const importTarget = projectScope === 'all-projects'
            ? resolveNativeHistoryImportTarget(conversation.cwd, cwd, env, projectScope)
            : { runtimeRoot, workspaceCwd: cwd }
          if (findImportedNativeHistorySessionId(importTarget.runtimeRoot, conversation) != null) {
            continue
          }
          await mkdir(importTarget.runtimeRoot, { recursive: true })
          result.matchedFiles += 1
          const sessionResult = await importConversation(conversation, {
            runtimeRoot: importTarget.runtimeRoot,
            workspaceCwd: importTarget.workspaceCwd
          })
          result.importedEvents += sessionResult.importedEvents
          if (sessionResult.importedEvents > 0) {
            result.importedSessions += 1
            changedRuntimeRoots.add(importTarget.runtimeRoot)
          }
          result.sessions.push(sessionResult)
        } catch (error) {
          logger.warn({
            adapter,
            error,
            filePath
          }, '[runtime-store] Failed to import native history file')
        }
      }
    }
  }

  if (result.sessions.length > 0) {
    result.sessions.sort(compareNativeHistoryImportSessions(options.timeSort))
    const runtimeRoots = Array.from(changedRuntimeRoots)
    setNativeHistoryImportRuntimeRoots(result, runtimeRoots)
    await Promise.all(runtimeRoots.map(root => watchRuntimeStoreRoot(root)))
  }

  return result
}

export async function importNativeProjectHistory(
  options: NativeHistoryImportOptions = {}
): Promise<NativeHistoryImportResult> {
  if (hasCustomImportOptions(options)) {
    return importNativeProjectHistoryInternal(options)
  }

  defaultNativeHistoryImportInFlight ??= importNativeProjectHistoryInternal(options).finally(() => {
    defaultNativeHistoryImportInFlight = undefined
  })
  return defaultNativeHistoryImportInFlight
}

export async function importNativeProjectHistoryAndReplay(
  options: NativeHistoryImportOptions = {}
): Promise<NativeHistoryImportResult> {
  const result = await importNativeProjectHistory(options)
  if (result.sessions.length > 0) {
    await Promise.all(
      getNativeHistoryImportRuntimeRoots(result, options).map(root => replayNativeHistoryRuntimeRoot(root))
    )
  }
  return result
}

async function prepareNativeProjectHistoryFirstOpenImportInternal(
  options: NativeHistoryImportOptions = {}
) {
  const markerDir = resolveNativeHistoryImportMarkerDir(options)
  const shouldImport = await claimNativeHistoryFirstOpenImport(markerDir)
  if (!shouldImport) {
    return createEmptyImportResult()
  }

  try {
    const result = await importNativeProjectHistoryAndReplay(options)
    await writeNativeHistoryFirstOpenMarker(markerDir, result)
    if (!hasCustomImportOptions(options) && result.sessions.length > 0) {
      pendingFirstOpenPromptResult = result
    }
    return result
  } catch (error) {
    await rm(markerDir, { force: true, recursive: true }).catch(() => undefined)
    throw error
  }
}

export async function prepareNativeProjectHistoryFirstOpenImport(
  options: NativeHistoryImportOptions = {}
): Promise<NativeHistoryImportResult> {
  if (hasCustomImportOptions(options)) {
    return prepareNativeProjectHistoryFirstOpenImportInternal(options)
  }

  defaultFirstOpenImportInFlight ??= prepareNativeProjectHistoryFirstOpenImportInternal(options).finally(() => {
    defaultFirstOpenImportInFlight = undefined
  })
  return defaultFirstOpenImportInFlight
}

export async function consumeNativeProjectHistoryImportPrompt(): Promise<NativeHistoryImportResult> {
  if (defaultFirstOpenImportInFlight != null) {
    await defaultFirstOpenImportInFlight
  }
  const pendingResult = pendingFirstOpenPromptResult
  if (pendingResult != null) {
    pendingFirstOpenPromptResult = undefined
    return pendingResult
  }
  return createEmptyImportResult()
}
