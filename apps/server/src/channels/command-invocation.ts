import type { ChannelRuntimeState } from './types'

import { resolveAuthoritativeCommandInput } from './command-invocation-authority'
import { createOfflineCommandContext } from './command-invocation-context'
import { getErrorMessage, isRecord, resolveInboundForCommand } from './command-invocation-input'
import type { ChannelCommandInvocationInput } from './command-invocation-types'
import { invokeChannelCommandTool, listChannelCommandTools } from './middleware/commands'

export type { ChannelCommandInvocationContext, ChannelCommandInvocationInput } from './command-invocation-types'

export const listInvokableChannelCommandTools = () => listChannelCommandTools()

export const invokeChannelCommandForState = async (
  state: ChannelRuntimeState,
  input: ChannelCommandInvocationInput
) => {
  const commandInputResult = resolveAuthoritativeCommandInput(state, input)
  if (!commandInputResult.ok) {
    return {
      ok: false as const,
      statusCode: commandInputResult.statusCode,
      message: commandInputResult.message
    }
  }

  const authoritativeInput = commandInputResult.input
  const inboundResult = resolveInboundForCommand(state, authoritativeInput)
  if (inboundResult.inbound == null) {
    return {
      ok: false as const,
      statusCode: 400,
      message: inboundResult.message ?? 'Invalid channel command context.'
    }
  }

  const replies: string[] = []
  const ctx = createOfflineCommandContext(state, authoritativeInput, inboundResult.inbound, replies)
  const commandInput = authoritativeInput.input ?? {}
  if (!isRecord(commandInput)) {
    return {
      ok: false as const,
      statusCode: 400,
      message: 'Channel command input must be an object.',
      replies
    }
  }

  try {
    const result = await invokeChannelCommandTool(ctx, input.toolName, commandInput, {
      replyOnError: true,
      source: 'natural_language'
    })
    if ('ok' in result && result.ok === false) {
      return {
        ok: false as const,
        statusCode: 400,
        message: result.message,
        replies,
        result
      }
    }

    return {
      ok: true as const,
      statusCode: 200,
      replies,
      result
    }
  } catch (error) {
    return {
      ok: false as const,
      statusCode: 500,
      message: getErrorMessage(error),
      replies
    }
  }
}
