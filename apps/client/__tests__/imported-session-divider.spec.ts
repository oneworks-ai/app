import { describe, expect, it } from 'vitest'

import { formatImportedSessionTimestamp } from '../src/components/chat/messages/ImportedSessionDivider'
import { getImportedSessionSummary, getSessionActivityTimestamp } from '../src/utils/session-history-import'

describe('imported session divider', () => {
  it('resolves Codex and Claude Code import provenance from imported session ids', () => {
    expect(getImportedSessionSummary({
      adapter: 'codex',
      createdAt: 1_785_443_760_904,
      id: 'imported_codex_3a136df72656fa99'
    })).toEqual({
      importedAt: 1_785_443_760_904,
      sourceLabel: 'Codex'
    })
    expect(getImportedSessionSummary({
      adapter: 'claude-code',
      createdAt: 1_785_443_760_904,
      id: 'imported_claude_code_3a136df72656fa99'
    })).toEqual({
      importedAt: 1_785_443_760_904,
      sourceLabel: 'Claude Code'
    })
  })

  it('keeps migration time separate from the original session activity time', () => {
    const session = {
      adapter: 'codex',
      createdAt: 1_785_443_760_904,
      historyImport: {
        adapter: 'codex',
        importedAt: 1_785_443_760_904,
        sourceUpdatedAt: 1_744_264_400_000
      },
      id: 'imported_codex_3a136df72656fa99'
    }
    expect(getImportedSessionSummary(session)).toEqual({
      importedAt: 1_785_443_760_904,
      sourceLabel: 'Codex',
      sourceUpdatedAt: 1_744_264_400_000
    })
    expect(getSessionActivityTimestamp(session)).toBe(1_744_264_400_000)
  })

  it('does not mark ordinary or mismatched sessions as imported', () => {
    expect(getImportedSessionSummary({
      adapter: 'codex',
      createdAt: 1_785_443_760_904,
      id: 'regular-session'
    })).toBeUndefined()
    expect(getImportedSessionSummary({
      adapter: 'claude-code',
      createdAt: 1_785_443_760_904,
      id: 'imported_codex_3a136df72656fa99'
    })).toBeUndefined()
  })

  it('formats the import time for the active interface language', () => {
    expect(formatImportedSessionTimestamp(1_785_443_760_904, 'zh-CN')).toContain('2026')
    expect(formatImportedSessionTimestamp(1_785_443_760_904, 'en-US')).toContain('2026')
  })
})
