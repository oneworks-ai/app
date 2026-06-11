import { DEFAULT_SUPPORTED_PROTOCOL_RANGE, getCurrentProtocolVersion } from '@oneworks/runtime-protocol'
import type {
  ResumeRuntimeCommand,
  RuntimeCommandBase,
  RuntimeCommandSource,
  RuntimeEvent,
  RuntimeEventDraft,
  RuntimeProtocolEnvelope,
  RuntimeStatus,
  RuntimeVisibility,
  SendMessageRuntimeCommand,
  StartRuntimeCommand,
  StopRuntimeCommand,
  SubmitInputRuntimeCommand,
  TaskDefinitionType,
  TaskRuntimeCommand
} from '@oneworks/runtime-protocol'

export const TASK_RUNTIME_PROTOCOL_VERSION = getCurrentProtocolVersion()
export const TASK_RUNTIME_SUPPORTED_PROTOCOL_RANGE = DEFAULT_SUPPORTED_PROTOCOL_RANGE

export type {
  ResumeRuntimeCommand,
  RuntimeCommandBase,
  RuntimeCommandSource,
  RuntimeEvent,
  RuntimeEventDraft,
  RuntimeProtocolEnvelope,
  RuntimeStatus,
  RuntimeVisibility,
  SendMessageRuntimeCommand,
  StartRuntimeCommand,
  StopRuntimeCommand,
  SubmitInputRuntimeCommand,
  TaskDefinitionType
}

export type RuntimeCommand = TaskRuntimeCommand

export type NormalizedRuntimeCommand<T extends RuntimeCommand = RuntimeCommand> = T & RuntimeProtocolEnvelope & {
  priority: number
  ts: number
}

export const RUNTIME_COMMAND_PRIORITIES = {
  lifecycle: 0,
  unblock: 10,
  message: 20
} as const

export const resolveRuntimeCommandPriority = (command: RuntimeCommand) => {
  if (command.priority != null) return command.priority
  if (command.type === 'stop') return RUNTIME_COMMAND_PRIORITIES.lifecycle
  if (command.type === 'submit_input') return RUNTIME_COMMAND_PRIORITIES.unblock
  return RUNTIME_COMMAND_PRIORITIES.message
}

export const normalizeRuntimeCommand = <T extends RuntimeCommand>(command: T): NormalizedRuntimeCommand<T> => ({
  ...command,
  protocolVersion: command.protocolVersion ?? TASK_RUNTIME_PROTOCOL_VERSION,
  supportedProtocolRange: command.supportedProtocolRange ?? TASK_RUNTIME_SUPPORTED_PROTOCOL_RANGE,
  priority: resolveRuntimeCommandPriority(command),
  ts: command.ts ?? Date.now()
} as NormalizedRuntimeCommand<T>)

export const isLifecycleRuntimeCommand = (command: RuntimeCommand) => command.type === 'stop'

export const sortRuntimeCommands = <T extends RuntimeCommand>(commands: T[]) =>
  [...commands].sort((left, right) => {
    const priorityDiff = resolveRuntimeCommandPriority(left) - resolveRuntimeCommandPriority(right)
    if (priorityDiff !== 0) return priorityDiff
    return (left.ts ?? 0) - (right.ts ?? 0)
  })
