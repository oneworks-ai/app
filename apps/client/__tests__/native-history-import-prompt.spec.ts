import { describe, expect, it } from 'vitest'

import type { NativeHistoryImportSession } from '#~/api'
import {
  getNativeHistoryImportAdapterSummary,
  selectNativeHistoryImportPromptSession
} from '#~/hooks/native-history-import-prompt-model'

const createImportSession = (
  sessionId: string,
  updatedAt: number,
  adapter: NativeHistoryImportSession['adapter'] = 'codex'
): NativeHistoryImportSession => ({
  adapter,
  createdAt: updatedAt - 1,
  importedEvents: 2,
  sessionId,
  sourcePath: `/history/${sessionId}.jsonl`,
  title: sessionId,
  updatedAt
})

describe('native history import prompt helpers', () => {
  it('summarizes mixed native adapters', () => {
    expect(getNativeHistoryImportAdapterSummary([
      createImportSession('session-a', 2000, 'codex'),
      createImportSession('session-b', 3000, 'claude-code')
    ])).toBe('Codex / Claude Code')
  })

  it('opens the newest imported session first', () => {
    expect(selectNativeHistoryImportPromptSession([
      createImportSession('older', 1000),
      createImportSession('newer', 4000)
    ])).toEqual(expect.objectContaining({
      sessionId: 'newer'
    }))
  })
})
