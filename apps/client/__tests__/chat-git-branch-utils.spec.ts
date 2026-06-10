import { describe, expect, it } from 'vitest'

import type { GitBranchSummary } from '@oneworks/types'

import {
  filterGitBranches,
  formatGitWorktreePathLabel,
  getGitBranchCheckoutBlockedPath,
  getGitBranchViewState,
  hasExactGitBranchMatch,
  isGitBranchCheckedOutInOtherWorktree
} from '#~/components/chat/git-controls/git-branch-utils'

describe('chat git branch utils', () => {
  const branches: GitBranchSummary[] = [
    {
      name: 'main',
      kind: 'local',
      localName: 'main',
      isCurrent: true
    },
    {
      name: 'feature/chat-header',
      kind: 'local',
      localName: 'feature/chat-header',
      worktreePath: '/Users/yijie/.codex/worktrees/3d03/oneworks-app',
      isCurrent: false
    },
    {
      name: 'origin/main',
      kind: 'remote',
      localName: 'main',
      remoteName: 'origin',
      isCurrent: false
    },
    {
      name: 'origin/release/v1',
      kind: 'remote',
      localName: 'release/v1',
      remoteName: 'origin',
      isCurrent: false
    }
  ]

  it('filters branches by local and remote names', () => {
    expect(filterGitBranches(branches, 'release')).toEqual([
      {
        name: 'origin/release/v1',
        kind: 'remote',
        localName: 'release/v1',
        remoteName: 'origin',
        isCurrent: false
      }
    ])

    expect(filterGitBranches(branches, 'origin/main')).toEqual([
      {
        name: 'origin/main',
        kind: 'remote',
        localName: 'main',
        remoteName: 'origin',
        isCurrent: false
      }
    ])

    expect(filterGitBranches(branches, 'chat-header')).toEqual([
      {
        name: 'feature/chat-header',
        kind: 'local',
        localName: 'feature/chat-header',
        worktreePath: '/Users/yijie/.codex/worktrees/3d03/oneworks-app',
        isCurrent: false
      }
    ])
  })

  it('treats matching local or remote refs as exact matches', () => {
    expect(hasExactGitBranchMatch(branches, 'main')).toBe(true)
    expect(hasExactGitBranchMatch(branches, 'origin/main')).toBe(true)
    expect(hasExactGitBranchMatch(branches, 'feature/new-panel')).toBe(false)
  })

  it('detects branches that are checked out in another worktree', () => {
    expect(isGitBranchCheckedOutInOtherWorktree(
      {
        name: 'feature/chat-header',
        kind: 'local',
        localName: 'feature/chat-header',
        worktreePath: '/Users/yijie/.codex/worktrees/3d03/oneworks-app',
        isCurrent: false
      },
      '/Users/yijie/codes/oneworks-app'
    )).toBe(true)

    expect(getGitBranchCheckoutBlockedPath(
      {
        name: 'origin/feature/chat-header',
        kind: 'remote',
        localName: 'feature/chat-header',
        remoteName: 'origin',
        isCurrent: false
      },
      branches,
      '/Users/yijie/codes/oneworks-app'
    )).toBe('/Users/yijie/.codex/worktrees/3d03/oneworks-app')
  })

  it('formats worktree paths for compact display', () => {
    expect(formatGitWorktreePathLabel('/Users/yijie/.codex/worktrees/3d03/oneworks-app')).toBe('3d03/oneworks-app')
  })

  it('hides branches that are occupied by another worktree from the switcher view', () => {
    const allVisibleBranches: GitBranchSummary[] = [
      {
        name: 'main',
        kind: 'local',
        localName: 'main',
        worktreePath: '/Users/yijie/codes/oneworks-app',
        isCurrent: false
      },
      {
        name: 'feature/panel',
        kind: 'local',
        localName: 'feature/panel',
        isCurrent: true
      },
      {
        name: 'origin/main',
        kind: 'remote',
        localName: 'main',
        remoteName: 'origin',
        isCurrent: false
      },
      {
        name: 'origin/release/v1',
        kind: 'remote',
        localName: 'release/v1',
        remoteName: 'origin',
        isCurrent: false
      }
    ]

    const { availableLocalBranches, hasResults, remoteBranches } = getGitBranchViewState(
      allVisibleBranches,
      allVisibleBranches,
      '/Users/yijie/.codex/worktrees/3d03/oneworks-app'
    )

    expect(availableLocalBranches.map(branch => branch.name)).toEqual(['feature/panel'])
    expect(hasResults).toBe(true)
    expect(remoteBranches.map(branch => branch.name)).toEqual(['origin/release/v1'])

    const remoteOnlyQueryBranches = allVisibleBranches.filter(branch => branch.name === 'origin/main')
    expect(
      getGitBranchViewState(
        remoteOnlyQueryBranches,
        allVisibleBranches,
        '/Users/yijie/.codex/worktrees/3d03/oneworks-app'
      )
    ).toEqual({
      availableLocalBranches: [],
      hasResults: false,
      remoteBranches: []
    })
  })
})
