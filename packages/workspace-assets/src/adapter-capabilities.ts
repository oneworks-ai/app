import type { WorkspaceAssetAdapter } from '@oneworks/types'

const NATIVE_SKILL_ADAPTERS = new Set<WorkspaceAssetAdapter>([
  'claude-code',
  'codex',
  'copilot',
  'cursor',
  'gemini',
  'grok',
  'kimi',
  'opencode',
  'pi'
])

export const supportsNativeProjectSkills = (adapter?: string): adapter is WorkspaceAssetAdapter =>
  adapter != null && NATIVE_SKILL_ADAPTERS.has(adapter as WorkspaceAssetAdapter)

export const resolveNativeSkillDiagnosticReason = (adapter: WorkspaceAssetAdapter) => (
  adapter === 'claude-code'
    ? 'Synced into the Claude mock home as a native skill.'
    : adapter === 'codex'
    ? 'Mirrored into the Codex mock home as a native skill.'
    : adapter === 'copilot'
    ? 'Staged for Copilot CLI native skill discovery.'
    : adapter === 'cursor'
    ? 'Staged in the isolated Cursor data directory as a native skill.'
    : adapter === 'gemini'
    ? 'Symlinked into GEMINI_CLI_HOME as a native Gemini skill.'
    : adapter === 'grok'
    ? 'Staged into the session GROK_HOME as a native Grok skill.'
    : adapter === 'kimi'
    ? 'Staged into a Kimi --skills-dir directory as a native skill.'
    : adapter === 'pi'
    ? 'Passed to Pi as an explicit --skill resource with discovery disabled.'
    : 'Mirrored into OPENCODE_CONFIG_DIR as a native skill.'
)
