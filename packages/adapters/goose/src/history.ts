/* eslint-disable max-lines -- public CLI validation and export normalization stay fail-closed in one boundary. */
import { Buffer } from 'node:buffer'
import { execFile, spawn } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import type { AdapterCtx } from '@oneworks/types'

import type { GooseCliConfig } from './config-schema'
import { resolveInstalledGooseCli } from './managed-cli'

const execFileAsync = promisify(execFile)
const DEFAULT_LIST_LIMIT_BYTES = 4 * 1024 * 1024
// Public exports stream in production. The buffered dependency-injection fallback receives 1 MiB
// beyond the active serialized policy for JSON framing, but no path can exceed the 128 MiB ceiling.
const DEFAULT_EXPORT_ABSOLUTE_LIMIT_BYTES = 128 * 1024 * 1024
const EXPORT_BUFFER_FRAMING_HEADROOM_BYTES = 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_SESSIONS = 10_000
const MAX_MESSAGES = 100_000

export interface GooseHistorySession {
  archived: boolean
  createdAt: number
  cwd: string
  messageCount: number
  model?: string
  nativeSessionId: string
  sessionType?: string
  sourcePath: string
  title: string
  updatedAt: number
}

export interface GooseHistoryMessage {
  content: string | Array<Record<string, unknown> & { type: string }>
  id: string
  role: 'assistant' | 'user'
  ts: number
}

export interface GooseHistoryConversation extends GooseHistorySession {
  messages: GooseHistoryMessage[]
}

export interface GooseHistoryCommandOptions {
  binaryPath?: string
  deadlineAt?: number
  env?: NodeJS.ProcessEnv
  exec?: typeof execFileAsync
  maxOutputBytes?: number
  maxSerializedBytes?: number
  now?: () => number
  spawn?: typeof spawn
  timeoutMs?: number
}

export interface GooseHistoryUnsupportedCounts {
  recipe: number
  subagent: number
}

export interface GooseHistoryListResult {
  sessions: GooseHistorySession[]
  unsupported: GooseHistoryUnsupportedCounts
}

export interface GooseHistoryExportInspection {
  conversation?: GooseHistoryConversation
  oversized: boolean
  serializedBytes: number
  serializedBytesExact: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const stringValue = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const numberValue = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
)

const parseTimestamp = (value: unknown, label: string) => {
  const timestamp = typeof value === 'string' ? Date.parse(value) : numberValue(value)
  if (timestamp == null || !Number.isFinite(timestamp)) throw new Error(`Goose history returned invalid ${label}.`)
  return timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp
}

const assertNativeSessionId = (value: unknown) => {
  const id = stringValue(value)
  if (id == null || !/^[A-Za-z0-9][\w.:-]{0,255}$/u.test(id)) {
    throw new Error('Goose history returned an unsafe native session id.')
  }
  return id
}

const assertAbsoluteCwd = (value: unknown) => {
  const cwd = stringValue(value)
  if (cwd == null || !isAbsolute(cwd) || cwd.includes('\0')) {
    throw new Error('Goose history returned an unsafe working directory.')
  }
  return cwd
}

const resolveBinary = async (value: string | undefined) => {
  const candidate = value?.trim() || 'goose'
  if (candidate.includes('/') || candidate.includes('\\')) {
    if (!isAbsolute(candidate)) throw new Error('Goose history CLI path must be absolute.')
    const resolved = await realpath(candidate).catch(() => undefined)
    if (resolved == null || !(await lstat(resolved)).isFile()) {
      throw new Error('Goose history CLI path is not a regular file.')
    }
    return resolved
  }
  if (candidate !== 'goose') throw new Error('Goose history CLI command must be goose or an absolute path.')
  return candidate
}

const buildHistoryEnv = (env: NodeJS.ProcessEnv) => {
  const realHome = stringValue(env.__ONEWORKS_PROJECT_REAL_HOME__) ?? stringValue(env.HOME) ?? homedir()
  const names = [
    'APPDATA',
    'LANG',
    'LC_ALL',
    'LOCALAPPDATA',
    'PATH',
    'PATHEXT',
    'SHELL',
    'SYSTEMROOT',
    'TMP',
    'TMPDIR',
    'TEMP',
    'USERPROFILE',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_STATE_HOME'
  ] as const
  const result: NodeJS.ProcessEnv = { HOME: realHome, USERPROFILE: realHome }
  for (const name of names) {
    if (typeof env[name] === 'string') result[name] = env[name]
  }
  const realGooseRoot = stringValue(env.__ONEWORKS_PROJECT_REAL_GOOSE_PATH_ROOT__)
  if (realGooseRoot != null) result.GOOSE_PATH_ROOT = realGooseRoot
  return result
}

const resolveSerializedLimit = (value: number | undefined) => {
  if (value != null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Goose history serialized size limit must be a non-negative safe integer.')
  }
  return value
}

const resolveOutputLimit = (value: number | undefined, fallback: number) => {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('Goose history output limit must be a positive safe integer.')
  }
  return Math.min(limit, DEFAULT_EXPORT_ABSOLUTE_LIMIT_BYTES)
}

const resolveCommandTimeout = (options: GooseHistoryCommandOptions) => {
  const configuredTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(configuredTimeout) || configuredTimeout <= 0) {
    throw new Error('Goose history timeout must be a positive safe integer.')
  }
  const remaining = options.deadlineAt == null
    ? configuredTimeout
    : Math.floor(options.deadlineAt - (options.now ?? Date.now)())
  if (!Number.isSafeInteger(remaining) || remaining <= 0) {
    throw new Error('Goose history request deadline exceeded before the next public CLI command.')
  }
  return Math.min(configuredTimeout, remaining)
}

const runJson = async (params: {
  args: string[]
  defaultMaxOutputBytes: number
  options: GooseHistoryCommandOptions
  oversizedOnBufferLimit?: boolean
}) => {
  const binaryPath = await resolveBinary(params.options.binaryPath)
  const maxOutputBytes = resolveOutputLimit(params.options.maxOutputBytes, params.defaultMaxOutputBytes)
  const maxSerializedBytes = resolveSerializedLimit(params.options.maxSerializedBytes)
  const timeout = resolveCommandTimeout(params.options)
  let result: { stdout?: string | Buffer; stderr?: string | Buffer }
  try {
    result = await (params.options.exec ?? execFileAsync)(binaryPath, params.args, {
      env: buildHistoryEnv(params.options.env ?? process.env),
      maxBuffer: maxOutputBytes,
      timeout,
      windowsHide: true
    })
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stderr?: unknown }
    if (commandError.killed || commandError.code === 'ETIMEDOUT' || commandError.signal === 'SIGTERM') {
      throw new Error(`Goose history command timed out after ${timeout}ms.`)
    }
    if (commandError.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      if (params.oversizedOnBufferLimit && maxSerializedBytes != null && maxOutputBytes > maxSerializedBytes) {
        return {
          oversized: true as const,
          serializedBytes: maxOutputBytes + 1,
          serializedBytesExact: false
        }
      }
      throw new Error('Goose history output exceeded the configured limit.')
    }
    throw new Error(`Goose history command failed: ${stringValue(commandError.stderr) ?? commandError.message}`)
  }
  const stdout = String(result.stdout ?? '')
  const serializedBytes = Buffer.byteLength(stdout)
  if (serializedBytes > maxOutputBytes) throw new Error('Goose history output exceeded the configured limit.')
  if (maxSerializedBytes != null) {
    if (serializedBytes > maxSerializedBytes) {
      return { oversized: true as const, serializedBytes, serializedBytesExact: true }
    }
  }
  try {
    return {
      output: JSON.parse(stdout) as unknown,
      oversized: false as const,
      serializedBytes,
      serializedBytesExact: true
    }
  } catch {
    throw new Error('Goose history command returned invalid JSON.')
  }
}

const runStreamingExportJson = async (params: {
  args: string[]
  options: GooseHistoryCommandOptions
}) => {
  const binaryPath = await resolveBinary(params.options.binaryPath)
  const maxSerializedBytes = resolveSerializedLimit(params.options.maxSerializedBytes)
  const absoluteLimit = resolveOutputLimit(
    params.options.maxOutputBytes,
    DEFAULT_EXPORT_ABSOLUTE_LIMIT_BYTES
  )
  const timeout = resolveCommandTimeout(params.options)
  const child = (params.options.spawn ?? spawn)(binaryPath, params.args, {
    env: buildHistoryEnv(params.options.env ?? process.env),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })

  return await new Promise<{
    output?: unknown
    oversized: boolean
    serializedBytes: number
    serializedBytesExact: boolean
  }>((resolvePromise, reject) => {
    let absoluteLimitExceeded = false
    let settled = false
    let serializedBytes = 0
    let stderr = Buffer.alloc(0)
    let timedOut = false
    let stdout: Buffer[] = []
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeout)

    child.stdout?.on('data', (value: Buffer | string) => {
      if (absoluteLimitExceeded) return
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      if (serializedBytes + chunk.byteLength > absoluteLimit) {
        serializedBytes = absoluteLimit + 1
        absoluteLimitExceeded = true
        stdout = []
        child.kill('SIGKILL')
        return
      }
      serializedBytes += chunk.byteLength
      if (maxSerializedBytes != null && serializedBytes > maxSerializedBytes) {
        stdout = []
        return
      }
      stdout.push(chunk)
    })
    child.stderr?.on('data', (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      stderr = Buffer.concat([stderr, chunk]).subarray(-MAX_STDERR_BYTES)
    })
    child.once('error', (error) => settle(() => reject(error)))
    child.once('close', (code) =>
      settle(() => {
        if (timedOut) {
          reject(new Error(`Goose history command timed out after ${timeout}ms.`))
          return
        }
        if (absoluteLimitExceeded) {
          if (maxSerializedBytes != null && maxSerializedBytes < absoluteLimit) {
            resolvePromise({
              oversized: true,
              serializedBytes,
              serializedBytesExact: false
            })
            return
          }
          reject(new Error('Goose history output exceeded the absolute safety limit.'))
          return
        }
        if (code !== 0) {
          reject(new Error(`Goose history command failed: ${stderr.toString('utf8').trim() || `exit ${code}`}`))
          return
        }
        if (maxSerializedBytes != null && serializedBytes > maxSerializedBytes) {
          resolvePromise({ oversized: true, serializedBytes, serializedBytesExact: true })
          return
        }
        try {
          resolvePromise({
            output: JSON.parse(Buffer.concat(stdout, serializedBytes).toString('utf8')) as unknown,
            oversized: false,
            serializedBytes,
            serializedBytesExact: true
          })
        } catch {
          reject(new Error('Goose history command returned invalid JSON.'))
        }
      }))
  })
}

const readModel = (value: Record<string, unknown>) => {
  const provider = stringValue(value.provider_name)
  const modelConfig = isRecord(value.model_config) ? value.model_config : {}
  const model = stringValue(modelConfig.model_name) ?? stringValue(modelConfig.model) ?? stringValue(modelConfig.name)
  return model == null ? provider : provider == null ? model : `${provider}/${model}`
}

const normalizeSession = (value: unknown): GooseHistorySession => {
  if (!isRecord(value)) throw new Error('Goose history list contained a non-object session.')
  const nativeSessionId = assertNativeSessionId(value.id)
  const title = stringValue(value.name)
  if (title == null || title.length > 4_096) throw new Error('Goose history returned an invalid session title.')
  const cwd = assertAbsoluteCwd(value.working_dir)
  const createdAt = parseTimestamp(value.created_at, 'created_at')
  const updatedAt = parseTimestamp(value.last_message_at ?? value.updated_at, 'updated_at')
  const messageCount = numberValue(value.message_count) ?? 0
  if (!Number.isSafeInteger(messageCount) || messageCount < 0) {
    throw new Error('Goose history returned an invalid message count.')
  }
  return {
    archived: value.archived_at != null,
    createdAt,
    cwd,
    messageCount,
    model: readModel(value),
    nativeSessionId,
    sessionType: value.recipe == null ? stringValue(value.session_type) : 'recipe',
    sourcePath: `goose-cli://session/${encodeURIComponent(nativeSessionId)}`,
    title,
    updatedAt
  }
}

export const listGooseHistoryWithDiagnostics = async (
  options: GooseHistoryCommandOptions = {}
): Promise<GooseHistoryListResult> => {
  const result = await runJson({
    args: ['session', 'list', '--format', 'json'],
    defaultMaxOutputBytes: DEFAULT_LIST_LIMIT_BYTES,
    options
  })
  if (result.oversized) throw new Error('Goose history list exceeded its serialized size limit.')
  const output = result.output
  if (!Array.isArray(output) || output.length > MAX_SESSIONS) {
    throw new Error('Goose history list returned an invalid session array.')
  }
  const normalized = output.map(normalizeSession)
  const unsupported: GooseHistoryUnsupportedCounts = { recipe: 0, subagent: 0 }
  const sessions = normalized.filter((session) => {
    if (/recipe/iu.test(session.sessionType ?? '')) {
      unsupported.recipe += 1
      return false
    }
    if (/sub.?agent/iu.test(session.sessionType ?? '')) {
      unsupported.subagent += 1
      return false
    }
    return true
  })
  const unique = new Map<string, GooseHistorySession>()
  for (const session of sessions) {
    const existing = unique.get(session.nativeSessionId)
    if (existing != null && existing.cwd !== session.cwd) {
      throw new Error('Goose history returned one native session id for multiple projects.')
    }
    if (existing == null || existing.updatedAt < session.updatedAt) unique.set(session.nativeSessionId, session)
  }
  return { sessions: [...unique.values()], unsupported }
}

export const listGooseHistory = async (options: GooseHistoryCommandOptions = {}) =>
  (
    await listGooseHistoryWithDiagnostics(options)
  ).sessions

const normalizeTextBlock = (value: Record<string, unknown>) => {
  const text = stringValue(value.text)
  return text == null ? undefined : { type: 'text', text }
}

const normalizeToolRequest = (value: Record<string, unknown>) => {
  const id = stringValue(value.id)
  const result = isRecord(value.toolCall) ? value.toolCall : isRecord(value.tool_call) ? value.tool_call : {}
  const tool = result.status === 'success' && isRecord(result.value) ? result.value : undefined
  const name = stringValue(tool?.name)
  if (id == null || name == null) return undefined
  return { type: 'tool_use', id, name, input: isRecord(tool?.arguments) ? tool.arguments : {} }
}

const normalizeToolResponse = (value: Record<string, unknown>) => {
  const id = stringValue(value.id)
  const result = isRecord(value.toolResult) ? value.toolResult : isRecord(value.tool_result) ? value.tool_result : {}
  if (id == null) return undefined
  if (result.status === 'error') {
    return { type: 'tool_result', tool_use_id: id, content: stringValue(result.error) ?? 'Tool failed', is_error: true }
  }
  const response = isRecord(result.value) ? result.value : {}
  const content = Array.isArray(response.content)
    ? response.content.map(item => isRecord(item) && item.type === 'text' ? stringValue(item.text) : undefined)
      .filter((item): item is string => item != null).join('\n')
    : ''
  return { type: 'tool_result', tool_use_id: id, content, ...(response.isError === true ? { is_error: true } : {}) }
}

const normalizeMessageContent = (value: unknown) => {
  if (!Array.isArray(value)) return undefined
  const content = value.flatMap((item) => {
    if (!isRecord(item)) return []
    if (item.type === 'text') return normalizeTextBlock(item) ?? []
    if (item.type === 'toolRequest') return normalizeToolRequest(item) ?? []
    if (item.type === 'toolResponse') return normalizeToolResponse(item) ?? []
    if (item.type === 'image') return [{ type: 'text', text: `[Image: ${stringValue(item.mimeType) ?? 'unknown'}]` }]
    if (item.type === 'error') {
      return [{ type: 'text', text: `[Goose error: ${stringValue(item.message) ?? 'unknown'}]` }]
    }
    return []
  })
  if (content.length === 0) return undefined
  if (content.every(item => item.type === 'text')) {
    const text = content.map(item => 'text' in item ? String(item.text ?? '') : '').join('\n').trim()
    return text === '' ? undefined : text
  }
  return content
}

export const inspectGooseHistoryExport = async (
  session: GooseHistorySession,
  options: GooseHistoryCommandOptions = {}
): Promise<GooseHistoryExportInspection> => {
  const nativeSessionId = assertNativeSessionId(session.nativeSessionId)
  const args = ['session', 'export', '--session-id', nativeSessionId, '--format', 'json']
  const maxSerializedBytes = resolveSerializedLimit(options.maxSerializedBytes)
  const result = options.exec == null
    ? await runStreamingExportJson({ args, options })
    : await runJson({
      args,
      defaultMaxOutputBytes: maxSerializedBytes == null
        ? DEFAULT_EXPORT_ABSOLUTE_LIMIT_BYTES
        : Math.min(
          DEFAULT_EXPORT_ABSOLUTE_LIMIT_BYTES,
          maxSerializedBytes + EXPORT_BUFFER_FRAMING_HEADROOM_BYTES
        ),
      options,
      oversizedOnBufferLimit: true
    })
  if (result.oversized) {
    return {
      oversized: true,
      serializedBytes: result.serializedBytes,
      serializedBytesExact: result.serializedBytesExact
    }
  }
  const output = result.output
  if (!isRecord(output) || assertNativeSessionId(output.id) !== nativeSessionId) {
    throw new Error('Goose history export returned a mismatched session.')
  }
  if (assertAbsoluteCwd(output.working_dir) !== session.cwd) {
    throw new Error('Goose history export changed the session working directory.')
  }
  if (!Array.isArray(output.conversation) || output.conversation.length > MAX_MESSAGES) {
    throw new Error('Goose history export returned an invalid conversation.')
  }
  const messages: GooseHistoryMessage[] = []
  output.conversation.forEach((message, index) => {
    if (!isRecord(message) || (message.role !== 'user' && message.role !== 'assistant')) return
    const content = normalizeMessageContent(message.content)
    if (content == null) return
    const nativeMessageId = stringValue(message.id) ?? `${index + 1}`
    messages.push({
      id: `goose:${nativeSessionId}:${nativeMessageId}:${index + 1}`,
      role: message.role,
      content,
      ts: parseTimestamp(message.created, 'message created')
    })
  })
  if (messages.length === 0) throw new Error('Goose history export contained no importable messages.')
  return {
    conversation: { ...session, messages },
    oversized: false,
    serializedBytes: result.serializedBytes,
    serializedBytesExact: true
  }
}

export const exportGooseHistory = async (
  session: GooseHistorySession,
  options: GooseHistoryCommandOptions = {}
): Promise<GooseHistoryConversation> => {
  const result = await inspectGooseHistoryExport(session, options)
  if (result.oversized || result.conversation == null) {
    throw new Error('Goose history export exceeded its serialized size limit.')
  }
  return result.conversation
}

export const resolveGooseHistoryBinary = async (params: {
  config?: GooseCliConfig
  cwd: string
  env: AdapterCtx['env'] | NodeJS.ProcessEnv
}) =>
  resolveInstalledGooseCli({
    config: params.config,
    cwd: params.cwd,
    env: params.env
  })
