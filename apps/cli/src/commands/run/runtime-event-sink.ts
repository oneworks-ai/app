/* eslint-disable max-lines -- runtime sink maps all adapter events into protocol store events */
import { randomUUID } from 'node:crypto'
import process from 'node:process'

import type { ChatMessage, ChatMessageContent } from '@oneworks/core'
import {
  DEFAULT_RUNTIME_PROTOCOL_VERSION,
  DEFAULT_SUPPORTED_PROTOCOL_RANGE,
  FileRuntimeStore,
  resolveRuntimeRoot
} from '@oneworks/runtime-store'
import type {
  RuntimeCommand,
  RuntimeEvent,
  RuntimeEventDraft,
  RuntimeHeartbeat,
  RuntimeMeta,
  RuntimeState
} from '@oneworks/runtime-store'
import type { AdapterOutputEvent } from '@oneworks/types'
import { extractTextFromMessage } from '@oneworks/utils/chat-message'

type RuntimeEventAppendDraft = Omit<RuntimeEventDraft, 'sessionId'> & {
  sessionId?: string
}

export interface RuntimeOperationEventInput {
  error?: string
  message: string
  operationId: string
  title: string
  type: 'operation_started' | 'operation_completed' | 'operation_failed'
}

export interface RuntimeEventSinkOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  runtimeId?: string
  sessionId: string
}

export interface CliRuntimeEventSinkOptions extends RuntimeEventSinkOptions {
  adapter?: string
  createdAt?: number
  effort?: RuntimeMeta['effort']
  message?: string
  model?: string
  permissionMode?: RuntimeMeta['permissionMode']
  title?: string
}

export interface RuntimeStartupRecord {
  startAlreadyAcked: boolean
  startCommand?: RuntimeCommand
  shouldRunInitialPrompt: boolean
}

const statusForEvent = (event: RuntimeEvent): RuntimeState['status'] | undefined => {
  switch (event.type) {
    case 'session_started':
    case 'session_resumed':
    case 'message':
      return 'running'
    case 'approval_requested':
    case 'input_requested':
      return 'waiting_input'
    case 'session_completed':
      return 'completed'
    case 'session_failed':
      return 'failed'
    case 'session_stopped':
      return 'stopped'
    case 'status_changed':
      return event.status
    default:
      return undefined
  }
}

const textFromMessage = (message: ChatMessage) => {
  const text = extractTextFromMessage(message).trim()
  return text === '' ? undefined : text
}

const textFromContent = (content: RuntimeEventDraft['content']) => {
  if (typeof content === 'string') {
    const text = content.trim()
    return text === '' ? undefined : text
  }
  if (Array.isArray(content)) {
    const text = content
      .flatMap(item => item.type === 'text' && typeof item.text === 'string' ? [item.text] : [])
      .join('\n')
      .trim()
    return text === '' ? undefined : text
  }
  return undefined
}

const isChatMessageContent = (item: unknown): item is ChatMessageContent => {
  if (item == null || typeof item !== 'object') {
    return false
  }
  const record = item as Record<string, unknown>
  switch (record.type) {
    case 'text':
      return typeof record.text === 'string'
    case 'image':
      return typeof record.url === 'string'
    case 'file':
      return typeof record.path === 'string'
    case 'tool_use':
      return typeof record.id === 'string' && typeof record.name === 'string'
    case 'tool_result':
      return typeof record.tool_use_id === 'string'
    default:
      return false
  }
}

const normalizeCommandContent = (command: RuntimeCommand): RuntimeEventDraft['content'] => {
  const contentItems = command.contentItems
  if (Array.isArray(contentItems) && contentItems.every(isChatMessageContent)) {
    return structuredClone(contentItems)
  }
  return command.content ?? command.message
}

const normalizeSubmitValue = (value: unknown) => {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value.join('\n')
  if (value == null) return undefined
  return JSON.stringify(value)
}

const trimOptional = (value: string | undefined) => {
  const normalized = value?.trim()
  return normalized == null || normalized === '' ? undefined : normalized
}

const buildCliRuntimeTitle = (options: CliRuntimeEventSinkOptions) =>
  trimOptional(options.title) ??
    trimOptional(options.message)?.split('\n')[0]?.trim() ??
    options.sessionId

const INITIAL_PROMPT_DELIVERY = 'initial_prompt'

export class RuntimeEventSink {
  private queue = Promise.resolve()
  private readonly commandBackedUserMessageTexts: string[] = []
  private lastAssistantText: string | undefined
  private sawFatalError = false
  private readonly runtimeId: string

  constructor(
    private readonly store: FileRuntimeStore,
    private readonly sessionId: string,
    private readonly meta: RuntimeMeta | undefined,
    runtimeId?: string
  ) {
    this.runtimeId = runtimeId ?? `oneworks-run-${process.pid}`
  }

  async recordStartup(commands: RuntimeCommand[]): Promise<RuntimeStartupRecord> {
    const startCommand = commands.find(command => command.type === 'start')
    if (startCommand != null) {
      const events = await this.store.session(this.sessionId).replayEvents()
      const alreadyAcked = events.some(event => event.type === 'command_ack' && event.commandId === startCommand.id)
      if (alreadyAcked) {
        await this.writeHeartbeat('running')
        return {
          startAlreadyAcked: true,
          startCommand,
          shouldRunInitialPrompt: false
        }
      }

      if (startCommand.messageDelivery === 'bridge') {
        await this.writeHeartbeat('running')
        return {
          startAlreadyAcked: false,
          startCommand,
          shouldRunInitialPrompt: false
        }
      }

      if (startCommand.messageDelivery === INITIAL_PROMPT_DELIVERY) {
        this.rememberCommandBackedUserContent(startCommand.content ?? startCommand.message)
        await this.ackCommand(startCommand)
        await this.writeHeartbeat('running')
        return {
          startAlreadyAcked: false,
          startCommand,
          shouldRunInitialPrompt: true
        }
      }

      await this.ackCommand(startCommand)
      const content = startCommand.content ?? startCommand.message
      if (content != null && content.trim() !== '') {
        await this.append({
          type: 'message',
          role: 'user',
          content,
          causedByCommandId: startCommand.id,
          commandId: startCommand.commandId,
          visibility: 'private'
        })
        this.rememberCommandBackedUserContent(content)
      }
      await this.writeHeartbeat('running')
      return {
        startAlreadyAcked: false,
        startCommand,
        shouldRunInitialPrompt: true
      }
    }
    await this.writeHeartbeat('running')
    return {
      startAlreadyAcked: false,
      shouldRunInitialPrompt: false
    }
  }

  ackCommand(command: RuntimeCommand) {
    return this.append({
      type: 'command_ack',
      commandId: command.id,
      causedByCommandId: command.commandId,
      visibility: 'audit',
      message: command.type
    })
  }

  failCommand(command: RuntimeCommand, error: unknown) {
    return this.append({
      type: 'command_failed',
      commandId: command.id,
      causedByCommandId: command.commandId,
      visibility: 'audit',
      error: error instanceof Error ? error.message : String(error),
      message: command.type
    })
  }

  recordInputSubmitted(command: RuntimeCommand) {
    return this.append({
      type: 'input_submitted',
      commandId: command.id,
      causedByCommandId: command.commandId,
      requestId: command.requestId,
      visibility: 'audit',
      message: normalizeSubmitValue(command.value ?? command.data)
    })
  }

  recordMessageCommand(command: RuntimeCommand) {
    const content = normalizeCommandContent(command)
    if (typeof content === 'string' && content.trim() === '') {
      return Promise.resolve()
    }
    if (content == null) {
      return Promise.resolve()
    }

    this.rememberCommandBackedUserContent(content)
    return this.append({
      type: 'message',
      role: 'user',
      content,
      causedByCommandId: command.id,
      commandId: command.commandId,
      ...(command.source != null ? { source: command.source } : {}),
      visibility: 'private'
    })
  }

  recordOperation(input: RuntimeOperationEventInput) {
    const status = input.type === 'operation_started'
      ? 'running'
      : input.type === 'operation_completed'
      ? 'completed'
      : 'failed'
    return this.append({
      type: input.type,
      status,
      operationId: input.operationId,
      title: input.title,
      message: input.message,
      summary: input.message,
      ...(input.error != null ? { error: input.error } : {}),
      visibility: 'system'
    })
  }

  handleAdapterEvent(event: AdapterOutputEvent) {
    if (event.type === 'init') {
      return this.append({
        type: 'session_started',
        status: 'running',
        title: event.data.title ?? this.meta?.title,
        adapter: event.data.adapter,
        model: event.data.model,
        visibility: 'system'
      })
    }

    if (event.type === 'message') {
      if (event.data.role === 'user' && this.consumeCommandBackedUserMessage(event.data)) {
        return Promise.resolve()
      }
      const text = textFromMessage(event.data)
      if (event.data.role === 'assistant' && text != null) {
        this.lastAssistantText = text
      }
      return this.append({
        type: 'message',
        role: event.data.role,
        content: event.data.content,
        ...(event.data.model != null ? { model: event.data.model } : {}),
        visibility: 'private'
      })
    }

    if (event.type === 'interaction_request') {
      return this.append({
        type: 'approval_requested',
        requestId: event.data.id,
        question: event.data.payload.question,
        kind: event.data.payload.kind,
        requestKind: event.data.payload.kind === 'permission' ? 'confirmation' : 'input',
        options: event.data.payload.options as RuntimeEventDraft['options'],
        ...(event.data.payload.permissionContext != null
          ? { permissionContext: event.data.payload.permissionContext }
          : {}),
        publicSummary: event.data.payload.question,
        visibility: 'room'
      })
    }

    if (event.type === 'error') {
      if (event.data.fatal !== false) {
        this.sawFatalError = true
      }
      return this.append({
        type: event.data.fatal === false ? 'command_failed' : 'session_failed',
        status: event.data.fatal === false ? undefined : 'failed',
        error: event.data.message,
        message: event.data.message,
        summary: event.data.message,
        visibility: 'room'
      })
    }

    if (event.type === 'stop') {
      if (this.sawFatalError) {
        return Promise.resolve()
      }
      return this.append({
        type: 'session_completed',
        status: 'completed',
        summary: event.data != null ? textFromMessage(event.data) : this.lastAssistantText,
        visibility: 'room'
      })
    }

    if (event.type === 'exit') {
      if (this.sawFatalError) {
        return Promise.resolve()
      }
      return this.append({
        type: event.data.exitCode == null || event.data.exitCode === 0 ? 'session_completed' : 'session_failed',
        status: event.data.exitCode == null || event.data.exitCode === 0 ? 'completed' : 'failed',
        ...(event.data.stderr != null && event.data.stderr.trim() !== '' ? { error: event.data.stderr } : {}),
        ...(event.data.exitCode == null || event.data.exitCode === 0
          ? {}
          : { summary: event.data.stderr ?? `Exited with code ${event.data.exitCode}` }),
        visibility: 'room'
      })
    }

    return Promise.resolve()
  }

  recordFailure(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return this.append({
      type: 'session_failed',
      status: 'failed',
      error: message,
      message,
      summary: message,
      visibility: 'room'
    })
  }

  append(draft: RuntimeEventAppendDraft) {
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        await this.appendNow(draft)
      })
      .catch((error) => {
        console.error(
          `[runtime-protocol] Failed to append runtime event: ${error instanceof Error ? error.message : String(error)}`
        )
      })
    return this.queue
  }

  async flush() {
    await this.queue
  }

  private async appendNow(draft: RuntimeEventAppendDraft) {
    const session = this.store.session(this.sessionId)
    const eventDraft = {
      ...this.metadataFields(),
      ...draft,
      sessionId: this.sessionId
    } as RuntimeEventDraft
    const event = await session.appendEvent(eventDraft)
    await this.writeStateForEvent(event)
    return event
  }

  private metadataFields(): Partial<RuntimeEventAppendDraft> {
    return {
      ...(this.meta?.parentSessionId != null ? { parentSessionId: this.meta.parentSessionId } : {}),
      ...(this.meta?.roomId != null ? { roomId: this.meta.roomId } : {}),
      ...(this.meta?.roomTitle != null ? { roomTitle: this.meta.roomTitle } : {}),
      ...(this.meta?.hostSessionId != null ? { hostSessionId: this.meta.hostSessionId } : {}),
      ...(this.meta?.memberKey != null ? { memberKey: this.meta.memberKey } : {}),
      ...(this.meta?.memberKind != null ? { memberKind: this.meta.memberKind } : {}),
      ...(this.meta?.memberLabel != null ? { memberLabel: this.meta.memberLabel } : {}),
      ...(this.meta?.memberAvatar != null ? { memberAvatar: this.meta.memberAvatar } : {}),
      ...(this.meta?.memberSubtitle != null ? { memberSubtitle: this.meta.memberSubtitle } : {}),
      ...(this.meta?.runId != null ? { runId: this.meta.runId } : {}),
      ...(this.meta?.runTitle != null ? { runTitle: this.meta.runTitle } : {}),
      ...(this.meta?.operationId != null ? { operationId: this.meta.operationId } : {})
    }
  }

  private rememberCommandBackedUserContent(content: RuntimeEventDraft['content']) {
    const text = textFromContent(content)
    if (text != null) {
      this.commandBackedUserMessageTexts.push(text)
    }
  }

  private consumeCommandBackedUserMessage(message: ChatMessage) {
    const text = textFromMessage(message)
    if (text == null) {
      return false
    }
    const index = this.commandBackedUserMessageTexts.indexOf(text)
    if (index < 0) {
      return false
    }
    this.commandBackedUserMessageTexts.splice(index, 1)
    return true
  }

  private async writeStateForEvent(event: RuntimeEvent) {
    const session = this.store.session(this.sessionId)
    const previous = await session.readState()
    const nextStatus = statusForEvent(event) ?? previous?.status ?? 'running'
    const lastMessage = textFromContent(event.content) ?? event.publicSummary ?? event.summary ?? event.message
    const nextState: RuntimeState = {
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: this.sessionId,
      status: nextStatus,
      title: previous?.title ?? this.meta?.title,
      lastSeq: event.seq,
      ...(lastMessage != null && lastMessage.trim() !== '' ? { lastMessage } : previous?.lastMessage != null
        ? { lastMessage: previous.lastMessage }
        : {}),
      ...(event.type === 'approval_requested' && event.requestId != null
        ? { pendingInput: { requestId: event.requestId, kind: event.kind } }
        : nextStatus === 'waiting_input' && previous?.pendingInput != null
        ? { pendingInput: previous.pendingInput }
        : {}),
      updatedAt: event.ts
    }
    await Promise.all([
      session.writeState(nextState),
      this.writeHeartbeat(nextStatus),
      this.store.updateIndex(this.sessionId, {
        storePath: `sessions/${this.sessionId}`,
        cwd: this.meta?.cwd,
        status: nextStatus,
        updatedAt: event.ts
      })
    ])
  }

  private async writeHeartbeat(status: RuntimeState['status']) {
    const session = this.store.session(this.sessionId)
    const heartbeat: RuntimeHeartbeat = {
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: this.sessionId,
      runtimeId: this.runtimeId,
      pid: process.pid,
      status,
      updatedAt: Date.now()
    }
    await session.writeHeartbeat(heartbeat)
  }
}

export const createRuntimeEventSink = async (options: RuntimeEventSinkOptions) => {
  const root = await resolveRuntimeRoot({ cwd: options.cwd, env: options.env })
  const store = new FileRuntimeStore(root)
  const session = store.session(options.sessionId)
  const meta = await session.readMeta()
  return new RuntimeEventSink(store, options.sessionId, meta, options.runtimeId)
}

export const createCliRuntimeEventSink = async (options: CliRuntimeEventSinkOptions) => {
  const root = await resolveRuntimeRoot({ cwd: options.cwd, env: options.env })
  const store = new FileRuntimeStore(root)
  const ts = options.createdAt ?? Date.now()
  const title = buildCliRuntimeTitle(options)
  const message = trimOptional(options.message)
  const session = await store.createSession(
    {
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: options.sessionId,
      title,
      cwd: options.cwd,
      ...(trimOptional(options.adapter) != null ? { adapter: trimOptional(options.adapter) } : {}),
      ...(options.effort != null ? { effort: options.effort } : {}),
      ...(trimOptional(options.model) != null ? { model: trimOptional(options.model) } : {}),
      ...(options.permissionMode != null ? { permissionMode: options.permissionMode } : {}),
      createdAt: ts
    } satisfies RuntimeMeta
  )

  await Promise.all([
    session.writeState({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: options.sessionId,
      status: 'starting',
      title,
      lastSeq: 0,
      updatedAt: ts
    }),
    session.writeHeartbeat({
      protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
      sessionId: options.sessionId,
      runtimeId: options.runtimeId ?? `oneworks-run-${process.pid}`,
      pid: process.pid,
      status: 'starting',
      updatedAt: ts
    })
  ])

  const startCommand = message == null
    ? undefined
    : await session.appendCommand(
      {
        protocolVersion: DEFAULT_RUNTIME_PROTOCOL_VERSION,
        supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
        id: `cmd_start_${randomUUID()}`,
        ts,
        sessionId: options.sessionId,
        type: 'start',
        priority: 20,
        source: 'cli',
        content: message,
        message,
        title
      } satisfies RuntimeCommand
    )

  const sink = new RuntimeEventSink(store, options.sessionId, await session.readMeta(), options.runtimeId)
  if (startCommand != null) {
    await sink.recordStartup([startCommand])
  }
  return sink
}
