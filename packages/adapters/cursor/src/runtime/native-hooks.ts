import {
  NATIVE_HOOK_BRIDGE_ADAPTER_ENV,
  buildNodeScriptCommand,
  hasManagedHookPlugins,
  prepareManagedHookRuntime,
  resolveManagedHookScriptPath
} from '@oneworks/hooks'
import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'

export const CURSOR_NATIVE_HOOK_EVENTS = [
  'sessionStart',
  'sessionEnd',
  'beforeSubmitPrompt',
  'preToolUse',
  'postToolUse',
  'preCompact',
  'stop'
] as const

type CursorNativeHookEvent = (typeof CURSOR_NATIVE_HOOK_EVENTS)[number]

const MANAGED_COMMAND_PATH = resolveManagedHookScriptPath('call-hook.js')

export const prepareCursorNativeHooks = (
  ctx: Pick<AdapterCtx, 'assets' | 'cwd' | 'env' | 'logger'>
) => {
  ctx.env.__ONEWORKS_PROJECT_CURSOR_NATIVE_HOOKS_AVAILABLE__ = '0'
  const enabled = hasManagedHookPlugins(ctx) || ctx.env.__ONEWORKS_PROJECT_ENABLE_BUILTIN_PERMISSION_HOOKS__ === '1'
  try {
    const { nodePath } = prepareManagedHookRuntime(ctx)
    ctx.env.__ONEWORKS_PROJECT_CURSOR_HOOK_COMMAND__ = buildNodeScriptCommand({
      nodePath,
      scriptPath: MANAGED_COMMAND_PATH
    })
    ctx.env.__ONEWORKS_PROJECT_CURSOR_NATIVE_HOOKS_AVAILABLE__ = enabled ? '1' : '0'
    return enabled
  } catch (error) {
    ctx.logger.warn('[cursor hooks] failed to prepare native hook bridge', error)
    delete ctx.env.__ONEWORKS_PROJECT_CURSOR_HOOK_COMMAND__
    return false
  }
}

const toOneWorksEventName = (eventName: CursorNativeHookEvent) => (
  eventName === 'preToolUse'
    ? 'PreToolUse'
    : eventName === 'postToolUse'
    ? 'PostToolUse'
    : eventName === 'beforeSubmitPrompt'
    ? 'UserPromptSubmit'
    : eventName === 'preCompact'
    ? 'PreCompact'
    : eventName === 'sessionStart'
    ? 'SessionStart'
    : eventName === 'sessionEnd'
    ? 'SessionEnd'
    : 'Stop'
)

export const buildCursorNativeHooksConfig = (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  options: AdapterQueryOptions
}) => {
  const command = params.ctx.env.__ONEWORKS_PROJECT_CURSOR_HOOK_COMMAND__?.trim()
  const enabled = params.ctx.env.__ONEWORKS_PROJECT_CURSOR_NATIVE_HOOKS_AVAILABLE__ === '1' && command != null
  if (!enabled) return undefined

  return {
    version: 1,
    hooks: Object.fromEntries(
      CURSOR_NATIVE_HOOK_EVENTS.map(eventName => [eventName, [{ command }]])
    )
  }
}

export const buildCursorNativeHookEnv = (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  options: AdapterQueryOptions
}) => ({
  __ONEWORKS_CURSOR_HOOKS_ACTIVE__: '1',
  [NATIVE_HOOK_BRIDGE_ADAPTER_ENV]: 'cursor',
  __ONEWORKS_CURSOR_TASK_SESSION_ID__: params.options.sessionId,
  __ONEWORKS_CURSOR_HOOK_RUNTIME__: params.options.runtime,
  __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: params.ctx.cwd,
  ...(params.options.model != null ? { __ONEWORKS_CURSOR_HOOK_MODEL__: params.options.model } : {}),
  __ONEWORKS_CURSOR_SUPPORTED_HOOK_EVENTS__: CURSOR_NATIVE_HOOK_EVENTS
    .map(toOneWorksEventName)
    .join(',')
})
