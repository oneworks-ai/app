import type { WorkspaceAssetAdapter } from '@oneworks/types'

const NATIVE_SKILL_ADAPTERS = new Set<WorkspaceAssetAdapter>([
  'claude-code',
  'cline',
  'codex',
  'copilot',
  'cursor',
  'droid',
  'gemini',
  'goose',
  'grok',
  'kiro',
  'junie',
  'kimi',
  'opencode',
  'pi',
  'qwen-code'
])

export const supportsNativeProjectSkills = (adapter?: string): adapter is WorkspaceAssetAdapter =>
  adapter != null && NATIVE_SKILL_ADAPTERS.has(adapter as WorkspaceAssetAdapter)

export const resolveNativeSkillDiagnosticReason = (adapter: WorkspaceAssetAdapter) => (
  adapter === 'claude-code'
    ? 'Synced into the Claude mock home as a native skill.'
    : adapter === 'cline'
    ? 'Staged below the isolated CLINE_DIR for native Cline skill discovery.'
    : adapter === 'codex'
    ? 'Mirrored into the Codex mock home as a native skill.'
    : adapter === 'copilot'
    ? 'Staged for Copilot CLI native skill discovery.'
    : adapter === 'cursor'
    ? 'Staged in the isolated Cursor data directory as a native skill.'
    : adapter === 'droid'
    ? 'Staged into the isolated Factory home as a native Droid skill.'
    : adapter === 'gemini'
    ? 'Symlinked into GEMINI_CLI_HOME as a native Gemini skill.'
    : adapter === 'grok'
    ? 'Staged into the session GROK_HOME as a native Grok skill.'
    : adapter === 'goose'
    ? 'Staged into the isolated Goose .agents/skills directory as a native skill.'
    : adapter === 'kiro'
    ? 'Staged into the isolated KIRO_HOME as a native Kiro skill.'
    : adapter === 'junie'
    ? 'Passed to Junie through an explicit isolated --skill-location.'
    : adapter === 'kimi'
    ? 'Staged into a Kimi --skills-dir directory as a native skill.'
    : adapter === 'pi'
    ? 'Passed to Pi as an explicit --skill resource with discovery disabled.'
    : adapter === 'qwen-code'
    ? 'Staged into the isolated QWEN_HOME as a native Qwen Code skill.'
    : 'Mirrored into OPENCODE_CONFIG_DIR as a native skill.'
)
