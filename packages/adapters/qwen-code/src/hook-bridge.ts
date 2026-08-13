import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import type { HookInput, HookInputs, HookOutput, HookOutputs } from '@oneworks/hooks'
import { executeHookInput, readHookInput } from '@oneworks/hooks'
import type { AdapterQueryOptions } from '@oneworks/types'

import { createQwenRuntimeRedactor } from './runtime/redaction'

type NativeQwenEventName =
  | 'PostToolUse'
  | 'PreCompact'
  | 'PreToolUse'
  | 'SessionStart'
  | 'Stop'
  | 'SubagentStop'
  | 'UserPromptSubmit'

interface NativeQwenInputBase {
  cwd: string
  hookEventName: NativeQwenEventName
  model?: string
  sessionId: string
  transcriptPath?: string | null
}

type NativeQwenHookInput = NativeQwenInputBase & {
  agentId?: string
  agentType?: string
  customInstructions?: string
  lastAssistantMessage?: string
  prompt?: string
  source?: 'clear' | 'resume' | 'startup'
  stopHookActive?: boolean
  toolInput?: unknown
  toolName?: string
  toolResponse?: unknown
  trigger?: string
}

const runtime = process.env.__ONEWORKS_QWEN_CODE_HOOK_RUNTIME__ as AdapterQueryOptions['runtime'] | undefined
const taskSessionId = process.env.__ONEWORKS_QWEN_CODE_TASK_SESSION_ID__?.trim()
const taskModel = process.env.__ONEWORKS_QWEN_CODE_HOOK_MODEL__?.trim()

const isBlockable = (eventName: NativeQwenEventName) => (
  eventName === 'PreToolUse' || eventName === 'UserPromptSubmit' || eventName === 'SessionStart' ||
  eventName === 'PostToolUse' || eventName === 'PreCompact'
)

const applyOutputFields = (output: HookOutput) => ({
  ...(typeof output.continue === 'boolean' ? { continue: output.continue } : {}),
  ...(typeof output.stopReason === 'string' ? { stopReason: output.stopReason } : {}),
  ...(typeof output.suppressOutput === 'boolean' ? { suppressOutput: output.suppressOutput } : {}),
  ...(typeof output.systemMessage === 'string' ? { systemMessage: output.systemMessage } : {})
})

const additionalContext = (value: unknown) => {
  const record = value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as { additionalContext?: unknown }
    : {}
  return typeof record.additionalContext === 'string'
    ? { additionalContext: record.additionalContext }
    : undefined
}

export const isQwenNativeHookEnv = () => process.env.__ONEWORKS_QWEN_CODE_HOOKS_ACTIVE__ === '1'
export const supportsHookEvent = (_eventName: keyof HookInputs) => false

export const mapQwenHookInputToOneWorks = (input: NativeQwenHookInput): HookInput => {
  const base = {
    cwd: input.cwd,
    sessionId: taskSessionId || input.sessionId,
    transcriptPath: input.transcriptPath,
    adapter: 'qwen-code',
    runtime,
    hookSource: 'native' as const,
    canBlock: isBlockable(input.hookEventName)
  }
  switch (input.hookEventName) {
    case 'PreToolUse':
      return { ...base, hookEventName: 'PreToolUse', toolName: input.toolName ?? 'unknown', toolInput: input.toolInput }
    case 'PostToolUse':
      return {
        ...base,
        hookEventName: 'PostToolUse',
        toolName: input.toolName ?? 'unknown',
        toolInput: input.toolInput,
        toolResponse: input.toolResponse
      }
    case 'UserPromptSubmit':
      return { ...base, hookEventName: 'UserPromptSubmit', prompt: input.prompt ?? '' }
    case 'Stop':
      return {
        ...base,
        hookEventName: 'Stop',
        lastAssistantMessage: input.lastAssistantMessage,
        stopHookActive: input.stopHookActive
      }
    case 'SubagentStop':
      return {
        ...base,
        hookEventName: 'SubagentStop'
      }
    case 'SessionStart':
      return {
        ...base,
        hookEventName: 'SessionStart',
        source: input.source === 'resume' ? 'resume' : input.source === 'startup' ? 'startup' : undefined,
        model: input.model ?? taskModel
      }
    case 'PreCompact':
      return {
        ...base,
        hookEventName: 'PreCompact',
        trigger: input.trigger
      }
  }
}

export const mapOneWorksHookOutputToQwen = (eventName: NativeQwenEventName, output: HookOutput) => {
  const result: Record<string, unknown> = applyOutputFields(output)
  if (eventName === 'PreToolUse') {
    const specific = (output as HookOutputs['PreToolUse']).hookSpecificOutput
    if (specific?.hookEventName === 'PreToolUse') {
      result.hookSpecificOutput = {
        hookEventName: 'PreToolUse',
        permissionDecision: specific.permissionDecision,
        permissionDecisionReason: specific.permissionDecisionReason
      }
    }
  }
  if (eventName === 'PostToolUse' || eventName === 'UserPromptSubmit' || eventName === 'SessionStart') {
    const specific = additionalContext((output as { hookSpecificOutput?: unknown }).hookSpecificOutput)
    if (specific != null) result.hookSpecificOutput = { hookEventName: eventName, ...specific }
  }
  return result
}

export const runQwenHookBridge = async () => {
  let isolatedSettings: unknown
  if (process.env.QWEN_HOME != null) {
    try {
      isolatedSettings = JSON.parse(await readFile(join(process.env.QWEN_HOME, 'settings.json'), 'utf8')) as unknown
    } catch {
      isolatedSettings = undefined
    }
  }
  const redactor = createQwenRuntimeRedactor({
    ...(isolatedSettings == null ? {} : { additionalValues: [isolatedSettings] }),
    env: process.env,
    qwenHome: process.env.QWEN_HOME,
    runtimeDir: process.env.QWEN_RUNTIME_DIR
  })
  try {
    const input = await readHookInput() as NativeQwenHookInput
    const result = await executeHookInput(mapQwenHookInputToOneWorks(input))
    process.stdout.write(
      `${JSON.stringify(redactor.unknown(mapOneWorksHookOutputToQwen(input.hookEventName, result)))}\n`
    )
  } catch (error) {
    process.stdout.write(`${
      JSON.stringify({
        continue: true,
        systemMessage: redactor.string(`oneworks qwen-code hook bridge error: ${String(error)}`)
      })
    }\n`)
  }
}

export const isNativeHookEnv = isQwenNativeHookEnv
export const runHookBridge = runQwenHookBridge
