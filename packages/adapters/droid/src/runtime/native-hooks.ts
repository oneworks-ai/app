import {
  buildNodeScriptCommand,
  hasManagedHookPlugins,
  prepareManagedHookRuntime,
  resolveManagedHookScriptPath
} from '@oneworks/hooks'
import type { AdapterCtx } from '@oneworks/types'

export const DROID_NATIVE_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'UserPromptSubmit',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'SessionStart',
  'SessionEnd'
] as const

const MANAGED_COMMAND_PATH = resolveManagedHookScriptPath('call-hook.js')

export const prepareDroidNativeHooks = (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'assets'>
) => {
  ctx.env.__ONEWORKS_PROJECT_DROID_NATIVE_HOOKS_AVAILABLE__ = '0'
  const enabled = hasManagedHookPlugins({ assets: ctx.assets }) ||
    ctx.env.__ONEWORKS_PROJECT_ENABLE_BUILTIN_PERMISSION_HOOKS__ === '1'

  try {
    const { nodePath } = prepareManagedHookRuntime(ctx)
    ctx.env.__ONEWORKS_PROJECT_DROID_HOOK_COMMAND__ = buildNodeScriptCommand({
      nodePath,
      scriptPath: MANAGED_COMMAND_PATH
    })
    ctx.env.__ONEWORKS_PROJECT_DROID_NATIVE_HOOKS_AVAILABLE__ = enabled ? '1' : '0'
    return enabled
  } catch (error) {
    ctx.logger.warn('[droid hooks] failed to prepare native hook bridge', error)
    ctx.env.__ONEWORKS_PROJECT_DROID_NATIVE_HOOKS_AVAILABLE__ = '0'
    delete ctx.env.__ONEWORKS_PROJECT_DROID_HOOK_COMMAND__
    return false
  }
}

export const buildDroidNativeHooks = (env: AdapterCtx['env']) => {
  const enabled = env.__ONEWORKS_PROJECT_DROID_NATIVE_HOOKS_AVAILABLE__ === '1'
  const command = env.__ONEWORKS_PROJECT_DROID_HOOK_COMMAND__?.trim()
  if (!enabled || command == null || command === '') return undefined

  return Object.fromEntries(DROID_NATIVE_HOOK_EVENTS.map(eventName => [
    eventName,
    [{
      ...(eventName === 'PreToolUse' || eventName === 'PostToolUse' || eventName === 'SubagentStop'
        ? { matcher: '.*' }
        : {}),
      hooks: [{
        type: 'command',
        command,
        timeout: 600,
        statusMessage: `running oneworks ${eventName} hook`
      }]
    }]
  ]))
}
