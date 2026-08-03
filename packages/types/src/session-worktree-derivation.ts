export type SessionWorktreeDerivationDisabledReason =
  | 'already_managed_worktree'
  | 'workspace_unavailable'
  | 'external_runtime'
  | 'not_repository'
  | 'git_not_installed'
  | 'repository_unavailable'
  | 'dirty_worktree'

export interface SessionWorktreeDerivationEligibility {
  eligible: boolean
  disabledReason?: SessionWorktreeDerivationDisabledReason
}
