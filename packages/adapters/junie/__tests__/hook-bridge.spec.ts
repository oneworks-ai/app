import { describe, expect, it } from 'vitest'

import { mapJunieHookInputToOneWorks, mapOneWorksHookOutputToJunie, supportsHookEvent } from '#~/hook-bridge.js'
import { buildJunieNativeHooksConfig } from '#~/runtime/native-hooks.js'

describe('junie native hook bridge', () => {
  it('maps a PreToolUse denial into Junie decision output', () => {
    expect(mapJunieHookInputToOneWorks({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'rm fixture' }
    })).toEqual(expect.objectContaining({
      adapter: 'junie',
      canBlock: true,
      hookEventName: 'PreToolUse',
      toolName: 'Bash',
      toolInput: { command: 'rm fixture' }
    }))
    expect(mapOneWorksHookOutputToJunie('PreToolUse', {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'blocked by fixture policy'
      }
    })).toEqual({ decision: 'deny', reason: 'blocked by fixture policy' })
  })

  it('maps StopFailure as observability-only and supports cleanup events', () => {
    expect(mapJunieHookInputToOneWorks({
      hook_event_name: 'StopFailure',
      error: 'authentication_failed',
      error_details: 'sanitized failure'
    })).toEqual(expect.objectContaining({
      canBlock: false,
      error: 'authentication_failed',
      errorDetails: 'sanitized failure',
      hookEventName: 'StopFailure'
    }))
    expect(mapOneWorksHookOutputToJunie('StopFailure', {
      continue: false,
      stopReason: 'must not block'
    })).toEqual({})
    expect(mapJunieHookInputToOneWorks({
      hook_event_name: 'SessionEnd',
      reason: 'other'
    })).toEqual(expect.objectContaining({
      canBlock: false,
      hookEventName: 'SessionEnd',
      reason: 'other'
    }))
    expect(mapOneWorksHookOutputToJunie('SessionEnd', { continue: false })).toEqual({})
    expect(supportsHookEvent('StopFailure')).toBe(true)
    expect(supportsHookEvent('SessionEnd')).toBe(true)
    expect(supportsHookEvent('PostToolUse')).toBe(false)
  })

  it('writes the verified headless hook event set including failure and cleanup', () => {
    const config = buildJunieNativeHooksConfig({
      env: {
        __ONEWORKS_PROJECT_JUNIE_NATIVE_HOOKS_AVAILABLE__: '1',
        __ONEWORKS_PROJECT_JUNIE_HOOK_COMMAND__: 'node sanitized-hook.js'
      }
    })
    expect(Object.keys(config!.hooks)).toEqual([
      'SessionStart',
      'PreToolUse',
      'Stop',
      'StopFailure',
      'SessionEnd'
    ])
    expect(config!.hooks.StopFailure).toEqual([
      expect.objectContaining({ hooks: [expect.objectContaining({ timeout: 60 })] })
    ])
  })
})
