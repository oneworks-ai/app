import type { GitWorktreeSummary } from '@oneworks/types'

import { splitGitNulRecords } from './path-records'
import { getGitWorktreePathComparisonKey } from './worktree'

export const parseGitWorktrees = (output: string, currentWorktreePath: string): GitWorktreeSummary[] => {
  const worktrees: GitWorktreeSummary[] = []
  const normalizedCurrentWorktreePath = getGitWorktreePathComparisonKey(currentWorktreePath)
  let currentEntry: Partial<GitWorktreeSummary> | null = null

  const flushCurrentEntry = () => {
    if (currentEntry?.path == null || currentEntry.path === '') {
      currentEntry = null
      return
    }

    const path = currentEntry.path
    worktrees.push({
      path,
      branchName: currentEntry.branchName?.trim() || null,
      isCurrent: getGitWorktreePathComparisonKey(path) === normalizedCurrentWorktreePath,
      isDetached: currentEntry.isDetached === true
    })
    currentEntry = null
  }

  const records = output.includes('\0') ? splitGitNulRecords(output) : output.split(/\r?\n/)
  for (const rawLine of records) {
    const line = rawLine.replace(/^(?:\r\n|\r|\n)+/u, '')
    if (line.trim() === '') {
      flushCurrentEntry()
      continue
    }

    if (line.startsWith('worktree ')) {
      flushCurrentEntry()
      currentEntry = {
        path: line.slice('worktree '.length),
        branchName: null,
        isDetached: false
      }
      continue
    }

    if (currentEntry == null) {
      continue
    }

    if (line.startsWith('branch ')) {
      const branchRef = line.slice('branch '.length).trim()
      currentEntry.branchName = branchRef.startsWith('refs/heads/')
        ? branchRef.slice('refs/heads/'.length)
        : branchRef
      continue
    }

    if (line === 'detached') {
      currentEntry.isDetached = true
      currentEntry.branchName = null
    }
  }

  flushCurrentEntry()
  return worktrees
}
