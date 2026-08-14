import { afterEach, describe, expect, it, vi } from 'vitest'

import { mapDroidHookInputToOneWorks, supportsHookEvent } from '../src/hook-bridge'

describe('factory Droid native hook bridge', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })
  it('maps supported native fields and preserves blocking semantics', () => {
    expect(supportsHookEvent('PreToolUse')).toBe(true)
    expect(mapDroidHookInputToOneWorks({
      hook_event_name: 'PreToolUse',
      session_id: 'native-session',
      tool_name: 'Read',
      tool_input: { path: 'README.md' }
    })).toEqual(expect.objectContaining({
      adapter: 'droid',
      canBlock: true,
      hookEventName: 'PreToolUse',
      hookSource: 'native',
      sessionId: 'native-session',
      toolInput: { path: 'README.md' },
      toolName: 'Read'
    }))
  })

  it.each(
    [
      ['PreToolUse', true],
      ['PostToolUse', false],
      ['Notification', false],
      ['UserPromptSubmit', true],
      ['Stop', true],
      ['SubagentStop', true],
      ['PreCompact', false],
      ['SessionStart', false],
      ['SessionEnd', false]
    ] as const
  )('maps pinned Factory hook %s blockability to %s', (hookEventName, canBlock) => {
    expect(supportsHookEvent(hookEventName)).toBe(true)
    expect(mapDroidHookInputToOneWorks({ hookEventName })).toEqual(expect.objectContaining({
      canBlock,
      hookEventName
    }))
  })

  it('ignores unknown native hook events', () => {
    expect(mapDroidHookInputToOneWorks({ hookEventName: 'Unknown' as never })).toBeUndefined()
  })

  it('attributes native hook events to the owning One Works runtime and session', async () => {
    vi.stubEnv('__ONEWORKS_DROID_HOOK_RUNTIME__', 'server')
    vi.stubEnv('__ONEWORKS_DROID_TASK_SESSION_ID__', 'oneworks-owner-session')
    vi.resetModules()
    const bridge = await import('../src/hook-bridge')
    expect(bridge.mapDroidHookInputToOneWorks({
      hook_event_name: 'PostToolUse',
      session_id: 'factory-native-session'
    })).toEqual(expect.objectContaining({
      runtime: 'server',
      sessionId: 'oneworks-owner-session'
    }))
  })
})
