// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitRepositoryState } from '@oneworks/types'

import { useChatGitControls } from '#~/components/chat/git-controls/use-chat-git-controls'

const mocks = vi.hoisted(() => ({
  messageError: vi.fn(),
  mutateBranchData: vi.fn(),
  mutateRepoState: vi.fn(),
  mutateWorkspaceData: vi.fn(),
  mutateWorktreeData: vi.fn(),
  refreshRepoState: vi.fn(),
  resetPushState: vi.fn(),
  setWorktreeMenuOpen: vi.fn(),
  useSWR: vi.fn()
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: mocks.messageError,
        success: vi.fn()
      }
    })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('swr', () => ({
  default: mocks.useSWR
}))

vi.mock('#~/api', () => ({
  checkoutSessionGitBranch: vi.fn(),
  createSessionGitBranch: vi.fn(),
  createSessionManagedWorktree: vi.fn(),
  getApiErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? `${fallback}: ${error.message}` : fallback,
  getSessionWorkspace: vi.fn(),
  listSessionGitBranches: vi.fn(),
  transferSessionWorkspaceToLocal: vi.fn()
}))

vi.mock('#~/components/chat/git-controls/use-session-git-state', () => ({
  useSessionGitState: () => ({
    data: {
      available: true,
      cwd: '/workspace',
      repositoryRoot: '/workspace',
      currentBranch: 'main',
      hasChanges: false,
      remotes: ['origin']
    } satisfies GitRepositoryState,
    isValidating: false,
    mutate: mocks.mutateRepoState,
    refresh: mocks.refreshRepoState
  })
}))

vi.mock('#~/components/chat/git-controls/use-chat-git-commit', () => ({
  useChatGitCommit: () => ({})
}))

vi.mock('#~/components/chat/git-controls/use-chat-git-push-state', () => ({
  useChatGitPushState: () => ({
    pushForce: false,
    pushModalOpen: false,
    resetPushState: mocks.resetPushState,
    setPushForce: vi.fn(),
    setPushModalOpen: vi.fn()
  })
}))

vi.mock('#~/components/chat/git-controls/use-chat-git-worktrees', () => ({
  useChatGitWorktrees: () => ({
    mutateWorktreeData: mocks.mutateWorktreeData,
    setWorktreeMenuOpen: mocks.setWorktreeMenuOpen,
    showWorktreeButton: false,
    worktreeMenuOpen: false,
    worktrees: []
  })
}))

describe('chat Git controls refresh failure', () => {
  let container: HTMLDivElement
  let controls: ReturnType<typeof useChatGitControls> | undefined
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    mocks.messageError.mockReset()
    mocks.mutateBranchData.mockReset().mockResolvedValue(undefined)
    mocks.mutateRepoState.mockReset().mockResolvedValue(undefined)
    mocks.mutateWorkspaceData.mockReset().mockResolvedValue(undefined)
    mocks.mutateWorktreeData.mockReset().mockResolvedValue(undefined)
    mocks.refreshRepoState.mockReset()
    mocks.resetPushState.mockReset()
    mocks.setWorktreeMenuOpen.mockReset()
    mocks.useSWR.mockReset().mockImplementation((key: unknown) => {
      if (Array.isArray(key) && key[0] === 'session-workspace') {
        return { data: undefined, mutate: mocks.mutateWorkspaceData }
      }
      return { data: undefined, isLoading: false, mutate: mocks.mutateBranchData }
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('turns an explicit request failure into a localized actionable toast', async () => {
    const refreshError = new Error('git status unavailable')
    mocks.refreshRepoState.mockRejectedValue(refreshError)

    function Harness() {
      controls = useChatGitControls('session-1')
      return null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => controls?.handleRefreshGitState())

    expect(mocks.refreshRepoState).toHaveBeenCalledOnce()
    expect(mocks.messageError).toHaveBeenCalledWith(
      'chat.gitRefreshStatusFailed: git status unavailable'
    )
  })
})
