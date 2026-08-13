import {
  buildNodeScriptCommand,
  hasManagedHookPlugins,
  mergeManagedHookGroups,
  prepareManagedHookRuntime,
  resolveManagedHookScriptPath
} from '@oneworks/hooks'
import type { NativeHookMatcherGroup } from '@oneworks/hooks'
import type { AdapterCtx } from '@oneworks/types'

import { createQwenRuntimeRedactor } from './redaction'

export interface QwenNativeHooksSettings {
  hooks?: Record<string, NativeHookMatcherGroup[]>
  hooksConfig?: {
    enabled?: boolean
    disabled?: string[]
  }
}

export const QWEN_NATIVE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'PreCompact'
] as const

type QwenNativeHookEvent = (typeof QWEN_NATIVE_HOOK_EVENTS)[number]
const MANAGED_COMMAND_PATH = resolveManagedHookScriptPath('call-hook.js')
const MANAGED_MARKERS = [MANAGED_COMMAND_PATH, 'oneworks-call-hook', 'call-hook.js']

const isManagedGroup = (group: NativeHookMatcherGroup) => (
  Array.isArray(group.hooks) &&
  group.hooks.some(hook => MANAGED_MARKERS.some(marker => hook.command.includes(marker)))
)

const createManagedGroup = (command: string, eventName: QwenNativeHookEvent): NativeHookMatcherGroup => ({
  ...(eventName === 'PreToolUse' || eventName === 'PostToolUse' ? { matcher: '.*' } : {}),
  hooks: [{ type: 'command', command, timeout: 600_000 }]
})

export const buildQwenNativeHooksSettings = (
  env: Record<string, string | null | undefined>
): QwenNativeHooksSettings => {
  const command = env.__ONEWORKS_PROJECT_QWEN_CODE_HOOK_COMMAND__?.trim()
  if (env.__ONEWORKS_PROJECT_QWEN_CODE_NATIVE_HOOKS_AVAILABLE__ !== '1' || command == null || command === '') {
    return {}
  }
  const merged = mergeManagedHookGroups({
    existing: {},
    eventNames: QWEN_NATIVE_HOOK_EVENTS,
    enabled: true,
    isManagedGroup,
    createGroup: eventName => createManagedGroup(command, eventName as QwenNativeHookEvent)
  })
  return {
    hooksConfig: { enabled: true },
    ...(merged.hooks == null ? {} : { hooks: merged.hooks as Record<string, NativeHookMatcherGroup[]> })
  }
}

export const prepareQwenNativeHooks = (
  ctx: Pick<AdapterCtx, 'assets' | 'cwd' | 'env' | 'logger'>
) => {
  ctx.env.__ONEWORKS_PROJECT_QWEN_CODE_NATIVE_HOOKS_AVAILABLE__ = '0'
  const enabled = hasManagedHookPlugins({ assets: ctx.assets }) ||
    ctx.env.__ONEWORKS_PROJECT_ENABLE_BUILTIN_PERMISSION_HOOKS__ === '1'
  try {
    const { nodePath } = prepareManagedHookRuntime(ctx)
    ctx.env.__ONEWORKS_PROJECT_QWEN_CODE_NATIVE_HOOKS_AVAILABLE__ = enabled ? '1' : '0'
    ctx.env.__ONEWORKS_PROJECT_QWEN_CODE_HOOK_COMMAND__ = buildNodeScriptCommand({
      nodePath,
      scriptPath: MANAGED_COMMAND_PATH
    })
    return enabled
  } catch (error) {
    const redactor = createQwenRuntimeRedactor({
      additionalValues: [ctx.assets],
      env: ctx.env,
      qwenHome: ctx.env.QWEN_HOME ?? undefined,
      runtimeDir: ctx.env.QWEN_RUNTIME_DIR ?? undefined
    })
    ctx.logger.warn('[qwen-code hooks] failed to prepare native hook bridge', redactor.unknown(error))
    delete ctx.env.__ONEWORKS_PROJECT_QWEN_CODE_HOOK_COMMAND__
    return false
  }
}
