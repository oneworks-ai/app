import type { GitBranchSummary } from '@oneworks/types'

import { getFilesystemPathComparisonKey, stripOptionalTrailingPathSeparators } from '#~/utils/filesystem-path-identity'

const normalizeBranchText = (value: string) => value.trim().toLowerCase()

export const normalizeGitFilesystemPathForComparison = stripOptionalTrailingPathSeparators

export const formatGitWorktreePathLabel = (value: string) => {
  const normalizedPath = normalizeGitFilesystemPathForComparison(value)
  const separator = normalizedPath.startsWith('/') ? /\//u : /[\\/]/u
  const segments = normalizedPath.split(separator).filter(Boolean)
  if (segments.length >= 2) {
    return segments.slice(-2).join('/')
  }
  return segments[0] ?? value
}

export const isGitBranchCheckedOutInOtherWorktree = (
  branch: GitBranchSummary,
  currentWorktreePath: string
) => {
  if (branch.kind !== 'local' || branch.worktreePath == null || branch.worktreePath === '') {
    return false
  }

  return getFilesystemPathComparisonKey(branch.worktreePath) !==
    getFilesystemPathComparisonKey(currentWorktreePath)
}

export const getGitBranchCheckoutBlockedPath = (
  branch: GitBranchSummary,
  branches: GitBranchSummary[],
  currentWorktreePath: string
) => {
  if (branch.kind === 'local') {
    return isGitBranchCheckedOutInOtherWorktree(branch, currentWorktreePath)
      ? branch.worktreePath ?? null
      : null
  }

  const localPeer = branches.find(item => item.kind === 'local' && item.localName === branch.localName)
  if (localPeer == null) {
    return null
  }

  return isGitBranchCheckedOutInOtherWorktree(localPeer, currentWorktreePath)
    ? localPeer.worktreePath ?? null
    : null
}

export const getGitBranchViewState = (
  visibleBranches: GitBranchSummary[],
  allBranches: GitBranchSummary[],
  currentWorktreePath: string
) => {
  const localBranches = visibleBranches.filter(branch => branch.kind === 'local')
  const isSwitchableBranch = (branch: GitBranchSummary) =>
    getGitBranchCheckoutBlockedPath(branch, allBranches, currentWorktreePath) == null
  const availableLocalBranches = localBranches.filter(isSwitchableBranch)
  const remoteBranches = visibleBranches.filter(branch => branch.kind === 'remote' && isSwitchableBranch(branch))

  return {
    availableLocalBranches,
    hasResults: availableLocalBranches.length > 0 || remoteBranches.length > 0,
    remoteBranches
  }
}

const getBranchSearchTokens = (branch: GitBranchSummary) => {
  const tokens = [branch.name, branch.localName]
  if (branch.remoteName != null && branch.remoteName !== '') {
    tokens.push(branch.remoteName, `${branch.remoteName}/${branch.localName}`)
  }
  return tokens.map(token => normalizeBranchText(token))
}

export const filterGitBranches = (branches: GitBranchSummary[], query: string) => {
  const normalizedQuery = normalizeBranchText(query)
  if (normalizedQuery === '') {
    return branches
  }

  return branches.filter(branch => getBranchSearchTokens(branch).some(token => token.includes(normalizedQuery)))
}

export const hasExactGitBranchMatch = (branches: GitBranchSummary[], query: string) => {
  const normalizedQuery = normalizeBranchText(query)
  if (normalizedQuery === '') {
    return false
  }

  return branches.some(branch => getBranchSearchTokens(branch).includes(normalizedQuery))
}
