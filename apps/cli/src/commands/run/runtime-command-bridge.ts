import type { ChatMessageContent } from '@oneworks/core'
import path from 'node:path'
import {
  RuntimeActivationCommandSchema,
  RuntimeActivationContentItemSchema,
  isRuntimeActivationCommand
} from '@oneworks/runtime-protocol'
import {
  FileRuntimeSessionStore,
  isAuthenticProjectConfigRecovery,
  orderRuntimeCommands
} from '@oneworks/runtime-store'
import type { RuntimeCommand, RuntimeEvent } from '@oneworks/runtime-store'

import { resolveRuntimeSessionStore } from '../agent/runtime-store'
import type { RuntimeEventSink } from './runtime-event-sink'
import type { CliInputSession } from './types'

export interface RuntimeCommandBridgeSession extends CliInputSession {
  kill?: () => void
}

export class RuntimeDeliveryCrashError extends Error {
  constructor(readonly boundary: 'before_emit' | 'after_accepted' | 'after_completed') {
    super(`Injected runtime delivery crash at ${boundary}.`)
    this.name = 'RuntimeDeliveryCrashError'
  }
}

// The adapter session has synchronous local acceptance but no durable dedupe
// acknowledgement. Recovery therefore guarantees at-least-once delivery with
// a stable deliveryId: it never acknowledges before acceptance, while a crash
// after acceptance and before completion may replay the same deliveryId.
export const RUNTIME_RECOVERY_DELIVERY_GUARANTEE = 'at-least-once' as const

export interface RuntimeCommandBridgeOptions {
  adapter?: string
  deliveryCrashHook?: (
    boundary: 'before_emit' | 'after_accepted' | 'after_completed',
    command: RuntimeCommand
  ) => Promise<void> | void
  cwd: string
  env?: NodeJS.ProcessEnv
  intervalMs?: number
  runtimeAdapter?: string
  session: RuntimeCommandBridgeSession
  sessionId: string
  sink: RuntimeEventSink
  submitInput?: (params: { interactionId?: string; data: string | string[] }) => Promise<void>
}

const toMessageContent = (command: RuntimeCommand): ChatMessageContent[] => {
  if (isRuntimeActivationCommand(command)) {
    RuntimeActivationCommandSchema.parse(command)
  }
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
    : command.content ?? command.message
  if (content == null || content.trim() === '') {
    throw new Error(`${command.type} command requires a supported nonempty activation payload.`)
  }
  return [{ type: 'text', text: content }]
}

const normalizeCommandContentItems = (value: unknown): ChatMessageContent[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const parsed = value.map(item => RuntimeActivationContentItemSchema.safeParse(item))
  return parsed.every(item => item.success)
    ? parsed.map(item => item.data) as ChatMessageContent[]
    : undefined
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
      await dispatchMessageCommand(command, options)
      return
    case 'start':
      if (command.messageDelivery === 'bridge') {
        await dispatchMessageCommand(command, options)
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

const dispatchMessageCommand = async (
  command: RuntimeCommand,
  options: RuntimeCommandBridgeOptions
) => {
  if (command.recovery == null) {
    options.session.emit({ type: 'message', content: toMessageContent(command) })
    await options.sink.recordMessageCommand(command)
    await options.sink.ackCommand(command)
    return
  }
  const deliveryId = `runtime-delivery:${command.id}`
  await options.sink.recordCommandDelivery(command, deliveryId, 'prepared')
  await options.deliveryCrashHook?.('before_emit', command)
  options.session.emit({
    type: 'message',
    content: toMessageContent(command),
    deliveryId
  })
  await options.sink.recordCommandDelivery(command, deliveryId, 'accepted')
  await options.deliveryCrashHook?.('after_accepted', command)
  await options.sink.recordCommandDelivery(command, deliveryId, 'completed')
  await options.deliveryCrashHook?.('after_completed', command)
  await options.sink.recordMessageCommand(command)
  await options.sink.ackCommand(command)
}

const PROCESSED_COMMAND_EVENT_TYPES = new Set([
  'command_ack',
  'command_delivery_completed',
  'command_failed',
  'command_cancelled',
  'input_submitted'
])

const addProcessedCommandIds = (processed: Set<string>, events: RuntimeEvent[]) => {
  for (const event of events) {
    if (
      typeof event.commandId === 'string' &&
      event.commandId.trim() !== '' &&
      PROCESSED_COMMAND_EVENT_TYPES.has(event.type)
    ) {
      processed.add(event.commandId)
    }
  }
}

const readReplacedActivationIds = (
  commands: RuntimeCommand[],
  events: RuntimeEvent[],
  options: Pick<RuntimeCommandBridgeOptions, 'adapter' | 'cwd' | 'runtimeAdapter' | 'sessionId'>
) => {
  const replaced = new Set<string>()
  const authenticRecoveryIds = new Set<string>()
  for (const command of commands) {
    if (command.recovery == null) continue
    const parsed = RuntimeActivationCommandSchema.safeParse(command)
    const adapter = options.adapter?.trim() ?? ''
    const authentic = parsed.success &&
      adapter !== '' &&
      options.runtimeAdapter === 'codex' &&
      isAuthenticProjectConfigRecovery(
        command,
        commands,
        events,
        {
          workspaceFolder: path.resolve(options.cwd),
          adapter,
          runtimeAdapter: 'codex',
          sessionId: options.sessionId
        }
      )
    if (authentic) {
      authenticRecoveryIds.add(command.id)
      replaced.add(parsed.data.recovery!.replacedActivationCommandId)
    }
  }
  return { replaced, authenticRecoveryIds }
}

export const attachRuntimeCommandBridge = async (options: RuntimeCommandBridgeOptions) => {
  const processed = new Set<string>()
  let stopped = false
  let tickQueue = Promise.resolve()

  const tick = async () => {
    const store = await resolveRuntimeSessionStore(
      options.cwd,
      options.sessionId,
      options.env
    )
    const { commands, events } = await new FileRuntimeSessionStore(
      store.storePath,
      options.sessionId
    ).readCommandEventSnapshot('runtime-command-bridge-read')
    addProcessedCommandIds(processed, events)
    const recovery = readReplacedActivationIds(commands, events, options)
    const pending = orderRuntimeCommands(commands.filter(command =>
      !processed.has(command.id) && !recovery.replaced.has(command.id)
    ))
    for (const command of pending) {
      processed.add(command.id)
      try {
        if (command.recovery != null && !recovery.authenticRecoveryIds.has(command.id)) {
          throw new Error('Recovery command does not match its authoritative failed activation.')
        }
        await dispatchCommand(command, options)
      } catch (error) {
        if (!(error instanceof RuntimeDeliveryCrashError)) {
          await options.sink.failCommand(command, error)
        }
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
