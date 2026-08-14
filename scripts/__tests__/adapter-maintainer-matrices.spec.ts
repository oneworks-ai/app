import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const nativeAssets = readFileSync('.oo/rules/adapter-design/native-assets.md', 'utf8')
const hooksReadme = readFileSync('.oo/rules/hooks/README.md', 'utf8')
const hookEvents = readFileSync('.oo/rules/hooks/events.md', 'utf8')

describe('adapter maintainer source-of-truth matrices', () => {
  it('keeps every built-in native-asset owner and includes Junie in both matrices', () => {
    const adapters = [
      'claude-code',
      'codex',
      'copilot',
      'cursor',
      'gemini',
      'grok',
      'junie',
      'kimi',
      'opencode',
      'pi'
    ]
    for (const adapter of adapters) {
      expect(nativeAssets.split(`| \`${adapter}\``)).toHaveLength(3)
    }
    expect(nativeAssets).toContain('## Junie')
    expect(nativeAssets).toContain('minimal child-env policy')
  })

  it('keeps the established hook owners and documents Junie StopFailure ownership', () => {
    for (const adapter of ['claude-code', 'codex', 'gemini', 'junie', 'kimi', 'opencode', 'pi']) {
      expect(hooksReadme).toContain(`\`${adapter}\``)
    }
    for (
      const event of [
        'TaskStart',
        'TaskStop',
        'SessionStart',
        'UserPromptSubmit',
        'PreToolUse',
        'PostToolUse',
        'Stop',
        'StopFailure',
        'SessionEnd',
        'Notification',
        'SubagentStop',
        'PreCompact'
      ]
    ) {
      expect(hookEvents).toContain(`\`${event}\``)
    }
    expect(hookEvents).toContain('`StopFailure` 归一化为带 `error` / `errorDetails` 的失败观测')
    expect(hookEvents).toContain('framework bridge 只 suppress 这五类事件')
    expect(hookEvents).toContain('`UserPromptSubmit` / `PostToolUse` 等未验证事件不能一并禁用')
  })
})
