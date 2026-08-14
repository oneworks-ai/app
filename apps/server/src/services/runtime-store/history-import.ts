/* eslint-disable max-lines -- native history import needs parser compatibility in one place. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { constants, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import { mkdir, mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import type { DatabaseSync as NodeDatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import type { GooseCliConfig } from '@oneworks/adapter-goose/config-schema'
import {
  inspectGooseHistoryExport,
  listGooseHistoryWithDiagnostics,
  resolveGooseHistoryBinary
} from '@oneworks/adapter-goose/history'
import type { GooseHistoryConversation, GooseHistorySession } from '@oneworks/adapter-goose/history'
import type { RuntimeContentItem } from '@oneworks/runtime-protocol'
import {
  DEFAULT_RUNTIME_PROTOCOL_VERSION,
  DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  FileRuntimeStore,
  appendJsonlLine
} from '@oneworks/runtime-store'
import type { RuntimeEvent, RuntimeEventDraft, RuntimeMeta, RuntimeState } from '@oneworks/runtime-store'
import { NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES } from '@oneworks/types'
import type { Config } from '@oneworks/types'
import { resolveProjectHomePath, resolveProjectWorkspaceFolder } from '@oneworks/utils/ai-path'
import { projectEmbeddedDocument } from '@oneworks/utils/embedded-document'
import {
  resolveProjectPrimaryWorkspaceFolder,
  resolveProjectSharedWorkspaceFolder
} from '@oneworks/utils/project-cache-path'

import { getDb } from '#~/db/index.js'
import { logger } from '#~/utils/logger.js'

import { CLINE_HISTORY_MESSAGES_MAX_BYTES, readClineHistory } from './cline-history.js'
import type { ClineHistorySession } from './cline-history.js'
import { discoverRuntimeSessionStores } from './discovery.js'
import { getRuntimeStoreWatcher, replayRuntimeStore, watchRuntimeStoreRoot } from './watcher.js'
import { createWorkspaceRuntimeEnv, resolveWorkspaceRuntimeStoreRoot } from './workspace-env.js'

const require = createRequire(__filename)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

export type NativeHistoryAdapter =
  | 'codex'
  | 'claude-code'
  | 'cline'
  | 'cursor'
  | 'droid'
  | 'goose'
  | 'grok'
  | 'qwen-code'
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
  bestEffortUnavailableAdapters?: NativeHistoryAdapter[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  gooseCli?: GooseCliConfig
  homeDir?: string
  maxFileSizeBytes?: number
  maxFileSizeBytesByAdapter?: Partial<Record<NativeHistoryAdapter, number | null>>
  maxTotalBytes?: number
  readOperations?: NativeHistoryReadOperations
  candidateScope?: NativeHistoryCandidateScope
  threadScope?: NativeHistoryThreadScope
  previewCursor?: string
  previewLimit?: number
  projectPaths?: string[]
  projectScope?: NativeHistoryProjectScope
  sourceDirs?: Partial<Record<NativeHistoryAdapter, string[]>>
  sourcePaths?: string[]
  timeFilter?: NativeHistoryTimeFilter
  timeSort?: NativeHistoryTimeSort
}

export interface NativeHistoryImportDiagnostic {
  adapter: NativeHistoryAdapter
  code: 'adapter_unavailable' | 'history_oversized' | 'unsupported_history_kind' | 'unsupported_history_scope'
  level: 'error' | 'warning'
  message: string
  nativeSessionId?: string
  skippedSessions?: number
  sourcePath?: string
  sourceKind?: 'recipe' | 'subagent'
}

export interface NativeHistoryImportSessionResult {
  adapter: NativeHistoryAdapter
  createdAt: number
  cwd: string
  importedEvents: number
  sessionId: string
  sourcePath: string
  title: string
  updatedAt: number
  workspaceCwd: string
}

export interface NativeHistoryImportResult {
  diagnostics?: NativeHistoryImportDiagnostic[]
  aggregateLimitedBytes: number
  aggregateLimitedFiles: number
  importedEvents: number
  importedSessions: number
  matchedFiles: number
  perFileLimitedBytes: number
  perFileLimitedFiles: number
  rejectedFiles: number
  scannedFiles: number
  sessions: NativeHistoryImportSessionResult[]
  sizeLimitedBytes: number
  sizeLimitedFiles: number
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

export interface NativeHistoryImportPreviewProject {
  path: string
  sessionCount: number
}

export interface NativeHistoryImportAdapterPreview {
  adapter: NativeHistoryAdapter
  aggregateLimitedBytes: number
  aggregateLimitedFiles: number
  candidates: NativeHistoryImportPreviewCandidate[]
  diagnostics: string[]
  hasMore: boolean
  isComplete: boolean
  largeFiles: number
  largestFileBytes: number
  matchedFiles: number
  nextCursor?: string
  perFileLimitedBytes: number
  perFileLimitedFiles: number
  projects: NativeHistoryImportPreviewProject[]
  rejectedFiles: number
  scannedFiles: number
  sizeLimitedBytes: number
  sizeLimitedFiles: number
  totalBytes: number
}

export interface NativeHistoryImportPreviewResult {
  adapters: NativeHistoryImportAdapterPreview[]
  diagnostics?: NativeHistoryImportDiagnostic[]
  aggregateLimitedBytes: number
  aggregateLimitedFiles: number
  hasMore: boolean
  isComplete: boolean
  largeFileThresholdBytes: number
  largeFiles: number
  largestFileBytes: number
  matchedFiles: number
  maxFileSizeBytes: number
  nextCursor?: string
  perFileLimitedBytes: number
  perFileLimitedFiles: number
  rejectedFiles: number
  scannedFiles: number
  sizeLimitedBytes: number
  sizeLimitedFiles: number
  totalBytes: number
}

export interface NativeHistoryReadOperations {
  afterOpen?: (filePath: string) => Promise<void> | void
  beforeOpen?: (filePath: string) => Promise<void> | void
}

interface JsonlRecord {
  line: number
  value: unknown
}

interface NativeHistoryMessage {
  content: string | RuntimeContentItem[]
  id: string
  parentId?: string
  role: 'assistant' | 'system' | 'user'
  ts: number
}

interface NativeHistoryConversation {
  adapter: NativeHistoryAdapter
  createdAt: number
  cwd: string
  messages: NativeHistoryMessage[]
  model?: string
  nativeParentSessionId?: string
  nativeSessionId: string
  nativeSourceRoot?: string
  parentConversation?: Pick<NativeHistoryConversation, 'adapter' | 'nativeSessionId' | 'sourcePath'>
  parentSessionId?: string
  parentNativeSessionId?: string
  parentSourcePath?: string
  sourcePath: string
  threadSource?: string
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

interface NativeHistoryWorkspaceResolutionCache {
  existingWorkspaceByCwd: Map<string, string | null>
  gitRemoteByWorkspace: Map<string, string | null>
  workspaceByGitOrigin: Map<string, string | null>
}

interface CodexSpawnEdge {
  parentThreadId: string
  status: string
}

interface GrokSessionMetadata {
  createdAt?: number
  cwd?: string
  gitOriginUrl?: string
  model?: string
  nativeSessionId: string
  title?: string
  updatedAt?: number
}

interface NativeHistorySourceFile {
  codexThreadMetadata?: CodexThreadMetadata
  createdAt: number
  filePath: string
  isArchived: boolean
  isPinned: boolean
  grokSessionMetadata?: GrokSessionMetadata
  stat: Stats
  updatedAt: number
}

interface NativeHistoryPreviewCursor {
  offsets: Partial<Record<NativeHistoryAdapter, number>>
}

const HISTORY_IMPORT_SOURCE = 'native-history-import'
const HISTORY_IMPORT_MARKER_SEGMENTS = ['caches', 'native-history-import'] as const
const LARGE_NATIVE_HISTORY_FILE_BYTES = 25 * 1024 * 1024
export const DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES = NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
const MAX_NATIVE_HISTORY_PREVIEW_LIMIT = 100
const MAX_NATIVE_HISTORY_JSONL_RECORDS = 200_000
const MAX_NATIVE_HISTORY_JSONL_FRAME_BYTES = 16 * 1024 * 1024
const GOOSE_HISTORY_REQUEST_BUDGET_MS = 30_000
const MAX_HISTORY_WALK_DEPTH = 8
const NATIVE_HISTORY_ADAPTERS: NativeHistoryAdapter[] = [
  'codex',
  'claude-code',
  'cline',
  'cursor',
  'droid',
  'goose',
  'grok',
  'qwen-code'
]
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

const isGrokSyntheticUser = (value: Record<string, unknown>) => (
  value.type === 'user' && asString(value.synthetic_reason) != null
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

interface NativeHistoryReadBudget {
  consumedBytes: number
  maxBytes: number
}

interface NativeHistoryDiagnostics {
  aggregateLimitedBytes: number
  aggregateLimitedFiles: number
  perFileLimitedBytes: number
  perFileLimitedFiles: number
  rejectedFiles: number
  sizeLimitedBytes: number
  sizeLimitedFiles: number
}

class NativeHistoryReadLimitError extends Error {
  constructor(
    readonly scope: 'aggregate' | 'file',
    readonly filePath: string,
    readonly limitBytes: number,
    readonly observedBytes: number,
    readonly fileBytes = observedBytes
  ) {
    super(
      `Native history ${scope} read limit exceeded at ${filePath}: ` +
        `${observedBytes} bytes exceeds ${limitBytes} bytes.`
    )
  }
}

class NativeHistoryFileChangedError extends Error {
  constructor(filePath: string, reason: string) {
    super(`Native history file changed or is unsafe at ${filePath}: ${reason}`)
  }
}

const recordNativeHistoryDiagnostic = (
  diagnostics: NativeHistoryDiagnostics,
  error: unknown
) => {
  if (error instanceof NativeHistoryReadLimitError) {
    const fileBytes = Math.max(0, error.fileBytes)
    diagnostics.sizeLimitedFiles += 1
    diagnostics.sizeLimitedBytes += fileBytes
    if (error.scope === 'file') {
      diagnostics.perFileLimitedFiles += 1
      diagnostics.perFileLimitedBytes += fileBytes
    } else {
      diagnostics.aggregateLimitedFiles += 1
      diagnostics.aggregateLimitedBytes += fileBytes
    }
    return
  }
  diagnostics.rejectedFiles += 1
}

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

const readCodexSessionIndexThreadNames = async (
  homeDir: string,
  readContext: {
    budget: NativeHistoryReadBudget
    maxFileSizeBytes: number
    operations?: NativeHistoryReadOperations
  },
  diagnostics: NativeHistoryDiagnostics
) => {
  const threadNames = new Map<string, string>()
  const indexPath = resolveCodexSessionIndexPaths(homeDir).find(filePath => existsSync(filePath))
  if (indexPath == null) {
    return threadNames
  }

  try {
    const content = await readBoundedNativeHistoryText({
      ...readContext,
      expectedStat: lstatSync(indexPath),
      filePath: indexPath
    })
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') {
        continue
      }
      const record = JSON.parse(trimmed) as unknown
      if (!isRecord(record)) {
        throw new Error(`Codex session index record is not an object: ${indexPath}`)
      }
      const nativeSessionId = asString(record.id)
      const threadName = asString(record.thread_name) ?? asString(record.threadName)
      if (nativeSessionId != null && threadName != null) {
        threadNames.set(nativeSessionId, threadName)
      }
    }
  } catch (error) {
    recordNativeHistoryDiagnostic(diagnostics, error)
    logger.warn({ error, indexPath }, '[runtime-store] Failed to read Codex session index')
  }
  return threadNames
}

const readCodexPinnedThreadIds = async (
  homeDir: string,
  readContext: {
    budget: NativeHistoryReadBudget
    maxFileSizeBytes: number
    operations?: NativeHistoryReadOperations
  },
  diagnostics: NativeHistoryDiagnostics
) => {
  const statePath = resolveCodexGlobalStatePaths(homeDir).find(filePath => existsSync(filePath))
  if (statePath == null) {
    return new Set<string>()
  }

  try {
    const state = JSON.parse(
      await readBoundedNativeHistoryText({
        ...readContext,
        expectedStat: lstatSync(statePath),
        filePath: statePath
      })
    ) as unknown
    if (!isRecord(state)) {
      throw new Error(`Codex global state is not an object: ${statePath}`)
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
    recordNativeHistoryDiagnostic(diagnostics, error)
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
    Array.from(
      database.prepare('PRAGMA table_info(threads)').iterate() as Iterable<Record<string, unknown>>
    )
      .map(row => asString(row.name))
      .filter((value): value is string => value != null)
  )

const readCodexTableNames = (database: NodeDatabaseSync) =>
  new Set(
    Array.from(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").iterate() as Iterable<
        Record<string, unknown>
      >
    )
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
  `).iterate() as Iterable<Record<string, unknown>>
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
  childThreadIds: Set<string>,
  readContext: {
    budget: NativeHistoryReadBudget
    maxFileSizeBytes: number
    operations?: NativeHistoryReadOperations
  }
) => {
  const completedChildThreadIds = new Set<string>()
  const records = await readJsonlRecords(filePath, 'codex', {
    budget: readContext.budget,
    expectedStat: lstatSync(filePath),
    maxFileSizeBytes: readContext.maxFileSizeBytes,
    operations: readContext.operations
  })

  for (const item of records) {
    const record = item.value
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
            return completedChildThreadIds
          }
        }
      }
    }
  }

  return completedChildThreadIds
}

const readCodexCompletedSubagentNotificationIds = async (
  spawnEdges: Map<string, CodexSpawnEdge>,
  threadRolloutPaths: Map<string, string>,
  readContext: {
    budget: NativeHistoryReadBudget
    diagnostics: NativeHistoryDiagnostics
    maxFileSizeBytes: number
    operations?: NativeHistoryReadOperations
  }
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
      const completedIds = await readCodexCompletedSubagentNotificationIdsFromRollout(
        rolloutPath,
        childThreadIds,
        readContext
      )
      for (const completedId of completedIds) {
        completedChildThreadIds.add(completedId)
      }
    } catch (error) {
      recordNativeHistoryDiagnostic(readContext.diagnostics, error)
      logger.warn({ error, rolloutPath }, '[runtime-store] Failed to read Codex subagent notifications')
    }
  }

  return completedChildThreadIds
}

const readCodexThreadMetadataIndex = async (
  homeDir: string,
  readContext: {
    budget: NativeHistoryReadBudget
    diagnostics: NativeHistoryDiagnostics
    maxFileSizeBytes: number
    operations?: NativeHistoryReadOperations
  }
): Promise<CodexThreadMetadataIndex> => {
  const pinnedThreadIds = await readCodexPinnedThreadIds(homeDir, readContext, readContext.diagnostics)
  const sessionIndexThreadNames = await readCodexSessionIndexThreadNames(
    homeDir,
    readContext,
    readContext.diagnostics
  )
  const databasePath = resolveCodexStateDatabasePaths(homeDir).find(filePath => existsSync(filePath))
  if (databasePath == null) {
    return applyCodexSessionIndexThreadNames(
      createEmptyCodexThreadMetadataIndex(pinnedThreadIds),
      sessionIndexThreadNames
    )
  }

  let database: NodeDatabaseSync | undefined
  let snapshotDir: string | undefined
  try {
    const databaseBytes = await readBoundedNativeHistoryBuffer({
      ...readContext,
      expectedStat: lstatSync(databasePath),
      filePath: databasePath
    })
    snapshotDir = await mkdtemp(path.join(tmpdir(), 'oneworks-codex-history-'))
    const snapshotPath = path.join(snapshotDir, 'state.sqlite')
    await writeFile(snapshotPath, databaseBytes, { flag: 'wx', mode: 0o600 })
    database = new DatabaseSync(snapshotPath, { readOnly: true })
    const columns = readCodexThreadMetadataColumns(database)
    if (!columns.has('id') || !columns.has('rollout_path')) {
      return applyCodexSessionIndexThreadNames(
        createEmptyCodexThreadMetadataIndex(pinnedThreadIds),
        sessionIndexThreadNames
      )
    }
    const spawnEdges = readCodexSpawnEdges(database, readCodexTableNames(database))

    const index = createEmptyCodexThreadMetadataIndex(pinnedThreadIds)
    const threadRolloutPaths = new Map<string, string>()
    const rows = database.prepare(`
      SELECT ${buildCodexThreadMetadataSelect(columns)}
      FROM threads
    `).iterate() as Iterable<Record<string, unknown>>
    for (const row of rows) {
      const nativeSessionId = asString(row.id)
      if (nativeSessionId == null) {
        continue
      }
      const sourcePath = asString(row.rollout_path)
      if (sourcePath != null) {
        threadRolloutPaths.set(nativeSessionId, sourcePath)
      }
      const gitOriginUrl = asString(row.git_origin_url)
      const spawnStatus = spawnEdges.get(nativeSessionId)?.status
      const threadSource = asString(row.thread_source)
      const isArchived = typeof row.archived === 'number' ? row.archived !== 0 : undefined
      const metadata: CodexThreadMetadata = {
        createdAt: readCodexThreadTimestamp(row.created_at_ms, row.created_at),
        cwd: asString(row.cwd),
        gitOriginUrl: gitOriginUrl == null ? undefined : normalizeRemoteUrl(gitOriginUrl),
        isArchived: isArchived === true || spawnStatus === 'closed' ? true : isArchived,
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
    const completedSubagentThreadIds = await readCodexCompletedSubagentNotificationIds(
      spawnEdges,
      threadRolloutPaths,
      readContext
    )
    for (const nativeSessionId of completedSubagentThreadIds) {
      const metadata = index.byNativeSessionId.get(nativeSessionId)
      if (metadata != null) metadata.isArchived = true
    }

    return applyCodexSessionIndexThreadNames(index, sessionIndexThreadNames)
  } catch (error) {
    recordNativeHistoryDiagnostic(readContext.diagnostics, error)
    logger.warn({ databasePath, error }, '[runtime-store] Failed to read Codex thread metadata')
    return applyCodexSessionIndexThreadNames(
      createEmptyCodexThreadMetadataIndex(pinnedThreadIds),
      sessionIndexThreadNames
    )
  } finally {
    if (database?.isOpen === true) {
      database.close()
    }
    if (snapshotDir != null) {
      await rm(snapshotDir, { force: true, recursive: true })
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

const isSafeNativeHistoryPath = (authorityRoot: string, targetPath: string) => {
  const root = path.resolve(authorityRoot)
  const target = path.resolve(targetPath)
  if (!isPathInside(root, target)) return false
  try {
    let current = root
    for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment)
      if (lstatSync(current).isSymbolicLink()) return false
    }
    return isPathInside(realpathSync(root), realpathSync(target))
  } catch {
    return false
  }
}

const isArchivedNativeHistoryFile = (
  adapter: NativeHistoryAdapter,
  homeDir: string,
  filePath: string
) => adapter === 'codex' && isPathInside(path.join(homeDir, '.codex', 'archived_sessions'), filePath)

const toCursorProjectKey = (value: string) => (
  value
    .replace(/[^a-z0-9]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
)

const readCursorProjectKeyFromSourcePath = (homeDir: string, filePath: string) => {
  const projectsDir = normalizeRealPath(path.join(homeDir, '.cursor', 'projects'))
  const relativePath = path.relative(projectsDir, normalizeRealPath(filePath))
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return undefined
  }
  return relativePath.split(path.sep)[0]
}

const readCursorWorkspaceFolder = async (
  workspaceJsonPath: string,
  readContext: {
    budget: NativeHistoryReadBudget
    maxFileSizeBytes: number
    operations?: NativeHistoryReadOperations
  },
  diagnostics: NativeHistoryDiagnostics
) => {
  try {
    const value = JSON.parse(
      await readBoundedNativeHistoryText({
        ...readContext,
        expectedStat: lstatSync(workspaceJsonPath),
        filePath: workspaceJsonPath
      })
    ) as unknown
    if (!isRecord(value)) throw new Error(`Cursor workspace metadata is not an object: ${workspaceJsonPath}`)
    const location = asString(value.folder) ?? asString(value.workspace)
    if (location == null) return undefined
    const candidatePath = location.startsWith('file:')
      ? fileURLToPath(location)
      : path.resolve(path.dirname(workspaceJsonPath), location)
    const stats = statSync(candidatePath)
    return stats.isDirectory()
      ? normalizeRealPath(candidatePath)
      : stats.isFile()
      ? normalizeRealPath(path.dirname(candidatePath))
      : undefined
  } catch (error) {
    recordNativeHistoryDiagnostic(diagnostics, error)
    logger.warn({ error, workspaceJsonPath }, '[runtime-store] Failed to read Cursor workspace metadata')
    return undefined
  }
}

const readCursorWorkspaceRoots = async (
  homeDir: string,
  env: NodeJS.ProcessEnv,
  readContext: {
    budget: NativeHistoryReadBudget
    maxFileSizeBytes: number
    operations?: NativeHistoryReadOperations
  },
  diagnostics: NativeHistoryDiagnostics
) => {
  const storageRoots = unique([
    env.CURSOR_DATA_PATH == null ? '' : path.join(env.CURSOR_DATA_PATH, 'User', 'workspaceStorage'),
    env.APPDATA == null ? '' : path.join(env.APPDATA, 'Cursor', 'User', 'workspaceStorage'),
    path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage'),
    path.join(homeDir, '.config', 'Cursor', 'User', 'workspaceStorage'),
    path.join(homeDir, 'AppData', 'Roaming', 'Cursor', 'User', 'workspaceStorage')
  ].filter(Boolean))
  const workspaceRoots: string[] = []
  for (const storageRoot of storageRoots) {
    let entries: Dirent[]
    try {
      entries = readdirSync(storageRoot, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const workspaceJsonPath = path.join(storageRoot, entry.name, 'workspace.json')
      if (!existsSync(workspaceJsonPath)) continue
      const workspaceRoot = await readCursorWorkspaceFolder(workspaceJsonPath, readContext, diagnostics)
      if (workspaceRoot != null) workspaceRoots.push(workspaceRoot)
    }
  }
  return unique(workspaceRoots)
}

const resolveCursorConversationCwd = (
  filePath: string,
  homeDir: string,
  projectContext: ProjectMatchContext,
  projectPaths?: string[]
) => {
  const projectKey = readCursorProjectKeyFromSourcePath(homeDir, filePath)
  if (projectKey == null) return undefined
  const candidateRoots = unique([
    ...projectContext.roots,
    ...(projectPaths ?? []).map(normalizeRealPath)
  ])
  return candidateRoots.find((root) => {
    const rootKey = toCursorProjectKey(root)
    return rootKey === projectKey || rootKey === `private-${projectKey}` || projectKey === `private-${rootKey}`
  })
}

const readCursorNativeSessionId = (filePath: string) => path.basename(filePath, '.jsonl')

const readCursorThreadSource = (filePath: string) => (
  filePath.split(path.sep).includes('subagents') ? 'subagent' : undefined
)

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

const assertNativeHistoryPathIdentity = (
  filePath: string,
  openedStat: { dev: bigint; ino: bigint }
) => {
  let pathStat: Stats
  try {
    pathStat = lstatSync(filePath)
  } catch {
    throw new NativeHistoryFileChangedError(filePath, 'the path disappeared after open')
  }
  if (
    !pathStat.isFile() || pathStat.isSymbolicLink() ||
    BigInt(pathStat.dev) !== openedStat.dev || BigInt(pathStat.ino) !== openedStat.ino
  ) {
    throw new NativeHistoryFileChangedError(filePath, 'the opened file no longer matches the path')
  }
}

const readBoundedNativeHistoryBuffer = async (params: {
  budget: NativeHistoryReadBudget
  expectedStat: Stats
  filePath: string
  maxFileSizeBytes: number
  operations?: NativeHistoryReadOperations
}) => {
  if (!params.expectedStat.isFile() || params.expectedStat.isSymbolicLink()) {
    throw new NativeHistoryFileChangedError(params.filePath, 'the inspected path is not a regular file')
  }
  if (params.expectedStat.size > params.maxFileSizeBytes) {
    throw new NativeHistoryReadLimitError(
      'file',
      params.filePath,
      params.maxFileSizeBytes,
      params.expectedStat.size
    )
  }
  const aggregateRemaining = params.budget.maxBytes - params.budget.consumedBytes
  if (params.expectedStat.size > aggregateRemaining) {
    throw new NativeHistoryReadLimitError(
      'aggregate',
      params.filePath,
      params.budget.maxBytes,
      params.budget.consumedBytes + params.expectedStat.size,
      params.expectedStat.size
    )
  }

  await params.operations?.beforeOpen?.(params.filePath)
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const handle = await open(params.filePath, constants.O_RDONLY | noFollow)
  try {
    const openedStat = await handle.stat({ bigint: true })
    if (
      !openedStat.isFile() ||
      openedStat.dev !== BigInt(params.expectedStat.dev) ||
      openedStat.ino !== BigInt(params.expectedStat.ino) ||
      openedStat.size !== BigInt(params.expectedStat.size)
    ) {
      throw new NativeHistoryFileChangedError(params.filePath, 'identity or size changed before open')
    }
    assertNativeHistoryPathIdentity(params.filePath, openedStat)
    await params.operations?.afterOpen?.(params.filePath)
    assertNativeHistoryPathIdentity(params.filePath, openedStat)

    const chunks: Buffer[] = []
    let fileBytes = 0
    while (true) {
      const fileRemaining = params.maxFileSizeBytes - fileBytes
      const totalRemaining = params.budget.maxBytes - params.budget.consumedBytes
      const readSize = Math.max(1, Math.min(64 * 1024, fileRemaining + 1, totalRemaining + 1))
      const buffer = Buffer.allocUnsafe(readSize)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      fileBytes += bytesRead
      params.budget.consumedBytes += bytesRead
      if (fileBytes > params.maxFileSizeBytes) {
        throw new NativeHistoryReadLimitError(
          'file',
          params.filePath,
          params.maxFileSizeBytes,
          fileBytes
        )
      }
      if (params.budget.consumedBytes > params.budget.maxBytes) {
        throw new NativeHistoryReadLimitError(
          'aggregate',
          params.filePath,
          params.budget.maxBytes,
          params.budget.consumedBytes,
          fileBytes
        )
      }
      chunks.push(buffer.subarray(0, bytesRead))
    }

    const finalStat = await handle.stat({ bigint: true })
    if (
      !finalStat.isFile() ||
      finalStat.dev !== openedStat.dev ||
      finalStat.ino !== openedStat.ino ||
      finalStat.size !== openedStat.size ||
      finalStat.mtimeNs !== openedStat.mtimeNs ||
      finalStat.ctimeNs !== openedStat.ctimeNs ||
      finalStat.size !== BigInt(fileBytes)
    ) {
      if (finalStat.size > BigInt(params.maxFileSizeBytes)) {
        throw new NativeHistoryReadLimitError(
          'file',
          params.filePath,
          params.maxFileSizeBytes,
          Number(finalStat.size)
        )
      }
      throw new NativeHistoryFileChangedError(params.filePath, 'identity, size, or timestamps changed while reading')
    }
    assertNativeHistoryPathIdentity(params.filePath, openedStat)
    return Buffer.concat(chunks, fileBytes)
  } finally {
    await handle.close()
  }
}

const readBoundedNativeHistoryText = async (
  params: Parameters<typeof readBoundedNativeHistoryBuffer>[0]
) => (await readBoundedNativeHistoryBuffer(params)).toString('utf8')

const readJsonlRecords = async (
  filePath: string,
  adapter: NativeHistoryAdapter,
  readContext: {
    authorityRoot?: string
    budget: NativeHistoryReadBudget
    expectedStat: Stats
    maxFileSizeBytes: number
    maxRecords?: number
    operations?: NativeHistoryReadOperations
  }
): Promise<JsonlRecord[]> => {
  if (readContext.authorityRoot != null && !isSafeNativeHistoryPath(readContext.authorityRoot, filePath)) {
    throw new NativeHistoryFileChangedError(filePath, 'the source path escaped its configured authority root')
  }
  const records: JsonlRecord[] = []
  const content = await readBoundedNativeHistoryText({
    ...readContext,
    filePath
  })
  const lines = content.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (readContext.maxRecords != null && index + 1 > readContext.maxRecords) {
      throw new Error('Native history JSONL exceeded the safe parser record limit while being read.')
    }
    if (
      readContext.maxRecords != null &&
      Buffer.byteLength(line, 'utf8') > MAX_NATIVE_HISTORY_JSONL_FRAME_BYTES
    ) {
      throw new NativeHistoryReadLimitError(
        'file',
        filePath,
        MAX_NATIVE_HISTORY_JSONL_FRAME_BYTES,
        Buffer.byteLength(line, 'utf8')
      )
    }
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    if (adapter === 'codex' && trimmed.includes('function_call_output')) {
      continue
    }
    try {
      records.push({ line: index + 1, value: JSON.parse(trimmed) as unknown })
    } catch (error) {
      if (adapter === 'qwen-code') {
        throw new Error(`Malformed Qwen Code JSONL at ${filePath}:${index + 1}`, { cause: error })
      }
      if (adapter === 'droid') return []
      continue
    }
  }
  if (readContext.authorityRoot != null && !isSafeNativeHistoryPath(readContext.authorityRoot, filePath)) {
    throw new NativeHistoryFileChangedError(filePath, 'the source path changed while it was being read')
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
      } else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.jsonl')) {
        files.push(entryPath)
      }
    }
  }

  await visit(root, 0)
  return files
}

const isQwenHistoryFilePath = (filePath: string) => {
  const parentDir = path.dirname(filePath)
  const parentName = path.basename(parentDir)
  const grandparentName = path.basename(path.dirname(parentDir))
  return parentName === 'chats' || grandparentName === 'subagents'
}

const QWEN_HISTORY_VERSION = '0.21.11'
const QWEN_HISTORY_META_MAX_FILE_SIZE_BYTES = 1024 * 1024

const isSafeQwenHistoryRegularFile = (params: {
  filePath: string
  maxFileSizeBytes: number
  sourceDirs: string[]
}) =>
  params.sourceDirs.some((sourceDir) => {
    const root = path.resolve(sourceDir)
    const filePath = path.resolve(params.filePath)
    if (!isPathInside(root, filePath)) return false
    try {
      const relativePath = path.relative(root, filePath)
      if (relativePath === '' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        return false
      }
      let currentPath = root
      for (const segment of relativePath.split(path.sep)) {
        currentPath = path.join(currentPath, segment)
        if (lstatSync(currentPath).isSymbolicLink()) return false
      }
      const fileStat = lstatSync(filePath)
      if (!fileStat.isFile() || fileStat.size > params.maxFileSizeBytes) return false
      return isPathInside(realpathSync(root), realpathSync(filePath))
    } catch {
      return false
    }
  })

const filterNativeHistoryFiles = (
  adapter: NativeHistoryAdapter,
  files: string[]
) => (
  adapter === 'grok'
    ? files.filter(filePath => path.basename(filePath) === 'chat_history.jsonl')
    : adapter === 'qwen-code'
    ? files.filter(filePath => isQwenHistoryFilePath(filePath))
    : files
)

const resolveSourceDirs = (
  adapter: NativeHistoryAdapter,
  homeDir: string,
  sourceDirs?: Partial<Record<NativeHistoryAdapter, string[]>>,
  env: NodeJS.ProcessEnv = process.env
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

  if (adapter === 'cursor') {
    return [path.join(homeDir, '.cursor', 'projects')]
  }

  if (adapter === 'droid') {
    return [path.join(homeDir, '.factory', 'sessions')]
  }

  if (adapter === 'cline') {
    return [path.join(homeDir, '.cline', 'data')]
  }

  if (adapter === 'grok') {
    const grokHome = asString(env.GROK_HOME) ?? path.join(homeDir, '.grok')
    return [path.join(grokHome, 'sessions')]
  }

  if (adapter === 'qwen-code') {
    const qwenRuntimeDir = asString(env.QWEN_RUNTIME_DIR) ??
      asString(env.QWEN_HOME) ??
      path.join(homeDir, '.qwen')
    return [path.join(qwenRuntimeDir, 'projects')]
  }

  return [
    path.join(homeDir, '.claude', 'projects')
  ]
}

const listNativeHistoryJsonlFiles = async (
  sourceDirs: string[],
  sourcePaths: string[] | undefined,
  authorityRoot?: string
) => {
  const safeSourceDirs = sourceDirs.filter((sourceDir) => {
    try {
      if (authorityRoot != null && !isSafeNativeHistoryPath(authorityRoot, sourceDir)) return false
      const sourceStat = lstatSync(sourceDir)
      return sourceStat.isDirectory() && !sourceStat.isSymbolicLink()
    } catch {
      return false
    }
  })
  if (sourcePaths != null) {
    const seenPaths = new Set<string>()
    return sourcePaths
      .map(filePath => path.resolve(filePath))
      .filter((filePath) => {
        if (seenPaths.has(filePath)) {
          return false
        }
        seenPaths.add(filePath)
        return true
      })
      .filter(filePath => filePath.endsWith('.jsonl'))
      .filter(filePath =>
        sourceDirs.some((sourceDir) => {
          const relativePath = path.relative(path.resolve(sourceDir), filePath)
          return relativePath !== '' && relativePath !== '..' &&
            !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath)
        })
      )
  }

  const files: string[] = []
  for (const sourceDir of safeSourceDirs) {
    files.push(...(await walkJsonlFiles(sourceDir)).filter(filePath => (
      authorityRoot == null || isSafeNativeHistoryPath(authorityRoot, filePath)
    )))
  }
  return unique(files)
}

const readGrokSessionMetadata = async (
  filePath: string,
  readContext: {
    budget: NativeHistoryReadBudget
    maxFileSizeBytes: number
    operations?: NativeHistoryReadOperations
  },
  diagnostics: NativeHistoryDiagnostics
): Promise<GrokSessionMetadata | undefined> => {
  const summaryPath = path.join(path.dirname(filePath), 'summary.json')
  if (!existsSync(summaryPath)) return undefined
  try {
    const summary = JSON.parse(
      await readBoundedNativeHistoryText({
        ...readContext,
        expectedStat: lstatSync(summaryPath),
        filePath: summaryPath
      })
    ) as unknown
    if (!isRecord(summary)) throw new Error(`Grok summary is not an object: ${summaryPath}`)
    const info = isRecord(summary.info) ? summary.info : undefined
    const nativeSessionId = asString(info?.id) ?? path.basename(path.dirname(filePath))
    const gitRemotes = asStringArray(summary.git_remotes)
    return {
      nativeSessionId,
      cwd: asString(info?.cwd),
      createdAt: getEventTime(summary.created_at, 0) || undefined,
      updatedAt: getEventTime(summary.last_active_at ?? summary.updated_at, 0) || undefined,
      title: asString(summary.session_summary),
      model: asString(summary.current_model_id),
      gitOriginUrl: gitRemotes[0]
    }
  } catch (error) {
    recordNativeHistoryDiagnostic(diagnostics, error)
    logger.warn({ error, summaryPath }, '[runtime-store] Failed to read Grok summary metadata')
    return undefined
  }
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

const createNativeHistoryWorkspaceResolutionCache = (): NativeHistoryWorkspaceResolutionCache => ({
  existingWorkspaceByCwd: new Map(),
  gitRemoteByWorkspace: new Map(),
  workspaceByGitOrigin: new Map()
})

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
  projectScope: NativeHistoryProjectScope,
  codexThreadMetadata?: CodexThreadMetadata,
  codexThreadMetadataIndex?: CodexThreadMetadataIndex,
  resolutionCache = createNativeHistoryWorkspaceResolutionCache()
) => {
  if (projectScope !== 'all-projects') {
    return fallbackCwd
  }

  const resolveExistingWorkspace = (candidateCwd: string) => {
    const normalizedCandidateCwd = normalizeRealPath(candidateCwd)
    if (resolutionCache.existingWorkspaceByCwd.has(normalizedCandidateCwd)) {
      return resolutionCache.existingWorkspaceByCwd.get(normalizedCandidateCwd) ?? undefined
    }

    try {
      if (!statSync(candidateCwd).isDirectory()) {
        resolutionCache.existingWorkspaceByCwd.set(normalizedCandidateCwd, null)
        return undefined
      }
    } catch {
      resolutionCache.existingWorkspaceByCwd.set(normalizedCandidateCwd, null)
      return undefined
    }

    const candidateEnv = createWorkspaceRuntimeEnv(candidateCwd, env)
    const sharedWorkspace = resolveProjectSharedWorkspaceFolder(candidateCwd, candidateEnv)
    let workspaceCwd: string
    try {
      workspaceCwd = statSync(sharedWorkspace).isDirectory()
        ? normalizeRealPath(sharedWorkspace)
        : normalizeRealPath(candidateCwd)
    } catch {
      workspaceCwd = normalizeRealPath(candidateCwd)
    }
    resolutionCache.existingWorkspaceByCwd.set(normalizedCandidateCwd, workspaceCwd)
    return workspaceCwd
  }

  const directWorkspace = resolveExistingWorkspace(conversationCwd)
  if (directWorkspace != null) {
    return directWorkspace
  }

  const normalizedGitOriginUrl = codexThreadMetadata?.gitOriginUrl == null
    ? undefined
    : normalizeRemoteUrl(codexThreadMetadata.gitOriginUrl)
  if (normalizedGitOriginUrl == null || codexThreadMetadataIndex == null) {
    return normalizeRealPath(conversationCwd)
  }

  if (resolutionCache.workspaceByGitOrigin.has(normalizedGitOriginUrl)) {
    return resolutionCache.workspaceByGitOrigin.get(normalizedGitOriginUrl) ?? normalizeRealPath(conversationCwd)
  }

  const workspaceFrequency = new Map<string, number>()
  for (const metadata of codexThreadMetadataIndex.byNativeSessionId.values()) {
    if (
      metadata.cwd == null ||
      metadata.gitOriginUrl == null ||
      normalizeRemoteUrl(metadata.gitOriginUrl) !== normalizedGitOriginUrl
    ) {
      continue
    }
    const workspaceCwd = resolveExistingWorkspace(metadata.cwd)
    let workspaceGitRemote = workspaceCwd == null
      ? undefined
      : resolutionCache.gitRemoteByWorkspace.get(workspaceCwd) ?? undefined
    if (workspaceCwd != null && !resolutionCache.gitRemoteByWorkspace.has(workspaceCwd)) {
      workspaceGitRemote = resolveGitProjectIdentity(workspaceCwd)?.remoteUrl
      resolutionCache.gitRemoteByWorkspace.set(workspaceCwd, workspaceGitRemote ?? null)
    }
    if (workspaceCwd != null && workspaceGitRemote === normalizedGitOriginUrl) {
      workspaceFrequency.set(workspaceCwd, (workspaceFrequency.get(workspaceCwd) ?? 0) + 1)
    }
  }

  const resolvedWorkspace = Array.from(workspaceFrequency.entries())
    .sort(([leftPath, leftCount], [rightPath, rightCount]) =>
      rightCount - leftCount ||
      leftPath.length - rightPath.length ||
      leftPath.localeCompare(rightPath)
    )
    .at(0)?.[0]
  resolutionCache.workspaceByGitOrigin.set(normalizedGitOriginUrl, resolvedWorkspace ?? null)
  return resolvedWorkspace ?? normalizeRealPath(conversationCwd)
}

const resolveNativeHistoryImportTarget = (
  conversationCwd: string,
  fallbackCwd: string,
  env: NodeJS.ProcessEnv,
  projectScope: NativeHistoryProjectScope,
  codexThreadMetadata?: CodexThreadMetadata,
  codexThreadMetadataIndex?: CodexThreadMetadataIndex,
  resolutionCache = createNativeHistoryWorkspaceResolutionCache()
) => {
  const workspaceCwd = resolveConversationWorkspaceCwd(
    conversationCwd,
    fallbackCwd,
    env,
    projectScope,
    codexThreadMetadata,
    codexThreadMetadataIndex,
    resolutionCache
  )
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

interface QwenHistoryIdentity {
  agentId?: string
  createdAt: number
  cwd: string
  model?: string
  nativeSessionId: string
  parentNativeSessionId?: string
  parentSourcePath?: string
  threadSource?: 'subagent'
  title?: string
  updatedAt: number
}

interface QwenHistoryValidationContext {
  budget: NativeHistoryReadBudget
  maxFileSizeBytes: number
  operations?: NativeHistoryReadOperations
  sourceDirs: string[]
}

const readQwenPartsText = (value: unknown) => {
  if (!Array.isArray(value)) return undefined
  const text = value.flatMap((part) => {
    if (!isRecord(part)) return []
    const partText = asString(part.text)
    return partText == null ? [] : [partText]
  }).join('\n').trim()
  return text === '' ? undefined : text
}

const failQwenHistoryValidation = (sourcePath: string, reason: string): never => {
  throw new Error(`Unsupported Qwen Code history at ${sourcePath}: ${reason}`)
}

const readQwenBaseHistoryIdentity = (
  sourcePath: string,
  records: JsonlRecord[]
): QwenHistoryIdentity & { isSidechain: boolean } => {
  let agentId: string | undefined
  let cwd: string | undefined
  let model: string | undefined
  let nativeSessionId: string | undefined
  let title: string | undefined
  let createdAt = 0
  let updatedAt = 0
  let isSidechain: boolean | undefined

  for (const record of records) {
    const value = isRecord(record.value)
      ? record.value
      : failQwenHistoryValidation(sourcePath, `record ${record.line} is not an object`)
    if (value.version !== QWEN_HISTORY_VERSION) {
      failQwenHistoryValidation(
        sourcePath,
        `record ${record.line} requires version ${QWEN_HISTORY_VERSION}; received ${
          asString(value.version) ?? 'missing version'
        }`
      )
    }
    const recordCwd = asString(value.cwd) ??
      failQwenHistoryValidation(sourcePath, `record ${record.line} is missing cwd`)
    const recordSessionId = asString(value.sessionId) ??
      failQwenHistoryValidation(sourcePath, `record ${record.line} is missing sessionId`)
    if ((cwd != null && cwd !== recordCwd) || (nativeSessionId != null && nativeSessionId !== recordSessionId)) {
      failQwenHistoryValidation(sourcePath, `record ${record.line} changes cwd or sessionId`)
    }
    cwd = recordCwd
    nativeSessionId = recordSessionId
    const recordAgentId = asString(value.agentId)
    if (agentId != null && recordAgentId !== agentId) {
      failQwenHistoryValidation(sourcePath, `record ${record.line} changes or omits agentId`)
    }
    agentId ??= recordAgentId
    model ??= asString(value.model)
    const recordIsSidechain = value.isSidechain === true
    if (isSidechain != null && recordIsSidechain !== isSidechain) {
      failQwenHistoryValidation(sourcePath, `record ${record.line} changes sidechain identity`)
    }
    isSidechain = recordIsSidechain
    const timestamp = getEventTime(value.timestamp, 0)
    if (timestamp > 0 && createdAt === 0) createdAt = timestamp
    updatedAt = Math.max(updatedAt, timestamp)
    const message = isRecord(value.message) ? value.message : undefined
    if (value.type === 'user' && value.provenance === 'real_user') {
      title ??= readQwenPartsText(message?.parts)
    }
    if (value.type === 'system' && value.subtype === 'custom_title') {
      const payload = isRecord(value.systemPayload) ? value.systemPayload : undefined
      title = asString(payload?.customTitle) ?? title
    }
  }

  if (records.length === 0 || cwd == null || nativeSessionId == null || createdAt === 0) {
    failQwenHistoryValidation(sourcePath, 'records do not contain a complete history identity')
  }
  if (isSidechain === true && agentId == null) {
    failQwenHistoryValidation(sourcePath, 'sidechain records require one consistent agentId')
  }
  return {
    agentId,
    createdAt,
    cwd: cwd ?? failQwenHistoryValidation(sourcePath, 'records do not contain cwd'),
    isSidechain: isSidechain === true,
    model,
    nativeSessionId: nativeSessionId ?? failQwenHistoryValidation(sourcePath, 'records do not contain sessionId'),
    title,
    updatedAt: updatedAt || createdAt
  }
}

const readQwenParentToolCorrelation = (params: {
  agentSourcePath: string
  description?: string
  records: JsonlRecord[]
  toolUseId: string
}) => {
  let matchingCalls = 0
  let matchingResponses = 0
  for (const record of params.records) {
    if (!isRecord(record.value)) continue
    const message = isRecord(record.value.message) ? record.value.message : undefined
    if (!Array.isArray(message?.parts)) continue
    for (const part of message.parts) {
      if (!isRecord(part)) continue
      const functionCall = isRecord(part.functionCall) ? part.functionCall : undefined
      if (asString(functionCall?.id) === params.toolUseId) {
        const args = isRecord(functionCall?.args) ? functionCall.args : undefined
        if (
          asString(functionCall?.name) !== 'agent' ||
          (params.description != null && asString(args?.description) !== params.description)
        ) {
          failQwenHistoryValidation(
            params.agentSourcePath,
            'parent agent functionCall identity does not match metadata'
          )
        }
        matchingCalls += 1
      }
      const functionResponse = isRecord(part.functionResponse) ? part.functionResponse : undefined
      if (asString(functionResponse?.id) === params.toolUseId) {
        const response = isRecord(functionResponse?.response) ? functionResponse.response : undefined
        const output = asString(response?.output)
        if (
          asString(functionResponse?.name) !== 'agent' ||
          output == null ||
          !output.includes(params.agentSourcePath)
        ) {
          failQwenHistoryValidation(
            params.agentSourcePath,
            'parent agent functionResponse does not identify this child'
          )
        }
        matchingResponses += 1
      }
    }
  }
  if (matchingCalls !== 1 || matchingResponses !== 1) {
    failQwenHistoryValidation(
      params.agentSourcePath,
      `parent correlation requires exactly one agent call and response; received ${matchingCalls}/${matchingResponses}`
    )
  }
}

const readQwenHistoryIdentity = async (
  sourcePath: string,
  records: JsonlRecord[],
  validation: QwenHistoryValidationContext
): Promise<QwenHistoryIdentity> => {
  const baseIdentity = readQwenBaseHistoryIdentity(sourcePath, records)
  const parentDir = path.dirname(sourcePath)
  const parentName = path.basename(parentDir)
  const isChat = parentName === 'chats'
  const isSubagent = path.basename(path.dirname(parentDir)) === 'subagents'
  if (isChat) {
    if (baseIdentity.isSidechain || path.basename(sourcePath, '.jsonl') !== baseIdentity.nativeSessionId) {
      failQwenHistoryValidation(sourcePath, 'chat filename/session/sidechain identity is inconsistent')
    }
    const { isSidechain: _isSidechain, ...identity } = baseIdentity
    return identity
  }
  if (!isSubagent || !baseIdentity.isSidechain || baseIdentity.agentId == null) {
    failQwenHistoryValidation(sourcePath, 'subagent path requires sidechain records and one agentId')
  }
  if (path.basename(sourcePath, '.jsonl') !== `agent-${baseIdentity.agentId}`) {
    failQwenHistoryValidation(sourcePath, 'subagent filename does not match record agentId')
  }

  const metadataPath = sourcePath.replace(/\.jsonl$/u, '.meta.json')
  if (
    !isSafeQwenHistoryRegularFile({
      filePath: metadataPath,
      maxFileSizeBytes: Math.min(validation.maxFileSizeBytes, QWEN_HISTORY_META_MAX_FILE_SIZE_BYTES),
      sourceDirs: validation.sourceDirs
    })
  ) {
    failQwenHistoryValidation(sourcePath, 'subagent metadata is unsafe, oversized, missing, or not a regular file')
  }
  let parsedMetadata: unknown
  try {
    parsedMetadata = JSON.parse(
      await readBoundedNativeHistoryText({
        budget: validation.budget,
        expectedStat: lstatSync(metadataPath),
        filePath: metadataPath,
        maxFileSizeBytes: Math.min(validation.maxFileSizeBytes, QWEN_HISTORY_META_MAX_FILE_SIZE_BYTES),
        operations: validation.operations
      })
    ) as unknown
  } catch (error) {
    if (error instanceof NativeHistoryReadLimitError || error instanceof NativeHistoryFileChangedError) {
      throw error
    }
    failQwenHistoryValidation(sourcePath, 'subagent metadata is malformed')
  }
  const metadata = isRecord(parsedMetadata)
    ? parsedMetadata
    : failQwenHistoryValidation(sourcePath, 'subagent metadata is not an object')
  const metadataAgentId = asString(metadata.agentId)
  const parentNativeSessionId = asString(metadata.parentSessionId)
  const toolUseId = asString(metadata.toolUseId) ??
    failQwenHistoryValidation(sourcePath, 'subagent metadata is missing toolUseId')
  const pathParentSessionId = path.basename(parentDir)
  if (
    metadataAgentId !== baseIdentity.agentId ||
    parentNativeSessionId !== baseIdentity.nativeSessionId ||
    parentNativeSessionId !== pathParentSessionId
  ) {
    failQwenHistoryValidation(sourcePath, 'subagent metadata agent, parent session, or toolUseId is inconsistent')
  }
  const projectDir = path.dirname(path.dirname(path.dirname(sourcePath)))
  const stableParentSessionId = parentNativeSessionId ??
    failQwenHistoryValidation(sourcePath, 'subagent metadata is missing parentSessionId')
  const parentSourcePath = path.join(projectDir, 'chats', `${stableParentSessionId}.jsonl`)
  if (
    !isSafeQwenHistoryRegularFile({
      filePath: parentSourcePath,
      maxFileSizeBytes: validation.maxFileSizeBytes,
      sourceDirs: validation.sourceDirs
    })
  ) {
    failQwenHistoryValidation(sourcePath, 'parent chat is unsafe, oversized, missing, or not a regular file')
  }
  const parentRecords = await readJsonlRecords(parentSourcePath, 'qwen-code', {
    budget: validation.budget,
    expectedStat: lstatSync(parentSourcePath),
    maxFileSizeBytes: validation.maxFileSizeBytes,
    operations: validation.operations
  })
  const parentIdentity = readQwenBaseHistoryIdentity(parentSourcePath, parentRecords)
  if (
    parentIdentity.isSidechain ||
    parentIdentity.nativeSessionId !== stableParentSessionId ||
    path.basename(parentSourcePath, '.jsonl') !== stableParentSessionId ||
    parentIdentity.cwd !== baseIdentity.cwd
  ) {
    failQwenHistoryValidation(sourcePath, 'parent chat identity does not match subagent metadata')
  }
  readQwenParentToolCorrelation({
    agentSourcePath: sourcePath,
    description: asString(metadata.description),
    records: parentRecords,
    toolUseId
  })
  return {
    agentId: baseIdentity.agentId,
    createdAt: baseIdentity.createdAt,
    cwd: baseIdentity.cwd,
    model: baseIdentity.model ?? asString(metadata.model),
    nativeSessionId: `${stableParentSessionId}:${baseIdentity.agentId}`,
    parentNativeSessionId: stableParentSessionId,
    parentSourcePath,
    threadSource: 'subagent',
    title: asString(metadata.description) ?? baseIdentity.title,
    updatedAt: baseIdentity.updatedAt
  }
}

const buildPreviewTitle = (adapter: NativeHistoryAdapter, title: string | undefined) => {
  const normalized = title?.replace(/\s+/g, ' ').trim()
  if (normalized == null || normalized === '') {
    return `${adapter} history`
  }
  return normalized.length > TITLE_MAX_LENGTH ? `${normalized.slice(0, TITLE_MAX_LENGTH - 1)}...` : normalized
}

const readDroidConversationPreview = (params: {
  filePath: string
  fileStat: Stats
  projectContext: ProjectMatchContext
  records: JsonlRecord[]
}): NativeHistoryImportPreviewCandidate | undefined => {
  const metadata = readDroidSessionStart(params.records)
  if (metadata == null || !isConversationInProjectScope(metadata.cwd, params.projectContext, 'all-projects')) {
    return undefined
  }
  let createdAt = 0
  let messageCount = 0
  let updatedAt = 0
  for (const record of params.records.slice(1)) {
    const value = record.value
    if (!isRecord(value)) return undefined
    const role = value.role
    if (
      asString(value.id) == null ||
      (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') ||
      !isValidDroidContent(value.content)
    ) return undefined
    if (toRuntimeContentItems(value.content) == null) continue
    const timestamp = getEventTime(value.createdAt, params.fileStat.birthtimeMs || params.fileStat.mtimeMs)
    if (messageCount === 0) createdAt = timestamp
    updatedAt = timestamp
    messageCount += 1
  }

  const finalStat = statSync(params.filePath)
  if (messageCount === 0) return undefined
  const fileNativeSessionId = path.basename(params.filePath, '.jsonl')
  if (metadata.nativeSessionId != null && metadata.nativeSessionId !== fileNativeSessionId) return undefined
  return {
    adapter: 'droid',
    createdAt: createdAt || finalStat.birthtimeMs || finalStat.mtimeMs,
    cwd: metadata.cwd,
    fileSizeBytes: finalStat.size,
    isArchived: false,
    isImported: false,
    isLarge: finalStat.size >= LARGE_NATIVE_HISTORY_FILE_BYTES,
    isPinned: false,
    nativeSessionId: metadata.nativeSessionId ?? fileNativeSessionId,
    sourcePath: params.filePath,
    ...(metadata.isSubagent ? { threadSource: 'subagent' } : {}),
    title: buildPreviewTitle('droid', metadata.title),
    updatedAt: updatedAt || finalStat.mtimeMs
  }
}

const readConversationPreview = async (
  adapter: NativeHistoryAdapter,
  filePath: string,
  isArchived: boolean,
  codexThreadMetadata?: CodexThreadMetadata,
  fileStat?: Stats,
  codexThreadMetadataIndex?: CodexThreadMetadataIndex,
  homeDir?: string,
  projectContext?: ProjectMatchContext,
  projectPaths?: string[],
  grokSessionMetadata?: GrokSessionMetadata,
  readContext?: {
    budget: NativeHistoryReadBudget
    maxFileSizeBytes: number
    operations?: NativeHistoryReadOperations
  },
  qwenValidation?: QwenHistoryValidationContext
): Promise<NativeHistoryImportPreviewCandidate | undefined> => {
  const stat = fileStat ?? statSync(filePath)
  const effectiveReadContext = readContext ?? {
    budget: { consumedBytes: 0, maxBytes: DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES },
    maxFileSizeBytes: DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
  }
  const records = await readJsonlRecords(filePath, adapter, {
    ...(adapter === 'droid' && homeDir != null
      ? { authorityRoot: homeDir, maxRecords: MAX_NATIVE_HISTORY_JSONL_RECORDS }
      : {}),
    budget: effectiveReadContext.budget,
    expectedStat: stat,
    maxFileSizeBytes: effectiveReadContext.maxFileSizeBytes,
    operations: effectiveReadContext.operations
  })

  if (adapter === 'droid' && projectContext != null) {
    return readDroidConversationPreview({
      filePath,
      fileStat: stat,
      projectContext,
      records
    })
  }

  if (adapter === 'qwen-code') {
    const qwenContext = qwenValidation ?? failQwenHistoryValidation(
      filePath,
      'validation context is unavailable'
    )
    const identity = await readQwenHistoryIdentity(filePath, records, qwenContext)
    return {
      adapter,
      createdAt: identity.createdAt,
      cwd: identity.cwd,
      fileSizeBytes: stat.size,
      isArchived: false,
      isImported: false,
      isLarge: stat.size >= LARGE_NATIVE_HISTORY_FILE_BYTES,
      isPinned: false,
      nativeSessionId: identity.nativeSessionId,
      sourcePath: filePath,
      ...(identity.threadSource == null ? {} : { threadSource: identity.threadSource }),
      title: buildPreviewTitle(adapter, identity.title),
      updatedAt: identity.updatedAt
    }
  }

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

  let createdAt = codexThreadMetadata?.createdAt ?? grokSessionMetadata?.createdAt ?? 0
  let cwd: string | undefined = codexThreadMetadata?.cwd ?? grokSessionMetadata?.cwd
  let nativeSessionId: string | undefined = codexThreadMetadata?.nativeSessionId ??
    grokSessionMetadata?.nativeSessionId
  let parsedRecords = 0
  let title: string | undefined = codexThreadMetadata?.title ?? grokSessionMetadata?.title
  let updatedAt = codexThreadMetadata?.updatedAt ?? grokSessionMetadata?.updatedAt ?? 0

  if (adapter === 'cursor' && homeDir != null && projectContext != null) {
    cwd = resolveCursorConversationCwd(filePath, homeDir, projectContext, projectPaths)
    nativeSessionId = readCursorNativeSessionId(filePath)
  }

  for (const record of records) {
    const value = record.value
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
    } else if (adapter === 'cursor') {
      if (createdAt === 0) createdAt = stat.birthtimeMs || stat.mtimeMs
      if (value.role === 'user') {
        const message = isRecord(value.message) ? value.message : undefined
        title ??= readContentText(message?.content)
      }
    } else if (adapter === 'grok') {
      if (createdAt === 0) createdAt = timestamp
      if (value.type === 'user' && !isGrokSyntheticUser(value)) {
        title ??= readContentText(value.content)
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
      break
    }
  }

  const effectiveCodexThreadMetadata = adapter === 'codex'
    ? getCodexThreadMetadata(codexThreadMetadataIndex, filePath, nativeSessionId) ?? codexThreadMetadata
    : codexThreadMetadata
  const resolvedNativeSessionId = effectiveCodexThreadMetadata?.nativeSessionId ??
    grokSessionMetadata?.nativeSessionId ?? nativeSessionId ??
    path.basename(filePath, '.jsonl')
  const resolvedCwd = effectiveCodexThreadMetadata?.cwd ?? cwd
  if (resolvedCwd == null) {
    return undefined
  }
  const finalStat = statSync(filePath)
  if (finalStat.size > effectiveReadContext.maxFileSizeBytes) return undefined

  return {
    adapter,
    createdAt: effectiveCodexThreadMetadata?.createdAt ?? grokSessionMetadata?.createdAt ??
      (createdAt || stat.birthtimeMs || stat.mtimeMs),
    cwd: resolvedCwd,
    fileSizeBytes: finalStat.size,
    isArchived: effectiveCodexThreadMetadata?.isArchived ?? isArchived,
    isImported: false,
    isLarge: finalStat.size >= LARGE_NATIVE_HISTORY_FILE_BYTES,
    isPinned: effectiveCodexThreadMetadata?.isPinned === true ||
      codexThreadMetadataIndex?.pinnedThreadIds.has(resolvedNativeSessionId) === true,
    nativeSessionId: resolvedNativeSessionId,
    sourcePath: filePath,
    ...((adapter === 'cursor'
        ? readCursorThreadSource(filePath)
        : getVisibleCodexThreadSource(effectiveCodexThreadMetadata)) == null
      ? {}
      : {
        threadSource: adapter === 'cursor'
          ? readCursorThreadSource(filePath)
          : getVisibleCodexThreadSource(effectiveCodexThreadMetadata)
      }),
    title: buildPreviewTitle(adapter, effectiveCodexThreadMetadata?.title ?? grokSessionMetadata?.title ?? title),
    updatedAt: effectiveCodexThreadMetadata?.updatedAt ?? grokSessionMetadata?.updatedAt ??
      (updatedAt || createdAt || stat.mtimeMs)
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
        ...(typeof (item.is_error ?? item.isError) === 'boolean'
          ? { is_error: Boolean(item.is_error ?? item.isError) }
          : {})
      })
    } else if (type === 'image') {
      const source = isRecord(item.source) ? item.source : {}
      const imagePath = asString(source.path)
      const imageUrl = asString(source.url)
      const data = asString(source.data)
      const mediaType = asString(source.mediaType ?? source.media_type) ?? 'image/png'
      if (imagePath != null) content.push({ type: 'image', path: imagePath })
      else if (imageUrl != null) content.push({ type: 'image', url: imageUrl })
      else if (data != null) content.push({ type: 'image', url: `data:${mediaType};base64,${data}` })
    } else if (type === 'document') {
      const source = isRecord(item.source) ? item.source : {}
      const sourceType = asString(source.type)
      const mediaType = asString(source.mediaType)
      const data = asString(source.data)
      const document = data != null && (
          (sourceType === 'base64' && mediaType === 'application/pdf') ||
          (sourceType === 'text' && mediaType === 'text/plain')
        )
        ? projectEmbeddedDocument({
          data,
          encoding: sourceType === 'base64' ? 'base64' : 'utf8',
          mimeType: mediaType as 'application/pdf' | 'text/plain',
          name: asString(source.name)
        })
        : undefined
      if (document != null) content.push(document)
      else {
        const documentPath = asString(source.path)
        if (documentPath != null) content.push({ type: 'file', path: documentPath })
      }
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

const normalizeQwenHistoryToolName = (value: string) => {
  const normalized = value
    .split(/[^a-z0-9]+/iu)
    .filter(Boolean)
    .map(token => `${token[0]?.toUpperCase() ?? ''}${token.slice(1)}`)
    .join('') || 'UnknownTool'
  return `adapter:qwen-code:${normalized}`
}

const normalizeQwenHistoryParts = (value: unknown): RuntimeContentItem[] => {
  if (!Array.isArray(value)) return []
  const content: RuntimeContentItem[] = []
  for (const part of value) {
    if (!isRecord(part)) continue
    const text = asString(part.text)
    if (text != null) {
      content.push({ type: 'text', text })
      continue
    }
    const functionCall = isRecord(part.functionCall) ? part.functionCall : undefined
    if (functionCall != null && asString(functionCall.id) != null && asString(functionCall.name) != null) {
      content.push({
        type: 'tool_use',
        id: asString(functionCall.id)!,
        name: normalizeQwenHistoryToolName(asString(functionCall.name)!),
        input: functionCall.args ?? {}
      })
      continue
    }
    const functionResponse = isRecord(part.functionResponse) ? part.functionResponse : undefined
    if (functionResponse != null && asString(functionResponse.id) != null) {
      const response = isRecord(functionResponse.response) ? functionResponse.response : undefined
      content.push({
        type: 'tool_result',
        tool_use_id: asString(functionResponse.id)!,
        content: response?.output ?? functionResponse.response ?? ''
      })
    }
  }
  return content
}

const parseQwenConversation = async (
  sourcePath: string,
  records: JsonlRecord[],
  projectContext: ProjectMatchContext,
  projectScope: NativeHistoryProjectScope,
  validation: QwenHistoryValidationContext
): Promise<NativeHistoryConversation | undefined> => {
  const identity = await readQwenHistoryIdentity(sourcePath, records, validation)
  if (!isConversationInProjectScope(identity.cwd, projectContext, projectScope)) {
    return undefined
  }
  const messages: NativeHistoryMessage[] = []
  for (const record of records) {
    if (!isRecord(record.value)) return undefined
    const value = record.value
    if (value.type !== 'user' && value.type !== 'assistant' && value.type !== 'tool_result') continue
    const message = isRecord(value.message) ? value.message : undefined
    const contentItems = normalizeQwenHistoryParts(message?.parts)
    if (contentItems.length === 0) continue
    const textOnly = contentItems.every(item => item.type === 'text')
    const role = value.type === 'tool_result' || message?.role === 'model' ? 'assistant' : 'user'
    messages.push({
      id: buildNativeMessageId('qwen-code', sourcePath, record.line, role, asString(value.uuid)),
      role,
      content: textOnly
        ? contentItems.map(item => item.type === 'text' ? item.text : '').join('\n').trim()
        : contentItems,
      ts: getEventTime(value.timestamp, identity.createdAt + record.line)
    })
  }
  if (messages.length === 0) return undefined
  return {
    adapter: 'qwen-code',
    createdAt: identity.createdAt,
    cwd: identity.cwd,
    messages,
    model: identity.model,
    nativeSessionId: identity.nativeSessionId,
    parentNativeSessionId: identity.parentNativeSessionId,
    parentSourcePath: identity.parentSourcePath,
    sourcePath,
    threadSource: identity.threadSource,
    title: identity.title,
    titleIsAuthoritative: identity.threadSource === 'subagent' && identity.title != null,
    updatedAt: identity.updatedAt
  }
}

const parseCursorConversation = (
  sourcePath: string,
  records: JsonlRecord[],
  projectContext: ProjectMatchContext,
  projectScope: NativeHistoryProjectScope,
  homeDir: string,
  projectPaths?: string[]
): NativeHistoryConversation | undefined => {
  const stat = statSync(sourcePath)
  const cwd = resolveCursorConversationCwd(sourcePath, homeDir, projectContext, projectPaths)
  const messages: NativeHistoryMessage[] = []
  const createdAt = stat.birthtimeMs || stat.mtimeMs
  const updatedAt = stat.mtimeMs || createdAt

  for (const record of records) {
    if (!isRecord(record.value)) continue
    const value = record.value
    if (value.role !== 'user' && value.role !== 'assistant') continue
    const message = isRecord(value.message) ? value.message : undefined
    const normalizedContent: RuntimeContentItem[] = []
    const contentItems = Array.isArray(message?.content)
      ? message.content
      : typeof message?.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : []
    for (const [itemIndex, item] of contentItems.entries()) {
      if (!isRecord(item)) continue
      if (item.type === 'text' && asString(item.text) != null) {
        normalizedContent.push({ type: 'text', text: asString(item.text)! })
      } else if (item.type === 'tool_use' && asString(item.name) != null) {
        normalizedContent.push({
          type: 'tool_use',
          id: asString(item.id) ?? buildNativeMessageId('cursor', sourcePath, record.line, `tool-use-${itemIndex}`),
          name: asString(item.name)!,
          input: item.input ?? {}
        })
      } else if (item.type === 'tool_result' && asString(item.tool_use_id) != null) {
        normalizedContent.push({
          type: 'tool_result',
          tool_use_id: asString(item.tool_use_id)!,
          content: item.content ?? '',
          ...(typeof item.is_error === 'boolean' ? { is_error: item.is_error } : {})
        })
      }
    }
    if (normalizedContent.length === 0) continue
    const textOnly = normalizedContent.every(item => item.type === 'text')
    messages.push({
      id: buildNativeMessageId('cursor', sourcePath, record.line, String(value.role)),
      role: value.role,
      content: textOnly
        ? normalizedContent.map(item => item.type === 'text' ? item.text : '').join('\n').trim()
        : normalizedContent,
      ts: updatedAt
    })
  }

  if (!isConversationInProjectScope(cwd, projectContext, projectScope) || messages.length === 0) {
    return undefined
  }
  return {
    adapter: 'cursor',
    createdAt,
    cwd: cwd!,
    messages,
    nativeSessionId: readCursorNativeSessionId(sourcePath),
    sourcePath,
    updatedAt
  }
}

const parseGrokConversation = (
  sourcePath: string,
  records: JsonlRecord[],
  projectContext: ProjectMatchContext,
  projectScope: NativeHistoryProjectScope,
  metadata?: GrokSessionMetadata
): NativeHistoryConversation | undefined => {
  const messages: NativeHistoryMessage[] = []
  const createdAt = metadata?.createdAt ?? statSync(sourcePath).birthtimeMs ?? Date.now()

  for (const record of records) {
    if (!isRecord(record.value)) continue
    const value = record.value
    if (value.type !== 'user' && value.type !== 'assistant') continue
    if (isGrokSyntheticUser(value)) continue
    const content = normalizeClaudeContent(value.content)
    if (content == null) continue
    messages.push({
      id: buildNativeMessageId('grok', sourcePath, record.line, value.type, asString(value.id)),
      role: value.type,
      content,
      ts: Math.min(metadata?.updatedAt ?? Number.POSITIVE_INFINITY, createdAt + record.line)
    })
  }

  if (
    !isConversationInProjectScope(metadata?.cwd, projectContext, projectScope, metadata?.gitOriginUrl) ||
    messages.length === 0
  ) {
    return undefined
  }

  return {
    adapter: 'grok',
    createdAt,
    cwd: metadata!.cwd!,
    messages,
    model: metadata?.model,
    nativeSessionId: metadata?.nativeSessionId ?? path.basename(path.dirname(sourcePath)),
    sourcePath,
    title: metadata?.title,
    titleIsAuthoritative: metadata?.title != null,
    updatedAt: metadata?.updatedAt ?? messages.at(-1)!.ts
  }
}

const readDroidSessionStart = (records: JsonlRecord[]) => {
  const first = records[0]?.value
  if (!isRecord(first) || first.type !== 'session_start') return undefined
  const title = typeof first.title === 'string' ? first.title : undefined
  const cwd = asString(first.cwd)
  if (title == null || cwd == null) return undefined
  return {
    cwd,
    decompMissionId: asString(first.decompMissionId),
    isSubagent: first.decompSessionType === 'worker',
    nativeSessionId: asString(first.sessionId),
    title
  }
}

const isValidDroidContent = (value: unknown) => (
  Array.isArray(value) && value.every((item) => {
    if (!isRecord(item)) return false
    const type = item.type
    if (type === 'text') return typeof item.text === 'string'
    if (type === 'tool_use') {
      return asString(item.id) != null && asString(item.name) != null && isRecord(item.input)
    }
    if (type === 'tool_result') return asString(item.toolUseId) != null
    if (type === 'thinking') return typeof item.thinking === 'string'
    if (type === 'redacted_thinking') return typeof item.data === 'string'
    if (type === 'image') return isRecord(item.source)
    if (type === 'document') {
      const source = isRecord(item.source) ? item.source : {}
      const sourceType = asString(source.type)
      const mediaType = asString(source.mediaType)
      const data = asString(source.data)
      if (data == null) return false
      if (sourceType === 'base64' && mediaType === 'application/pdf') {
        return projectEmbeddedDocument({ data, encoding: 'base64', mimeType: 'application/pdf' }) != null
      }
      if (sourceType === 'text' && mediaType === 'text/plain') {
        return projectEmbeddedDocument({ data, encoding: 'utf8', mimeType: 'text/plain' }) != null
      }
      return false
    }
    return false
  })
)

const parseDroidConversation = (
  sourcePath: string,
  records: JsonlRecord[],
  projectContext: ProjectMatchContext,
  projectScope: NativeHistoryProjectScope
): NativeHistoryConversation | undefined => {
  const metadata = readDroidSessionStart(records)
  if (metadata == null || !isConversationInProjectScope(metadata.cwd, projectContext, projectScope)) {
    return undefined
  }
  const fileNativeSessionId = path.basename(sourcePath, '.jsonl')
  if (metadata.nativeSessionId != null && metadata.nativeSessionId !== fileNativeSessionId) return undefined
  const stat = statSync(sourcePath)
  const messages: NativeHistoryMessage[] = []
  for (const record of records.slice(1)) {
    if (!isRecord(record.value)) return undefined
    const value = record.value
    const id = asString(value.id)
    const role = value.role
    if (
      id == null ||
      (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') ||
      !isValidDroidContent(value.content)
    ) return undefined
    const contentItems = toRuntimeContentItems(value.content)
    if (contentItems == null) continue
    const textOnly = contentItems.every(item => item.type === 'text')
    const timestamp = getEventTime(value.createdAt, stat.birthtimeMs || stat.mtimeMs)
    messages.push({
      id,
      role: role === 'tool' ? 'assistant' : role,
      content: textOnly
        ? contentItems.map(item => item.type === 'text' ? String(item.text ?? '') : '').join('\n').trim()
        : contentItems,
      ...(asString(value.parentId) == null ? {} : { parentId: asString(value.parentId) }),
      ts: timestamp
    })
  }
  if (messages.length === 0) return undefined
  return {
    adapter: 'droid',
    createdAt: messages[0]?.ts ?? stat.birthtimeMs ?? stat.mtimeMs,
    cwd: metadata.cwd,
    messages,
    nativeSessionId: metadata.nativeSessionId ?? fileNativeSessionId,
    sourcePath,
    title: metadata.title,
    titleIsAuthoritative: true,
    updatedAt: messages.at(-1)?.ts ?? stat.mtimeMs
  }
}

const toRuntimeSessionId = (
  conversation: Pick<NativeHistoryConversation, 'adapter' | 'nativeSessionId' | 'sourcePath'>
) => (
  `${IMPORT_SESSION_PREFIX}${conversation.adapter.replace(/[^a-z0-9]+/gi, '_')}_${
    stableHash(
      conversation.adapter === 'droid'
        ? conversation.nativeSessionId
        : `${conversation.nativeSessionId}\0${conversation.sourcePath}`
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
    },
    ...(message.parentId == null ? {} : { parentEventId: message.parentId })
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
  const existingMeta = await store.session(sessionId).readMeta()
  const existingHistoryImport = isRecord(existingMeta?.historyImport) ? existingMeta.historyImport : undefined
  const importedAt = typeof existingHistoryImport?.importedAt === 'number' &&
      Number.isFinite(existingHistoryImport.importedAt)
    ? existingHistoryImport.importedAt
    : Date.now()
  const session = await store.createSession(
    {
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId,
      title,
      cwd: params.workspaceCwd,
      adapter: conversation.adapter,
      ...(conversation.parentSessionId != null
        ? { parentSessionId: conversation.parentSessionId }
        : conversation.parentConversation != null
        ? { parentSessionId: toRuntimeSessionId(conversation.parentConversation) }
        : conversation.parentNativeSessionId != null && conversation.parentSourcePath != null
        ? {
          parentSessionId: toRuntimeSessionId({
            adapter: conversation.adapter,
            nativeSessionId: conversation.parentNativeSessionId,
            sourcePath: conversation.parentSourcePath
          })
        }
        : {}),
      ...(conversation.model != null ? { model: conversation.model } : {}),
      createdAt: conversation.createdAt,
      historyImport: {
        adapter: conversation.adapter,
        importedAt,
        nativeCwd: conversation.cwd,
        ...(conversation.nativeParentSessionId == null && conversation.parentNativeSessionId == null
          ? {}
          : { nativeParentSessionId: conversation.nativeParentSessionId ?? conversation.parentNativeSessionId }),
        nativeSessionId: conversation.nativeSessionId,
        ...(conversation.nativeSourceRoot == null ? {} : { nativeSourceRoot: conversation.nativeSourceRoot }),
        sourcePath: conversation.sourcePath,
        sourceUpdatedAt: conversation.updatedAt,
        workspaceCwd: params.workspaceCwd,
        ...(conversation.threadSource == null ? {} : { threadSource: conversation.threadSource })
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
      cwd: params.workspaceCwd,
      status: 'completed',
      updatedAt: conversation.updatedAt
    })
  ])

  return {
    adapter: conversation.adapter,
    createdAt: conversation.createdAt,
    cwd: conversation.cwd,
    importedEvents,
    sessionId,
    sourcePath: conversation.sourcePath,
    title,
    updatedAt: conversation.updatedAt,
    workspaceCwd: params.workspaceCwd
  }
}

const parseConversation = async (
  adapter: NativeHistoryAdapter,
  filePath: string,
  records: JsonlRecord[],
  projectContext: ProjectMatchContext,
  projectScope: NativeHistoryProjectScope,
  codexThreadMetadata: CodexThreadMetadata | undefined,
  homeDir: string,
  projectPaths: string[] | undefined,
  grokSessionMetadata?: GrokSessionMetadata,
  qwenValidation?: QwenHistoryValidationContext
) =>
  adapter === 'codex'
    ? parseCodexConversation(filePath, records, projectContext, projectScope, codexThreadMetadata)
    : adapter === 'cursor'
    ? parseCursorConversation(filePath, records, projectContext, projectScope, homeDir, projectPaths)
    : adapter === 'droid'
    ? parseDroidConversation(filePath, records, projectContext, projectScope)
    : adapter === 'grok'
    ? parseGrokConversation(filePath, records, projectContext, projectScope, grokSessionMetadata)
    : adapter === 'qwen-code'
    ? qwenValidation == null
      ? failQwenHistoryValidation(filePath, 'validation context is unavailable')
      : parseQwenConversation(filePath, records, projectContext, projectScope, qwenValidation)
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
    } else if (adapter !== 'cursor') {
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
  options.bestEffortUnavailableAdapters != null ||
  options.cwd != null ||
  options.env != null ||
  options.homeDir != null ||
  options.gooseCli != null ||
  options.maxFileSizeBytes != null ||
  options.maxFileSizeBytesByAdapter != null ||
  options.maxTotalBytes != null ||
  options.readOperations != null ||
  options.projectPaths != null ||
  options.projectScope != null ||
  options.sourceDirs != null ||
  options.sourcePaths != null ||
  options.threadScope != null ||
  options.timeFilter != null ||
  options.timeSort != null
)

const createEmptyImportResult = (): NativeHistoryImportResult => ({
  aggregateLimitedBytes: 0,
  aggregateLimitedFiles: 0,
  importedEvents: 0,
  importedSessions: 0,
  matchedFiles: 0,
  perFileLimitedBytes: 0,
  perFileLimitedFiles: 0,
  rejectedFiles: 0,
  scannedFiles: 0,
  sessions: [],
  sizeLimitedBytes: 0,
  sizeLimitedFiles: 0
})

const getImportFileSizeLimit = (
  options: NativeHistoryImportOptions,
  adapter: NativeHistoryAdapter
) => {
  let configuredLimit: number | null | undefined
  if (options.maxFileSizeBytesByAdapter != null && hasOwn(options.maxFileSizeBytesByAdapter, adapter)) {
    configuredLimit = options.maxFileSizeBytesByAdapter[adapter]
  } else {
    configuredLimit = options.maxFileSizeBytes
  }
  if (configuredLimit == null) {
    return adapter === 'goose' ? undefined : DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
  }
  if (
    typeof configuredLimit !== 'number' || !Number.isFinite(configuredLimit) || configuredLimit < 0 ||
    configuredLimit > DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
  ) {
    throw new Error(
      `Native history import size limit must be between 0 and ${DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES} bytes.`
    )
  }
  return configuredLimit
}

const createNativeHistoryReadBudget = (options: NativeHistoryImportOptions): NativeHistoryReadBudget => {
  const maxBytes = options.maxTotalBytes ?? DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
  if (
    !Number.isFinite(maxBytes) || maxBytes < 0 ||
    maxBytes > DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
  ) {
    throw new Error(
      `Native history aggregate read limit must be between 0 and ` +
        `${DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES} bytes.`
    )
  }
  return { consumedBytes: 0, maxBytes }
}

const getGoosePreviewFileSizeLimit = (options: NativeHistoryImportOptions) => {
  if (options.maxFileSizeBytesByAdapter != null && hasOwn(options.maxFileSizeBytesByAdapter, 'goose')) {
    return options.maxFileSizeBytesByAdapter.goose ?? undefined
  }
  if (hasOwn(options, 'maxFileSizeBytes')) return options.maxFileSizeBytes
  return DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
}

const getPreviewFileSizeLimit = (
  options: NativeHistoryImportOptions,
  adapter: NativeHistoryAdapter
) => getImportFileSizeLimit(options, adapter) ?? DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES

const createProjectPathFilter = (projectPaths: string[] | undefined) => (
  projectPaths == null || projectPaths.length === 0
    ? undefined
    : unique(projectPaths.map(projectPath => normalizeRealPath(projectPath)))
)

const matchesProjectPathFilter = (
  projectPathFilter: string[] | undefined,
  conversationCwd: string | undefined
) => (
  projectPathFilter == null ||
  (
    conversationCwd != null &&
    projectPathFilter.some(projectPath => isPathInside(projectPath, conversationCwd))
  )
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
    for (const adapter of NATIVE_HISTORY_ADAPTERS) {
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

const resolveClineMessagesSizeLimit = (configuredLimit: number | undefined) => (
  Math.min(CLINE_HISTORY_MESSAGES_MAX_BYTES, configuredLimit ?? CLINE_HISTORY_MESSAGES_MAX_BYTES)
)

const toClinePreviewCandidate = (session: ClineHistorySession): NativeHistoryImportPreviewCandidate => ({
  adapter: 'cline',
  createdAt: session.createdAt,
  cwd: session.workspaceRoot,
  fileSizeBytes: session.fileSizeBytes,
  isArchived: false,
  isImported: false,
  isLarge: session.fileSizeBytes >= LARGE_NATIVE_HISTORY_FILE_BYTES,
  isPinned: false,
  nativeSessionId: session.nativeSessionId,
  sourcePath: session.sourcePath,
  ...(session.isSubagent ? { threadSource: 'subagent' } : {}),
  title: buildPreviewTitle('cline', session.title),
  updatedAt: session.updatedAt
})

const toClineSessionScopeKey = (session: ClineHistorySession, nativeSessionId = session.nativeSessionId) => (
  `${session.sourceRoot}\0${path.resolve(session.workspaceRoot)}\0${nativeSessionId}`
)

const matchesImportedClineScope = (
  historyImport: Record<string, unknown>,
  session: ClineHistorySession
) => {
  const nativeCwd = asString(historyImport.nativeCwd)
  const nativeSourceRoot = asString(historyImport.nativeSourceRoot)
  const sourcePath = asString(historyImport.sourcePath)
  return nativeCwd != null && normalizeRealPath(nativeCwd) === normalizeRealPath(session.workspaceRoot) &&
    (nativeSourceRoot != null
      ? normalizeRealPath(nativeSourceRoot) === normalizeRealPath(session.sourceRoot)
      : sourcePath != null && isPathInside(session.sourceRoot, sourcePath))
}

const listImportedClineMetas = async (runtimeRoot: string) => {
  const store = new FileRuntimeStore(runtimeRoot)
  const index = await store.readIndex()
  const entries: Array<{ meta: RuntimeMeta; sessionId: string }> = []
  for (const sessionId of Object.keys(index.sessions).sort()) {
    const meta = await store.session(sessionId).readMeta()
    if (meta?.historyImport?.adapter === 'cline') entries.push({ meta, sessionId })
  }
  return entries
}

const findDurableImportedClineParent = async (
  runtimeRoot: string,
  session: ClineHistorySession
) => {
  if (session.parentNativeSessionId == null) return undefined
  const matches = (await listImportedClineMetas(runtimeRoot)).filter(({ meta }) => {
    const historyImport = isRecord(meta.historyImport) ? meta.historyImport : undefined
    return historyImport != null &&
      asString(historyImport.nativeSessionId) === session.parentNativeSessionId &&
      matchesImportedClineScope(historyImport, session)
  })
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous imported Cline parent "${session.parentNativeSessionId}" for source root and project scope.`
    )
  }
  return matches[0]?.sessionId
}

const reconcileDurableImportedClineChildren = async (
  runtimeRoot: string,
  parent: ClineHistorySession,
  parentSessionId: string
) => {
  const store = new FileRuntimeStore(runtimeRoot)
  let updated = 0
  for (const { meta, sessionId } of await listImportedClineMetas(runtimeRoot)) {
    const historyImport = isRecord(meta.historyImport) ? meta.historyImport : undefined
    if (
      historyImport == null ||
      meta.parentSessionId != null ||
      asString(historyImport.nativeParentSessionId) !== parent.nativeSessionId ||
      !matchesImportedClineScope(historyImport, parent)
    ) {
      continue
    }
    await store.session(sessionId).writeMeta({ ...meta, parentSessionId })
    updated += 1
  }
  return updated
}

const toClineConversation = (
  session: ClineHistorySession,
  sessionsByScope: Map<string, ClineHistorySession>,
  linkableParentKeys: Set<string>,
  durableParentSessionId?: string
): NativeHistoryConversation | undefined => {
  if (session.messages == null || session.messages.length === 0) {
    return undefined
  }
  const parentKey = session.parentNativeSessionId == null
    ? undefined
    : toClineSessionScopeKey(session, session.parentNativeSessionId)
  const parent = parentKey == null || !linkableParentKeys.has(parentKey)
    ? undefined
    : sessionsByScope.get(parentKey)
  return {
    adapter: 'cline',
    createdAt: session.createdAt,
    cwd: session.workspaceRoot,
    messages: session.messages,
    model: session.model,
    ...(session.parentNativeSessionId == null ? {} : { nativeParentSessionId: session.parentNativeSessionId }),
    nativeSessionId: session.nativeSessionId,
    nativeSourceRoot: session.sourceRoot,
    ...(durableParentSessionId == null ? {} : { parentSessionId: durableParentSessionId }),
    ...(parent == null
      ? {}
      : {
        parentConversation: {
          adapter: 'cline',
          nativeSessionId: parent.nativeSessionId,
          sourcePath: parent.sourcePath
        }
      }),
    sourcePath: session.sourcePath,
    ...(session.isSubagent ? { threadSource: 'subagent' } : {}),
    title: session.title,
    updatedAt: session.updatedAt
  }
}

const createAdapterPreview = (adapter: NativeHistoryAdapter): NativeHistoryImportAdapterPreview => ({
  adapter,
  aggregateLimitedBytes: 0,
  aggregateLimitedFiles: 0,
  candidates: [],
  diagnostics: [],
  hasMore: false,
  isComplete: true,
  largeFiles: 0,
  largestFileBytes: 0,
  matchedFiles: 0,
  perFileLimitedBytes: 0,
  perFileLimitedFiles: 0,
  projects: [],
  rejectedFiles: 0,
  scannedFiles: 0,
  sizeLimitedBytes: 0,
  sizeLimitedFiles: 0,
  totalBytes: 0
})

const resolveGooseHistoryOptions = async (
  options: NativeHistoryImportOptions,
  env: NodeJS.ProcessEnv,
  deadlineAt: number
) => {
  const binaryPath = await resolveGooseHistoryBinary({
    config: options.gooseCli,
    cwd: path.resolve(options.cwd ?? process.cwd()),
    env
  })
  if (binaryPath == null) {
    throw new Error('Goose history CLI is unavailable; install the configured Goose CLI or adjust adapters.goose.cli.')
  }
  return {
    binaryPath,
    deadlineAt,
    env
  }
}

const isGooseHistorySourceSelected = (session: GooseHistorySession, sourcePaths: string[] | undefined) => (
  sourcePaths == null || sourcePaths.includes(session.sourcePath)
)

const isUnavailableGooseHistoryCliError = (error: unknown) => (
  error instanceof Error && /ENOENT|does not exist|not found|not recognized|CLI is unavailable/iu.test(error.message)
)

const appendGooseUnsupportedDiagnostics = (
  diagnostics: NativeHistoryImportDiagnostic[],
  unsupported: { recipe: number; subagent: number }
) => {
  for (const [kind, skippedSessions] of Object.entries(unsupported)) {
    if (skippedSessions === 0) continue
    diagnostics.push({
      adapter: 'goose',
      code: 'unsupported_history_kind',
      level: 'warning',
      message: `Skipped ${skippedSessions} Goose ${kind} histor${
        skippedSessions === 1 ? 'y entry' : 'y entries'
      } because that source kind is not supported.`,
      skippedSessions,
      sourceKind: kind as 'recipe' | 'subagent'
    })
  }
}

const appendGooseUnsupportedSubtaskScopeDiagnostic = (
  diagnostics: NativeHistoryImportDiagnostic[]
) => {
  diagnostics.push({
    adapter: 'goose',
    code: 'unsupported_history_scope',
    level: 'warning',
    message: 'Goose does not expose supported Subtasks history through its public session commands.',
    sourceKind: 'subagent'
  })
}

const handleUnavailableGooseHistory = (params: {
  diagnostics: NativeHistoryImportDiagnostic[]
  error: unknown
  options: NativeHistoryImportOptions
}) => {
  if (!isUnavailableGooseHistoryCliError(params.error)) return false
  const adapters = params.options.adapters ?? NATIVE_HISTORY_ADAPTERS
  const bestEffort = params.options.bestEffortUnavailableAdapters?.includes('goose') === true
  if (!bestEffort && adapters.length === 1) return false
  params.diagnostics.push({
    adapter: 'goose',
    code: 'adapter_unavailable',
    level: bestEffort ? 'warning' : 'error',
    message: bestEffort
      ? 'Skipped Goose native history because its configured CLI is unavailable.'
      : 'Goose native history was not imported because its configured CLI is unavailable.'
  })
  return true
}

const toGoosePreviewCandidate = (
  session: GooseHistorySession,
  cwd: string,
  fileSizeBytes: number
): NativeHistoryImportPreviewCandidate => ({
  adapter: 'goose',
  createdAt: session.createdAt,
  cwd,
  fileSizeBytes,
  isArchived: session.archived,
  isImported: false,
  isLarge: fileSizeBytes >= LARGE_NATIVE_HISTORY_FILE_BYTES,
  isPinned: false,
  nativeSessionId: session.nativeSessionId,
  sourcePath: session.sourcePath,
  title: buildPreviewTitle('goose', session.title),
  updatedAt: session.updatedAt
})

const previewGooseHistory = async (params: {
  cwd: string
  env: NodeJS.ProcessEnv
  options: NativeHistoryImportOptions
  previewCursor: NativeHistoryPreviewCursor
  previewLimit?: number
  projectContext: ProjectMatchContext
  projectPathFilter?: string[]
  projectScope: NativeHistoryProjectScope
  runtimeRoot: string
  diagnostics: NativeHistoryImportDiagnostic[]
}) => {
  const preview = createAdapterPreview('goose')
  if (params.options.threadScope === 'subagent') {
    appendGooseUnsupportedSubtaskScopeDiagnostic(params.diagnostics)
    return preview
  }
  const deadlineAt = Date.now() + GOOSE_HISTORY_REQUEST_BUDGET_MS
  let historyData: {
    options: Awaited<ReturnType<typeof resolveGooseHistoryOptions>>
    sessions: GooseHistorySession[]
  } | undefined
  try {
    const options = await resolveGooseHistoryOptions(params.options, params.env, deadlineAt)
    const listed = await listGooseHistoryWithDiagnostics(options)
    historyData = { options, sessions: listed.sessions }
    appendGooseUnsupportedDiagnostics(params.diagnostics, listed.unsupported)
  } catch (error) {
    if (handleUnavailableGooseHistory({ diagnostics: params.diagnostics, error, options: params.options })) {
      return preview
    }
    throw error
  }
  if (historyData == null) throw new Error('Goose history options were not resolved.')
  const { options: historyOptions, sessions } = historyData
  preview.scannedFiles = sessions.length
  const workspaceResolutionCache = createNativeHistoryWorkspaceResolutionCache()
  const projectsByPath = new Map<string, NativeHistoryImportPreviewProject>()
  const candidates: Array<{
    candidate: NativeHistoryImportPreviewCandidate
    session: GooseHistorySession
  }> = []

  for (const session of sessions) {
    if (
      !isGooseHistorySourceSelected(session, params.options.sourcePaths) ||
      !isConversationInProjectScope(session.cwd, params.projectContext, params.projectScope)
    ) {
      continue
    }
    const workspaceCwd = resolveConversationWorkspaceCwd(
      session.cwd,
      params.cwd,
      params.env,
      params.projectScope,
      undefined,
      undefined,
      workspaceResolutionCache
    )
    const normalizedProjectPath = normalizeRealPath(workspaceCwd)
    const existingProject = projectsByPath.get(normalizedProjectPath)
    projectsByPath.set(normalizedProjectPath, {
      path: normalizedProjectPath,
      sessionCount: (existingProject?.sessionCount ?? 0) + 1
    })
    const candidate = toGoosePreviewCandidate(session, workspaceCwd, 0)
    if (
      !matchesProjectPathFilter(params.projectPathFilter, workspaceCwd) ||
      !matchesNativeHistoryTimeFilter(candidate, params.options.timeFilter) ||
      !matchesNativeHistoryCandidateScope(candidate, params.options.candidateScope)
    ) {
      continue
    }
    const importTarget = params.projectScope === 'all-projects'
      ? resolveNativeHistoryImportTarget(
        session.cwd,
        params.cwd,
        params.env,
        params.projectScope,
        undefined,
        undefined,
        workspaceResolutionCache
      )
      : { runtimeRoot: params.runtimeRoot, workspaceCwd: params.cwd }
    if (findImportedNativeHistorySessionId(importTarget.runtimeRoot, candidate) == null) {
      candidates.push({ candidate, session })
    }
  }

  candidates.sort((left, right) => (
    compareNativeHistoryCandidates(params.options.timeSort)(left.candidate, right.candidate)
  ))
  const startOffset = params.previewCursor.offsets.goose ?? 0
  const pageLimit = params.previewLimit ?? MAX_NATIVE_HISTORY_PREVIEW_LIMIT
  const page = candidates.slice(startOffset, startOffset + pageLimit)
  const maxSerializedBytes = getGoosePreviewFileSizeLimit(params.options)
  for (const { candidate, session } of page) {
    const exported = await inspectGooseHistoryExport(session, {
      ...historyOptions,
      ...(maxSerializedBytes == null || maxSerializedBytes < 0 ? {} : { maxSerializedBytes })
    })
    if (exported.serializedBytesExact) {
      preview.candidates.push({
        ...candidate,
        fileSizeBytes: exported.serializedBytes,
        isLarge: exported.serializedBytes >= LARGE_NATIVE_HISTORY_FILE_BYTES
      })
    }
    if (exported.oversized) {
      params.diagnostics.push({
        adapter: 'goose',
        code: 'history_oversized',
        level: 'warning',
        message:
          'Automatic import will skip a Goose history entry because its public export exceeds the configured size limit.',
        nativeSessionId: session.nativeSessionId,
        sourcePath: session.sourcePath,
        skippedSessions: 1
      })
    }
  }
  preview.matchedFiles = preview.candidates.length
  preview.totalBytes = preview.candidates.reduce((sum, candidate) => sum + candidate.fileSizeBytes, 0)
  preview.largestFileBytes = Math.max(0, ...preview.candidates.map(candidate => candidate.fileSizeBytes))
  preview.largeFiles = preview.candidates.filter(candidate => candidate.isLarge).length
  preview.hasMore = startOffset + page.length < candidates.length
  preview.isComplete = !preview.hasMore
  if (preview.hasMore) {
    preview.nextCursor = createNativeHistoryPreviewCursor({
      ...params.previewCursor.offsets,
      goose: startOffset + page.length
    })
  }
  preview.projects = [...projectsByPath.values()].sort((left, right) => left.path.localeCompare(right.path))
  return preview
}

const toNativeGooseConversation = (conversation: GooseHistoryConversation): NativeHistoryConversation => ({
  adapter: 'goose',
  createdAt: conversation.createdAt,
  cwd: normalizeRealPath(conversation.cwd),
  messages: conversation.messages,
  model: conversation.model,
  nativeSessionId: conversation.nativeSessionId,
  sourcePath: conversation.sourcePath,
  title: conversation.title,
  titleIsAuthoritative: true,
  updatedAt: conversation.updatedAt
})

const createNativeHistorySourceFile = async (
  adapter: NativeHistoryAdapter,
  homeDir: string,
  filePath: string,
  codexThreadMetadataIndex: CodexThreadMetadataIndex | undefined,
  readContext: {
    budget: NativeHistoryReadBudget
    maxFileSizeBytes: number
    operations?: NativeHistoryReadOperations
  },
  diagnostics: NativeHistoryDiagnostics
): Promise<NativeHistorySourceFile> => {
  if (adapter === 'droid' && !isSafeNativeHistoryPath(homeDir, filePath)) {
    throw new NativeHistoryFileChangedError(filePath, 'Factory Droid history escaped the configured real-home root')
  }
  const stat = lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new NativeHistoryFileChangedError(filePath, 'the inspected source path is not a regular file')
  }
  const codexThreadMetadata = adapter === 'codex'
    ? getCodexThreadMetadata(codexThreadMetadataIndex, filePath)
    : undefined
  const grokSessionMetadata = adapter === 'grok'
    ? await readGrokSessionMetadata(filePath, readContext, diagnostics)
    : undefined
  return {
    codexThreadMetadata,
    createdAt: codexThreadMetadata?.createdAt ?? grokSessionMetadata?.createdAt ?? stat.birthtimeMs ?? stat.mtimeMs,
    filePath,
    grokSessionMetadata,
    isArchived: isArchivedNativeHistoryFile(adapter, homeDir, filePath),
    isPinned: codexThreadMetadata?.isPinned === true,
    stat,
    updatedAt: codexThreadMetadata?.updatedAt ?? grokSessionMetadata?.updatedAt ?? stat.mtimeMs
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
  const adapters = options.adapters ?? NATIVE_HISTORY_ADAPTERS
  const projectContext = resolveProjectMatchContext(cwd, runtimeEnv)
  const projectScope = resolveNativeHistoryProjectScope(options)
  const adapterPreviews: NativeHistoryImportAdapterPreview[] = []
  const diagnostics: NativeHistoryImportDiagnostic[] = []
  const projectPathFilter = createProjectPathFilter(options.projectPaths)
  const previewLimit = normalizeNativeHistoryPreviewLimit(options.previewLimit)
  const previewCursor = parseNativeHistoryPreviewCursor(options.previewCursor)
  const nextCursorOffsets: Partial<Record<NativeHistoryAdapter, number>> = {}
  const readBudget = createNativeHistoryReadBudget(options)

  for (const adapter of adapters) {
    if (adapter === 'goose') {
      const preview = await previewGooseHistory({
        cwd,
        env,
        options,
        previewCursor,
        previewLimit,
        projectContext,
        projectPathFilter,
        projectScope,
        runtimeRoot,
        diagnostics
      })
      if (preview.nextCursor != null) {
        const gooseOffset = parseNativeHistoryPreviewCursor(preview.nextCursor).offsets.goose
        if (gooseOffset != null) nextCursorOffsets.goose = gooseOffset
      }
      adapterPreviews.push(preview)
      continue
    }
    const preview = createAdapterPreview(adapter)
    const maxFileSizeBytes = getImportFileSizeLimit(options, adapter) ??
      DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
    const cursorProjectPaths = adapter === 'cursor' && projectScope === 'all-projects'
      ? unique([
        ...(projectPathFilter ?? []),
        ...await readCursorWorkspaceRoots(homeDir, runtimeEnv, {
          budget: readBudget,
          maxFileSizeBytes,
          operations: options.readOperations
        }, preview)
      ])
      : projectPathFilter
    const sourceDirs = resolveSourceDirs(adapter, homeDir, options.sourceDirs, env)
    if (adapter === 'cline') {
      const clineSessions = await readClineHistory({
        dataRoots: sourceDirs,
        maxMessagesBytes: resolveClineMessagesSizeLimit(getImportFileSizeLimit(options, adapter)),
        onDiagnostic: (message) => {
          if (preview.diagnostics.length < 64 && !preview.diagnostics.includes(message)) {
            preview.diagnostics.push(message)
          }
        },
        readMessages: true,
        sourcePaths: options.sourcePaths
      })
      const candidates = clineSessions
        .map(toClinePreviewCandidate)
        .sort(compareNativeHistoryCandidates(options.timeSort))
      preview.scannedFiles = candidates.length
      const startOffset = previewCursor.offsets[adapter] ?? 0
      const projectsByPath = new Map<string, NativeHistoryImportPreviewProject>()
      const workspaceResolutionCache = createNativeHistoryWorkspaceResolutionCache()
      let candidatePageFull = false
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]!
        if (!isConversationInProjectScope(candidate.cwd, projectContext, projectScope)) {
          continue
        }
        const workspaceCwd = projectScope === 'all-projects'
          ? resolveConversationWorkspaceCwd(
            candidate.cwd,
            cwd,
            env,
            projectScope,
            undefined,
            undefined,
            workspaceResolutionCache
          )
          : candidate.cwd
        const workspaceCandidate = workspaceCwd === candidate.cwd
          ? candidate
          : { ...candidate, cwd: workspaceCwd }
        const normalizedProjectPath = normalizeRealPath(workspaceCandidate.cwd)
        const existingProject = projectsByPath.get(normalizedProjectPath)
        projectsByPath.set(normalizedProjectPath, {
          path: normalizedProjectPath,
          sessionCount: (existingProject?.sessionCount ?? 0) + 1
        })

        if (
          index < startOffset ||
          candidatePageFull ||
          !matchesProjectPathFilter(projectPathFilter, workspaceCandidate.cwd) ||
          !matchesNativeHistoryThreadScope(workspaceCandidate, options.threadScope) ||
          !matchesNativeHistoryTimeFilter(workspaceCandidate, options.timeFilter) ||
          !matchesNativeHistoryCandidateScope(workspaceCandidate, options.candidateScope)
        ) {
          continue
        }

        const importTarget = projectScope === 'all-projects'
          ? resolveNativeHistoryImportTarget(candidate.cwd, cwd, env, projectScope)
          : { runtimeRoot, workspaceCwd: cwd }
        const importedSessionId = findImportedNativeHistorySessionId(importTarget.runtimeRoot, workspaceCandidate)
        if (importedSessionId != null) {
          continue
        }
        preview.candidates.push(workspaceCandidate)
        preview.matchedFiles += 1
        preview.totalBytes += workspaceCandidate.fileSizeBytes
        preview.largestFileBytes = Math.max(preview.largestFileBytes, workspaceCandidate.fileSizeBytes)
        if (workspaceCandidate.isLarge) preview.largeFiles += 1

        if (previewLimit != null && preview.candidates.length >= previewLimit) {
          const nextOffset = index + 1
          if (nextOffset < candidates.length) {
            preview.hasMore = true
            preview.isComplete = false
            preview.nextCursor = createNativeHistoryPreviewCursor({
              ...previewCursor.offsets,
              ...nextCursorOffsets,
              [adapter]: nextOffset
            })
            nextCursorOffsets[adapter] = nextOffset
          }
          candidatePageFull = true
        }
      }
      preview.projects = Array.from(projectsByPath.values())
        .sort((left, right) => left.path.localeCompare(right.path))
      adapterPreviews.push(preview)
      continue
    }
    const codexThreadMetadataIndex = adapter === 'codex'
      ? await readCodexThreadMetadataIndex(homeDir, {
        budget: readBudget,
        diagnostics: preview,
        maxFileSizeBytes,
        operations: options.readOperations
      })
      : undefined
    const workspaceResolutionCache = createNativeHistoryWorkspaceResolutionCache()
    const sourceFiles: NativeHistorySourceFile[] = []
    const files = filterNativeHistoryFiles(
      adapter,
      await listNativeHistoryJsonlFiles(
        sourceDirs,
        options.sourcePaths,
        adapter === 'droid' ? homeDir : undefined
      )
    )
    preview.scannedFiles += files.length

    for (const filePath of files) {
      try {
        if (
          adapter === 'qwen-code' && !isSafeQwenHistoryRegularFile({
            filePath,
            maxFileSizeBytes: Number.MAX_SAFE_INTEGER,
            sourceDirs
          })
        ) {
          throw new NativeHistoryFileChangedError(filePath, 'the Qwen source path is outside its safe root')
        }
        const sourceFile = await createNativeHistorySourceFile(
          adapter,
          homeDir,
          filePath,
          codexThreadMetadataIndex,
          {
            budget: readBudget,
            maxFileSizeBytes,
            operations: options.readOperations
          },
          preview
        )
        if (sourceFile.stat.size > maxFileSizeBytes) {
          preview.totalBytes += sourceFile.stat.size
          preview.largestFileBytes = Math.max(preview.largestFileBytes, sourceFile.stat.size)
          if (sourceFile.stat.size >= LARGE_NATIVE_HISTORY_FILE_BYTES) preview.largeFiles += 1
          recordNativeHistoryDiagnostic(
            preview,
            new NativeHistoryReadLimitError(
              'file',
              sourceFile.filePath,
              maxFileSizeBytes,
              sourceFile.stat.size
            )
          )
          continue
        }
        sourceFiles.push(sourceFile)
      } catch (error) {
        recordNativeHistoryDiagnostic(preview, error)
        logger.warn({
          adapter,
          error,
          filePath
        }, '[runtime-store] Failed to inspect native history file')
      }
    }

    sourceFiles.sort(compareNativeHistorySourceFiles(options.timeSort))

    const startOffset = previewCursor.offsets[adapter] ?? 0
    const projectsByPath = new Map<string, NativeHistoryImportPreviewProject>()
    let candidatePageFull = false
    for (let index = 0; index < sourceFiles.length; index += 1) {
      const sourceFile = sourceFiles[index]!
      try {
        const codexThreadMetadata = sourceFile.codexThreadMetadata
        const candidate = await readConversationPreview(
          adapter,
          sourceFile.filePath,
          sourceFile.isArchived,
          codexThreadMetadata,
          sourceFile.stat,
          codexThreadMetadataIndex,
          homeDir,
          projectContext,
          cursorProjectPaths,
          sourceFile.grokSessionMetadata,
          {
            budget: readBudget,
            maxFileSizeBytes,
            operations: options.readOperations
          },
          adapter === 'qwen-code'
            ? {
              budget: readBudget,
              maxFileSizeBytes,
              operations: options.readOperations,
              sourceDirs
            }
            : undefined
        )
        if (
          candidate == null ||
          !isConversationInProjectScope(
            candidate.cwd,
            projectContext,
            projectScope,
            codexThreadMetadata?.gitOriginUrl ?? sourceFile.grokSessionMetadata?.gitOriginUrl
          )
        ) {
          continue
        }

        const workspaceCwd = projectScope === 'all-projects'
          ? resolveConversationWorkspaceCwd(
            candidate.cwd,
            cwd,
            env,
            projectScope,
            codexThreadMetadata,
            codexThreadMetadataIndex,
            workspaceResolutionCache
          )
          : candidate.cwd
        const workspaceCandidate = workspaceCwd === candidate.cwd
          ? candidate
          : { ...candidate, cwd: workspaceCwd }
        const normalizedProjectPath = normalizeRealPath(workspaceCandidate.cwd)
        const existingProject = projectsByPath.get(normalizedProjectPath)
        projectsByPath.set(normalizedProjectPath, {
          path: normalizedProjectPath,
          sessionCount: (existingProject?.sessionCount ?? 0) + 1
        })

        if (
          index < startOffset ||
          candidatePageFull ||
          !matchesProjectPathFilter(projectPathFilter, workspaceCandidate.cwd) ||
          !matchesNativeHistoryThreadScope(workspaceCandidate, options.threadScope) ||
          !matchesNativeHistoryTimeFilter(workspaceCandidate, options.timeFilter) ||
          !matchesNativeHistoryCandidateScope(workspaceCandidate, options.candidateScope)
        ) {
          continue
        }

        const importTarget = projectScope === 'all-projects'
          ? resolveNativeHistoryImportTarget(
            candidate.cwd,
            cwd,
            env,
            projectScope,
            codexThreadMetadata,
            codexThreadMetadataIndex,
            workspaceResolutionCache
          )
          : { runtimeRoot, workspaceCwd: cwd }
        const importedSessionId = findImportedNativeHistorySessionId(importTarget.runtimeRoot, workspaceCandidate)
        if (importedSessionId != null) {
          continue
        }

        preview.candidates.push(workspaceCandidate)
        preview.matchedFiles += 1
        preview.totalBytes += workspaceCandidate.fileSizeBytes
        preview.largestFileBytes = Math.max(preview.largestFileBytes, workspaceCandidate.fileSizeBytes)
        if (workspaceCandidate.isLarge) {
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
          candidatePageFull = true
        }
      } catch (error) {
        recordNativeHistoryDiagnostic(preview, error)
        if (error instanceof NativeHistoryReadLimitError) {
          preview.totalBytes += Math.max(0, error.fileBytes)
          preview.largestFileBytes = Math.max(preview.largestFileBytes, error.fileBytes)
          if (error.fileBytes >= LARGE_NATIVE_HISTORY_FILE_BYTES) preview.largeFiles += 1
        }
        logger.warn({
          adapter,
          error,
          filePath: sourceFile.filePath
        }, '[runtime-store] Failed to preview native history file')
      }
    }

    preview.candidates.sort(compareNativeHistoryCandidates(options.timeSort))
    preview.projects = Array.from(projectsByPath.values())
      .sort((left, right) => left.path.localeCompare(right.path))
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
    ...(diagnostics.length === 0 ? {} : { diagnostics }),
    aggregateLimitedBytes: adapterPreviews.reduce((sum, preview) => sum + preview.aggregateLimitedBytes, 0),
    aggregateLimitedFiles: adapterPreviews.reduce((sum, preview) => sum + preview.aggregateLimitedFiles, 0),
    hasMore: adapterPreviews.some(preview => preview.hasMore),
    isComplete: adapterPreviews.every(preview => preview.isComplete),
    largeFileThresholdBytes: LARGE_NATIVE_HISTORY_FILE_BYTES,
    largeFiles: adapterPreviews.reduce((sum, preview) => sum + preview.largeFiles, 0),
    largestFileBytes: Math.max(0, ...adapterPreviews.map(preview => preview.largestFileBytes)),
    matchedFiles: adapterPreviews.reduce((sum, preview) => sum + preview.matchedFiles, 0),
    maxFileSizeBytes: DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES,
    ...(nextCursor == null ? {} : { nextCursor }),
    perFileLimitedBytes: adapterPreviews.reduce((sum, preview) => sum + preview.perFileLimitedBytes, 0),
    perFileLimitedFiles: adapterPreviews.reduce((sum, preview) => sum + preview.perFileLimitedFiles, 0),
    rejectedFiles: adapterPreviews.reduce((sum, preview) => sum + preview.rejectedFiles, 0),
    scannedFiles: adapterPreviews.reduce((sum, preview) => sum + preview.scannedFiles, 0),
    sizeLimitedBytes: adapterPreviews.reduce((sum, preview) => sum + preview.sizeLimitedBytes, 0),
    sizeLimitedFiles: adapterPreviews.reduce((sum, preview) => sum + preview.sizeLimitedFiles, 0),
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
          aggregateLimitedBytes: result.aggregateLimitedBytes,
          aggregateLimitedFiles: result.aggregateLimitedFiles,
          completedAt: new Date().toISOString(),
          importedEvents: result.importedEvents,
          importedSessions: result.importedSessions,
          matchedFiles: result.matchedFiles,
          perFileLimitedBytes: result.perFileLimitedBytes,
          perFileLimitedFiles: result.perFileLimitedFiles,
          rejectedFiles: result.rejectedFiles,
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

const nativeHistoryAutoImportAdapters: NativeHistoryAdapter[] = NATIVE_HISTORY_ADAPTERS

const normalizeConfiguredFileSizeLimit = (value: unknown) => {
  if (value == null) return DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
  if (
    typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
    value > DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
  ) {
    throw new Error(
      `Native history import size limit must be between 0 and ` +
        `${DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES} bytes.`
    )
  }
  return value
}

export const resolveNativeHistoryAutoImportOptions = (
  config: Config
): NativeHistoryImportOptions | undefined => {
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
    ? normalizeConfiguredFileSizeLimit(nativeHistoryImport.maxFileSizeBytes)
    : DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
  const maxFileSizeBytesByAdapter = Object.fromEntries(
    nativeHistoryAutoImportAdapters.flatMap((adapter) => {
      const adapterConfig = nativeHistoryImport.adapters?.[adapter]
      if (adapterConfig == null || !hasOwn(adapterConfig, 'maxFileSizeBytes')) {
        return []
      }
      return [[adapter, normalizeConfiguredFileSizeLimit(adapterConfig.maxFileSizeBytes)]]
    })
  ) as Partial<Record<NativeHistoryAdapter, number | null>>
  const bestEffortUnavailableAdapters = adapters.filter((adapter) => (
    nativeHistoryImport.autoImport === true && nativeHistoryImport.adapters?.[adapter]?.autoImport == null
  ))
  const gooseAdapterConfig = (config.adapters as Record<string, { cli?: GooseCliConfig }> | undefined)?.goose

  return {
    adapters,
    ...(bestEffortUnavailableAdapters.length === 0 ? {} : { bestEffortUnavailableAdapters }),
    ...(gooseAdapterConfig?.cli == null ? {} : { gooseCli: gooseAdapterConfig.cli }),
    threadScope: 'user',
    maxFileSizeBytes,
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
  const adapters = options.adapters ?? NATIVE_HISTORY_ADAPTERS
  const projectContext = resolveProjectMatchContext(cwd, runtimeEnv)
  const projectScope = resolveNativeHistoryProjectScope(options)
  const projectPathFilter = createProjectPathFilter(options.projectPaths)
  const changedRuntimeRoots = new Set<string>()
  const result: NativeHistoryImportResult = {
    aggregateLimitedBytes: 0,
    aggregateLimitedFiles: 0,
    importedEvents: 0,
    importedSessions: 0,
    matchedFiles: 0,
    perFileLimitedBytes: 0,
    perFileLimitedFiles: 0,
    rejectedFiles: 0,
    scannedFiles: 0,
    sessions: [],
    sizeLimitedBytes: 0,
    sizeLimitedFiles: 0
  }
  const diagnostics: NativeHistoryImportDiagnostic[] = []
  const readBudget = createNativeHistoryReadBudget(options)

  await mkdir(runtimeRoot, { recursive: true })

  for (const adapter of adapters) {
    if (adapter === 'goose') {
      if (options.threadScope === 'subagent') {
        appendGooseUnsupportedSubtaskScopeDiagnostic(diagnostics)
        continue
      }
      let sessions: GooseHistorySession[]
      const deadlineAt = Date.now() + GOOSE_HISTORY_REQUEST_BUDGET_MS
      let historyOptions: Awaited<ReturnType<typeof resolveGooseHistoryOptions>> | undefined
      try {
        historyOptions = await resolveGooseHistoryOptions(options, env, deadlineAt)
        const listed = await listGooseHistoryWithDiagnostics(historyOptions)
        sessions = listed.sessions
        appendGooseUnsupportedDiagnostics(diagnostics, listed.unsupported)
      } catch (error) {
        if (handleUnavailableGooseHistory({ diagnostics, error, options })) continue
        throw error
      }
      if (historyOptions == null) throw new Error('Goose history options were not resolved.')
      const maxSerializedBytes = getImportFileSizeLimit(options, 'goose')
      const exportOptions = {
        ...historyOptions,
        ...(maxSerializedBytes == null || maxSerializedBytes < 0 ? {} : { maxSerializedBytes })
      }
      result.scannedFiles += sessions.length
      const workspaceResolutionCache = createNativeHistoryWorkspaceResolutionCache()
      for (const nativeSession of sessions) {
        if (
          !isGooseHistorySourceSelected(nativeSession, options.sourcePaths) ||
          !isConversationInProjectScope(nativeSession.cwd, projectContext, projectScope)
        ) {
          continue
        }
        const workspaceCwd = resolveConversationWorkspaceCwd(
          nativeSession.cwd,
          cwd,
          env,
          projectScope,
          undefined,
          undefined,
          workspaceResolutionCache
        )
        if (
          !matchesProjectPathFilter(projectPathFilter, workspaceCwd) ||
          !matchesNativeHistoryTimeFilter(nativeSession, options.timeFilter)
        ) {
          continue
        }
        const importTarget = projectScope === 'all-projects'
          ? resolveNativeHistoryImportTarget(
            nativeSession.cwd,
            cwd,
            env,
            projectScope,
            undefined,
            undefined,
            workspaceResolutionCache
          )
          : { runtimeRoot, workspaceCwd: normalizeRealPath(cwd) }
        if (
          findImportedNativeHistorySessionId(importTarget.runtimeRoot, {
            adapter: 'goose',
            nativeSessionId: nativeSession.nativeSessionId,
            sourcePath: nativeSession.sourcePath
          }) != null
        ) {
          continue
        }
        const exported = await inspectGooseHistoryExport(nativeSession, exportOptions)
        if (exported.oversized || exported.conversation == null) {
          diagnostics.push({
            adapter: 'goose',
            code: 'history_oversized',
            level: 'warning',
            message:
              'Automatic import skipped a Goose history entry because its public export exceeds the configured size limit.',
            nativeSessionId: nativeSession.nativeSessionId,
            sourcePath: nativeSession.sourcePath,
            skippedSessions: 1
          })
          continue
        }
        const conversation = toNativeGooseConversation(exported.conversation)
        if (!matchesNativeHistoryTimeFilter(conversation, options.timeFilter)) continue
        await mkdir(importTarget.runtimeRoot, { recursive: true })
        result.matchedFiles += 1
        const sessionResult = await importConversation(conversation, importTarget)
        result.importedEvents += sessionResult.importedEvents
        if (sessionResult.importedEvents > 0) {
          result.importedSessions += 1
          changedRuntimeRoots.add(importTarget.runtimeRoot)
        }
        result.sessions.push(sessionResult)
      }
      continue
    }
    const maxFileSizeBytes = getImportFileSizeLimit(options, adapter) ??
      DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES
    const cursorProjectPaths = adapter === 'cursor' && projectScope === 'all-projects'
      ? unique([
        ...(projectPathFilter ?? []),
        ...await readCursorWorkspaceRoots(homeDir, runtimeEnv, {
          budget: readBudget,
          maxFileSizeBytes,
          operations: options.readOperations
        }, result)
      ])
      : projectPathFilter
    const sourceDirs = resolveSourceDirs(adapter, homeDir, options.sourceDirs, env)
    if (adapter === 'cline') {
      const clineSessions = await readClineHistory({
        dataRoots: sourceDirs,
        maxMessagesBytes: resolveClineMessagesSizeLimit(getImportFileSizeLimit(options, adapter)),
        readMessages: true,
        sourcePaths: options.sourcePaths
      })
      const sessionsByScope = new Map(
        clineSessions.map(session => [toClineSessionScopeKey(session), session])
      )
      const workspaceResolutionCache = createNativeHistoryWorkspaceResolutionCache()
      result.scannedFiles += clineSessions.length
      const importCandidates: Array<{
        conversation: NativeHistoryConversation
        importTarget: { runtimeRoot: string; workspaceCwd: string }
        session: ClineHistorySession
      }> = []
      for (const clineSession of clineSessions) {
        try {
          const threadMetadata = clineSession.isSubagent ? { threadSource: 'subagent' } : undefined
          if (!matchesNativeHistoryThreadScope(threadMetadata, options.threadScope)) {
            continue
          }
          if (!isConversationInProjectScope(clineSession.workspaceRoot, projectContext, projectScope)) {
            continue
          }
          const workspaceCwd = resolveConversationWorkspaceCwd(
            clineSession.workspaceRoot,
            cwd,
            env,
            projectScope,
            undefined,
            undefined,
            workspaceResolutionCache
          )
          if (!matchesProjectPathFilter(projectPathFilter, workspaceCwd)) {
            continue
          }
          const conversation = toClineConversation(clineSession, sessionsByScope, new Set())
          if (conversation == null || !matchesNativeHistoryTimeFilter(conversation, options.timeFilter)) {
            continue
          }
          const importTarget = projectScope === 'all-projects'
            ? resolveNativeHistoryImportTarget(
              conversation.cwd,
              cwd,
              env,
              projectScope,
              undefined,
              undefined,
              workspaceResolutionCache
            )
            : { runtimeRoot, workspaceCwd: cwd }
          importCandidates.push({ conversation, importTarget, session: clineSession })
        } catch (error) {
          logger.warn({
            adapter,
            error,
            filePath: clineSession.sourcePath
          }, '[runtime-store] Failed to import native history file')
        }
      }
      const includedKeys = new Set(importCandidates.map(candidate => toClineSessionScopeKey(candidate.session)))
      for (const candidate of importCandidates) {
        try {
          const existingSessionId = findImportedNativeHistorySessionId(
            candidate.importTarget.runtimeRoot,
            candidate.conversation
          )
          if (existingSessionId != null) {
            const reconciled = await reconcileDurableImportedClineChildren(
              candidate.importTarget.runtimeRoot,
              candidate.session,
              existingSessionId
            )
            if (reconciled > 0) changedRuntimeRoots.add(candidate.importTarget.runtimeRoot)
            continue
          }
          const linkableParentKeys = new Set(includedKeys)
          let durableParentSessionId: string | undefined
          if (candidate.session.parentNativeSessionId != null) {
            const parentKey = toClineSessionScopeKey(candidate.session, candidate.session.parentNativeSessionId)
            const parent = sessionsByScope.get(parentKey)
            if (parent != null && !linkableParentKeys.has(parentKey)) {
              const parentConversation = toClineConversation(parent, sessionsByScope, new Set())
              if (
                parentConversation != null &&
                findImportedNativeHistorySessionId(candidate.importTarget.runtimeRoot, parentConversation) != null
              ) {
                linkableParentKeys.add(parentKey)
              }
            }
            if (!linkableParentKeys.has(parentKey)) {
              durableParentSessionId = await findDurableImportedClineParent(
                candidate.importTarget.runtimeRoot,
                candidate.session
              )
              if (durableParentSessionId == null) {
                logger.warn({
                  adapter,
                  nativeParentSessionId: candidate.session.parentNativeSessionId,
                  nativeSessionId: candidate.session.nativeSessionId,
                  sourceRoot: candidate.session.sourceRoot,
                  workspaceRoot: candidate.session.workspaceRoot
                }, '[runtime-store] Imported Cline child without an available parent; keeping it root-only')
              }
            }
          }
          const conversation = toClineConversation(
            candidate.session,
            sessionsByScope,
            linkableParentKeys,
            durableParentSessionId
          )
          if (conversation == null) continue
          await mkdir(candidate.importTarget.runtimeRoot, { recursive: true })
          result.matchedFiles += 1
          const sessionResult = await importConversation(conversation, candidate.importTarget)
          result.importedEvents += sessionResult.importedEvents
          if (sessionResult.importedEvents > 0) {
            result.importedSessions += 1
            changedRuntimeRoots.add(candidate.importTarget.runtimeRoot)
          }
          const reconciled = await reconcileDurableImportedClineChildren(
            candidate.importTarget.runtimeRoot,
            candidate.session,
            sessionResult.sessionId
          )
          if (reconciled > 0) changedRuntimeRoots.add(candidate.importTarget.runtimeRoot)
          result.sessions.push(sessionResult)
        } catch (error) {
          logger.warn({
            adapter,
            error,
            filePath: candidate.session.sourcePath
          }, '[runtime-store] Failed to import native history file')
        }
      }
      continue
    }
    const codexThreadMetadataIndex = adapter === 'codex'
      ? await readCodexThreadMetadataIndex(homeDir, {
        budget: readBudget,
        diagnostics: result,
        maxFileSizeBytes,
        operations: options.readOperations
      })
      : undefined
    const workspaceResolutionCache = createNativeHistoryWorkspaceResolutionCache()
    const files = filterNativeHistoryFiles(
      adapter,
      await listNativeHistoryJsonlFiles(
        sourceDirs,
        options.sourcePaths,
        adapter === 'droid' ? homeDir : undefined
      )
    )
    result.scannedFiles += files.length
    for (const filePath of files) {
      try {
        const fileStat = lstatSync(filePath)
        if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
          throw new NativeHistoryFileChangedError(filePath, 'the source path is not a regular file')
        }
        if (
          adapter === 'qwen-code' && !isSafeQwenHistoryRegularFile({
            filePath,
            maxFileSizeBytes: Number.MAX_SAFE_INTEGER,
            sourceDirs
          })
        ) {
          throw new NativeHistoryFileChangedError(filePath, 'the Qwen source path is outside its safe root')
        }
        if (fileStat.size > maxFileSizeBytes) {
          recordNativeHistoryDiagnostic(
            result,
            new NativeHistoryReadLimitError(
              'file',
              filePath,
              maxFileSizeBytes,
              fileStat.size
            )
          )
          continue
        }
        const pathCodexThreadMetadata = getCodexThreadMetadata(codexThreadMetadataIndex, filePath)
        const records = await readJsonlRecords(filePath, adapter, {
          ...(adapter === 'droid'
            ? { authorityRoot: homeDir, maxRecords: MAX_NATIVE_HISTORY_JSONL_RECORDS }
            : {}),
          budget: readBudget,
          expectedStat: fileStat,
          maxFileSizeBytes,
          operations: options.readOperations
        })
        const codexThreadMetadata = adapter === 'codex'
          ? getCodexThreadMetadataFromRecords(codexThreadMetadataIndex, filePath, records, pathCodexThreadMetadata)
          : pathCodexThreadMetadata
        const grokSessionMetadata = adapter === 'grok'
          ? await readGrokSessionMetadata(filePath, {
            budget: readBudget,
            maxFileSizeBytes,
            operations: options.readOperations
          }, result)
          : undefined
        const qwenHistoryIdentity = adapter === 'qwen-code'
          ? await readQwenHistoryIdentity(filePath, records, {
            budget: readBudget,
            maxFileSizeBytes,
            operations: options.readOperations,
            sourceDirs
          })
          : undefined
        const threadMetadata = adapter === 'cursor'
          ? { threadSource: readCursorThreadSource(filePath) }
          : adapter === 'qwen-code'
          ? { threadSource: qwenHistoryIdentity?.threadSource }
          : codexThreadMetadata
        if (!matchesNativeHistoryThreadScope(threadMetadata, options.threadScope)) {
          continue
        }
        const conversationCwd = codexThreadMetadata?.cwd ??
          (adapter === 'cursor'
            ? resolveCursorConversationCwd(filePath, homeDir, projectContext, cursorProjectPaths)
            : grokSessionMetadata?.cwd ?? qwenHistoryIdentity?.cwd ?? readConversationCwdFromRecords(adapter, records))
        const workspaceCwd = conversationCwd == null
          ? cwd
          : resolveConversationWorkspaceCwd(
            conversationCwd,
            cwd,
            env,
            projectScope,
            codexThreadMetadata,
            codexThreadMetadataIndex,
            workspaceResolutionCache
          )
        if (
          !isConversationInProjectScope(
            conversationCwd,
            projectContext,
            projectScope,
            codexThreadMetadata?.gitOriginUrl ?? grokSessionMetadata?.gitOriginUrl
          ) ||
          !matchesProjectPathFilter(projectPathFilter, workspaceCwd)
        ) {
          continue
        }
        const conversation = await parseConversation(
          adapter,
          filePath,
          records,
          projectContext,
          projectScope,
          codexThreadMetadata,
          homeDir,
          cursorProjectPaths,
          grokSessionMetadata,
          adapter === 'qwen-code'
            ? {
              budget: readBudget,
              maxFileSizeBytes,
              operations: options.readOperations,
              sourceDirs
            }
            : undefined
        )
        if (conversation == null || !matchesNativeHistoryTimeFilter(conversation, options.timeFilter)) {
          continue
        }
        const importTarget = projectScope === 'all-projects'
          ? resolveNativeHistoryImportTarget(
            conversation.cwd,
            cwd,
            env,
            projectScope,
            codexThreadMetadata,
            codexThreadMetadataIndex,
            workspaceResolutionCache
          )
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
        recordNativeHistoryDiagnostic(result, error)
        logger.warn({
          adapter,
          error,
          filePath
        }, '[runtime-store] Failed to import native history file')
      }
    }
  }

  if (result.sessions.length > 0) {
    result.sessions.sort(compareNativeHistoryImportSessions(options.timeSort))
    const runtimeRoots = Array.from(changedRuntimeRoots)
    setNativeHistoryImportRuntimeRoots(result, runtimeRoots)
    await Promise.all(runtimeRoots.map(root => watchRuntimeStoreRoot(root)))
  }

  if (diagnostics.length > 0) result.diagnostics = diagnostics

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
