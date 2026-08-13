import process from 'node:process'

import type { HookInput, HookInputs, HookOutput, HookOutputs } from '@oneworks/hooks'
import { executeHookInput, readHookInput } from '@oneworks/hooks'
import type { AdapterQueryOptions } from '@oneworks/types'

type CursorHookEventName =
  | 'beforeSubmitPrompt'
  | 'postToolUse'
  | 'preCompact'
  | 'preToolUse'
  | 'sessionEnd'
  | 'sessionStart'
  | 'stop'

interface CursorHookInput {
  hook_event_name: CursorHookEventName
  conversation_id?: string
  cwd?: string
  model?: string
  prompt?: string
  session_id?: string
  tool_input?: unknown
  tool_name?: string
  tool_output?: unknown
  transcript_path?: string
  workspace_roots?: string[]
}

const runtime = process.env.__ONEWORKS_CURSOR_HOOK_RUNTIME__ as AdapterQueryOptions['runtime'] | undefined
const taskSessionId = process.env.__ONEWORKS_CURSOR_TASK_SESSION_ID__?.trim()

const parseMaybeJson = (value: unknown) => {
  if (typeof value !== 'string' || value.trim() === '') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

export const isCursorNativeHookEnv = () => process.env.__ONEWORKS_CURSOR_HOOKS_ACTIVE__ === '1'

export const supportsHookEvent = (eventName: keyof HookInputs) => (
  eventName === 'PreToolUse' ||
  eventName === 'PostToolUse' ||
  eventName === 'UserPromptSubmit' ||
  eventName === 'PreCompact' ||
  eventName === 'SessionStart' ||
  eventName === 'SessionEnd' ||
  eventName === 'Stop'
)

export const mapCursorHookInputToOneWorks = (input: CursorHookInput): HookInput => {
  const base = {
    cwd: input.cwd ?? input.workspace_roots?.[0] ?? process.env.CURSOR_PROJECT_DIR ??
      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? process.cwd(),
    sessionId: taskSessionId || input.conversation_id || input.session_id || 'cursor-session',
    transcriptPath: input.transcript_path,
    adapter: 'cursor',
    runtime,
    hookSource: 'native' as const,
    canBlock: input.hook_event_name === 'preToolUse' ||
      input.hook_event_name === 'beforeSubmitPrompt' || input.hook_event_name === 'stop'
  }
  if (input.hook_event_name === 'preToolUse') {
    return {
      ...base,
      hookEventName: 'PreToolUse',
      toolName: input.tool_name ?? 'unknown',
      toolInput: parseMaybeJson(input.tool_input)
    }
  }
  if (input.hook_event_name === 'postToolUse') {
    return {
      ...base,
      hookEventName: 'PostToolUse',
      toolName: input.tool_name ?? 'unknown',
      toolInput: parseMaybeJson(input.tool_input),
      toolResponse: parseMaybeJson(input.tool_output)
    }
  }
  if (input.hook_event_name === 'beforeSubmitPrompt') {
    return { ...base, hookEventName: 'UserPromptSubmit', prompt: input.prompt ?? '' }
  }
  if (input.hook_event_name === 'preCompact') return { ...base, hookEventName: 'PreCompact' }
  if (input.hook_event_name === 'sessionStart') {
    return { ...base, hookEventName: 'SessionStart', model: input.model ?? process.env.__ONEWORKS_CURSOR_HOOK_MODEL__ }
  }
  if (input.hook_event_name === 'sessionEnd') return { ...base, hookEventName: 'SessionEnd' }
  return { ...base, hookEventName: 'Stop' }
}

const readAdditionalContext = (output: HookOutput) => {
  const hookSpecificOutput = (output as { hookSpecificOutput?: unknown }).hookSpecificOutput
  return hookSpecificOutput != null && typeof hookSpecificOutput === 'object' &&
      'additionalContext' in hookSpecificOutput &&
      typeof hookSpecificOutput.additionalContext === 'string'
    ? hookSpecificOutput.additionalContext
    : undefined
}

export const mapOneWorksHookOutputToCursor = (eventName: CursorHookEventName, output: HookOutput) => {
  if (eventName === 'preToolUse') {
    const hookSpecificOutput = (output as HookOutputs['PreToolUse']).hookSpecificOutput
    const permission = hookSpecificOutput?.hookEventName === 'PreToolUse'
      ? hookSpecificOutput.permissionDecision === 'deny' ? 'deny' : 'allow'
      : output.continue === false
      ? 'deny'
      : 'allow'
    const reason = hookSpecificOutput?.hookEventName === 'PreToolUse'
      ? hookSpecificOutput.permissionDecisionReason
      : output.stopReason
    return {
      permission,
      ...(permission === 'deny'
        ? {
          user_message: output.systemMessage ?? reason ?? 'Blocked by One Works hook',
          agent_message: reason ?? 'Blocked by One Works hook'
        }
        : {})
    }
  }
  const additionalContext = readAdditionalContext(output)
  if (eventName === 'postToolUse') {
    return additionalContext == null ? {} : { additional_context: additionalContext }
  }
  if (eventName === 'beforeSubmitPrompt') {
    return {
      continue: output.continue !== false,
      ...(output.continue === false
        ? { user_message: output.systemMessage ?? output.stopReason ?? 'Blocked by One Works hook' }
        : {})
    }
  }
  if (eventName === 'sessionStart') {
    return additionalContext == null ? {} : { additional_context: additionalContext }
  }
  if (eventName === 'preCompact') {
    return output.systemMessage == null ? {} : { user_message: output.systemMessage }
  }
  if (eventName === 'stop' && output.continue === false) {
    return { followup_message: output.stopReason ?? 'Continue working on the task.' }
  }
  return {}
}

export const runCursorHookBridge = async () => {
  try {
    const input = await readHookInput() as unknown as CursorHookInput
    const output = await executeHookInput(mapCursorHookInputToOneWorks(input))
    process.stdout.write(`${JSON.stringify(mapOneWorksHookOutputToCursor(input.hook_event_name, output))}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ user_message: `oneworks cursor hook bridge error: ${String(error)}` })}\n`)
  }
}

export const isNativeHookEnv = isCursorNativeHookEnv
export const runHookBridge = runCursorHookBridge
