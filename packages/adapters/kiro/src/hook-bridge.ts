import process from 'node:process'

import type { HookInput, HookInputs, HookOutput, HookOutputs } from '@oneworks/hooks'
import { executeHookInput, readHookInput } from '@oneworks/hooks'
import type { AdapterQueryOptions } from '@oneworks/types'

type KiroHookEventName = 'agentSpawn' | 'postToolUse' | 'preToolUse' | 'stop' | 'userPromptSubmit'

export interface KiroHookInput {
  agent_id?: string
  cwd?: string
  hook_event_name: KiroHookEventName
  prompt?: string
  session_id?: string
  tool_input?: unknown
  tool_name?: string
  tool_response?: unknown
  transcript_path?: string
}

const runtime = process.env.__ONEWORKS_KIRO_HOOK_RUNTIME__ as AdapterQueryOptions['runtime'] | undefined
const taskSessionId = process.env.__ONEWORKS_KIRO_TASK_SESSION_ID__?.trim()

export const isKiroNativeHookEnv = () => process.env.__ONEWORKS_KIRO_HOOKS_ACTIVE__ === '1'

export const supportsHookEvent = (eventName: keyof HookInputs) => (
  eventName === 'SessionStart' ||
  eventName === 'UserPromptSubmit' ||
  eventName === 'PreToolUse' ||
  eventName === 'PostToolUse' ||
  eventName === 'Stop'
)

export const mapKiroHookInputToOneWorks = (input: KiroHookInput): HookInput => {
  const base = {
    cwd: input.cwd ?? process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ ?? process.cwd(),
    sessionId: taskSessionId || input.session_id || 'kiro-session',
    transcriptPath: input.transcript_path,
    adapter: 'kiro',
    runtime,
    hookSource: 'native' as const,
    canBlock: input.hook_event_name === 'preToolUse' ||
      input.hook_event_name === 'userPromptSubmit' || input.hook_event_name === 'stop'
  }
  if (input.hook_event_name === 'preToolUse') {
    return {
      ...base,
      hookEventName: 'PreToolUse',
      toolName: input.tool_name ?? 'unknown',
      toolInput: input.tool_input
    }
  }
  if (input.hook_event_name === 'postToolUse') {
    return {
      ...base,
      hookEventName: 'PostToolUse',
      toolName: input.tool_name ?? 'unknown',
      toolInput: input.tool_input,
      toolResponse: input.tool_response
    }
  }
  if (input.hook_event_name === 'userPromptSubmit') {
    return { ...base, hookEventName: 'UserPromptSubmit', prompt: input.prompt ?? '' }
  }
  if (input.hook_event_name === 'agentSpawn') {
    return { ...base, hookEventName: 'SessionStart', model: process.env.__ONEWORKS_KIRO_HOOK_MODEL__ }
  }
  return { ...base, hookEventName: 'Stop' }
}

const blockReason = (output: HookOutput) => {
  const specific = (output as HookOutputs['PreToolUse']).hookSpecificOutput
  return specific?.hookEventName === 'PreToolUse' && specific.permissionDecision === 'deny'
    ? specific.permissionDecisionReason ?? 'Blocked by One Works hook'
    : output.continue === false
    ? output.stopReason ?? output.systemMessage ?? 'Blocked by One Works hook'
    : undefined
}

export const runKiroHookBridge = async () => {
  try {
    const input = await readHookInput() as unknown as KiroHookInput
    const output = await executeHookInput(mapKiroHookInputToOneWorks(input))
    const reason = blockReason(output)
    if (reason == null) return
    if (input.hook_event_name === 'stop') {
      process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`)
      return
    }
    process.stderr.write(`${reason}\n`)
    process.exitCode = 2
  } catch (error) {
    process.stderr.write(`oneworks kiro hook bridge error: ${String(error)}\n`)
  }
}

export const isNativeHookEnv = isKiroNativeHookEnv
export const runHookBridge = runKiroHookBridge
