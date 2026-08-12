import { describe, expect, it } from 'vitest'

import { mapGrokHookInputToOneWorks, mapOneWorksHookOutputToGrok, supportsHookEvent } from '../src/hook-bridge'

describe('grok native hook bridge', () => {
  it('maps snake-case native tool events into the shared hook contract', () => {
    expect(mapGrokHookInputToOneWorks({
      cwd: '/workspace',
      hook_event_name: 'PreToolUse',
      session_id: 'grok-session',
      tool_name: 'Bash',
      tool_input: { command: 'git status' }
    })).toEqual(expect.objectContaining({
      adapter: 'grok',
      hookEventName: 'PreToolUse',
      sessionId: 'grok-session',
      toolName: 'Bash',
      toolInput: { command: 'git status' },
      hookSource: 'native',
      canBlock: true
    }))
  })

  it('returns Grok deny decisions for blocking permission hooks', () => {
    expect(mapOneWorksHookOutputToGrok('PreToolUse', {
      continue: false,
      stopReason: 'command is denied'
    })).toEqual({
      decision: 'deny',
      reason: 'command is denied'
    })
    expect(mapOneWorksHookOutputToGrok('PostToolUse', { continue: false })).toEqual({})
  })

  it('advertises only the events installed into Grok hooks', () => {
    expect(supportsHookEvent('PreToolUse')).toBe(true)
    expect(supportsHookEvent('PostToolUse')).toBe(true)
    expect(supportsHookEvent('Stop')).toBe(true)
    expect(supportsHookEvent('SessionStart')).toBe(false)
  })
})
