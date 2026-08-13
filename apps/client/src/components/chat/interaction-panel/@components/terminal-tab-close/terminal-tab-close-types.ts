export interface PanelTabCloseExecutionResult {
  activeTabId?: string
  failedTabIds: string[]
}

export interface PanelTabClosePreflightHandle {
  close: (onAfterHidden?: () => void) => void
}

export type PanelTabClosePreflight = (
  actions: { cancel: () => void; proceed: () => void }
) => PanelTabClosePreflightHandle
