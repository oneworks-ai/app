import type { NativeHistoryImportSession } from '#~/api/sessions'

export const selectNativeHistoryImportPromptSession = (sessions: NativeHistoryImportSession[]) => (
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0]
)

export const getNativeHistoryImportAdapterSummary = (sessions: NativeHistoryImportSession[]) => {
  const adapters = new Set(sessions.map(session => session.adapter))
  if (adapters.has('codex') && adapters.has('claude-code')) {
    return 'Codex / Claude Code'
  }
  if (adapters.has('claude-code')) {
    return 'Claude Code'
  }
  return 'Codex'
}
