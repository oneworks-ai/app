// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitRepositoryState } from '@oneworks/types'

import { ChatGitControls } from '#~/components/chat/git-controls/ChatGitControls'

const mocks = vi.hoisted(() => ({
  handleRefreshGitState: vi.fn(),
  operationProps: undefined as {
    compact?: boolean
    onOpenChange: (open: boolean) => void
    onRefresh: () => void
  } | undefined,
  setBranchMenuOpen: vi.fn(),
  setOperationsMenuOpen: vi.fn(),
  setWorktreeMenuOpen: vi.fn(),
  useChatGitControls: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('#~/api', () => ({
  syncSessionGitBranch: vi.fn()
}))

vi.mock('#~/components/chat/git-controls/use-chat-git-controls', () => ({
  useChatGitControls: mocks.useChatGitControls
}))

vi.mock('#~/components/chat/git-controls/GitOperationsDropdown', () => ({
  GitOperationsDropdown: (props: NonNullable<typeof mocks.operationProps>) => {
    mocks.operationProps = props
    return (
      <>
        <button aria-label='Open Git actions' onClick={() => props.onOpenChange(true)} />
        <button aria-label='Refresh Git status' onClick={props.onRefresh} />
      </>
    )
  }
}))

vi.mock('#~/components/chat/git-controls/BranchSwitcherDropdown', () => ({
  BranchSwitcherDropdown: () => null
}))

vi.mock('#~/components/chat/git-controls/GitCommitModal', () => ({
  GitCommitModal: () => null
}))

vi.mock('#~/components/chat/git-controls/GitPushModal', () => ({
  GitPushModal: () => null
}))

vi.mock('#~/components/chat/git-controls/GitWorktreeDropdown', () => ({
  GitWorktreeDropdown: () => null
}))

const repoState: GitRepositoryState = {
  available: true,
  cwd: '/workspace',
  repositoryRoot: '/workspace',
  currentBranch: 'main',
  hasChanges: false,
  remotes: ['origin']
}

describe.each([false, true])('chat Git controls refresh wiring compact=%s', (compact) => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    mocks.handleRefreshGitState.mockReset().mockResolvedValue(undefined)
    mocks.operationProps = undefined
    mocks.setBranchMenuOpen.mockReset()
    mocks.setOperationsMenuOpen.mockReset()
    mocks.setWorktreeMenuOpen.mockReset()
    mocks.useChatGitControls.mockReset().mockReturnValue({
      availableLocalBranches: [],
      branchMenuOpen: false,
      branchQuery: '',
      canCommitAndPush: false,
      canCreateBranch: false,
      commitAmend: false,
      commitBlockedMessage: '',
      commitForcePush: false,
      commitIncludeUnstagedChanges: true,
      commitMessage: '',
      commitMessageError: '',
      commitModalOpen: false,
      commitNextStep: 'commit',
      commitSkipHooks: false,
      commitSummary: null,
      currentBranchLabel: 'main',
      handleRefreshGitState: mocks.handleRefreshGitState,
      hasBranchResults: false,
      isBranchListLoading: false,
      isBusy: false,
      isGitStateRefreshing: false,
      operationsMenuOpen: false,
      pendingAction: null,
      pushBlockedMessage: '',
      pushForce: false,
      pushModalOpen: false,
      remoteBranches: [],
      repoState,
      setBranchMenuOpen: mocks.setBranchMenuOpen,
      setOperationsMenuOpen: mocks.setOperationsMenuOpen,
      setWorktreeMenuOpen: mocks.setWorktreeMenuOpen,
      showWorktreeButton: false,
      workspace: undefined,
      worktreeMenuOpen: false,
      worktrees: []
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('uses the same explicit refresh for menu-open and manual actions', async () => {
    await act(async () => {
      root.render(<ChatGitControls compact={compact} sessionId='session-1' />)
    })

    const openButton = container.querySelector<HTMLButtonElement>('button[aria-label="Open Git actions"]')
    const refreshButton = container.querySelector<HTMLButtonElement>('button[aria-label="Refresh Git status"]')
    if (openButton == null || refreshButton == null) {
      throw new Error('Git refresh wiring controls were not rendered')
    }

    await act(async () => openButton.click())
    expect(mocks.operationProps?.compact).toBe(compact)
    expect(mocks.setOperationsMenuOpen).toHaveBeenCalledWith(true)
    expect(mocks.setBranchMenuOpen).toHaveBeenCalledWith(false)
    expect(mocks.setWorktreeMenuOpen).toHaveBeenCalledWith(false)
    expect(mocks.handleRefreshGitState).toHaveBeenCalledOnce()

    await act(async () => refreshButton.click())
    expect(mocks.handleRefreshGitState).toHaveBeenCalledTimes(2)
  })
})
