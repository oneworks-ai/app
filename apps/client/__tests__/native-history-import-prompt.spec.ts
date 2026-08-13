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
  cwd: `/workspace/${sessionId}`,
  importedEvents: 2,
  sessionId,
  sourcePath: `/history/${sessionId}.jsonl`,
  title: sessionId,
  updatedAt,
  workspaceCwd: `/workspace/${sessionId}`
})

describe('native history import prompt helpers', () => {
  it('summarizes mixed native adapters', () => {
    expect(getNativeHistoryImportAdapterSummary([
      createImportSession('session-a', 2000, 'codex'),
      createImportSession('session-b', 3000, 'claude-code')
    ])).toBe('Codex / Claude Code')
  })

  it('includes Cursor, Grok, and Qwen Code in mixed adapter summaries', () => {
    expect(getNativeHistoryImportAdapterSummary([
      createImportSession('session-a', 2000, 'cursor'),
      createImportSession('session-b', 3000, 'codex'),
      createImportSession('session-c', 4000, 'claude-code'),
      createImportSession('session-d', 5000, 'grok'),
      createImportSession('session-e', 6000, 'qwen-code')
    ])).toBe('Codex / Claude Code / Cursor / Grok / Qwen Code')
  })

  it('includes Goose and Grok in mixed adapter summaries', () => {
    expect(getNativeHistoryImportAdapterSummary([
      createImportSession('session-a', 2000, 'goose'),
      createImportSession('session-b', 3000, 'grok'),
      createImportSession('session-c', 4000, 'cursor')
    ])).toBe('Cursor / Goose / Grok')
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
