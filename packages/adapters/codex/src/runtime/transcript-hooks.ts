/* eslint-disable max-lines */

import { Buffer } from 'node:buffer'
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import type { ChatMessage } from '@oneworks/core'
import { callHook } from '@oneworks/hooks'
import type { AdapterCtx, AdapterOutputEvent, TaskRuntime } from '@oneworks/types'

import { prefixToolName } from '#~/protocol/incoming.js'

interface CodexTranscriptEvent {
  timestamp?: string
  type?: string
  payload?: Record<string, unknown>
}

interface CodexTranscriptSessionMeta {
  id?: string
  cwd?: string
  timestamp?: string
}

interface TranscriptFileState {
  byteOffset: number
  remainder: string
  sessionMeta?: CodexTranscriptSessionMeta & { eligible: boolean }
}

interface PendingTranscriptToolCall {
  toolName: string
  toolInput?: unknown
  transcriptPath: string
}

interface CodexTranscriptHookWatcherParams {
  cwd: string
  env: AdapterCtx['env']
  homeDir?: string
  logger: AdapterCtx['logger']
  onEvent?: (event: AdapterOutputEvent) => void
  runtime: TaskRuntime
  sessionId: string
  pollIntervalMs?: number
}

export interface CodexTranscriptHookWatcher {
  start(): void
  stop(): void
}

const DEFAULT_POLL_INTERVAL_MS = 250
const SESSION_TIME_SKEW_MS = 5_000

const BASH_LIKE_TOOL_NAMES = new Set([
  'bash',
  'exec',
  'exec_command',
  'command_execution',
  'shell',
  'local_shell'
])

const TOOL_NAME_MAP: Record<string, string> = {
  apply_patch: 'adapter:codex:ApplyPatch',
  edit_file: 'adapter:codex:EditFile',
  glob: 'adapter:codex:Glob',
  grep: 'adapter:codex:Grep',
  list_dir: 'adapter:codex:ListDir',
  read: 'adapter:codex:ReadFile',
  read_file: 'adapter:codex:ReadFile',
  view_image: 'adapter:codex:ViewImage',
  web_fetch: 'adapter:codex:WebFetch',
  write_file: 'adapter:codex:WriteFile'
}

const parseJson = (value: string) => {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined
)

const readRecord = (value: unknown) => (
  isRecord(value) ? value : undefined
)

const readCallId = (payload: Record<string, unknown>) => (
  readString(payload.call_id) ??
    readString(payload.callId) ??
    readString(payload.id)
)

const buildMcpToolName = (payload: Record<string, unknown>) => {
  const serverName = readString(payload.server) ?? readString(payload.server_name)
  const toolName = readString(payload.tool) ?? readString(payload.tool_name) ?? readString(payload.name)
  if (serverName == null || toolName == null) return undefined
  return `mcp:${serverName}:${toolName}`
}

const isImmediateToolPayload = (payloadType: string) => (
  payloadType === 'web_search_call' ||
  payloadType === 'file_change'
)

const isPendingToolCallPayload = (payloadType: string) => (
  payloadType === 'function_call' ||
  payloadType === 'custom_tool_call' ||
  payloadType === 'mcp_tool_call'
)

const isPendingToolResultPayload = (payloadType: string) => (
  payloadType === 'function_call_output' ||
  payloadType === 'custom_tool_call_output' ||
  payloadType === 'mcp_tool_call_output'
)

const normalizeToolName = (
  rawName: string | undefined,
  payloadType: string,
  payload?: Record<string, unknown>
) => {
  if (payloadType === 'web_search_call') return 'adapter:codex:WebSearch'
  if (payloadType === 'file_change') return 'adapter:codex:FileChange'

  if (payloadType === 'mcp_tool_call' && payload != null) {
    rawName = buildMcpToolName(payload)
  }

  if (rawName == null || rawName.trim() === '') return undefined

  const normalizedRawName = rawName.trim()
  const normalizedKey = normalizedRawName.toLowerCase()

  if (BASH_LIKE_TOOL_NAMES.has(normalizedKey)) return undefined
  if (TOOL_NAME_MAP[normalizedKey] != null) return TOOL_NAME_MAP[normalizedKey]
  if (normalizedRawName.startsWith('adapter:codex:')) return normalizedRawName

  return `adapter:codex:${normalizedRawName}`
}

const readRawToolName = (payload: Record<string, unknown>) => (
  typeof payload.name === 'string'
    ? payload.name
    : typeof payload.tool === 'string'
    ? payload.tool
    : typeof payload.tool_name === 'string'
    ? payload.tool_name
    : undefined
)

const normalizeTranscriptEventToolName = (
  payloadType: string,
  payload: Record<string, unknown>
) => {
  if (payloadType === 'web_search_call') return prefixToolName('WebSearch')
  if (payloadType === 'file_change') return prefixToolName('FileChange')

  if (payloadType === 'mcp_tool_call') {
    const mcpToolName = buildMcpToolName(payload)
    return mcpToolName == null ? undefined : prefixToolName(mcpToolName)
  }

  const rawName = readRawToolName(payload)
  if (rawName == null || rawName.trim() === '') return undefined

  const normalizedRawName = rawName.trim()
  const normalizedKey = normalizedRawName.toLowerCase()

  if (BASH_LIKE_TOOL_NAMES.has(normalizedKey)) return prefixToolName('Bash')
  if (TOOL_NAME_MAP[normalizedKey] != null) return TOOL_NAME_MAP[normalizedKey]
  return prefixToolName(normalizedRawName)
}

const normalizeTranscriptEventToolInput = (
  payloadType: string,
  payload: Record<string, unknown>,
  toolName: string
) => {
  const input = extractToolInput(payloadType, payload)
  if (toolName !== prefixToolName('Bash') || !isRecord(input)) {
    return input
  }

  const command = typeof input.command === 'string'
    ? input.command
    : typeof input.cmd === 'string'
    ? input.cmd
    : undefined
  const cwd = typeof input.cwd === 'string'
    ? input.cwd
    : typeof input.workdir === 'string'
    ? input.workdir
    : undefined
  const timeoutMs = typeof input.timeoutMs === 'number'
    ? input.timeoutMs
    : typeof input.yield_time_ms === 'number'
    ? input.yield_time_ms
    : undefined
  const omittedKeys = new Set(['command', 'cmd', 'cwd', 'workdir', 'timeoutMs', 'yield_time_ms'])
  const rest = Object.fromEntries(Object.entries(input).filter(([key]) => !omittedKeys.has(key)))

  return {
    ...(command != null ? { command } : {}),
    ...(cwd != null ? { cwd } : {}),
    ...(timeoutMs != null ? { timeoutMs } : {}),
    ...rest
  }
}

const extractAssistantText = (payload: Record<string, unknown>) => {
  if (payload.role !== 'assistant') return undefined

  const content = payload.content
  if (typeof content === 'string') {
    const trimmed = content.trim()
    return trimmed === '' ? undefined : content
  }
  if (!Array.isArray(content)) return undefined

  const text = content
    .map(item => {
      if (!isRecord(item)) return undefined
      if ((item.type === 'output_text' || item.type === 'text') && typeof item.text === 'string') {
        return item.text
      }
      return undefined
    })
    .filter((item): item is string => typeof item === 'string')
    .join('')
  return text.trim() === '' ? undefined : text
}

const extractToolInput = (payloadType: string, payload: Record<string, unknown>) => {
  if (payloadType === 'web_search_call') {
    const action = isRecord(payload.action) ? payload.action : {}
    const actionType = typeof action.type === 'string' ? action.type : undefined

    if (actionType === 'search') {
      return { query: action.query ?? payload.query }
    }
    if (actionType === 'open_page') {
      return { url: action.url }
    }
    if (actionType === 'find_in_page') {
      return {
        url: action.url,
        pattern: action.pattern
      }
    }
    return action
  }

  if (payloadType === 'function_call') {
    if (typeof payload.arguments === 'string') {
      return parseJson(payload.arguments) ?? { raw: payload.arguments }
    }
    return readRecord(payload.arguments)
  }

  if (payloadType === 'custom_tool_call') {
    if (typeof payload.input !== 'string') return undefined
    if (typeof payload.name === 'string' && payload.name.trim().toLowerCase() === 'apply_patch') {
      return { patch: payload.input }
    }
    return parseJson(payload.input) ?? { input: payload.input }
  }

  if (payloadType === 'mcp_tool_call') {
    if (typeof payload.arguments === 'string') {
      return parseJson(payload.arguments) ?? { raw: payload.arguments }
    }

    return readRecord(payload.arguments) ??
      readRecord(payload.input) ??
      {
        server: readString(payload.server) ?? readString(payload.server_name),
        tool: readString(payload.tool) ?? readString(payload.tool_name) ?? readString(payload.name)
      }
  }

  if (payloadType === 'file_change') {
    return {
      status: payload.status,
      changes: Array.isArray(payload.changes) ? payload.changes : []
    }
  }

  return undefined
}

const extractToolResponse = (payloadType: string, payload: Record<string, unknown>) => {
  if (payloadType === 'web_search_call') {
    return {
      status: payload.status,
      action: payload.action
    }
  }

  if (payloadType === 'file_change') {
    return {
      status: payload.status,
      changes: Array.isArray(payload.changes) ? payload.changes : []
    }
  }

  if (isPendingToolResultPayload(payloadType)) {
    if (typeof payload.output !== 'string') return payload.output
    return parseJson(payload.output) ?? payload.output
  }

  return undefined
}

const extractToolError = (toolResponse: unknown) => {
  if (!isRecord(toolResponse)) return false
  if (toolResponse.success === false) return true
  if (typeof toolResponse.status === 'string') {
    return toolResponse.status === 'failed' || toolResponse.status === 'declined'
  }
  if (isRecord(toolResponse.metadata) && typeof toolResponse.metadata.exit_code === 'number') {
    return toolResponse.metadata.exit_code !== 0
  }
  if (isRecord(toolResponse.metadata) && typeof toolResponse.metadata.exitCode === 'number') {
    return toolResponse.metadata.exitCode !== 0
  }
  return false
}

const walkJsonlFiles = (dir: string, visit: (filePath: string) => void) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      walkJsonlFiles(fullPath, visit)
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      visit(fullPath)
    }
  }
}

const parseTranscriptLine = (line: string) => {
  try {
    return JSON.parse(line) as CodexTranscriptEvent
  } catch {
    return undefined
  }
}

class CodexTranscriptHookWatcherImpl implements CodexTranscriptHookWatcher {
  private readonly states = new Map<string, TranscriptFileState>()
  private readonly pendingCalls = new Map<string, PendingTranscriptToolCall>()
  private readonly startedAt = Date.now()
  private readonly sessionsDir: string
  private emittedEventSeq = 0
  private scanChain: Promise<void> = Promise.resolve()
  private timer: NodeJS.Timeout | undefined
  private stopped = false

  constructor(private readonly params: CodexTranscriptHookWatcherParams) {
    const homeDir = params.homeDir ?? params.env.HOME ?? process.env.HOME
    this.sessionsDir = resolve(homeDir ?? '/', '.codex', 'sessions')
  }

  start() {
    try {
      this.scanSessionsDir()
      this.scheduleScan()
      this.timer = setInterval(() => {
        this.scheduleScan()
      }, this.params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
    } catch (error) {
      this.params.logger.warn('[codex transcript hooks] failed to start watcher', error)
    }
  }

  stop() {
    this.stopped = true
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    void this.flushAndDispose()
  }

  private scheduleScan() {
    this.scanChain = this.scanChain.then(async () => {
      await this.scanForChanges()
    })
  }

  private async flushAndDispose() {
    await this.scanChain
    await this.scanForChanges({
      includeStopped: true
    })
    this.states.clear()
    this.pendingCalls.clear()
  }

  private scanSessionsDir() {
    try {
      if (!existsSync(this.sessionsDir)) return
      walkJsonlFiles(this.sessionsDir, (filePath) => {
        if (this.states.has(filePath)) return
        const size = statSync(filePath).size
        this.states.set(filePath, { byteOffset: size, remainder: '' })
      })
    } catch {
      // sessions dir may not exist until codex writes the first transcript
    }
  }

  private async scanForChanges(options: { includeStopped?: boolean } = {}) {
    if (this.stopped && options.includeStopped !== true) return

    try {
      if (!existsSync(this.sessionsDir)) return
      const pendingProcesses: Promise<void>[] = []
      walkJsonlFiles(this.sessionsDir, (filePath) => {
        const stat = statSync(filePath)
        const current = this.states.get(filePath)

        if (current == null) {
          this.states.set(filePath, { byteOffset: 0, remainder: '' })
          pendingProcesses.push(this.processFile(filePath))
          return
        }

        if (stat.size < current.byteOffset) {
          current.byteOffset = 0
          current.remainder = ''
          current.sessionMeta = undefined
        }

        if (stat.size > current.byteOffset) {
          pendingProcesses.push(this.processFile(filePath))
        }
      })
      await Promise.all(pendingProcesses)
    } catch (error) {
      this.params.logger.warn('[codex transcript hooks] failed to scan session transcripts', error)
    }
  }

  private async processFile(filePath: string) {
    const state = this.states.get(filePath) ?? { byteOffset: 0, remainder: '' }
    this.states.set(filePath, state)

    let fd: number | undefined

    try {
      const stat = statSync(filePath)
      if (stat.size <= state.byteOffset) return

      fd = openSync(filePath, 'r')
      const nextLength = stat.size - state.byteOffset
      const buffer = Buffer.alloc(nextLength)
      readSync(fd, buffer, 0, nextLength, state.byteOffset)
      state.byteOffset = stat.size

      const chunk = `${state.remainder}${buffer.toString('utf8')}`
      const lines = chunk.split('\n')
      state.remainder = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        const event = parseTranscriptLine(trimmed)
        if (event == null) continue
        await this.handleEvent(filePath, state, event)
      }
    } catch (error) {
      this.params.logger.warn('[codex transcript hooks] failed to process transcript file', { error, filePath })
    } finally {
      if (fd != null) {
        closeSync(fd)
      }
    }
  }

  private async handleEvent(
    filePath: string,
    state: TranscriptFileState,
    event: CodexTranscriptEvent
  ) {
    const payload = isRecord(event.payload) ? event.payload : undefined
    if (payload == null) return

    if (event.type === 'session_meta') {
      const sessionMeta = payload as CodexTranscriptSessionMeta
      const sessionTimestamp = Date.parse(sessionMeta.timestamp ?? event.timestamp ?? '')
      state.sessionMeta = {
        ...sessionMeta,
        eligible: sessionMeta.cwd === this.params.cwd &&
          (!Number.isFinite(sessionTimestamp) || sessionTimestamp >= this.startedAt - SESSION_TIME_SKEW_MS)
      }
      return
    }

    if (event.type === 'event_msg' && state.sessionMeta?.eligible === true) {
      this.emitUserTranscriptMessage(payload, event)
      return
    }

    if (event.type !== 'response_item' || state.sessionMeta?.eligible !== true) return

    const payloadType = typeof payload.type === 'string' ? payload.type : undefined
    if (payloadType == null) return

    if (payloadType === 'message') {
      this.emitTranscriptMessageItem(payload, event)
      return
    }

    if (isImmediateToolPayload(payloadType)) {
      const toolName = normalizeToolName(undefined, payloadType, payload)
      const eventToolName = normalizeTranscriptEventToolName(payloadType, payload)
      if (toolName == null && eventToolName == null) return

      const callId = readCallId(payload) ??
        `${payloadType}:${event.timestamp ?? Date.now().toString(36)}:${state.byteOffset}`
      const toolInput = extractToolInput(payloadType, payload)
      const toolResponse = extractToolResponse(payloadType, payload)
      if (eventToolName != null) {
        this.emitTranscriptToolUse(
          callId,
          eventToolName,
          normalizeTranscriptEventToolInput(payloadType, payload, eventToolName)
        )
        this.emitTranscriptToolResult(callId, toolResponse, extractToolError(toolResponse))
      }
      if (toolName != null) {
        await this.callObservationalHook('PreToolUse', {
          transcriptPath: filePath,
          toolCallId: callId,
          toolInput,
          toolName
        })
        await this.callObservationalHook('PostToolUse', {
          transcriptPath: filePath,
          toolCallId: callId,
          toolInput,
          toolName,
          toolResponse,
          isError: extractToolError(toolResponse)
        })
      }
      return
    }

    if (isPendingToolCallPayload(payloadType)) {
      const rawToolName = readRawToolName(payload)
      const toolName = normalizeToolName(rawToolName, payloadType, payload)
      const eventToolName = normalizeTranscriptEventToolName(payloadType, payload)
      const callId = readCallId(payload)
      if (callId == null || (toolName == null && eventToolName == null)) return

      const toolInput = extractToolInput(payloadType, payload)
      if (toolName != null) {
        this.pendingCalls.set(callId, {
          toolName,
          toolInput,
          transcriptPath: filePath
        })
      }
      if (eventToolName != null) {
        this.emitTranscriptToolUse(
          callId,
          eventToolName,
          normalizeTranscriptEventToolInput(payloadType, payload, eventToolName)
        )
      }
      if (toolName == null) return
      await this.callObservationalHook('PreToolUse', {
        transcriptPath: filePath,
        toolCallId: callId,
        toolInput,
        toolName
      })
      return
    }

    if (isPendingToolResultPayload(payloadType)) {
      const callId = readCallId(payload)
      if (callId == null) return

      const pending = this.pendingCalls.get(callId)
      this.pendingCalls.delete(callId)
      const toolResponse = extractToolResponse(payloadType, payload)
      this.emitTranscriptToolResult(callId, toolResponse, extractToolError(toolResponse))
      if (pending == null) return

      await this.callObservationalHook('PostToolUse', {
        transcriptPath: pending.transcriptPath,
        toolCallId: callId,
        toolInput: pending.toolInput,
        toolName: pending.toolName,
        toolResponse,
        isError: extractToolError(toolResponse)
      })
    }
  }

  private nextTranscriptMessageId(type: string, preferredId?: string) {
    return preferredId ?? `codex-transcript:${type}:${++this.emittedEventSeq}`
  }

  private emitTranscriptMessage(message: ChatMessage) {
    this.params.onEvent?.({ type: 'message', data: message })
  }

  private emitTranscriptMessageItem(payload: Record<string, unknown>, event: CodexTranscriptEvent) {
    const text = extractAssistantText(payload)
    if (text == null) return

    this.emitTranscriptMessage({
      id: this.nextTranscriptMessageId('assistant', readString(payload.id)),
      role: 'assistant',
      content: text,
      createdAt: Date.parse(event.timestamp ?? '') || Date.now()
    })
  }

  private emitUserTranscriptMessage(payload: Record<string, unknown>, event: CodexTranscriptEvent) {
    if (payload.type !== 'user_message') return
    const message = readString(payload.message)
    if (message == null) return

    this.emitTranscriptMessage({
      id: this.nextTranscriptMessageId('user'),
      role: 'user',
      content: message,
      createdAt: Date.parse(event.timestamp ?? '') || Date.now()
    })
  }

  private emitTranscriptToolUse(callId: string, toolName: string, toolInput: unknown) {
    this.emitTranscriptMessage({
      id: this.nextTranscriptMessageId('tool-use', callId),
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: callId,
        name: toolName,
        input: toolInput ?? {}
      }],
      createdAt: Date.now()
    })
  }

  private emitTranscriptToolResult(callId: string, toolResponse: unknown, isError: boolean) {
    this.emitTranscriptMessage({
      id: this.nextTranscriptMessageId('tool-result', `${callId}:result:${++this.emittedEventSeq}`),
      role: 'assistant',
      content: [{
        type: 'tool_result',
        tool_use_id: callId,
        content: toolResponse ?? '[done]',
        is_error: isError
      }],
      createdAt: Date.now()
    })
  }

  private async callObservationalHook(
    eventName: 'PreToolUse' | 'PostToolUse',
    input: Record<string, unknown>
  ) {
    try {
      const output = await callHook(eventName, {
        adapter: 'codex',
        canBlock: false,
        cwd: this.params.cwd,
        hookSource: 'bridge',
        runtime: this.params.runtime,
        sessionId: this.params.sessionId,
        ...input
      } as any, this.params.env)

      if (output?.continue === false) {
        this.params.logger.warn(
          `[codex transcript hooks] ignoring blocking output from observational ${eventName} hook`,
          output.stopReason
        )
      }
    } catch (error) {
      this.params.logger.error(`[codex transcript hooks] ${eventName} failed`, error)
    }
  }
}

export const createCodexTranscriptHookWatcher = (
  params: CodexTranscriptHookWatcherParams
): CodexTranscriptHookWatcher => (
  new CodexTranscriptHookWatcherImpl(params)
)
