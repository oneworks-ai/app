import { describe, expect, it } from 'vitest'

import type { HookOutputs } from '@oneworks/hooks'

import { mapCursorHookInputToOneWorks, mapOneWorksHookOutputToCursor } from '#~/hook-bridge.js'

describe('cursor native hook bridge', () => {
  it('maps Cursor generic tool input to the One Works hook contract', () => {
    expect(mapCursorHookInputToOneWorks({
      hook_event_name: 'preToolUse',
      conversation_id: 'cursor-conversation',
      workspace_roots: ['/workspace'],
      tool_name: 'Shell',
      tool_input: '{"command":"git status"}'
    })).toEqual(expect.objectContaining({
      adapter: 'cursor',
      canBlock: true,
      cwd: '/workspace',
      hookEventName: 'PreToolUse',
      sessionId: 'cursor-conversation',
      toolInput: { command: 'git status' },
      toolName: 'Shell'
    }))
  })

  it('maps permission denials and post-tool context to Cursor output fields', () => {
    const denied: HookOutputs['PreToolUse'] = {
      continue: false,
      systemMessage: 'Command blocked',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Policy denied this command'
      }
    }
    const postTool: HookOutputs['PostToolUse'] = {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'Run the formatter next.'
      }
    }

    expect(mapOneWorksHookOutputToCursor('preToolUse', denied)).toEqual({
      permission: 'deny',
      user_message: 'Command blocked',
      agent_message: 'Policy denied this command'
    })
    expect(mapOneWorksHookOutputToCursor('postToolUse', postTool)).toEqual({
      additional_context: 'Run the formatter next.'
    })
  })

  it('maps prompt blocking, session context, and stop continuation', () => {
    expect(mapOneWorksHookOutputToCursor('beforeSubmitPrompt', {
      continue: false,
      stopReason: 'Prompt rejected'
    })).toEqual({
      continue: false,
      user_message: 'Prompt rejected'
    })
    expect(mapOneWorksHookOutputToCursor('sessionStart', {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'Session context'
      }
    })).toEqual({ additional_context: 'Session context' })
    expect(mapOneWorksHookOutputToCursor('stop', {
      continue: false,
      stopReason: 'Finish verification'
    })).toEqual({ followup_message: 'Finish verification' })
  })
})
