import process from 'node:process'

import type { HookInput, HookInputs } from '@oneworks/hooks'
import { executeHookInput, readHookInput } from '@oneworks/hooks'
import type { AdapterQueryOptions } from '@oneworks/types'

const runtime = process.env.__ONEWORKS_CLAUDE_HOOK_RUNTIME__ as AdapterQueryOptions['runtime'] | undefined
const taskSessionId = process.env.__ONEWORKS_CLAUDE_TASK_SESSION_ID__?.trim()

const SUPPORTED_EVENTS = new Set<keyof HookInputs>([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SubagentStop',
  'PreCompact'
])

const BLOCKABLE_EVENTS = new Set<keyof HookInputs>([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PreCompact'
])

export const isClaudeNativeHookEnv = () => (
  process.env.__ONEWORKS_CLAUDE_HOOKS_ACTIVE__ === '1'
)

export const supportsHookEvent = (eventName: keyof HookInputs) => (
  SUPPORTED_EVENTS.has(eventName)
)

const canBlock = (eventName: keyof HookInputs) => BLOCKABLE_EVENTS.has(eventName)

export const mapClaudeHookInputToOneWorks = (input: HookInput) => {
  if (!SUPPORTED_EVENTS.has(input.hookEventName)) return undefined

  return {
    ...input,
    sessionId: taskSessionId || input.sessionId,
    adapter: 'claude-code',
    runtime: input.runtime ?? runtime,
    hookSource: 'native' as const,
    canBlock: input.canBlock ?? canBlock(input.hookEventName)
  } satisfies HookInput
}

export const runClaudeHookBridge = async () => {
  try {
    const input = await readHookInput() as HookInput
    const hookInput = mapClaudeHookInputToOneWorks(input)
    if (hookInput == null) {
      process.stdout.write(`${JSON.stringify({ continue: true })}\n`)
      return
    }

    const result = await executeHookInput(hookInput)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stdout.write(`${
      JSON.stringify({
        continue: true,
        systemMessage: `oneworks claude hook bridge error: ${String(error)}`
      })
    }\n`)
  }
}

export const isNativeHookEnv = isClaudeNativeHookEnv
export const runHookBridge = runClaudeHookBridge
