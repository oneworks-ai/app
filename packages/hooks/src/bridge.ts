import type {
  AdapterContextCompactionData,
  AdapterInteractionRequest,
  AdapterSessionUpdateData,
  ChatMessage,
  ChatMessageContent,
  TaskRuntime
} from '@oneworks/types'

import type { HookLogger } from './context'
import type { HookInputs } from './type'

import { callHook } from './call'

export interface HookBridgeContext {
  cwd: string
  env: Record<string, string | null | undefined>
  logger: HookLogger
}

export type HookBridgeInputEvent =
  | { type: 'message'; content: ChatMessageContent[]; parentUuid?: string }
  | { type: 'interrupt' }
  | { type: 'stop' }

export interface HookBridgeSession {
  kill(): void
  stop?(): void
  emit(event: HookBridgeInputEvent): void
  respondInteraction?(interactionId: string, data: string | string[]): void | Promise<void>
  flushHooks?: () => Promise<void>
  pid?: number
}

export type HookBridgeOutputEvent =
  | { type: 'init'; data: unknown }
  | { type: 'context_compaction'; data: AdapterContextCompactionData }
  | { type: 'session_update'; data: AdapterSessionUpdateData }
  | { type: 'summary'; data: unknown }
  | { type: 'message'; data: ChatMessage }
  | { type: 'interaction_request'; data: AdapterInteractionRequest }
  | { type: 'error'; data: unknown }
  | { type: 'exit'; data: { exitCode?: number; stderr?: string } }
  | { type: 'stop'; data?: ChatMessage }

type HookBridgeMessageEvent = Extract<HookBridgeInputEvent, { type: 'message' }>

const normalizeText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const stringifyUnknown = (value: unknown) => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const describeContentPart = (item: ChatMessageContent): string | undefined => {
  switch (item.type) {
    case 'text':
      return normalizeText(item.text)
    case 'image':
      return normalizeText(item.name) != null ? `[Image: ${item.name}]` : '[Image attachment]'
    case 'tool_use':
      return `Tool request: ${item.name}`
    case 'tool_result':
      return typeof item.content === 'string' ? normalizeText(item.content) : stringifyUnknown(item.content)
    default:
      return undefined
  }
}

const extractPromptText = (content: HookBridgeMessageEvent['content']) => {
  const parts = content
    .map(describeContentPart)
    .filter((value): value is string => value != null)

  return parts.length > 0 ? parts.join('\n\n') : undefined
}

const extractAssistantText = (message: ChatMessage | undefined) => {
  if (message == null) return undefined
  if (typeof message.content === 'string') return normalizeText(message.content)

  const parts = message.content
    .filter((item): item is Extract<ChatMessageContent, { type: 'text' }> => item.type === 'text')
    .map(item => normalizeText(item.text))
    .filter((value): value is string => value != null)

  return parts.length > 0 ? parts.join('') : undefined
}

const isToolUse = (
  item: ChatMessageContent
): item is Extract<ChatMessageContent, { type: 'tool_use' }> => item.type === 'tool_use'

const isToolResult = (
  item: ChatMessageContent
): item is Extract<ChatMessageContent, { type: 'tool_result' }> => item.type === 'tool_result'

interface HookOutputLike {
  continue?: boolean
  stopReason?: string
}

export interface AdapterHookBridge {
  start: () => Promise<void>
  prepareInitialPrompt: (prompt?: string) => Promise<string | undefined>
  wrapSession: (session: HookBridgeSession) => HookBridgeSession
  handleOutput: (event: HookBridgeOutputEvent) => void
  flush: () => Promise<void>
}

export const createAdapterHookBridge = (params: {
  ctx: HookBridgeContext
  adapter: string
  runtime: TaskRuntime
  sessionId: string
  type: 'create' | 'resume'
  model?: string
  disabledEvents?: Array<keyof HookInputs>
}): AdapterHookBridge => {
  const {
    ctx,
    adapter,
    runtime,
    sessionId,
    type,
    model,
    disabledEvents: rawDisabledEvents = []
  } = params
  const disabledEvents = new Set(rawDisabledEvents)

  const pendingToolCalls = new Map<string, { toolName: string; toolInput?: unknown }>()
  let emitQueue = Promise.resolve()
  let outputQueue = Promise.resolve()
  let killRequested = false
  let lastAssistantMessage: string | undefined
  let sessionEnded = false

  const enqueueOutputHook = (runHook: () => Promise<unknown>) => {
    outputQueue = outputQueue
      .catch((error) => {
        ctx.logger.error('[HookBridge] output hook queue failed', error)
      })
      .then(async () => {
        await runHook()
      })
  }

  const callBridgeHook = async (
    eventName: Parameters<typeof callHook>[0],
    input: Record<string, unknown>,
    options: {
      canBlock: boolean
      enforce?: boolean
      blockedMessage: string
    }
  ): Promise<HookOutputLike | undefined> => {
    if (disabledEvents.has(eventName as keyof HookInputs)) {
      return undefined
    }

    try {
      const output = await callHook(
        eventName as never,
        {
          cwd: ctx.cwd,
          sessionId,
          adapter,
          runtime,
          hookSource: 'bridge',
          canBlock: options.canBlock,
          ...input
        } as never,
        ctx.env
      ) as HookOutputLike

      if (options.enforce && output?.continue === false) {
        throw new Error(output.stopReason ?? options.blockedMessage)
      }

      if (!options.canBlock && output?.continue === false) {
        ctx.logger.warn(
          `[HookBridge] Ignoring blocking output from observational ${String(eventName)} hook`,
          output.stopReason
        )
      }

      return output
    } catch (error) {
      ctx.logger.error(`[HookBridge] ${String(eventName)} failed`, error)
      if (options.enforce) throw error
      return undefined
    }
  }

  const observeMessage = (message: ChatMessage) => {
    const assistantText = extractAssistantText(message)
    if (assistantText != null) lastAssistantMessage = assistantText
    const preToolUseDisabled = disabledEvents.has('PreToolUse')
    const postToolUseDisabled = disabledEvents.has('PostToolUse')
    const needsPendingToolCalls = !postToolUseDisabled

    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if (isToolUse(item)) {
          if (needsPendingToolCalls) {
            pendingToolCalls.set(item.id, {
              toolName: item.name,
              toolInput: item.input
            })
          }
          if (!preToolUseDisabled) {
            enqueueOutputHook(
              () =>
                callBridgeHook(
                  'PreToolUse',
                  {
                    toolCallId: item.id,
                    toolName: item.name,
                    toolInput: item.input
                  },
                  {
                    canBlock: false,
                    blockedMessage: 'PreToolUse hook attempted to block an observed tool call'
                  }
                )
            )
          }
        }

        if (isToolResult(item)) {
          const pending = pendingToolCalls.get(item.tool_use_id)
          pendingToolCalls.delete(item.tool_use_id)
          if (!postToolUseDisabled) {
            enqueueOutputHook(
              () =>
                callBridgeHook(
                  'PostToolUse',
                  {
                    toolCallId: item.tool_use_id,
                    toolName: pending?.toolName ?? 'unknown',
                    toolInput: pending?.toolInput,
                    toolResponse: item.content,
                    isError: item.is_error ?? false
                  },
                  {
                    canBlock: false,
                    blockedMessage: 'PostToolUse hook attempted to block an observed tool result'
                  }
                )
            )
          }
        }
      }
    }

    if (message.toolCall?.name != null) {
      const toolCall = message.toolCall
      const toolCallId = toolCall.id ?? message.id
      if (needsPendingToolCalls && !pendingToolCalls.has(toolCallId)) {
        pendingToolCalls.set(toolCallId, {
          toolName: toolCall.name,
          toolInput: toolCall.args
        })
      }

      if (!preToolUseDisabled) {
        enqueueOutputHook(
          () =>
            callBridgeHook(
              'PreToolUse',
              {
                toolCallId,
                toolName: toolCall.name,
                toolInput: toolCall.args
              },
              {
                canBlock: false,
                blockedMessage: 'PreToolUse hook attempted to block a legacy observed tool call'
              }
            )
        )
      }

      if (!postToolUseDisabled && (toolCall.output != null || toolCall.status === 'error')) {
        pendingToolCalls.delete(toolCallId)
        enqueueOutputHook(
          () =>
            callBridgeHook(
              'PostToolUse',
              {
                toolCallId,
                toolName: toolCall.name,
                toolInput: toolCall.args,
                toolResponse: toolCall.output,
                isError: toolCall.status === 'error'
              },
              {
                canBlock: false,
                blockedMessage: 'PostToolUse hook attempted to block a legacy observed tool result'
              }
            )
        )
      }
    }
  }

  return {
    start: async () => {
      if (disabledEvents.has('SessionStart')) return
      await callBridgeHook(
        'SessionStart',
        {
          source: type === 'resume' ? 'resume' : 'startup',
          model
        },
        {
          canBlock: true,
          enforce: true,
          blockedMessage: 'SessionStart hook blocked session startup'
        }
      )
    },
    prepareInitialPrompt: async (prompt) => {
      const normalizedPrompt = normalizeText(prompt)
      if (normalizedPrompt == null) return normalizedPrompt
      if (disabledEvents.has('UserPromptSubmit')) return normalizedPrompt

      await callBridgeHook(
        'UserPromptSubmit',
        { prompt: normalizedPrompt },
        {
          canBlock: true,
          enforce: true,
          blockedMessage: 'UserPromptSubmit hook blocked the initial prompt'
        }
      )

      return normalizedPrompt
    },
    wrapSession: (session) => ({
      kill: () => {
        killRequested = true
        session.kill()
      },
      stop: session.stop == null
        ? undefined
        : () => {
          session.stop?.()
        },
      emit: (event) => {
        emitQueue = emitQueue
          .catch((error) => {
            ctx.logger.error('[HookBridge] emit queue failed', error)
          })
          .then(async () => {
            if (event.type === 'message') {
              const prompt = extractPromptText(event.content)
              if (prompt != null && !disabledEvents.has('UserPromptSubmit')) {
                const output = await callBridgeHook(
                  'UserPromptSubmit',
                  { prompt },
                  {
                    canBlock: true,
                    blockedMessage: 'UserPromptSubmit hook blocked the outgoing prompt'
                  }
                )

                if (output?.continue === false) {
                  ctx.logger.warn(
                    '[HookBridge] Dropping outgoing message blocked by UserPromptSubmit hook',
                    output.stopReason
                  )
                  return
                }
              }
            }

            session.emit(event)
          })
      },
      get pid() {
        return session.pid
      },
      respondInteraction: (interactionId, data) => session.respondInteraction?.(interactionId, data),
      flushHooks: async () => {
        await emitQueue
        await outputQueue
        await session.flushHooks?.()
      }
    }),
    handleOutput: (event) => {
      if (event.type === 'message' && event.data.role === 'assistant') {
        observeMessage(event.data)
        return
      }

      if (event.type === 'stop') {
        if (disabledEvents.has('Stop')) return
        enqueueOutputHook(
          () =>
            callBridgeHook(
              'Stop',
              {
                lastAssistantMessage: extractAssistantText(event.data) ?? lastAssistantMessage
              },
              {
                canBlock: false,
                blockedMessage: 'Stop hook attempted to control an observed stop event'
              }
            )
        )
        return
      }

      if (event.type === 'exit' && !sessionEnded) {
        sessionEnded = true
        const exitCode = event.data.exitCode ?? 0
        let reason = 'failed'
        if (exitCode === 0) {
          reason = killRequested ? 'terminated' : 'completed'
        }
        enqueueOutputHook(
          () =>
            callBridgeHook(
              'SessionEnd',
              {
                reason,
                exitCode: event.data.exitCode,
                stderr: event.data.stderr,
                lastAssistantMessage
              },
              {
                canBlock: false,
                blockedMessage: 'SessionEnd hook attempted to control an observed session end'
              }
            )
        )
      }
    },
    flush: async () => {
      await emitQueue
      await outputQueue
    }
  }
}
