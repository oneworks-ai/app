/* eslint-disable max-lines -- native history import needs parser compatibility in one place. */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'

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
import { resolveProjectPrimaryWorkspaceFolder } from '@oneworks/utils/project-cache-path'

import { getDb } from '#~/db/index.js'
import { logger } from '#~/utils/logger.js'

import { discoverRuntimeSessionStores } from './discovery.js'
import { getRuntimeStoreWatcher, replayRuntimeStore, watchRuntimeStoreRoot } from './watcher.js'
import { createWorkspaceRuntimeEnv, resolveWorkspaceRuntimeStoreRoot } from './workspace-env.js'

export type NativeHistoryAdapter = 'codex' | 'claude-code'

export interface NativeHistoryImportOptions {
  adapters?: NativeHistoryAdapter[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
  maxFileSizeBytes?: number
  maxFileSizeBytesByAdapter?: Partial<Record<NativeHistoryAdapter, number | null>>
  sourceDirs?: Partial<Record<NativeHistoryAdapter, string[]>>
  sourcePaths?: string[]
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
  nativeSessionId: string
  sourcePath: string
  title: string
  updatedAt: number
}

export interface NativeHistoryImportAdapterPreview {
  adapter: NativeHistoryAdapter
  candidates: NativeHistoryImportPreviewCandidate[]
  largeFiles: number
  largestFileBytes: number
  matchedFiles: number
  scannedFiles: number
  totalBytes: number
}

export interface NativeHistoryImportPreviewResult {
  adapters: NativeHistoryImportAdapterPreview[]
  largeFileThresholdBytes: number
  largeFiles: number
  largestFileBytes: number
  matchedFiles: number
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

const HISTORY_IMPORT_SOURCE = 'native-history-import'
const HISTORY_IMPORT_MARKER_SEGMENTS = ['caches', 'native-history-import'] as const
const LARGE_NATIVE_HISTORY_FILE_BYTES = 25 * 1024 * 1024
export const DEFAULT_NATIVE_HISTORY_IMPORT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
const MAX_HISTORY_WALK_DEPTH = 8
const IMPORT_SESSION_PREFIX = 'imported_'
const TITLE_MAX_LENGTH = 80
let defaultNativeHistoryImportInFlight: Promise<NativeHistoryImportResult> | undefined
let defaultFirstOpenImportInFlight: Promise<NativeHistoryImportResult> | undefined
let pendingFirstOpenPromptResult: NativeHistoryImportResult | undefined

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
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
  const title = conversation.messages.find(message => message.role === 'user' && getFirstText(message.content) != null)
    ?.content ?? conversation.title?.trim()
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

const isProjectConversation = (conversationCwd: string | undefined, projectContext: ProjectMatchContext) => {
  if (conversationCwd == null) {
    return false
  }
  const normalizedCwd = normalizeRealPath(conversationCwd)
  if (projectContext.roots.some(root => isPathInside(root, normalizedCwd))) {
    return true
  }

  const conversationGitIdentity = resolveGitProjectIdentity(normalizedCwd)
  return conversationGitIdentity != null &&
    projectContext.gitIdentities.some(identity => gitIdentitiesMatch(identity, conversationGitIdentity))
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
  isArchived: boolean
): Promise<NativeHistoryImportPreviewCandidate | undefined> => {
  const stat = statSync(filePath)
  const lines = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(filePath, { encoding: 'utf8' })
  })
  let createdAt = 0
  let cwd: string | undefined
  let nativeSessionId: string | undefined
  let parsedRecords = 0
  let title: string | undefined
  let updatedAt = stat.mtimeMs

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

      const timestamp = getEventTime(value.timestamp, updatedAt)
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

  if (cwd == null) {
    return undefined
  }

  return {
    adapter,
    createdAt: createdAt || stat.birthtimeMs || stat.mtimeMs,
    cwd,
    fileSizeBytes: stat.size,
    isArchived,
    isImported: false,
    isLarge: stat.size >= LARGE_NATIVE_HISTORY_FILE_BYTES,
    nativeSessionId: nativeSessionId ?? path.basename(filePath, '.jsonl'),
    sourcePath: filePath,
    title: buildPreviewTitle(adapter, title),
    updatedAt
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
  projectContext: ProjectMatchContext
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

  const cwd = asString(sessionMeta?.cwd)
  if (!isProjectConversation(cwd, projectContext) || messages.length === 0) {
    return undefined
  }

  const nativeSessionId = asString(sessionMeta?.id) ?? path.basename(sourcePath, '.jsonl')
  const createdAt = getEventTime(sessionMeta?.timestamp, messages[0]?.ts ?? Date.now())
  return {
    adapter: 'codex',
    createdAt,
    cwd: cwd!,
    messages,
    model: asString(sessionMeta?.model) ?? asString(sessionMeta?.model_provider),
    nativeSessionId,
    sourcePath,
    title: asString(sessionMeta?.thread_name),
    updatedAt: updatedAt || createdAt
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
  projectContext: ProjectMatchContext
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

  if (!isProjectConversation(cwd, projectContext) || messages.length === 0) {
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
  projectContext: ProjectMatchContext
) =>
  adapter === 'codex'
    ? parseCodexConversation(filePath, records, projectContext)
    : parseClaudeConversation(filePath, records, projectContext)

const readConversationCwd = async (adapter: NativeHistoryAdapter, filePath: string) => {
  const lines = createInterface({
    crlfDelay: Infinity,
    input: createReadStream(filePath, { encoding: 'utf8' })
  })

  try {
    for await (const line of lines) {
      const trimmed = line.trim()
      if (trimmed === '') {
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

      if (adapter === 'codex') {
        const payload = isRecord(value.payload) ? value.payload : undefined
        const cwd = value.type === 'session_meta' ? asString(payload?.cwd) : undefined
        if (cwd != null) {
          lines.close()
          return cwd
        }
      } else {
        const cwd = asString(value.cwd)
        if (cwd != null) {
          lines.close()
          return cwd
        }
      }
    }
  } finally {
    lines.close()
  }
}

const hasCustomImportOptions = (options: NativeHistoryImportOptions) => (
  options.adapters != null ||
  options.cwd != null ||
  options.env != null ||
  options.homeDir != null ||
  options.maxFileSizeBytes != null ||
  options.maxFileSizeBytesByAdapter != null ||
  options.sourceDirs != null ||
  options.sourcePaths != null
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

const isWithinImportFileSizeLimit = (
  filePath: string,
  limitBytes: number | undefined
) => limitBytes == null || statSync(filePath).size <= limitBytes

const createAdapterPreview = (adapter: NativeHistoryAdapter): NativeHistoryImportAdapterPreview => ({
  adapter,
  candidates: [],
  largeFiles: 0,
  largestFileBytes: 0,
  matchedFiles: 0,
  scannedFiles: 0,
  totalBytes: 0
})

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
  const adapterPreviews: NativeHistoryImportAdapterPreview[] = []
  const sourcePathFilter = createSourcePathFilter(options.sourcePaths)

  for (const adapter of adapters) {
    const preview = createAdapterPreview(adapter)
    const sourceDirs = resolveSourceDirs(adapter, homeDir, options.sourceDirs)

    for (const sourceDir of sourceDirs) {
      if (!existsSync(sourceDir)) {
        continue
      }
      const files = await walkJsonlFiles(sourceDir)
      preview.scannedFiles += files.length

      for (const filePath of files) {
        try {
          if (!matchesSourcePathFilter(sourcePathFilter, filePath)) {
            continue
          }
          const candidate = await readConversationPreview(
            adapter,
            filePath,
            isArchivedNativeHistoryFile(adapter, homeDir, filePath)
          )
          if (candidate == null || !isProjectConversation(candidate.cwd, projectContext)) {
            continue
          }

          const importedSessionId = findImportedNativeHistorySessionId(runtimeRoot, candidate)
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
        } catch (error) {
          logger.warn({
            adapter,
            error,
            filePath
          }, '[runtime-store] Failed to preview native history file')
        }
      }
    }

    preview.candidates.sort((a, b) => b.updatedAt - a.updatedAt)
    adapterPreviews.push(preview)
  }

  return {
    adapters: adapterPreviews,
    largeFileThresholdBytes: LARGE_NATIVE_HISTORY_FILE_BYTES,
    largeFiles: adapterPreviews.reduce((sum, preview) => sum + preview.largeFiles, 0),
    largestFileBytes: Math.max(0, ...adapterPreviews.map(preview => preview.largestFileBytes)),
    matchedFiles: adapterPreviews.reduce((sum, preview) => sum + preview.matchedFiles, 0),
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
  const sourcePathFilter = createSourcePathFilter(options.sourcePaths)
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
          const conversationCwd = await readConversationCwd(adapter, filePath)
          if (!isProjectConversation(conversationCwd, projectContext)) {
            continue
          }
          const records = await readJsonlRecords(filePath, adapter)
          const conversation = parseConversation(adapter, filePath, records, projectContext)
          if (conversation == null) {
            continue
          }
          if (findImportedNativeHistorySessionId(runtimeRoot, conversation) != null) {
            continue
          }
          result.matchedFiles += 1
          const sessionResult = await importConversation(conversation, {
            runtimeRoot,
            workspaceCwd: cwd
          })
          result.importedEvents += sessionResult.importedEvents
          if (sessionResult.importedEvents > 0) {
            result.importedSessions += 1
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
    result.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    await watchRuntimeStoreRoot(runtimeRoot)
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
    await replayNativeHistoryRuntimeRoot(resolveNativeHistoryImportRuntimeRoot(options))
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
