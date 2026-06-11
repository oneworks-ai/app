import type { ChatMessageContent } from '@oneworks/core'
import { orderRuntimeCommands } from '@oneworks/runtime-store'
import type { RuntimeCommand } from '@oneworks/runtime-store'

import { readRuntimeCommands, readRuntimeEvents } from '../agent/runtime-store'
import type { RuntimeEventSink } from './runtime-event-sink'
import type { CliInputSession } from './types'

export interface RuntimeCommandBridgeSession extends CliInputSession {
  kill?: () => void
}

export interface RuntimeCommandBridgeOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  intervalMs?: number
  session: RuntimeCommandBridgeSession
  sessionId: string
  sink: RuntimeEventSink
  submitInput?: (params: { interactionId?: string; data: string | string[] }) => Promise<void>
}

const toMessageContent = (command: RuntimeCommand): ChatMessageContent[] => {
  const runtimeContentItems = normalizeCommandContentItems(command.runtimeContentItems)
  if (runtimeContentItems != null) {
    return runtimeContentItems
  }

  const contentItems = normalizeCommandContentItems(command.contentItems)
  if (contentItems != null) {
    return contentItems
  }

  const content = typeof command.runtimeMessage === 'string'
    ? command.runtimeMessage
    : command.content ?? command.message ?? ''
  return [{ type: 'text', text: content }]
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

const normalizeCommandContentItems = (value: unknown): ChatMessageContent[] | undefined => {
  if (!Array.isArray(value) || !value.every(isChatMessageContent)) {
    return undefined
  }
  return structuredClone(value)
}

const toSubmitData = (command: RuntimeCommand): string | string[] => {
  if (typeof command.data === 'string' || Array.isArray(command.data)) {
    return command.data
  }
  if (typeof command.value === 'string') {
    return command.value
  }
  if (Array.isArray(command.value) && command.value.every(item => typeof item === 'string')) {
    return command.value
  }
  if (command.value == null) {
    throw new Error('submit_input command requires value or data.')
  }
  return JSON.stringify(command.value)
}

const dispatchCommand = async (
  command: RuntimeCommand,
  options: RuntimeCommandBridgeOptions
) => {
  switch (command.type) {
    case 'send_message':
    case 'resume':
      await options.sink.ackCommand(command)
      await options.sink.recordMessageCommand(command)
      options.session.emit({ type: 'message', content: toMessageContent(command) })
      return
    case 'start':
      if (command.messageDelivery === 'bridge') {
        await options.sink.ackCommand(command)
        await options.sink.recordMessageCommand(command)
        options.session.emit({ type: 'message', content: toMessageContent(command) })
      }
      return
    case 'submit_input':
      await options.sink.ackCommand(command)
      await options.submitInput?.({
        interactionId: command.requestId ?? command.interactionId,
        data: toSubmitData(command)
      })
      await options.sink.recordInputSubmitted(command)
      return
    case 'stop':
      await options.sink.ackCommand(command)
      options.session.emit({ type: 'stop' })
      return
    case 'kill':
      await options.sink.ackCommand(command)
      if (options.session.kill != null) {
        options.session.kill()
      } else {
        options.session.emit({ type: 'stop' })
      }
      break
  }
}

const PROCESSED_COMMAND_EVENT_TYPES = new Set([
  'command_ack',
  'command_failed',
  'command_cancelled',
  'input_submitted'
])

const readProcessedCommandIds = async (options: RuntimeCommandBridgeOptions) => {
  const processed = new Set<string>()
  const events = await readRuntimeEvents(options.cwd, options.sessionId, options.env)
  for (const event of events) {
    if (
      typeof event.commandId === 'string' &&
      event.commandId.trim() !== '' &&
      PROCESSED_COMMAND_EVENT_TYPES.has(event.type)
    ) {
      processed.add(event.commandId)
    }
  }
  return processed
}

export const attachRuntimeCommandBridge = async (options: RuntimeCommandBridgeOptions) => {
  const processed = await readProcessedCommandIds(options)
  let stopped = false
  let tickQueue = Promise.resolve()

  const tick = async () => {
    const commands = await readRuntimeCommands(options.cwd, options.sessionId, options.env)
    const pending = orderRuntimeCommands(commands.filter(command => !processed.has(command.id)))
    for (const command of pending) {
      processed.add(command.id)
      try {
        await dispatchCommand(command, options)
      } catch (error) {
        await options.sink.failCommand(command, error)
      }
    }
  }

  const runTick = () => {
    tickQueue = tickQueue
      .catch(() => {})
      .then(() => tick())
      .catch((error) => {
        console.error(
          `[runtime-protocol] Failed to process runtime command: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      })
  }

  runTick()
  const timer = setInterval(() => {
    if (!stopped) {
      runTick()
    }
  }, options.intervalMs ?? 1000)

  return async () => {
    stopped = true
    clearInterval(timer)
    await tickQueue
  }
}
