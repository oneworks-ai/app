import process from 'node:process'

import type { HookInput, HookInputs } from '@oneworks/hooks'
import { executeHookInput, readHookInput } from '@oneworks/hooks'
import type { AdapterQueryOptions } from '@oneworks/types'

interface DroidNativeHookInput extends Record<string, unknown> {
  hookEventName?: keyof HookInputs
  hook_event_name?: keyof HookInputs
  sessionId?: string
  session_id?: string
}

const runtime = process.env.__ONEWORKS_DROID_HOOK_RUNTIME__ as AdapterQueryOptions['runtime'] | undefined
const taskSessionId = process.env.__ONEWORKS_DROID_TASK_SESSION_ID__?.trim()

const SUPPORTED_EVENTS = new Set<keyof HookInputs>([
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'UserPromptSubmit',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'SessionStart',
  'SessionEnd'
])

const BLOCKABLE_EVENTS = new Set<keyof HookInputs>([
  'PreToolUse',
  'UserPromptSubmit',
  'Stop',
  'SubagentStop'
])

export const isDroidNativeHookEnv = () => process.env.__ONEWORKS_DROID_HOOKS_ACTIVE__ === '1'

export const supportsHookEvent = (eventName: keyof HookInputs) => SUPPORTED_EVENTS.has(eventName)

export const mapDroidHookInputToOneWorks = (input: DroidNativeHookInput) => {
  const hookEventName = input.hook_event_name ?? input.hookEventName
  if (hookEventName == null || !SUPPORTED_EVENTS.has(hookEventName)) return undefined

  const normalized = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase()),
      value
    ])
  )
  return {
    ...normalized,
    hookEventName,
    sessionId: taskSessionId || input.session_id || input.sessionId || 'droid-session',
    adapter: 'droid',
    runtime,
    hookSource: 'native' as const,
    canBlock: BLOCKABLE_EVENTS.has(hookEventName)
  } as HookInput
}

export const runDroidHookBridge = async () => {
  try {
    const input = await readHookInput() as unknown as DroidNativeHookInput
    const hookInput = mapDroidHookInputToOneWorks(input)
    if (hookInput == null) {
      process.stdout.write(`${JSON.stringify({ continue: true })}\n`)
      return
    }
    process.stdout.write(`${JSON.stringify(await executeHookInput(hookInput))}\n`)
  } catch (error) {
    process.stdout.write(`${
      JSON.stringify({
        continue: true,
        systemMessage: `oneworks droid hook bridge error: ${String(error)}`
      })
    }\n`)
  }
}

export const isNativeHookEnv = isDroidNativeHookEnv
export const runHookBridge = runDroidHookBridge
