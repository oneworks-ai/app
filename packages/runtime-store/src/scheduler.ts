import type { RuntimeCommand } from './types'

export const RuntimeCommandPriority = {
  lifecycle: 0,
  unblock: 10,
  message: 20
} as const

const priorityForCommand = (command: RuntimeCommand) => {
  if (Number.isFinite(command.priority)) {
    return command.priority
  }

  if (['kill', 'stop', 'cancel', 'pause'].includes(command.type)) {
    return RuntimeCommandPriority.lifecycle
  }
  if (['submit_input', 'approve', 'deny'].includes(command.type)) {
    return RuntimeCommandPriority.unblock
  }
  return RuntimeCommandPriority.message
}

export const isLifecycleCommand = (command: RuntimeCommand) => {
  return priorityForCommand(command) === RuntimeCommandPriority.lifecycle
}

export const orderRuntimeCommands = (commands: RuntimeCommand[]) => {
  return commands
    .map((command, index) => ({ command, index }))
    .sort((left, right) => {
      const priorityDelta = priorityForCommand(left.command) - priorityForCommand(right.command)
      if (priorityDelta !== 0) {
        return priorityDelta
      }

      const tsDelta = left.command.ts - right.command.ts
      return tsDelta !== 0 ? tsDelta : left.index - right.index
    })
    .map(item => item.command)
}

export interface CommandSelectionOptions {
  activeCommandId?: string
}

export const selectNextRuntimeCommand = (
  commands: RuntimeCommand[],
  options: CommandSelectionOptions = {}
) => {
  const ordered = orderRuntimeCommands(commands)
  const lifecycle = ordered.find(isLifecycleCommand)
  if (lifecycle != null) {
    return lifecycle
  }

  if (options.activeCommandId != null) {
    return undefined
  }

  return ordered[0]
}
