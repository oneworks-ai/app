import type { CommittedScopeIdentity } from './committed-scope-identity'
import type { PermissionModeTransitionTerminalOutcome } from './use-session-permission-mode-change'

export interface ActivePermissionModeConfirmation {
  cancel?: () => Promise<PermissionModeTransitionTerminalOutcome>
  cancelTransition?: () => Promise<PermissionModeTransitionTerminalOutcome>
  destroy?: () => void
  id: number
  scopeToken: CommittedScopeIdentity
  settle: (selected: boolean) => void
}

export const createPermissionModeSelectionSettlement = () => {
  let settled = false
  let resolveCompletion: (selected: boolean) => void = () => {}
  const completion = new Promise<boolean>((resolve) => {
    resolveCompletion = resolve
  })
  return {
    completion,
    hasSettled: () => settled,
    settle: (selected: boolean) => {
      if (settled) return
      settled = true
      resolveCompletion(selected)
    }
  }
}
