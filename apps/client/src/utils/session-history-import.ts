import type { Session } from '@oneworks/core'

const importedSessionAdapters = {
  'claude-code': {
    idSegment: 'claude_code',
    sourceLabel: 'Claude Code'
  },
  codex: {
    idSegment: 'codex',
    sourceLabel: 'Codex'
  }
} as const

type ImportedSessionAdapter = keyof typeof importedSessionAdapters

export interface ImportedSessionSummary {
  importedAt: number
  sourceLabel: string
  sourceUpdatedAt?: number
}

const isImportedSessionAdapter = (value: string | undefined): value is ImportedSessionAdapter => (
  value != null && Object.hasOwn(importedSessionAdapters, value)
)

export const getImportedSessionSummary = (
  session: Pick<Session, 'adapter' | 'createdAt' | 'historyImport' | 'id'> | undefined
): ImportedSessionSummary | undefined => {
  if (session == null) {
    return undefined
  }

  const historyImport = session.historyImport
  if (
    historyImport != null &&
    isImportedSessionAdapter(historyImport.adapter) &&
    Number.isFinite(historyImport.importedAt) &&
    Number.isFinite(historyImport.sourceUpdatedAt)
  ) {
    return {
      importedAt: historyImport.importedAt,
      sourceLabel: importedSessionAdapters[historyImport.adapter].sourceLabel,
      sourceUpdatedAt: historyImport.sourceUpdatedAt
    }
  }

  if (!isImportedSessionAdapter(session.adapter) || !Number.isFinite(session.createdAt)) {
    return undefined
  }

  const adapter = importedSessionAdapters[session.adapter]
  if (!session.id.startsWith(`imported_${adapter.idSegment}_`)) {
    return undefined
  }

  return {
    importedAt: session.createdAt,
    sourceLabel: adapter.sourceLabel
  }
}

export const getSessionActivityTimestamp = (
  session: Pick<Session, 'adapter' | 'createdAt' | 'historyImport' | 'id'>
) => getImportedSessionSummary(session)?.sourceUpdatedAt ?? session.createdAt
