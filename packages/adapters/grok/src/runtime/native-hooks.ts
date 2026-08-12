import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  buildNodeScriptCommand,
  hasManagedHookPlugins,
  prepareManagedHookRuntime,
  resolveManagedHookScriptPath
} from '@oneworks/hooks'
import type { AdapterCtx } from '@oneworks/types'

export const GROK_NATIVE_HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'Stop'
] as const

const MANAGED_COMMAND_PATH = resolveManagedHookScriptPath('call-hook.js')

export const prepareGrokNativeHooks = (
  ctx: Pick<AdapterCtx, 'cwd' | 'env' | 'logger' | 'assets'>
) => {
  ctx.env.__ONEWORKS_PROJECT_GROK_NATIVE_HOOKS_AVAILABLE__ = '0'
  const enabled = hasManagedHookPlugins({ assets: ctx.assets }) ||
    ctx.env.__ONEWORKS_PROJECT_ENABLE_BUILTIN_PERMISSION_HOOKS__ === '1'

  try {
    const { nodePath } = prepareManagedHookRuntime(ctx)
    ctx.env.__ONEWORKS_PROJECT_GROK_HOOK_COMMAND__ = buildNodeScriptCommand({
      nodePath,
      scriptPath: MANAGED_COMMAND_PATH
    })
    ctx.env.__ONEWORKS_PROJECT_GROK_NATIVE_HOOKS_AVAILABLE__ = enabled ? '1' : '0'
    return enabled
  } catch (error) {
    ctx.logger.warn('[grok hooks] failed to prepare native hook bridge', error)
    ctx.env.__ONEWORKS_PROJECT_GROK_NATIVE_HOOKS_AVAILABLE__ = '0'
    delete ctx.env.__ONEWORKS_PROJECT_GROK_HOOK_COMMAND__
    return false
  }
}
export const writeGrokNativeHooks = async (params: {
  env: AdapterCtx['env']
  grokHome: string
}) => {
  const hooksPath = resolve(params.grokHome, 'hooks', 'oneworks.json')
  const enabled = params.env.__ONEWORKS_PROJECT_GROK_NATIVE_HOOKS_AVAILABLE__ === '1'
  const command = params.env.__ONEWORKS_PROJECT_GROK_HOOK_COMMAND__?.trim()
  if (!enabled || command == null || command === '') {
    await rm(hooksPath, { force: true })
    return undefined
  }

  const hooks = Object.fromEntries(GROK_NATIVE_HOOK_EVENTS.map((eventName) => [
    eventName,
    [{
      ...(eventName === 'PreToolUse' || eventName === 'PostToolUse' ? { matcher: '.*' } : {}),
      hooks: [{
        type: 'command',
        command,
        timeout: 600
      }]
    }]
  ]))
  await mkdir(resolve(hooksPath, '..'), { recursive: true })
  await writeFile(hooksPath, `${JSON.stringify({ hooks }, null, 2)}\n`, 'utf8')
  return hooksPath
}
