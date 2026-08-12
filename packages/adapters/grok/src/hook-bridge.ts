import process from 'node:process'

import type { HookInput, HookInputs, HookOutput, HookOutputs } from '@oneworks/hooks'
import { executeHookInput, readHookInput } from '@oneworks/hooks'
import type { AdapterQueryOptions } from '@oneworks/types'

type GrokNativeHookEventName = 'PostToolUse' | 'PreToolUse' | 'Stop'

export interface GrokNativeHookInput {
  cwd?: string
  hookEventName?: GrokNativeHookEventName
  hook_event_name?: GrokNativeHookEventName
  sessionId?: string
  session_id?: string
  transcriptPath?: string | null
  transcript_path?: string | null
  toolInput?: unknown
  toolName?: string
  toolResponse?: unknown
  tool_input?: unknown
  tool_name?: string
  tool_response?: unknown
  lastAssistantMessage?: string
  last_assistant_message?: string
  stopHookActive?: boolean
  stop_hook_active?: boolean
}

const runtime = process.env.__ONEWORKS_GROK_HOOK_RUNTIME__ as AdapterQueryOptions['runtime'] | undefined
const taskSessionId = process.env.__ONEWORKS_GROK_TASK_SESSION_ID__?.trim()

const resolveEventName = (input: GrokNativeHookInput): GrokNativeHookEventName => {
  const eventName = input.hook_event_name ?? input.hookEventName ?? process.env.__ONEWORKS_HOOK_EVENT_NAME__
  if (eventName === 'PreToolUse' || eventName === 'PostToolUse' || eventName === 'Stop') return eventName
  if (input.tool_response != null || input.toolResponse != null) return 'PostToolUse'
  if (input.tool_name != null || input.toolName != null) return 'PreToolUse'
  return 'Stop'
}

const blockReason = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : 'blocked by One Works PreToolUse hook'
)

export const isGrokNativeHookEnv = () => process.env.__ONEWORKS_GROK_HOOKS_ACTIVE__ === '1'

export const supportsHookEvent = (eventName: keyof HookInputs) => (
  eventName === 'PreToolUse' || eventName === 'PostToolUse' || eventName === 'Stop'
)

export const mapGrokHookInputToOneWorks = (input: GrokNativeHookInput): HookInput => {
  const eventName = resolveEventName(input)
  const base = {
    cwd: input.cwd ?? process.cwd(),
    sessionId: taskSessionId || input.session_id || input.sessionId || 'grok-session',
    transcriptPath: input.transcript_path ?? input.transcriptPath,
    adapter: 'grok',
    runtime,
    hookSource: 'native' as const,
    canBlock: eventName === 'PreToolUse'
  }

  if (eventName === 'PreToolUse') {
    return {
      ...base,
      hookEventName: 'PreToolUse',
      toolName: input.tool_name ?? input.toolName ?? 'unknown',
      toolInput: input.tool_input ?? input.toolInput
    }
  }
  if (eventName === 'PostToolUse') {
    return {
      ...base,
      hookEventName: 'PostToolUse',
      toolName: input.tool_name ?? input.toolName ?? 'unknown',
      toolInput: input.tool_input ?? input.toolInput,
      toolResponse: input.tool_response ?? input.toolResponse
    }
  }
  return {
    ...base,
    hookEventName: 'Stop',
    lastAssistantMessage: input.last_assistant_message ?? input.lastAssistantMessage,
    stopHookActive: input.stop_hook_active ?? input.stopHookActive
  }
}

export const mapOneWorksHookOutputToGrok = (
  eventName: GrokNativeHookEventName,
  output: HookOutput
) => {
  if (eventName !== 'PreToolUse') return {}
  const hookSpecificOutput = (output as HookOutputs['PreToolUse']).hookSpecificOutput
  if (hookSpecificOutput?.hookEventName === 'PreToolUse') {
    return {
      decision: hookSpecificOutput.permissionDecision,
      ...(hookSpecificOutput.permissionDecisionReason == null
        ? {}
        : { reason: hookSpecificOutput.permissionDecisionReason })
    }
  }
  if (output.continue === false) {
    return {
      decision: 'deny',
      reason: blockReason(output.stopReason)
    }
  }
  return {}
}

export const runGrokHookBridge = async () => {
  try {
    const input = await readHookInput() as GrokNativeHookInput
    const eventName = resolveEventName(input)
    const result = await executeHookInput(mapGrokHookInputToOneWorks(input))
    process.stdout.write(`${JSON.stringify(mapOneWorksHookOutputToGrok(eventName, result))}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ systemMessage: `oneworks grok hook bridge error: ${String(error)}` })}\n`)
  }
}

export const isNativeHookEnv = isGrokNativeHookEnv
export const runHookBridge = runGrokHookBridge
