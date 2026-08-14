import {
  NATIVE_HOOK_BRIDGE_ADAPTER_ENV,
  buildNodeScriptCommand,
  hasManagedHookPlugins,
  prepareManagedHookRuntime,
  resolveManagedHookScriptPath
} from '@oneworks/hooks'
import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'

export const KIRO_NATIVE_HOOK_EVENTS = [
  'agentSpawn',
  'userPromptSubmit',
  'preToolUse',
  'postToolUse',
  'stop'
] as const

const MANAGED_COMMAND_PATH = resolveManagedHookScriptPath('call-hook.js')

export const prepareKiroNativeHooks = (
  ctx: Pick<AdapterCtx, 'assets' | 'cwd' | 'env' | 'logger'>
) => {
  ctx.env.__ONEWORKS_PROJECT_KIRO_NATIVE_HOOKS_AVAILABLE__ = '0'
  const enabled = hasManagedHookPlugins(ctx) || ctx.env.__ONEWORKS_PROJECT_ENABLE_BUILTIN_PERMISSION_HOOKS__ === '1'
  try {
    const { nodePath } = prepareManagedHookRuntime(ctx)
    ctx.env.__ONEWORKS_PROJECT_KIRO_HOOK_COMMAND__ = buildNodeScriptCommand({
      nodePath,
      scriptPath: MANAGED_COMMAND_PATH
    })
    ctx.env.__ONEWORKS_PROJECT_KIRO_NATIVE_HOOKS_AVAILABLE__ = enabled ? '1' : '0'
    return enabled
  } catch (error) {
    ctx.logger.warn('[kiro hooks] failed to prepare native hook bridge', error)
    delete ctx.env.__ONEWORKS_PROJECT_KIRO_HOOK_COMMAND__
    return false
  }
}

const toOneWorksEventName = (event: (typeof KIRO_NATIVE_HOOK_EVENTS)[number]) => (
  event === 'agentSpawn'
    ? 'SessionStart'
    : event === 'userPromptSubmit'
    ? 'UserPromptSubmit'
    : event === 'preToolUse'
    ? 'PreToolUse'
    : event === 'postToolUse'
    ? 'PostToolUse'
    : 'Stop'
)

export const buildKiroNativeHooksConfig = (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  options: AdapterQueryOptions
}) => {
  const command = params.ctx.env.__ONEWORKS_PROJECT_KIRO_HOOK_COMMAND__?.trim()
  const enabled = params.ctx.env.__ONEWORKS_PROJECT_KIRO_NATIVE_HOOKS_AVAILABLE__ === '1' && command != null
  if (!enabled) return undefined
  return Object.fromEntries(
    KIRO_NATIVE_HOOK_EVENTS.map(event => [event, [{ command, ...(event.includes('Tool') ? { matcher: '*' } : {}) }]])
  )
}

export const buildKiroNativeHookEnv = (params: {
  ctx: Pick<AdapterCtx, 'cwd' | 'env'>
  options: AdapterQueryOptions
}) => ({
  __ONEWORKS_KIRO_HOOKS_ACTIVE__: '1',
  [NATIVE_HOOK_BRIDGE_ADAPTER_ENV]: 'kiro',
  __ONEWORKS_KIRO_TASK_SESSION_ID__: params.options.sessionId,
  __ONEWORKS_KIRO_HOOK_RUNTIME__: params.options.runtime,
  __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: params.ctx.cwd,
  ...(params.options.model != null ? { __ONEWORKS_KIRO_HOOK_MODEL__: params.options.model } : {}),
  __ONEWORKS_KIRO_SUPPORTED_HOOK_EVENTS__: KIRO_NATIVE_HOOK_EVENTS.map(toOneWorksEventName).join(',')
})
