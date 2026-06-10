import type { ChatRouteBottomPanelState } from '#~/hooks/chat/use-chat-route-bottom-panel'

import type { ActiveInteractionTab, InteractionPanelTab } from './interaction-panel-tabs'

export type InteractionPanelTabCloseScope = 'all' | 'current' | 'others' | 'right'

export const resolveOpenFilePath = (bottomPanel: ChatRouteBottomPanelState) => {
  const selectedPath = bottomPanel.selectedWorkspaceFilePath
  return selectedPath != null && bottomPanel.openWorkspaceFilePaths.includes(selectedPath)
    ? selectedPath
    : bottomPanel.openWorkspaceFilePaths[0] ?? null
}

export const toActiveInteractionTab = (tab: InteractionPanelTab): ActiveInteractionTab => {
  if (tab.kind === 'file') {
    return { kind: 'file', path: tab.path }
  }

  return { kind: tab.kind, id: tab.id }
}

export const getTabsForCloseScope = (
  tabs: InteractionPanelTab[],
  anchorTab: InteractionPanelTab,
  scope: InteractionPanelTabCloseScope
) => {
  const anchorIndex = tabs.findIndex(tab => tab.id === anchorTab.id)
  if (anchorIndex < 0) {
    return []
  }

  if (scope === 'all') return tabs
  if (scope === 'others') return tabs.filter(tab => tab.id !== anchorTab.id)
  if (scope === 'right') return tabs.slice(anchorIndex + 1)
  return [anchorTab]
}

export const getFallbackTabAfterClose = (
  tabs: InteractionPanelTab[],
  targetTabs: InteractionPanelTab[],
  anchorTab: InteractionPanelTab
) => {
  const targetIds = new Set(targetTabs.map(tab => tab.id))
  const remainingTabs = tabs.filter(tab => !targetIds.has(tab.id))
  const anchorIndex = tabs.findIndex(tab => tab.id === anchorTab.id)
  return remainingTabs[Math.min(Math.max(anchorIndex, 0), remainingTabs.length - 1)] ?? null
}

export const containsActiveTab = (
  activeTab: ActiveInteractionTab,
  targetTabs: InteractionPanelTab[]
) =>
  targetTabs.some((tab) => {
    if (tab.kind !== activeTab.kind) return false
    if (tab.kind === 'file' && activeTab.kind === 'file') return tab.path === activeTab.path
    return 'id' in activeTab && tab.id === activeTab.id
  })

export const closeWorkspaceFileTabsForScope = ({
  bottomPanel,
  targetTabs
}: {
  bottomPanel: ChatRouteBottomPanelState
  targetTabs: InteractionPanelTab[]
}) => {
  const filePaths = targetTabs
    .filter((tab): tab is Extract<InteractionPanelTab, { kind: 'file' }> => tab.kind === 'file')
    .map(tab => tab.path)
  if (filePaths.length <= 0) {
    return
  }

  bottomPanel.handleCloseWorkspaceFileTabs(filePaths)
}
