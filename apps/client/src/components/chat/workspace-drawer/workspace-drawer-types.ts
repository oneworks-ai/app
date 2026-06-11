export type WorkspaceDrawerView =
  | 'tree'
  | 'changes'
  | 'settings'
  | 'approvals'
  | 'agents'
  | `plugin:${string}:${string}`
