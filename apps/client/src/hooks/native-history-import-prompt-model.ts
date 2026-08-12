import type { NativeHistoryImportSession } from '#~/api/sessions'

export const selectNativeHistoryImportPromptSession = (sessions: NativeHistoryImportSession[]) => (
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0]
)

export const getNativeHistoryImportAdapterSummary = (sessions: NativeHistoryImportSession[]) => {
  const adapters = new Set(sessions.map(session => session.adapter))
  return [
    adapters.has('codex') ? 'Codex' : undefined,
    adapters.has('claude-code') ? 'Claude Code' : undefined,
    adapters.has('cursor') ? 'Cursor' : undefined
  ].filter((value): value is string => value != null).join(' / ')
}
