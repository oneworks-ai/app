import type { SessionWorkspace, SessionWorkspaceDerivationEligibility } from '@oneworks/types'

export interface WorkspaceActionState {
  description?: SessionWorkspaceDerivationEligibility['reason']
  disabled: boolean
}

export const getWorkspaceTransferActionState = (
  workspace: SessionWorkspace,
  isBusy: boolean
): WorkspaceActionState => ({
  description: workspace.state === 'ready'
    ? undefined
    : workspace.derivation?.reason ?? 'workspace_unavailable',
  disabled: isBusy || workspace.state !== 'ready'
})

export const getWorkspaceCreateActionState = (
  workspace: SessionWorkspace,
  isBusy: boolean
): WorkspaceActionState => ({
  description: workspace.derivation?.reason ?? 'workspace_unavailable',
  disabled: isBusy || workspace.derivation?.eligible !== true
})

export const getSessionWorkspaceMenuActions = (workspace: SessionWorkspace, isBusy: boolean) => ({
  create: workspace.kind !== 'managed_worktree'
    ? getWorkspaceCreateActionState(workspace, isBusy)
    : undefined,
  transfer: workspace.kind === 'managed_worktree'
    ? getWorkspaceTransferActionState(workspace, isBusy)
    : undefined
})
