import type { GitChangeSummary, GitHeadCommitSummary } from '@oneworks/types'

import { splitGitNulRecords } from './path-records'

export interface ParsedGitNumstatEntry {
  path: string
  additions: number
  deletions: number
}

export const parseGitNumstat = (output: string): ParsedGitNumstatEntry[] => {
  const entries: ParsedGitNumstatEntry[] = []

  if (output.includes('\0')) {
    const records = splitGitNulRecords(output)
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index] ?? ''
      const firstTab = record.indexOf('\t')
      const secondTab = firstTab < 0 ? -1 : record.indexOf('\t', firstTab + 1)
      if (firstTab < 0 || secondTab < 0) continue
      const additionsText = record.slice(0, firstTab)
      const deletionsText = record.slice(firstTab + 1, secondTab)
      const inlinePath = record.slice(secondTab + 1)
      let path = inlinePath
      if (path === '') {
        index += 2
        path = records[index] ?? ''
      }
      if (path === '') continue
      entries.push({
        path,
        additions: additionsText === '-' ? 0 : Number.parseInt(additionsText, 10) || 0,
        deletions: deletionsText === '-' ? 0 : Number.parseInt(deletionsText, 10) || 0
      })
    }
    return entries
  }

  for (const rawLine of output.split(/\r?\n/)) {
    if (rawLine.trim() === '') {
      continue
    }

    const [additionsText = '', deletionsText = '', ...pathParts] = rawLine.split('\t')
    const path = pathParts.at(-1) ?? ''
    if (path === '') {
      continue
    }

    entries.push({
      path,
      additions: additionsText === '-' ? 0 : Number.parseInt(additionsText, 10) || 0,
      deletions: deletionsText === '-' ? 0 : Number.parseInt(deletionsText, 10) || 0
    })
  }

  return entries
}

export const summarizeGitNumstat = (entries: ParsedGitNumstatEntry[]): GitChangeSummary => {
  const summaryByPath = new Map<string, { additions: number; deletions: number }>()

  for (const entry of entries) {
    const existing = summaryByPath.get(entry.path) ?? { additions: 0, deletions: 0 }
    existing.additions += entry.additions
    existing.deletions += entry.deletions
    summaryByPath.set(entry.path, existing)
  }

  return {
    changedFiles: summaryByPath.size,
    additions: Array.from(summaryByPath.values()).reduce((count, entry) => count + entry.additions, 0),
    deletions: Array.from(summaryByPath.values()).reduce((count, entry) => count + entry.deletions, 0)
  }
}

export const parseGitHeadCommit = (output: string): GitHeadCommitSummary | null => {
  const [hash = '', subject = ''] = output.split('\t')
  if (hash.trim() === '' || subject.trim() === '') {
    return null
  }

  return { hash, shortHash: hash.slice(0, 7), subject }
}
