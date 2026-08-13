import {
  NATIVE_HOOK_BRIDGE_ADAPTER_ENV,
  buildNodeScriptCommand,
  hasManagedHookPlugins,
  prepareManagedHookRuntime,
  resolveManagedHookScriptPath
} from '@oneworks/hooks'
import type { AdapterCtx, AdapterQueryOptions } from '@oneworks/types'

export const JUNIE_NATIVE_HOOK_EVENTS = [
  'SessionStart',
  'PreToolUse',
  'Stop',
  'StopFailure',
  'SessionEnd'
] as const

const MANAGED_COMMAND_PATH = resolveManagedHookScriptPath('call-hook.js')

export const prepareJunieNativeHooks = (
  ctx: Pick<AdapterCtx, 'assets' | 'cwd' | 'env' | 'logger'>
) => {
  ctx.env.__ONEWORKS_PROJECT_JUNIE_NATIVE_HOOKS_AVAILABLE__ = '0'
  const enabled = hasManagedHookPlugins(ctx) ||
    ctx.env.__ONEWORKS_PROJECT_ENABLE_BUILTIN_PERMISSION_HOOKS__ === '1'
  try {
    const { nodePath } = prepareManagedHookRuntime(ctx)
    ctx.env.__ONEWORKS_PROJECT_JUNIE_HOOK_COMMAND__ = buildNodeScriptCommand({
      nodePath,
      scriptPath: MANAGED_COMMAND_PATH
    })
    ctx.env.__ONEWORKS_PROJECT_JUNIE_NATIVE_HOOKS_AVAILABLE__ = enabled ? '1' : '0'
    return enabled
  } catch (error) {
    ctx.logger.warn('[junie hooks] failed to prepare native hook bridge', error)
    delete ctx.env.__ONEWORKS_PROJECT_JUNIE_HOOK_COMMAND__
    return false
  }
}

export const buildJunieNativeHooksConfig = (ctx: Pick<AdapterCtx, 'env'>) => {
  const command = ctx.env.__ONEWORKS_PROJECT_JUNIE_HOOK_COMMAND__?.trim()
  const enabled = ctx.env.__ONEWORKS_PROJECT_JUNIE_NATIVE_HOOKS_AVAILABLE__ === '1' && command != null
  if (!enabled) return undefined
  return {
    hooks: Object.fromEntries(JUNIE_NATIVE_HOOK_EVENTS.map(eventName => [
      eventName,
      [{
        ...(eventName === 'PreToolUse' ? { matcher: '.*' } : {}),
        hooks: [{
          type: 'command',
          command,
          timeout: eventName === 'Stop' ? 600 : eventName === 'StopFailure' ? 60 : 10
        }]
      }]
    ]))
  }
}

export const buildJunieNativeHookEnv = (params: {
  ctx: Pick<AdapterCtx, 'cwd'>
  options: AdapterQueryOptions
}) => ({
  __ONEWORKS_JUNIE_HOOKS_ACTIVE__: '1',
  [NATIVE_HOOK_BRIDGE_ADAPTER_ENV]: 'junie',
  __ONEWORKS_JUNIE_TASK_SESSION_ID__: params.options.sessionId,
  __ONEWORKS_JUNIE_HOOK_RUNTIME__: params.options.runtime,
  __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: params.ctx.cwd,
  ...(params.options.model == null ? {} : { __ONEWORKS_JUNIE_HOOK_MODEL__: params.options.model }),
  __ONEWORKS_JUNIE_SUPPORTED_HOOK_EVENTS__: JUNIE_NATIVE_HOOK_EVENTS.join(',')
})
