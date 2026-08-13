import { describe, expect, it } from 'vitest'

import { resolveNativeSkillDiagnosticReason, supportsNativeProjectSkills } from '#~/adapter-capabilities.js'

describe('adapter native skill capabilities', () => {
  it.each(
    [
      ['claude-code', 'Claude'],
      ['cline', 'Cline'],
      ['codex', 'Codex'],
      ['copilot', 'Copilot'],
      ['cursor', 'Cursor'],
      ['droid', 'Droid'],
      ['gemini', 'Gemini'],
      ['goose', 'Goose'],
      ['grok', 'Grok'],
      ['kiro', 'KIRO_HOME'],
      ['junie', '--skill-location'],
      ['kimi', 'Kimi'],
      ['opencode', 'OPENCODE_CONFIG_DIR'],
      ['pi', '--skill'],
      ['qwen-code', 'QWEN_HOME']
    ] as const
  )('treats %s as a native skill adapter', (adapter, reasonText) => {
    expect(supportsNativeProjectSkills(adapter)).toBe(true)
    expect(resolveNativeSkillDiagnosticReason(adapter)).toContain(reasonText)
  })

  it('does not treat unknown adapters as native skill adapters', () => {
    expect(supportsNativeProjectSkills('unknown')).toBe(false)
  })
})
