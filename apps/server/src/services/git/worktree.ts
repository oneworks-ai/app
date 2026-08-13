import type { GitBranchSummary } from '@oneworks/types'

type GitWorktreePathFamily =
  | 'posix-absolute'
  | 'posix-relative'
  | 'windows-drive-rooted'
  | 'windows-drive-relative'
  | 'windows-rooted'
  | 'windows-unc'

const gitWorktreePathFamily = (value: string): GitWorktreePathFamily => {
  if (/^[\\/]{2}/u.test(value)) return 'windows-unc'
  if (/^[a-z]:[\\/]/iu.test(value)) return 'windows-drive-rooted'
  if (/^[a-z]:/iu.test(value)) return 'windows-drive-relative'
  if (value.startsWith('\\')) return 'windows-rooted'
  return value.startsWith('/') ? 'posix-absolute' : 'posix-relative'
}

const getRootLength = (value: string, family: GitWorktreePathFamily) => {
  if (family === 'windows-unc') return /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/u.exec(value)?.[0].length ?? 2
  if (family === 'windows-drive-rooted') return 3
  if (family === 'windows-drive-relative') return 2
  return family === 'windows-rooted' || family === 'posix-absolute' ? 1 : 0
}

export const getGitWorktreePathComparisonKey = (value: string) => {
  const family = gitWorktreePathFamily(value)
  const windowsFamily = family.startsWith('windows-')
  const rootLength = getRootLength(value, family)
  const isSeparator = windowsFamily
    ? (character: string) => character === '/' || character === '\\'
    : (character: string) => character === '/'
  let end = value.length
  while (end > rootLength && isSeparator(value[end - 1])) end -= 1
  const normalized = windowsFamily ? value.slice(0, end).replace(/[\\/]+/gu, '/').toLowerCase() : value.slice(0, end)
  return `${family}:${normalized}`
}

export const getBlockedGitWorktreePath = (
  target: GitBranchSummary,
  branches: GitBranchSummary[],
  currentWorktreePath: string
) => {
  const normalizedCurrentWorktreePath = getGitWorktreePathComparisonKey(currentWorktreePath)

  if (target.kind === 'local') {
    if (target.worktreePath == null || target.worktreePath === '') {
      return null
    }

    const normalizedTargetWorktreePath = getGitWorktreePathComparisonKey(target.worktreePath)
    return normalizedTargetWorktreePath === normalizedCurrentWorktreePath ? null : target.worktreePath
  }

  const localPeer = branches.find(branch => branch.kind === 'local' && branch.localName === target.localName)
  if (localPeer?.worktreePath == null || localPeer.worktreePath === '') {
    return null
  }

  const normalizedPeerWorktreePath = getGitWorktreePathComparisonKey(localPeer.worktreePath)
  return normalizedPeerWorktreePath === normalizedCurrentWorktreePath ? null : localPeer.worktreePath
}
