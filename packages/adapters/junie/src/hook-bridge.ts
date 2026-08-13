import process from 'node:process'

import type { HookInput, HookInputs, HookOutput, HookOutputs } from '@oneworks/hooks'
import { executeHookInput, readHookInput } from '@oneworks/hooks'
import type { AdapterQueryOptions } from '@oneworks/types'

type JunieHookEventName = 'SessionStart' | 'PreToolUse' | 'Stop' | 'StopFailure' | 'SessionEnd'

interface JunieHookInput {
  hook_event_name: JunieHookEventName
  cwd?: string
  session_id?: string
  source?: 'startup' | 'resume'
  reason?: string
  tool_name?: string
  tool_input?: unknown
  stop_hook_active?: boolean
  last_assistant_message?: string
  error?: string
  error_details?: string
}

const runtime = process.env.__ONEWORKS_JUNIE_HOOK_RUNTIME__ as AdapterQueryOptions['runtime'] | undefined
const taskSessionId = process.env.__ONEWORKS_JUNIE_TASK_SESSION_ID__?.trim()

export const isJunieNativeHookEnv = () => process.env.__ONEWORKS_JUNIE_HOOKS_ACTIVE__ === '1'

export const supportsHookEvent = (eventName: keyof HookInputs) => (
  eventName === 'SessionStart' || eventName === 'PreToolUse' ||
  eventName === 'Stop' || eventName === 'StopFailure' || eventName === 'SessionEnd'
)

export const mapJunieHookInputToOneWorks = (input: JunieHookInput): HookInput => {
  const base = {
    adapter: 'junie',
    canBlock: input.hook_event_name === 'PreToolUse' || input.hook_event_name === 'Stop',
    cwd: input.cwd ?? process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? process.cwd(),
    hookSource: 'native' as const,
    runtime,
    sessionId: taskSessionId || input.session_id || 'junie-session'
  }
  if (input.hook_event_name === 'PreToolUse') {
    return {
      ...base,
      hookEventName: 'PreToolUse',
      toolName: input.tool_name ?? 'unknown',
      toolInput: input.tool_input
    }
  }
  if (input.hook_event_name === 'Stop') {
    return {
      ...base,
      hookEventName: 'Stop',
      stopHookActive: input.stop_hook_active,
      lastAssistantMessage: input.last_assistant_message
    }
  }
  if (input.hook_event_name === 'SessionEnd') {
    return { ...base, hookEventName: 'SessionEnd', reason: input.reason ?? 'other' }
  }
  if (input.hook_event_name === 'StopFailure') {
    return {
      ...base,
      canBlock: false,
      hookEventName: 'StopFailure',
      error: input.error ?? 'unknown',
      errorDetails: input.error_details ?? ''
    }
  }
  return {
    ...base,
    hookEventName: 'SessionStart',
    source: input.source === 'resume' ? 'resume' : 'startup',
    model: process.env.__ONEWORKS_JUNIE_HOOK_MODEL__
  }
}

export const mapOneWorksHookOutputToJunie = (eventName: JunieHookEventName, output: HookOutput) => {
  if (eventName === 'PreToolUse') {
    const specific = (output as HookOutputs['PreToolUse']).hookSpecificOutput
    const decision = specific?.hookEventName === 'PreToolUse'
      ? specific.permissionDecision === 'deny' ? 'deny' : specific.permissionDecision
      : output.continue === false
      ? 'deny'
      : 'allow'
    return {
      decision,
      ...(specific?.permissionDecisionReason == null ? {} : { reason: specific.permissionDecisionReason })
    }
  }
  if (eventName === 'Stop') {
    return output.continue === false
      ? { continue: false, stopReason: output.stopReason ?? 'Stopped by One Works hook' }
      : {}
  }
  if (eventName === 'StopFailure') return {}
  if (eventName === 'SessionStart') {
    return output.systemMessage == null ? {} : { systemMessage: output.systemMessage }
  }
  return {}
}

export const runJunieHookBridge = async () => {
  try {
    const input = await readHookInput() as unknown as JunieHookInput
    const output = await executeHookInput(mapJunieHookInputToOneWorks(input))
    process.stdout.write(`${JSON.stringify(mapOneWorksHookOutputToJunie(input.hook_event_name, output))}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ systemMessage: `oneworks junie hook bridge error: ${String(error)}` })}\n`)
  }
}

export const isNativeHookEnv = isJunieNativeHookEnv
export const runHookBridge = runJunieHookBridge
